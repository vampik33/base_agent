import { execFileSync } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type Database from "better-sqlite3";
import type { Config } from "../config.js";
import type { ModelProfileRegistry } from "../models/profiles.js";
import { buildModelEnv } from "../util.js";
import type { MessageLogger } from "./message-logger.js";

const PROTECTED_FILES = new Set([
  "src/core/self-evolve.ts",
  "src/config.ts",
  "run.sh",
  ".env",
  ".gitignore",
]);

const ALLOWED_PATH_PREFIXES = ["src/", "skills/", "CLAUDE.md"];

const MAX_CONSECUTIVE_FAILURES = 3;
const SELF_EVOLVE_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];

class EvolutionFailure extends Error {
  override name = "EvolutionFailure";
}

export class SelfEvolver {
  private consecutiveFailures = 0;

  constructor(
    private db: Database.Database,
    private config: Config,
    private models: ModelProfileRegistry,
    private logger: MessageLogger
  ) {
    const recentFailures = this.db
      .prepare(`
        SELECT status FROM evolution_log
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(MAX_CONSECUTIVE_FAILURES) as Array<{ status: string }>;

    this.consecutiveFailures = 0;
    for (const row of recentFailures) {
      if (row.status === "failed") {
        this.consecutiveFailures++;
      } else {
        break;
      }
    }
  }

  /** Returns true if evolution succeeded and the process should restart. */
  async evolve(objective?: string): Promise<boolean> {
    if (!this.config.selfEvolveEnabled) {
      console.log("[self-evolve] Self-evolution is disabled.");
      return false;
    }

    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.log(`[self-evolve] Disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures.`);
      return false;
    }

    const cwd = this.config.workDir;
    const branch = this.config.selfEvolveBranch;
    const baseBranch = this.config.defaultBranch;
    let originalBranch = "";

    // Ensure clean working tree
    try {
      const status = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf-8" }).trim();
      if (status) {
        console.log("[self-evolve] Working tree is not clean. Aborting.");
        return false;
      }
    } catch (err) {
      console.error("[self-evolve] Not a git repo or git not available:", err);
      return false;
    }

    try {
      originalBranch = this.getCurrentBranch(cwd);
    } catch (err) {
      console.error("[self-evolve] Failed to detect current branch:", err);
      return false;
    }

    // Create/reset evolve branch from configured base branch
    try {
      this.checkoutBranch(cwd, baseBranch);
      try {
        execFileSync("git", ["branch", "-D", branch], { cwd, stdio: "ignore" });
      } catch {
        // Branch may not exist yet — that's fine
      }
      execFileSync("git", ["checkout", "-B", branch], { cwd, stdio: "pipe" });
    } catch (err) {
      try {
        this.checkoutBranch(cwd, originalBranch);
      } catch {
        // Best-effort restore.
      }
      console.error(`[self-evolve] Failed to create evolution branch from ${baseBranch}:`, err);
      return false;
    }

    const description = objective ?? "Analyze recent task results and identify improvements to make";
    let diff = "";
    let validatedFiles: string[] = [];

    try {
      const result = await this.attemptEvolution(cwd, description);
      diff = result.diff;
      validatedFiles = result.files;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (!(err instanceof EvolutionFailure)) {
        console.error("[self-evolve] Unexpected error:", errorMessage);
      }

      this.abortEvolution(cwd, baseBranch, originalBranch, branch);
      this.logAttempt(description, diff, null, "failed", errorMessage);
      this.consecutiveFailures++;
      return false;
    }

    let commitHash = "";

    try {
      // All gates passed -- stage only validated files, then commit and merge
      execFileSync("git", ["add", "--", ...validatedFiles], { cwd });
      diff = execFileSync("git", ["diff", "--cached"], { cwd, encoding: "utf-8" }).trim();
      execFileSync("git", ["commit", "-m", `self-evolve: ${description.slice(0, 72)}`], { cwd, stdio: "pipe" });
      commitHash = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8" }).trim();

      this.checkoutBranch(cwd, baseBranch);
      execFileSync("git", ["merge", "--ff-only", branch], { cwd, stdio: "pipe" });
      execFileSync("git", ["branch", "-d", branch], { cwd, stdio: "pipe" });
    } catch (err) {
      const errorMessage = `Git finalize failed:\n${extractStderr(err).slice(0, 2000)}`;
      console.error("[self-evolve]", errorMessage);
      this.abortEvolution(cwd, baseBranch, originalBranch, branch);
      this.logAttempt(description, diff, null, "failed", errorMessage);
      this.consecutiveFailures++;
      return false;
    }

    this.logAttempt(description, diff, commitHash, "success", null);
    this.consecutiveFailures = 0;

    console.log(`[self-evolve] Evolution successful (${commitHash.slice(0, 8)}). Restarting...`);
    return true;
  }

  /** Run the agent, validate changes, and run quality gates. Throws on failure. */
  private async attemptEvolution(cwd: string, description: string): Promise<{ diff: string; files: string[] }> {
    const profile = this.models.getDefault();
    const systemPrompt = this.buildSystemPrompt();
    const prompt = this.buildPrompt(description);

    for await (const message of query({
      prompt,
      options: {
        model: profile.model,
        env: buildModelEnv(profile),
        systemPrompt,
        tools: SELF_EVOLVE_TOOLS,
        maxTurns: 30,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        cwd,
      },
    })) {
      this.logger.log("self-evolve", message);
    }

    const diff = execFileSync("git", ["diff"], { cwd, encoding: "utf-8" }).trim();
    const untrackedOutput = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd, encoding: "utf-8" }).trim();

    if (!diff && !untrackedOutput) {
      console.log("[self-evolve] No changes made. Aborting.");
      throw new EvolutionFailure("No changes were made");
    }

    const changedFiles = splitNonEmpty(
      execFileSync("git", ["diff", "--name-only"], { cwd, encoding: "utf-8" })
    );
    const untrackedFiles = splitNonEmpty(untrackedOutput);
    const allChanged = [...changedFiles, ...untrackedFiles];

    for (const file of allChanged) {
      if (PROTECTED_FILES.has(file)) {
        console.log(`[self-evolve] Protected file modified: ${file}. Aborting.`);
        throw new EvolutionFailure(`Protected file modified: ${file}`);
      }

      if (!ALLOWED_PATH_PREFIXES.some((prefix) => file.startsWith(prefix))) {
        console.log(`[self-evolve] File outside allowed paths: ${file}. Aborting.`);
        throw new EvolutionFailure(`File outside allowed paths: ${file}`);
      }
    }

    // Gate 1: Typecheck
    this.runGate(cwd, "npx", ["tsc", "--noEmit"], "Typecheck");

    // Gate 2: Tests
    this.runGate(cwd, "npm", ["test"], "Tests");

    return { diff, files: allChanged };
  }

  private runGate(cwd: string, cmd: string, args: string[], label: string): void {
    try {
      execFileSync(cmd, args, { cwd, encoding: "utf-8", stdio: "pipe" });
      console.log(`[self-evolve] ${label} passed.`);
    } catch (err) {
      console.log(`[self-evolve] ${label} failed. Aborting.`);
      throw new EvolutionFailure(
        `${label} failed:\n${extractStderr(err).slice(0, 2000)}`
      );
    }
  }

  private abortEvolution(cwd: string, baseBranch: string, originalBranch: string, branch: string): void {
    try {
      this.checkoutBranch(cwd, baseBranch);
      execFileSync("git", ["branch", "-D", branch], { cwd, stdio: "ignore" });
      if (originalBranch && originalBranch !== baseBranch) {
        this.checkoutBranch(cwd, originalBranch);
      }
    } catch {
      // Best-effort cleanup
    }
  }

  private getCurrentBranch(cwd: string): string {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf-8" }).trim();
  }

  private checkoutBranch(cwd: string, branch: string): void {
    execFileSync("git", ["checkout", branch], { cwd, stdio: "pipe" });
  }

  private logAttempt(
    description: string,
    diff: string,
    commitHash: string | null,
    status: "success" | "failed",
    errorOutput: string | null
  ): void {
    this.db
      .prepare(`
        INSERT INTO evolution_log (description, diff, commit_hash, status, error_output)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(description, diff, commitHash, status, errorOutput);
  }

  private buildSystemPrompt(): string {
    return `You are a self-evolving agent tasked with improving your own source code.

## Rules
- You may ONLY modify files under these paths: ${ALLOWED_PATH_PREFIXES.join(", ")}
- You may NOT modify these protected files: ${[...PROTECTED_FILES].join(", ")}
- Make targeted, focused changes — don't rewrite entire files unnecessarily
- Explain what you changed and why in your final response
- Your changes must pass TypeScript typecheck (tsc --noEmit) and tests (npm test)

## What You Can Improve
- Fix bugs or inefficiencies in existing code
- Add new skills (markdown files in skills/)
- Improve error handling or logging
- Optimize task execution patterns
- Add useful MCP tools to the skill registry`;
  }

  private buildPrompt(objective: string): string {
    const recentTasks = this.db
      .prepare(`
        SELECT title, result, status FROM tasks
        ORDER BY updated_at DESC
        LIMIT 10
      `)
      .all() as Array<{ title: string; result: string | null; status: string }>;

    const recentEvolutions = this.db
      .prepare(`
        SELECT description, status, error_output FROM evolution_log
        ORDER BY created_at DESC
        LIMIT 5
      `)
      .all() as Array<{ description: string; status: string; error_output: string | null }>;

    const sections = [`# Objective\n\n${objective}`];

    if (recentTasks.length > 0) {
      const taskList = recentTasks
        .map((t) => `- [${t.status}] ${t.title}: ${(t.result ?? "no result").slice(0, 150)}`)
        .join("\n");
      sections.push(`## Recent Task Results\n${taskList}`);
    }

    if (recentEvolutions.length > 0) {
      const evoList = recentEvolutions
        .map((e) => `- [${e.status}] ${e.description}${e.error_output ? `: ${e.error_output.slice(0, 100)}` : ""}`)
        .join("\n");
      sections.push(`## Recent Evolution Attempts\n${evoList}`);
    }

    sections.push(
      "## Instructions\n" +
      "Read the codebase, identify a specific improvement to make, implement it, " +
      "and explain your changes. Focus on the objective above."
    );

    return sections.join("\n\n");
  }
}

function extractStderr(err: unknown): string {
  if (err && typeof err === "object" && "stderr" in err) {
    return String(err.stderr);
  }
  return String(err);
}

/** Split a string by newlines and filter out empty entries. */
function splitNonEmpty(text: string): string[] {
  return text.trim().split("\n").filter((line) => line.length > 0);
}
