import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Planner } from "../../src/core/planner.js";
import { openTestDatabase, closeTestDatabase, type TestDatabase } from "../helpers/db.js";

describe("Planner", () => {
  let testDb: TestDatabase;
  let planner: Planner;

  beforeEach(() => {
    testDb = openTestDatabase("test-planner");
    planner = new Planner(testDb.db);
  });

  afterEach(() => {
    closeTestDatabase(testDb);
  });

  it("adds a task and retrieves it by id", () => {
    const task = planner.addTask({
      title: "Test task",
      description: "Do something",
    });

    expect(task.id).toBeGreaterThan(0);
    expect(task).toMatchObject({
      title: "Test task",
      status: "pending",
      priority: 10,
      source: "user",
    });

    const retrieved = planner.getById(task.id);
    expect(retrieved).toMatchObject({ title: "Test task" });
  });

  it("dequeues highest priority task first", () => {
    planner.addTask({ title: "Low priority", description: "d", priority: 20 });
    planner.addTask({ title: "High priority", description: "d", priority: 1 });
    planner.addTask({ title: "Medium priority", description: "d", priority: 10 });

    const task = planner.dequeueNext();
    expect(task).toMatchObject({ title: "High priority", status: "running" });
  });

  it("returns null when no pending tasks", () => {
    expect(planner.dequeueNext()).toBeNull();
  });

  it("completes a task with result", () => {
    const task = planner.addTask({ title: "To complete", description: "d" });
    planner.dequeueNext();
    planner.completeTask(task.id, "Done!", 0.5, "session-123");

    const completed = planner.getById(task.id);
    expect(completed).toMatchObject({
      status: "completed",
      result: "Done!",
      costUsd: 0.5,
      sessionId: "session-123",
    });
  });

  it("fails a task with error", () => {
    const task = planner.addTask({ title: "To fail", description: "d" });
    planner.dequeueNext();
    planner.failTask(task.id, "Something broke", 0.1, "session-456");

    const failed = planner.getById(task.id);
    expect(failed).toMatchObject({ status: "failed", result: "Something broke" });
  });

  it("lists pending tasks in priority order", () => {
    planner.addTask({ title: "B", description: "d", priority: 20 });
    planner.addTask({ title: "A", description: "d", priority: 5 });

    const pending = planner.listPending();
    expect(pending.map((t) => t.title)).toEqual(["A", "B"]);
  });

  it("counts pending tasks", () => {
    expect(planner.pendingCount()).toBe(0);
    planner.addTask({ title: "One", description: "d" });
    planner.addTask({ title: "Two", description: "d" });
    expect(planner.pendingCount()).toBe(2);
  });

  it("detects duplicate pending tasks", () => {
    planner.addTask({ title: "Scheduled task", description: "d", source: "schedule" });
    expect(planner.hasActiveTask("schedule", "Scheduled task")).toBe(true);
    expect(planner.hasActiveTask("schedule", "Other task")).toBe(false);
  });

  it("detects duplicate running tasks", () => {
    planner.addTask({ title: "Scheduled task", description: "d", source: "schedule" });
    planner.dequeueNext(); // status becomes "running"
    expect(planner.hasActiveTask("schedule", "Scheduled task")).toBe(true);
  });

  it("recovers orphaned running tasks", () => {
    const task = planner.addTask({ title: "Orphan", description: "d" });
    planner.dequeueNext();

    expect(planner.recoverOrphaned()).toBe(1);

    const failed = planner.getById(task.id);
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed!.result).toContain("crashed");
  });

});
