import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { SkillDefinition } from "../types.js";

export function loadSkills(skillsDir: string): Map<string, SkillDefinition> {
  const skills = new Map<string, SkillDefinition>();

  let files: string[];
  try {
    files = readdirSync(skillsDir).filter((f) => f.endsWith(".md"));
  } catch {
    console.log(`[skills] No skills directory found at ${skillsDir}, skipping.`);
    return skills;
  }

  for (const file of files) {
    try {
      const content = readFileSync(join(skillsDir, file), "utf-8");
      const skill = parseSkillFile(content, basename(file, ".md"));
      skills.set(skill.name.toLowerCase(), skill);
      console.log(`[skills] Loaded skill: ${skill.name}`);
    } catch (err) {
      console.error(`[skills] Failed to parse ${file}:`, err);
    }
  }

  return skills;
}

function parseSkillFile(content: string, fallbackName: string): SkillDefinition {
  const sections = parseSections(content);

  const name = sections.get("_title") ?? fallbackName;

  return {
    name,
    description: sections.get("description") ?? "",
    systemPrompt: sections.get("system prompt") ?? "",
    tools: parseOptionalListItems(sections.get("tools")),
    model: sections.get("model")?.trim() || null,
    mcpServers: parseMcpServers(sections.get("mcp servers") ?? ""),
  };
}

function parseSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  let currentSection = "";

  for (const line of content.split("\n")) {
    const h1Match = /^#\s+(.+)/.exec(line);
    if (h1Match) {
      sections.set("_title", h1Match[1].trim());
      continue;
    }

    const h2Match = /^##\s+(.+)/.exec(line);
    if (h2Match) {
      currentSection = h2Match[1].trim().toLowerCase();
      continue;
    }

    if (currentSection) {
      const existing = sections.get(currentSection) ?? "";
      sections.set(currentSection, existing + line + "\n");
    }
  }

  return sections;
}

function parseListItems(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((item) => item.length > 0);
}

function parseOptionalListItems(text: string | undefined): string[] | null {
  if (text === undefined) return null;

  const items = parseListItems(text);
  return items.length > 0 ? items : null;
}

function parseMcpServers(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    if (/^\w+:\s/m.test(trimmed)) {
      console.warn(`[skills] MCP Servers section looks like YAML but only JSON is supported. Content ignored.`);
    }
    return {};
  }
}
