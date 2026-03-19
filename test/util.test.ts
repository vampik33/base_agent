import { describe, it, expect } from "vitest";
import { cleanEnv, buildModelEnv, formatDuration } from "../src/util.js";
import type { ModelProfile } from "../src/types.js";

describe("cleanEnv", () => {
  it("filters out undefined values", () => {
    const original = process.env;
    process.env = { A: "1", B: undefined, C: "3" } as NodeJS.ProcessEnv;
    try {
      const result = cleanEnv();
      expect(result).toHaveProperty("A", "1");
      expect(result).toHaveProperty("C", "3");
      expect(result).not.toHaveProperty("B");
    } finally {
      process.env = original;
    }
  });
});

describe("buildModelEnv", () => {
  it("sets ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY from profile", () => {
    const profile: ModelProfile = {
      name: "test",
      model: "claude-test",
      baseUrl: "https://test.example.com",
      apiKey: "sk-test-key",
    };

    const env = buildModelEnv(profile);
    expect(env.ANTHROPIC_BASE_URL).toBe("https://test.example.com");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-test-key");
  });

  it("includes existing process.env entries", () => {
    const original = process.env.TEST_BUILD_MODEL_ENV;
    process.env.TEST_BUILD_MODEL_ENV = "present";
    try {
      const profile: ModelProfile = {
        name: "test",
        model: "m",
        baseUrl: "https://x.com",
        apiKey: "k",
      };
      const env = buildModelEnv(profile);
      expect(env.TEST_BUILD_MODEL_ENV).toBe("present");
    } finally {
      if (original === undefined) {
        delete process.env.TEST_BUILD_MODEL_ENV;
      } else {
        process.env.TEST_BUILD_MODEL_ENV = original;
      }
    }
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(59_000)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_599_000)).toBe("59m 59s");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3_600_000)).toBe("1h 0m");
    expect(formatDuration(5_400_000)).toBe("1h 30m");
    expect(formatDuration(86_400_000)).toBe("24h 0m");
  });
});
