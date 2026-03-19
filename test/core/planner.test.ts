import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase } from "../../src/memory/db.js";
import { Planner } from "../../src/core/planner.js";
import type Database from "better-sqlite3";

describe("Planner", () => {
  let db: Database.Database;
  let planner: Planner;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `test-planner-${Date.now()}.db`);
    db = initDatabase(dbPath);
    planner = new Planner(db);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch { /* ok */ }
    try { unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
    try { unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
  });

  it("adds a task and retrieves it by id", () => {
    const task = planner.addTask({
      title: "Test task",
      description: "Do something",
    });

    expect(task.id).toBeGreaterThan(0);
    expect(task.title).toBe("Test task");
    expect(task.status).toBe("pending");
    expect(task.priority).toBe(10);
    expect(task.source).toBe("user");

    const retrieved = planner.getById(task.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe("Test task");
  });

  it("dequeues highest priority task first", () => {
    planner.addTask({ title: "Low priority", description: "d", priority: 20 });
    planner.addTask({ title: "High priority", description: "d", priority: 1 });
    planner.addTask({ title: "Medium priority", description: "d", priority: 10 });

    const task = planner.dequeueNext();
    expect(task).not.toBeNull();
    expect(task!.title).toBe("High priority");
    expect(task!.status).toBe("running");
  });

  it("returns null when no pending tasks", () => {
    expect(planner.dequeueNext()).toBeNull();
  });

  it("completes a task with result", () => {
    const task = planner.addTask({ title: "To complete", description: "d" });
    planner.dequeueNext();
    planner.completeTask(task.id, "Done!", 0.5, "session-123");

    const completed = planner.getById(task.id)!;
    expect(completed.status).toBe("completed");
    expect(completed.result).toBe("Done!");
    expect(completed.costUsd).toBe(0.5);
    expect(completed.sessionId).toBe("session-123");
  });

  it("fails a task with error", () => {
    const task = planner.addTask({ title: "To fail", description: "d" });
    planner.dequeueNext();
    planner.failTask(task.id, "Something broke", 0.1, "session-456");

    const failed = planner.getById(task.id)!;
    expect(failed.status).toBe("failed");
    expect(failed.result).toBe("Something broke");
  });

  it("lists pending tasks in priority order", () => {
    planner.addTask({ title: "B", description: "d", priority: 20 });
    planner.addTask({ title: "A", description: "d", priority: 5 });

    const pending = planner.listPending();
    expect(pending).toHaveLength(2);
    expect(pending[0]!.title).toBe("A");
    expect(pending[1]!.title).toBe("B");
  });

  it("counts pending tasks", () => {
    expect(planner.pendingCount()).toBe(0);
    planner.addTask({ title: "One", description: "d" });
    planner.addTask({ title: "Two", description: "d" });
    expect(planner.pendingCount()).toBe(2);
  });

  it("detects duplicate pending tasks", () => {
    planner.addTask({ title: "Scheduled task", description: "d", source: "schedule" });
    expect(planner.hasPendingTask("schedule", "Scheduled task")).toBe(true);
    expect(planner.hasPendingTask("schedule", "Other task")).toBe(false);
  });

  it("recovers orphaned running tasks", () => {
    const task = planner.addTask({ title: "Orphan", description: "d" });
    planner.dequeueNext();

    const recovered = planner.recoverOrphaned();
    expect(recovered).toBe(1);

    const failed = planner.getById(task.id)!;
    expect(failed.status).toBe("failed");
    expect(failed.result).toContain("crashed");
  });

  it("calculates today's cost", () => {
    const task = planner.addTask({ title: "Costly", description: "d" });
    planner.dequeueNext();
    planner.completeTask(task.id, "done", 1.5, "s");

    expect(planner.todaysCost()).toBe(1.5);
  });
});
