import { Cron } from "croner";
import type { AgentContext, Task } from "../types.js";
import { executeTask } from "./executor.js";
import { formatDuration } from "../util.js";

interface RawScheduleRow {
  id: number;
  name: string;
  cron: string;
  task_title: string;
  task_description: string;
  skill: string | null;
  priority: number;
  last_run: string | null;
}

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
    if (this.abortController) {
      this.abortController.abort("shutdown");
    }
    console.log("[scheduler] Stopped.");
  }

  async triggerNow(): Promise<void> {
    await this.onTick();
  }

  private async onTick(): Promise<void> {
    if (this.running) {
      console.log("[scheduler] Tick skipped -- already running.");
      return;
    }

    this.running = true;
    try {
      const spentBeforeScheduling = this.ctx.planner.todaysCost();
      if (spentBeforeScheduling >= this.ctx.config.dailyBudgetUsd) {
        console.log(
          `[scheduler] Daily budget exhausted ($${spentBeforeScheduling.toFixed(2)} / $${this.ctx.config.dailyBudgetUsd.toFixed(2)}).`
        );
        return;
      }

      this.checkSchedules();

      let task = this.dequeueNextWithinBudget();
      while (task) {
        await this.executeAndRecord(task);
        task = this.dequeueNextWithinBudget();
      }
    } finally {
      this.running = false;
    }
  }

  private async executeAndRecord(task: Task): Promise<void> {
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

    const status = result.success ? "completed" : "failed";
    this.ctx.memory.store({
      type: "task_result",
      content: `Task "${task.title}" ${status}: ${result.summary.slice(0, 500)}`,
      metadata: {
        taskId: task.id,
        success: result.success,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      },
    });
  }

  private dequeueNextWithinBudget(): Task | null {
    const spentToday = this.ctx.planner.todaysCost();
    const remainingBudget = this.ctx.config.dailyBudgetUsd - spentToday;

    if (remainingBudget < this.ctx.config.maxBudgetPerTaskUsd) {
      const pendingTasks = this.ctx.planner.pendingCount();
      if (pendingTasks > 0) {
        console.log(
          `[scheduler] Pausing with ${pendingTasks} pending task(s); remaining daily budget $${remainingBudget.toFixed(2)} is below reserved per-task budget $${this.ctx.config.maxBudgetPerTaskUsd.toFixed(2)}.`
        );
      }
      return null;
    }

    return this.ctx.planner.dequeueNext();
  }

  private checkSchedules(): void {
    const rows = this.ctx.db
      .prepare("SELECT * FROM schedules WHERE enabled = 1")
      .all() as RawScheduleRow[];

    for (const schedule of rows) {
      try {
        const cronJob = new Cron(schedule.cron);
        const lastRun = schedule.last_run ? new Date(schedule.last_run) : new Date(0);
        const nextRun = cronJob.nextRun(lastRun);
        cronJob.stop();

        if (!nextRun || nextRun > new Date()) continue;

        if (this.ctx.planner.hasPendingTask("schedule", schedule.task_title)) continue;

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
      } catch (err) {
        console.error(`[scheduler] Error checking schedule "${schedule.name}":`, err);
      }
    }
  }
}
