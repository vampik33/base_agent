import { execSync } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type Database from "better-sqlite3";
import type { Config } from "../config.js";
import type { ModelProfileRegistry } from "../models/profiles.js";
import { buildModelEnv } from "../util.js";

/** Files the self-evolving agent is NOT allowed to modify. */
const PROTECTED_FILES = new Set([
  "src/core/self-evolve.ts",
  "src/config.ts",
  "run.sh",
  ".env",
  ".gitignore",
]);

/** Paths the self-evolving agent IS allowed to modify. */
const ALLOWED_PATH_PREFIXES = ["src/", "skills/", "CLAUDE.md"];

const MAX_CONSECUTIVE_FAILURES = 3;
const SELF_EVOLVE_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];

export class SelfEvolver {
  private consecutiveFailures = 0;

  constructor(
    private db: Database.Database,
    private config: Config,
    private models: ModelProfileRegistry
  ) {
    // Load consecutive failure count from recent evolution log
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

  /**
   * Attempt self-evolution. Returns true if evolution succeeded and process should restart.
   */
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

    // Ensure clean working tree
    try {
      const status = execSync("git status --porcelain", { cwd, encoding: "utf-8" }).trim();
      if (status) {
        console.log("[self-evolve] Working tree is not clean. Aborting.");
        return false;
      }
    } catch (err) {
      console.error("[self-evolve] Not a git repo or git not available:", err);
      return false;
    }

    // Create/checkout evolve branch from current HEAD
    try {
      execSync(`git branch -D ${branch} 2>/dev/null || true`, { cwd });
      execSync(`git checkout -b ${branch}`, { cwd });
    } catch (err) {
      console.error("[self-evolve] Failed to create branch:", err);
      return false;
    }

    const description = objective ?? "Analyze recent task results and identify improvements to make";
    let diff = "";
    let commitHash: string | null = null;
    let errorOutput: string | null = null;

    try {
      // Run Agent SDK with self-evolve prompt
      const profile = this.models.getDefault();
      const systemPrompt = this.buildSystemPrompt();
      const prompt = this.buildPrompt(description);

      for await (const _message of query({
        prompt,
        options: {
          model: profile.model,
          env: buildModelEnv(profile),
          systemPrompt,
          allowedTools: SELF_EVOLVE_TOOLS,
          maxTurns: 30,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          cwd,
        },
      })) {
        // Consume the stream — we check git diff for actual changes
      }

      // Check if any changes were made
      diff = execSync("git diff", { cwd, encoding: "utf-8" }).trim();
      const untrackedOutput = execSync("git ls-files --others --exclude-standard", { cwd, encoding: "utf-8" }).trim();

      if (!diff && !untrackedOutput) {
        console.log("[self-evolve] No changes made. Aborting.");
        this.abortEvolution(cwd, branch);
        this.logAttempt(description, "", null, "failed", "No changes were made");
        this.consecutiveFailures++;
        return false;
      }

      // Validate that only allowed files were modified
      const changedFiles = execSync("git diff --name-only", { cwd, encoding: "utf-8" })
        .trim()
        .split("\n")
        .filter((f) => f.length > 0);
      const untrackedFiles = untrackedOutput ? untrackedOutput.split("\n").filter((f) => f.length > 0) : [];
      const allChanged = [...changedFiles, ...untrackedFiles];

      for (const file of allChanged) {
        if (PROTECTED_FILES.has(file)) {
          console.log(`[self-evolve] Protected file modified: ${file}. Aborting.`);
          this.abortEvolution(cwd, branch);
          this.logAttempt(description, diff, null, "failed", `Protected file modified: ${file}`);
          this.consecutiveFailures++;
          return false;
        }

        if (!ALLOWED_PATH_PREFIXES.some((prefix) => file.startsWith(prefix))) {
          console.log(`[self-evolve] File outside allowed paths: ${file}. Aborting.`);
          this.abortEvolution(cwd, branch);
          this.logAttempt(description, diff, null, "failed", `File outside allowed paths: ${file}`);
          this.consecutiveFailures++;
          return false;
        }
      }

      // Gate 1: Typecheck
      try {
        execSync("npx tsc --noEmit", { cwd, encoding: "utf-8", stdio: "pipe" });
        console.log("[self-evolve] Typecheck passed.");
      } catch (err) {
        const stderr = err instanceof Error && "stderr" in err ? String((err as { stderr: unknown }).stderr) : String(err);
        console.log("[self-evolve] Typecheck failed. Aborting.");
        this.abortEvolution(cwd, branch);
        this.logAttempt(description, diff, null, "failed", `Typecheck failed:\n${stderr.slice(0, 2000)}`);
        this.consecutiveFailures++;
        return false;
      }

      // Gate 2: Tests (if they exist)
      try {
        execSync("npm test", { cwd, encoding: "utf-8", stdio: "pipe" });
        console.log("[self-evolve] Tests passed.");
      } catch (err) {
        const stderr = err instanceof Error && "stderr" in err ? String((err as { stderr: unknown }).stderr) : String(err);
        console.log("[self-evolve] Tests failed. Aborting.");
        this.abortEvolution(cwd, branch);
        this.logAttempt(description, diff, null, "failed", `Tests failed:\n${stderr.slice(0, 2000)}`);
        this.consecutiveFailures++;
        return false;
      }

      // All gates passed — commit and merge
      execSync("git add -A", { cwd });
      diff = execSync("git diff --cached", { cwd, encoding: "utf-8" }).trim();
      execSync(`git commit -m "self-evolve: ${description.slice(0, 72)}"`, { cwd });
      commitHash = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8" }).trim();

      // Merge to main (fast-forward)
      execSync("git checkout main", { cwd });
      execSync(`git merge ${branch}`, { cwd });
      execSync(`git branch -d ${branch}`, { cwd });

      this.logAttempt(description, diff, commitHash, "success", null);
      this.consecutiveFailures = 0;

      console.log(`[self-evolve] Evolution successful (${commitHash!.slice(0, 8)}). Restarting...`);
      return true;
    } catch (err) {
      errorOutput = err instanceof Error ? err.message : String(err);
      console.error("[self-evolve] Unexpected error:", errorOutput);
      this.abortEvolution(cwd, branch);
      this.logAttempt(description, diff, null, "failed", errorOutput);
      this.consecutiveFailures++;
      return false;
    }
  }

  private abortEvolution(cwd: string, branch: string): void {
    try {
      execSync("git checkout main", { cwd });
      execSync(`git branch -D ${branch}`, { cwd });
    } catch {
      // Best-effort cleanup
    }
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
    // Fetch recent task results for context
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
