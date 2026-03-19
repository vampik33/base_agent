import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSkills } from "../../src/skills/loader.js";

describe("loadSkills", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skill-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty map for non-existent directory", () => {
    const skills = loadSkills("/non/existent/path");
    expect(skills.size).toBe(0);
  });

  it("parses a skill file with all sections", () => {
    const content = `# My Skill

## Description

A test skill for unit testing.

## System Prompt

You are a test agent. Do test things.

## Tools

- Read
- Write
- Bash

## Model

claude-sonnet-4-20250514

## MCP Servers
`;
    writeFileSync(join(testDir, "my-skill.md"), content);

    const skills = loadSkills(testDir);
    expect(skills.size).toBe(1);

    const skill = skills.get("my skill");
    expect(skill).toBeDefined();
    expect(skill!).toMatchObject({
      name: "My Skill",
      tools: ["Read", "Write", "Bash"],
      model: "claude-sonnet-4-20250514",
      mcpServers: {},
    });
    expect(skill!.description).toContain("A test skill");
    expect(skill!.systemPrompt).toContain("test agent");
  });

  it("uses filename as fallback name when no H1", () => {
    const content = `## Description

A skill without an H1 title.

## System Prompt

Do stuff.

## Tools

- Read
`;
    writeFileSync(join(testDir, "no-title.md"), content);

    const skills = loadSkills(testDir);
    const skill = skills.get("no-title");
    expect(skill).toBeDefined();
    expect(skill!.name).toBe("no-title");
  });

  it("parses JSON MCP servers", () => {
    const content = `# MCP Test

## Description

Test MCP parsing.

## System Prompt

Test.

## Tools

- Read

## MCP Servers

{"my-server": {"command": "node", "args": ["server.js"]}}
`;
    writeFileSync(join(testDir, "mcp-test.md"), content);

    const skills = loadSkills(testDir);
    const skill = skills.get("mcp test");
    expect(skill).toBeDefined();
    expect(skill!.mcpServers).toEqual({
      "my-server": { command: "node", args: ["server.js"] },
    });
  });

  it("loads multiple skill files", () => {
    writeFileSync(join(testDir, "a.md"), "# Skill A\n## Description\nFirst\n## System Prompt\nA\n## Tools\n- Read\n");
    writeFileSync(join(testDir, "b.md"), "# Skill B\n## Description\nSecond\n## System Prompt\nB\n## Tools\n- Write\n");

    const skills = loadSkills(testDir);
    expect(skills.size).toBe(2);
    expect(skills.has("skill a")).toBe(true);
    expect(skills.has("skill b")).toBe(true);
  });
});
