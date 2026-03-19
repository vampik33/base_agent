import { Cron } from "croner";
import type { AgentContext } from "../types.js";
import { executeTask } from "./executor.js";
import { formatDuration } from "../util.js";

export class AgentScheduler {
  private cron: Cron | null = null;
  private running = false;
  private abortController: AbortController | null = null;

  constructor(
    private cronExpression: string,
    private ctx: AgentContext
  ) {}

  start(): void {
    this.cron = new Cron(this.cronExpression, () => {
      this.onTick().catch((err) => {
        console.error("[scheduler] Tick error:", err);
      });
    });
    console.log(`[scheduler] Started with cron: ${this.cronExpression}`);
  }

  stop(): void {
    if (this.cron) {
      this.cron.stop();
      this.cron = null;
    }
    // Abort any running task
    if (this.abortController) {
      this.abortController.abort("shutdown");
    }
    console.log("[scheduler] Stopped.");
  }

  /**
   * Trigger a tick manually (e.g. for testing or initial run).
   */
  async triggerNow(): Promise<void> {
    await this.onTick();
  }

  private async onTick(): Promise<void> {
    // Skip-if-running guard
    if (this.running) {
      console.log("[scheduler] Tick skipped — already running.");
      return;
    }

    this.running = true;
    try {
      // Check schedules and create tasks for due crons
      this.checkSchedules();

      // Process pending tasks
      let task = this.ctx.planner.dequeueNext();
      while (task) {
        console.log(`[scheduler] Executing task #${task.id}: ${task.title}`);

        this.abortController = new AbortController();
        const result = await executeTask(task, this.ctx, this.abortController);
        this.abortController = null;

        if (result.success) {
          this.ctx.planner.completeTask(task.id, result.summary, result.costUsd, result.sessionId);
          console.log(`[scheduler] Task #${task.id} completed (${formatDuration(result.durationMs)}, $${result.costUsd.toFixed(4)})`);
        } else {
          this.ctx.planner.failTask(task.id, result.summary, result.costUsd, result.sessionId);
          console.log(`[scheduler] Task #${task.id} failed: ${result.summary.slice(0, 100)}`);
        }

        // Store task result in memory
        this.ctx.memory.store({
          type: "task_result",
          content: `Task "${task.title}" ${result.success ? "completed" : "failed"}: ${result.summary.slice(0, 500)}`,
          metadata: {
            taskId: task.id,
            success: result.success,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
          },
        });

        task = this.ctx.planner.dequeueNext();
      }
    } finally {
      this.running = false;
    }
  }

  private checkSchedules(): void {
    const rows = this.ctx.db
      .prepare("SELECT * FROM schedules WHERE enabled = 1")
      .all() as Array<{
        id: number;
        name: string;
        cron: string;
        task_title: string;
        task_description: string;
        skill: string | null;
        priority: number;
        last_run: string | null;
      }>;

    for (const schedule of rows) {
      // Check if cron is due by comparing last_run with the cron expression
      try {
        const cronJob = new Cron(schedule.cron);
        const lastRun = schedule.last_run ? new Date(schedule.last_run) : new Date(0);
        const nextRun = cronJob.nextRun(lastRun);
        cronJob.stop();

        if (nextRun && nextRun <= new Date()) {
          // Skip if duplicate pending task exists
          if (this.ctx.planner.hasPendingTask("schedule", schedule.task_title)) {
            continue;
          }

          this.ctx.planner.addTask({
            title: schedule.task_title,
            description: schedule.task_description,
            skill: schedule.skill ?? undefined,
            priority: schedule.priority,
            source: "schedule",
          });

          this.ctx.db
            .prepare("UPDATE schedules SET last_run = datetime('now') WHERE id = ?")
            .run(schedule.id);

          console.log(`[scheduler] Created task from schedule: ${schedule.name}`);
        }
      } catch (err) {
        console.error(`[scheduler] Error checking schedule "${schedule.name}":`, err);
      }
    }
  }
}
