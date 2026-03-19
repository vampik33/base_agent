import { describe, it, expect } from "vitest";
import { ModelProfileRegistry } from "../../src/models/profiles.js";
import type { Config } from "../../src/config.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: "sk-test",
    defaultModel: "claude-sonnet-4-20250514",
    cronExpression: "*/10 * * * *",
    workDir: "/tmp",
    selfEvolveEnabled: false,
    defaultBranch: "main",
    selfEvolveBranch: "evolve",
    logLevel: "normal",
    defaultSystemPrompt: "You are an agent.",
    ...overrides,
  };
}

describe("ModelProfileRegistry", () => {
  it("creates a default profile from config", () => {
    const registry = new ModelProfileRegistry(makeConfig());
    const profile = registry.getDefault();

    expect(profile).toMatchObject({
      name: "default",
      model: "claude-sonnet-4-20250514",
      apiKey: "sk-test",
    });
  });

  it("uses apiBaseUrl from config when provided", () => {
    const registry = new ModelProfileRegistry(
      makeConfig({ apiBaseUrl: "https://custom.api.com" })
    );
    expect(registry.getDefault().baseUrl).toBe("https://custom.api.com");
  });

  it("defaults baseUrl to anthropic when apiBaseUrl is not set", () => {
    const registry = new ModelProfileRegistry(makeConfig());
    expect(registry.getDefault().baseUrl).toBe("https://api.anthropic.com");
  });

  describe("resolve", () => {
    it("resolves by profile name", () => {
      const registry = new ModelProfileRegistry(makeConfig());
      const profile = registry.resolve("default");
      expect(profile.name).toBe("default");
    });

    it("resolves by model name", () => {
      const registry = new ModelProfileRegistry(
        makeConfig({ defaultModel: "claude-opus-4-20250514" })
      );
      const profile = registry.resolve("claude-opus-4-20250514");
      expect(profile.model).toBe("claude-opus-4-20250514");
    });

    it("falls back to default for unknown names", () => {
      const registry = new ModelProfileRegistry(makeConfig());
      const profile = registry.resolve("nonexistent");
      expect(profile.name).toBe("default");
    });
  });

  describe("list", () => {
    it("returns all registered profiles", () => {
      const registry = new ModelProfileRegistry(makeConfig());
      const profiles = registry.list();
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.name).toBe("default");
    });
  });
});
