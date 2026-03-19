import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const configSchema = z.object({
  apiKey: z.string().min(1),
  apiBaseUrl: z.string().optional(),

  // Model defaults
  defaultModel: z.string().default("claude-sonnet-4-20250514"),

  // Scheduler
  cronExpression: z.string().default("*/10 * * * *"),
  dailyBudgetUsd: z.coerce.number().positive().default(20),
  maxBudgetPerTaskUsd: z.coerce.number().positive().default(5),

  // Workspace
  workDir: z.string().default("."),

  // Self-evolution
  selfEvolveEnabled: z.coerce.boolean().default(false),
  defaultBranch: z.string().min(1).default("main"),
  selfEvolveBranch: z.string().default("evolve"),

  // System prompt
  defaultSystemPrompt: z.string().default(
    "You are an autonomous AI agent. Complete the given task thoroughly and report your results."
  ),
});

type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const raw = {
    apiKey: process.env.API_KEY,
    apiBaseUrl: process.env.API_BASE_URL,
    defaultModel: process.env.DEFAULT_MODEL,
    cronExpression: process.env.CRON_EXPRESSION,
    dailyBudgetUsd: process.env.DAILY_BUDGET_USD,
    maxBudgetPerTaskUsd: process.env.MAX_BUDGET_PER_TASK_USD,
    workDir: process.env.WORK_DIR,
    selfEvolveEnabled: process.env.SELF_EVOLVE_ENABLED,
    defaultBranch: process.env.DEFAULT_BRANCH,
    selfEvolveBranch: process.env.SELF_EVOLVE_BRANCH,
    defaultSystemPrompt: process.env.DEFAULT_SYSTEM_PROMPT,
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return { ...result.data, workDir: resolve(result.data.workDir) };
}

export type { Config };
