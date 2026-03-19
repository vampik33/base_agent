import type Database from "better-sqlite3";
import type { Task, CreateTaskInput, TaskSource, TaskStatus } from "../types.js";

interface RawTaskRow {
  id: number;
  title: string;
  description: string;
  skill: string | null;
  priority: number;
  status: string;
  source: string;
  result: string | null;
  cost_usd: number;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

function toTask(row: RawTaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    skill: row.skill,
    priority: row.priority,
    status: row.status as TaskStatus,
    source: row.source as TaskSource,
    result: row.result,
    costUsd: row.cost_usd,
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class Planner {
  constructor(private db: Database.Database) {}

  addTask(input: CreateTaskInput): Task {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (title, description, skill, priority, source)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      input.title,
      input.description,
      input.skill ?? null,
      input.priority ?? 10,
      input.source ?? "user"
    );

    return this.getById(Number(result.lastInsertRowid))!;
  }

  /** Atomically dequeue the next pending task. */
  dequeueNext(): Task | null {
    const dequeue = this.db.transaction(() => {
      const row = this.db
        .prepare(`
          SELECT * FROM tasks
          WHERE status = 'pending'
          ORDER BY priority ASC, created_at ASC
          LIMIT 1
        `)
        .get() as RawTaskRow | undefined;

      if (!row) return null;

      this.db
        .prepare("UPDATE tasks SET status = 'running', updated_at = datetime('now') WHERE id = ?")
        .run(row.id);

      row.status = "running";
      return toTask(row);
    });

    return dequeue();
  }

  getById(id: number): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as RawTaskRow | undefined;
    return row ? toTask(row) : null;
  }

  completeTask(id: number, result: string, costUsd: number, sessionId: string): void {
    this.resolveTask(id, "completed", result, costUsd, sessionId);
  }

  failTask(id: number, error: string, costUsd = 0, sessionId = ""): void {
    this.resolveTask(id, "failed", error, costUsd, sessionId);
  }

  private resolveTask(
    id: number,
    status: "completed" | "failed",
    result: string,
    costUsd: number,
    sessionId: string
  ): void {
    this.db
      .prepare(`
        UPDATE tasks
        SET result = ?, cost_usd = ?, session_id = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?
      `)
      .run(result, costUsd, sessionId, status, id);
  }

  listPending(limit = 20): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE status = 'pending' ORDER BY priority ASC, created_at ASC LIMIT ?")
      .all(limit) as RawTaskRow[];
    return rows.map(toTask);
  }

  listRecent(limit = 10): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as RawTaskRow[];
    return rows.map(toTask);
  }

  pendingCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'")
      .get() as { count: number };
    return row.count;
  }

  hasActiveTask(source: string, title: string): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM tasks WHERE status IN ('pending', 'running') AND source = ? AND title = ?")
      .get(source, title) as { count: number };
    return row.count > 0;
  }

  /** Reset tasks stuck in "running" state (e.g. after a crash) to "failed". */
  recoverOrphaned(): number {
    const result = this.db
      .prepare(
        "UPDATE tasks SET status = 'failed', result = 'Process crashed before completion', updated_at = datetime('now') WHERE status = 'running'"
      )
      .run();
    return result.changes;
  }
}
