import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { SkillDefinition } from "../types.js";
import type { MemoryStore } from "../memory/store.js";
import type { Planner } from "../core/planner.js";

export interface SkillRegistryDeps {
  skills: Map<string, SkillDefinition>;
  memory: MemoryStore;
  planner: Planner;
  db: Database.Database;
}

export class SkillRegistry {
  private skills: Map<string, SkillDefinition>;
  private agentMcpConfig: McpServerConfig;

  constructor(deps: SkillRegistryDeps) {
    this.skills = deps.skills;
    this.agentMcpConfig = this.createAgentMcpServer(deps);
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name.toLowerCase());
  }

  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  getMcpServersForQuery(skill?: SkillDefinition | null): Record<string, McpServerConfig> {
    const servers: Record<string, McpServerConfig> = {
      agent: this.agentMcpConfig,
    };

    if (skill?.mcpServers) {
      for (const [name, config] of Object.entries(skill.mcpServers)) {
        servers[name] = config as McpServerConfig;
      }
    }

    return servers;
  }

  private createAgentMcpServer(deps: Omit<SkillRegistryDeps, "skills">): McpServerConfig {
    const { memory, planner, db } = deps;
    return createSdkMcpServer({
      name: "agent",
      version: "0.1.0",
      tools: [
        tool(
          "memory_search",
          "Search the agent's memory using full-text search",
          {
            query: z.string().describe("Search query"),
            limit: z.number().optional().describe("Max results (default: 10)"),
          },
          async ({ query, limit }) => {
            const results = memory.search(query, limit ?? 10);
            return textResult(JSON.stringify(results, null, 2));
          }
        ),
        tool(
          "memory_store",
          "Store a new memory entry",
          {
            type: z.enum(["conversation", "task_result", "user_preference", "fact"]).describe("Memory type"),
            content: z.string().describe("Memory content"),
          },
          async ({ type, content }) => {
            const entry = memory.store({ type, content });
            return textResult(`Stored memory #${entry.id} (type: ${type})`);
          }
        ),
        tool(
          "task_list",
          "List pending and recent tasks",
          {
            status: z.enum(["pending", "recent"]).optional().describe("Filter: 'pending' or 'recent' (default: pending)"),
          },
          async ({ status }) => {
            const tasks = status === "recent" ? planner.listRecent(20) : planner.listPending(20);
            return textResult(JSON.stringify(tasks, null, 2));
          }
        ),
        tool(
          "task_add",
          "Add a new task to the queue",
          {
            title: z.string().describe("Task title"),
            description: z.string().describe("Task description"),
            priority: z.number().optional().describe("Priority (lower = higher priority, default: 10)"),
          },
          async ({ title, description, priority }) => {
            const task = planner.addTask({
              title,
              description,
              priority: priority ?? 10,
              source: "auto",
            });
            return textResult(`Task #${task.id} added: ${title}`);
          }
        ),
        tool(
          "evolution_history",
          "List recent self-evolution attempts",
          {
            limit: z.number().optional().describe("Max results (default: 10)"),
          },
          async ({ limit }) => {
            const rows = db
              .prepare("SELECT * FROM evolution_log ORDER BY created_at DESC LIMIT ?")
              .all(limit ?? 10);
            return textResult(JSON.stringify(rows, null, 2));
          }
        ),
      ],
    });
  }
}

function textResult(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text }] };
}
