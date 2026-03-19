import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase } from "../../src/memory/db.js";
import { MemoryStore } from "../../src/memory/store.js";
import type Database from "better-sqlite3";

describe("MemoryStore", () => {
  let db: Database.Database;
  let store: MemoryStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `test-agent-${Date.now()}.db`);
    db = initDatabase(dbPath);
    store = new MemoryStore(db);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch { /* ok */ }
    try { unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
    try { unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
  });

  it("stores and retrieves a memory entry", () => {
    const entry = store.store({
      type: "fact",
      content: "The sky is blue",
      metadata: { source: "observation" },
    });

    expect(entry.id).toBeGreaterThan(0);
    expect(entry.type).toBe("fact");
    expect(entry.content).toBe("The sky is blue");
    expect(entry.metadata.source).toBe("observation");

    const retrieved = store.getById(entry.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.content).toBe("The sky is blue");
  });

  it("returns undefined for non-existent id", () => {
    expect(store.getById(9999)).toBeUndefined();
  });

  it("filters by type", () => {
    store.store({ type: "fact", content: "Fact 1" });
    store.store({ type: "task_result", content: "Result 1" });
    store.store({ type: "fact", content: "Fact 2" });

    const facts = store.getByType("fact");
    expect(facts).toHaveLength(2);
    expect(facts.every((m) => m.type === "fact")).toBe(true);
  });

  it("returns recent entries in descending order", () => {
    store.store({ type: "fact", content: "First" });
    store.store({ type: "fact", content: "Second" });
    store.store({ type: "fact", content: "Third" });

    const recent = store.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.content).toBe("Third");
    expect(recent[1]!.content).toBe("Second");
  });

  it("searches with FTS5", () => {
    store.store({ type: "fact", content: "TypeScript is a programming language" });
    store.store({ type: "fact", content: "Python is also a programming language" });
    store.store({ type: "fact", content: "The weather is nice today" });

    const results = store.search("programming language");
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((m) => m.content.includes("programming"))).toBe(true);
  });

  it("deletes by id", () => {
    const entry = store.store({ type: "fact", content: "To be deleted" });
    expect(store.deleteById(entry.id)).toBe(true);
    expect(store.getById(entry.id)).toBeUndefined();
    expect(store.deleteById(entry.id)).toBe(false);
  });

  it("counts entries", () => {
    expect(store.count()).toBe(0);
    store.store({ type: "fact", content: "One" });
    store.store({ type: "fact", content: "Two" });
    expect(store.count()).toBe(2);
  });

  it("evicts old entries", () => {
    for (let i = 0; i < 5; i++) {
      store.store({ type: "fact", content: `Entry ${i}` });
    }
    expect(store.count()).toBe(5);

    const evicted = store.evictOld(3);
    expect(evicted).toBe(2);
    expect(store.count()).toBe(3);
  });
});
