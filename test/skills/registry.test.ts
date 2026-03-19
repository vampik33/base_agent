import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillRegistry } from "../../src/skills/registry.js";
import { MemoryStore } from "../../src/memory/store.js";
import { Planner } from "../../src/core/planner.js";
import { openTestDatabase, closeTestDatabase, type TestDatabase } from "../helpers/db.js";
import type { SkillDefinition } from "../../src/types.js";

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "test-skill",
    description: "A test skill",
    systemPrompt: "You are a test.",
    tools: ["Read", "Write"],
    model: null,
    mcpServers: {},
    ...overrides,
  };
}

describe("SkillRegistry", () => {
  let testDb: TestDatabase;
  let registry: SkillRegistry;
  let skills: Map<string, SkillDefinition>;

  beforeEach(() => {
    testDb = openTestDatabase("test-registry");
    skills = new Map();
    skills.set("code", makeSkill({ name: "code", tools: ["Read", "Edit", "Bash"] }));
    skills.set("research", makeSkill({ name: "research", tools: ["WebFetch", "WebSearch"] }));

    registry = new SkillRegistry({
      skills,
      memory: new MemoryStore(testDb.db),
      planner: new Planner(testDb.db),
      db: testDb.db,
    });
  });

  afterEach(() => {
    closeTestDatabase(testDb);
  });

  describe("get", () => {
    it("retrieves a skill by name", () => {
      const skill = registry.get("code");
      expect(skill).toBeDefined();
      expect(skill!.name).toBe("code");
    });

    it("is case-insensitive", () => {
      const skill = registry.get("CODE");
      expect(skill).toBeDefined();
      expect(skill!.name).toBe("code");
    });

    it("returns undefined for unknown skills", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns all registered skills", () => {
      const listed = registry.list();
      expect(listed).toHaveLength(2);
      const names = listed.map((s) => s.name).sort();
      expect(names).toEqual(["code", "research"]);
    });
  });

  describe("getMcpServersForQuery", () => {
    it("always includes the agent MCP server", () => {
      const servers = registry.getMcpServersForQuery();
      expect(servers).toHaveProperty("agent");
    });

    it("includes the agent server when skill has no MCP servers", () => {
      const skill = makeSkill({ mcpServers: {} });
      const servers = registry.getMcpServersForQuery(skill);
      expect(servers).toHaveProperty("agent");
      expect(Object.keys(servers)).toHaveLength(1);
    });

    it("merges skill MCP servers with agent server", () => {
      const skill = makeSkill({
        mcpServers: {
          "custom-mcp": { type: "stdio", command: "node", args: ["server.js"] },
        },
      });
      const servers = registry.getMcpServersForQuery(skill);
      expect(servers).toHaveProperty("agent");
      expect(servers).toHaveProperty("custom-mcp");
      expect(Object.keys(servers)).toHaveLength(2);
    });

    it("handles null skill", () => {
      const servers = registry.getMcpServersForQuery(null);
      expect(servers).toHaveProperty("agent");
      expect(Object.keys(servers)).toHaveLength(1);
    });
  });
});
