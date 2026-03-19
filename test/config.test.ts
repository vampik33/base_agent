import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.API_KEY;
    delete process.env.API_BASE_URL;
    delete process.env.DEFAULT_MODEL;
    delete process.env.CRON_EXPRESSION;
    delete process.env.DAILY_BUDGET_USD;
    delete process.env.MAX_BUDGET_PER_TASK_USD;
    delete process.env.WORK_DIR;
    delete process.env.SELF_EVOLVE_ENABLED;
    delete process.env.DEFAULT_BRANCH;
    delete process.env.SELF_EVOLVE_BRANCH;
    delete process.env.DEFAULT_SYSTEM_PROMPT;
  });

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("throws when API_KEY is not set", () => {
    expect(() => loadConfig()).toThrow();
  });

  it("accepts API_KEY", () => {
    process.env.API_KEY = "sk-test";
    const config = loadConfig();
    expect(config.apiKey).toBe("sk-test");
  });

  it("applies defaults", () => {
    process.env.API_KEY = "sk-test";
    const config = loadConfig();
    expect(config.defaultModel).toBe("claude-sonnet-4-20250514");
    expect(config.cronExpression).toBe("*/10 * * * *");
    expect(config.dailyBudgetUsd).toBe(20);
    expect(config.maxBudgetPerTaskUsd).toBe(5);
    expect(config.selfEvolveEnabled).toBe(false);
    expect(config.defaultBranch).toBe("main");
    expect(config.selfEvolveBranch).toBe("evolve");
  });

  it("resolves workDir to absolute path", () => {
    process.env.API_KEY = "sk-test";
    process.env.WORK_DIR = ".";
    const config = loadConfig();
    expect(config.workDir).toMatch(/^\//);
  });

  it("parses boolean env vars", () => {
    process.env.API_KEY = "sk-test";
    process.env.SELF_EVOLVE_ENABLED = "true";
    const config = loadConfig();
    expect(config.selfEvolveEnabled).toBe(true);
  });

  it("uses custom API_BASE_URL", () => {
    process.env.API_KEY = "sk-test";
    process.env.API_BASE_URL = "https://custom.api.com";
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe("https://custom.api.com");
  });

  it("parses numeric budget env vars", () => {
    process.env.API_KEY = "sk-test";
    process.env.DAILY_BUDGET_USD = "12.5";
    process.env.MAX_BUDGET_PER_TASK_USD = "2.25";
    const config = loadConfig();
    expect(config.dailyBudgetUsd).toBe(12.5);
    expect(config.maxBudgetPerTaskUsd).toBe(2.25);
  });

  it("uses custom DEFAULT_BRANCH", () => {
    process.env.API_KEY = "sk-test";
    process.env.DEFAULT_BRANCH = "trunk";
    const config = loadConfig();
    expect(config.defaultBranch).toBe("trunk");
  });
});
