import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/memory/store.js";
import { openTestDatabase, closeTestDatabase, type TestDatabase } from "../helpers/db.js";

describe("MemoryStore", () => {
  let testDb: TestDatabase;
  let store: MemoryStore;

  beforeEach(() => {
    testDb = openTestDatabase("test-agent");
    store = new MemoryStore(testDb.db);
  });

  afterEach(() => {
    closeTestDatabase(testDb);
  });

  it("stores and retrieves a memory entry", () => {
    const entry = store.store({
      type: "fact",
      content: "The sky is blue",
      metadata: { source: "observation" },
    });

    expect(entry).toMatchObject({
      type: "fact",
      content: "The sky is blue",
      metadata: { source: "observation" },
    });
    expect(entry.id).toBeGreaterThan(0);

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
    for (const fact of facts) {
      expect(fact.type).toBe("fact");
    }
  });

  it("returns recent entries in descending order", () => {
    store.store({ type: "fact", content: "First" });
    store.store({ type: "fact", content: "Second" });
    store.store({ type: "fact", content: "Third" });

    const recent = store.getRecent(2);
    expect(recent.map((m) => m.content)).toEqual(["Third", "Second"]);
  });

  it("searches with FTS5", () => {
    store.store({ type: "fact", content: "TypeScript is a programming language" });
    store.store({ type: "fact", content: "Python is also a programming language" });
    store.store({ type: "fact", content: "The weather is nice today" });

    const results = store.search("programming language");
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const result of results) {
      expect(result.content).toContain("programming");
    }
  });

  it("returns empty array for blank search query", () => {
    store.store({ type: "fact", content: "Some content" });
    expect(store.search("")).toEqual([]);
    expect(store.search("   ")).toEqual([]);
  });

  it("handles FTS5 special characters without throwing", () => {
    store.store({ type: "fact", content: "testing func() and other stuff" });

    // These would throw with raw FTS5 MATCH if not sanitized
    expect(() => store.search('hello "unterminated')).not.toThrow();
    expect(() => store.search("func(")).not.toThrow();
    expect(() => store.search("a AND OR NOT")).not.toThrow();
    expect(() => store.search("test*")).not.toThrow();
    expect(() => store.search("(unbalanced")).not.toThrow();
  });

  it("finds content containing double quotes", () => {
    store.store({ type: "fact", content: 'He said "hello world" to everyone' });
    const results = store.search("hello world");
    expect(results.length).toBeGreaterThanOrEqual(1);
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
