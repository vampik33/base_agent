import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { initDatabase } from "./memory/db.js";
import { MemoryStore } from "./memory/store.js";
import { ModelProfileRegistry } from "./models/profiles.js";
import { loadSkills } from "./skills/loader.js";
import { SkillRegistry } from "./skills/registry.js";
import { Planner } from "./core/planner.js";
import { AgentScheduler } from "./core/scheduler.js";
import { SelfEvolver } from "./core/self-evolve.js";
import type { AgentContext } from "./types.js";

async function main(): Promise<void> {
  console.log("[agent] Starting...");

  // ── Config ──────────────────────────────────────────
  const config = loadConfig();
  console.log(`[agent] Work directory: ${config.workDir}`);

  // ── Directories ─────────────────────────────────────
  const dataDir = resolve(config.workDir, "data");
  const skillsDir = resolve(config.workDir, "skills");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });

  // ── Database ────────────────────────────────────────
  const dbPath = resolve(dataDir, "agent.db");
  const db = initDatabase(dbPath);
  console.log(`[agent] Database initialized at ${dbPath}`);

  try {
    // ── Core services ───────────────────────────────────
    const memory = new MemoryStore(db);
    const models = new ModelProfileRegistry(config);
    const planner = new Planner(db);
    const orphaned = planner.recoverOrphaned();
    if (orphaned > 0) {
      console.log(`[agent] Recovered ${orphaned} orphaned task(s) from previous crash.`);
    }

    // ── Skills ──────────────────────────────────────────
    const loadedSkills = loadSkills(skillsDir);
    const skills = new SkillRegistry({
      skills: loadedSkills,
      memory,
      planner,
      db,
    });

    // ── Agent context (DI container) ────────────────────
    const ctx: AgentContext = {
      db,
      config,
      planner,
      memory,
      skills,
      models,
    };

    // ── Scheduler ───────────────────────────────────────
    const scheduler = new AgentScheduler(config.cronExpression, ctx);

    // ── Graceful shutdown ───────────────────────────────
    let shuttingDown = false;
    function shutdown(signal: string): void {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n[agent] Received ${signal}, shutting down...`);

      scheduler.stop();

      const orphaned = planner.recoverOrphaned();
      if (orphaned > 0) {
        console.log(`[agent] Marked ${orphaned} running task(s) as failed.`);
      }

      db.close();
      console.log("[agent] Goodbye!");
      process.exit(0);
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // ── Initial tick ────────────────────────────────────
    console.log("[agent] Running initial tick...");
    await scheduler.triggerNow();

    // ── Self-evolution (after initial tick) ──────────────
    if (config.selfEvolveEnabled) {
      const evolver = new SelfEvolver(db, config, models);
      if (await evolver.evolve()) {
        db.close();
        process.exit(100); // Signal run.sh to rebuild and restart
      }
    }

    // ── Start cron scheduler ────────────────────────────
    scheduler.start();
    console.log("[agent] Agent is running. Press Ctrl+C to stop.");
  } catch (err) {
    try { db.close(); } catch { /* best-effort */ }
    throw err;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
