import type Database from "better-sqlite3";
import type { Config } from "./config.js";
import type { Planner } from "./core/planner.js";
import type { MemoryStore } from "./memory/store.js";
import type { SkillRegistry } from "./skills/registry.js";
import type { ModelProfileRegistry } from "./models/profiles.js";
import type { McpManager } from "./mcp/manager.js";

// ============================================================================
// Task
// ============================================================================

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type TaskSource = "user" | "auto" | "schedule";

export interface Task {
  id: number;
  title: string;
  description: string;
  skill: string | null;
  priority: number;
  status: TaskStatus;
  source: TaskSource;
  result: string | null;
  costUsd: number;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description: string;
  skill?: string;
  priority?: number;
  source?: TaskSource;
}

// ============================================================================
// Execution
// ============================================================================

export interface ExecutionResult {
  summary: string;
  costUsd: number;
  sessionId: string;
  success: boolean;
  durationMs: number;
  abortReason?: "timeout" | "shutdown";
}

// ============================================================================
// Model Profile
// ============================================================================

export interface ModelProfile {
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

// ============================================================================
// Skill Definition
// ============================================================================

export interface SkillDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model: string | null;
  mcpServers: Record<string, unknown>;
}

// ============================================================================
// Memory
// ============================================================================

export type MemoryType = "conversation" | "task_result" | "user_preference" | "fact";

export interface MemoryEntry {
  id: number;
  type: MemoryType;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateMemoryInput {
  type: MemoryType;
  content: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Schedule
// ============================================================================

export interface Schedule {
  id: number;
  name: string;
  cron: string;
  taskTitle: string;
  taskDescription: string;
  skill: string | null;
  priority: number;
  enabled: boolean;
  lastRun: string | null;
  createdAt: string;
}

export interface CreateScheduleInput {
  name: string;
  cron: string;
  taskTitle: string;
  taskDescription: string;
  skill?: string;
  priority?: number;
}

// ============================================================================
// Evolution
// ============================================================================

export interface EvolutionAttempt {
  id: number;
  description: string;
  diff: string;
  commitHash: string | null;
  status: "success" | "failed";
  errorOutput: string | null;
  createdAt: string;
}

// ============================================================================
// Agent Context (DI container)
// ============================================================================

export interface AgentContext {
  db: Database.Database;
  config: Config;
  planner: Planner;
  memory: MemoryStore;
  skills: SkillRegistry;
  models: ModelProfileRegistry;
  mcp: McpManager;
}
