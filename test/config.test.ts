import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

const CONFIG_ENV_VARS = [
  "API_KEY",
  "API_BASE_URL",
  "DEFAULT_MODEL",
  "CRON_EXPRESSION",
  "WORK_DIR",
  "SELF_EVOLVE_ENABLED",
  "DEFAULT_BRANCH",
  "SELF_EVOLVE_BRANCH",
  "DEFAULT_SYSTEM_PROMPT",
] as const;

function restoreEnvVar(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe("loadConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of CONFIG_ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of CONFIG_ENV_VARS) {
      restoreEnvVar(key, savedEnv[key]);
    }
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

  it("uses custom DEFAULT_BRANCH", () => {
    process.env.API_KEY = "sk-test";
    process.env.DEFAULT_BRANCH = "trunk";
    const config = loadConfig();
    expect(config.defaultBranch).toBe("trunk");
  });
});
