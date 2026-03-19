import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { SkillDefinition } from "../types.js";

/**
 * Registry for external MCP server configurations from skills.
 * The Agent SDK handles stdio transport internally — we just manage configs.
 */
export class McpManager {
  private externalServers = new Map<string, McpServerConfig>();

  /**
   * Register external MCP servers defined in a skill.
   */
  registerFromSkill(skill: SkillDefinition): void {
    if (!skill.mcpServers) return;
    for (const [name, config] of Object.entries(skill.mcpServers)) {
      this.externalServers.set(name, config as McpServerConfig);
    }
  }

  /**
   * Get merged MCP server configs for a query.
   * Combines base (in-process) server with skill-specific external servers.
   */
  getServersForQuery(
    baseMcpConfig: Record<string, McpServerConfig>,
    skill?: SkillDefinition | null
  ): Record<string, McpServerConfig> {
    const servers: Record<string, McpServerConfig> = { ...baseMcpConfig };

    if (skill?.mcpServers) {
      for (const [name, config] of Object.entries(skill.mcpServers)) {
        servers[name] = config as McpServerConfig;
      }
    }

    return servers;
  }

  /**
   * List all registered external MCP server names.
   */
  listExternal(): string[] {
    return [...this.externalServers.keys()];
  }
}
