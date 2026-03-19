import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { logMessage, setLogLevel } from "../../src/core/message-logger.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// Capture console output
let consoleOutput: string[];
const originalLog = console.log;
const originalError = console.error;

beforeEach(() => {
  consoleOutput = [];
  console.log = (...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  setLogLevel("normal"); // Reset to default
});

describe("setLogLevel", () => {
  it("controls which messages are logged", () => {
    setLogLevel("quiet");

    // At quiet level, normal assistant text should not appear
    logMessage("test", {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hello" }],
      },
    } as unknown as SDKMessage);

    expect(consoleOutput).toHaveLength(0);
  });
});

describe("logMessage", () => {
  it("logs result messages at any level", () => {
    setLogLevel("quiet");

    logMessage("test", {
      type: "result",
      subtype: "success",
      result: "All done",
      total_cost_usd: 0.01,
      num_turns: 3,
      duration_ms: 5000,
      session_id: "abc",
    } as unknown as SDKMessage);

    expect(consoleOutput).toHaveLength(1);
    expect(consoleOutput[0]).toContain("Result");
    expect(consoleOutput[0]).toContain("$0.0100");
    expect(consoleOutput[0]).toContain("3 turns");
  });

  it("logs error results", () => {
    logMessage("test", {
      type: "result",
      subtype: "error",
      errors: ["something broke"],
      total_cost_usd: 0.005,
      num_turns: 1,
      duration_ms: 1000,
      session_id: "def",
    } as unknown as SDKMessage);

    expect(consoleOutput).toHaveLength(1);
    expect(consoleOutput[0]).toContain("Error");
    expect(consoleOutput[0]).toContain("something broke");
  });

  it("logs assistant text at normal level", () => {
    setLogLevel("normal");

    logMessage("tag", {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
      },
    } as unknown as SDKMessage);

    expect(consoleOutput).toHaveLength(1);
    expect(consoleOutput[0]).toContain("Hello world");
    expect(consoleOutput[0]).toContain("[tag]");
  });

  it("hides thinking blocks at normal level", () => {
    setLogLevel("normal");

    logMessage("test", {
      type: "assistant",
      message: {
        content: [{ type: "thinking", thinking: "Let me think..." }],
      },
    } as unknown as SDKMessage);

    expect(consoleOutput).toHaveLength(0);
  });

  it("shows thinking blocks at verbose level", () => {
    setLogLevel("verbose");

    logMessage("test", {
      type: "assistant",
      message: {
        content: [{ type: "thinking", thinking: "Let me think..." }],
      },
    } as unknown as SDKMessage);

    expect(consoleOutput).toHaveLength(1);
    expect(consoleOutput[0]).toContain("Thinking");
  });

  it("shows tool names at normal level without input details", () => {
    setLogLevel("normal");

    logMessage("test", {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", input: { path: "/foo" } }],
      },
    } as unknown as SDKMessage);

    expect(consoleOutput).toHaveLength(1);
    expect(consoleOutput[0]).toContain("Read");
    expect(consoleOutput[0]).not.toContain("/foo");
  });

  it("shows tool input at verbose level", () => {
    setLogLevel("verbose");

    logMessage("test", {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", input: { path: "/foo" } }],
      },
    } as unknown as SDKMessage);

    expect(consoleOutput).toHaveLength(1);
    expect(consoleOutput[0]).toContain("Read");
    expect(consoleOutput[0]).toContain("/foo");
  });

  it("always logs assistant errors regardless of level", () => {
    setLogLevel("quiet");

    logMessage("test", {
      type: "assistant",
      message: { content: [] },
      error: "Something went wrong",
    } as unknown as SDKMessage);

    expect(consoleOutput).toHaveLength(1);
    expect(consoleOutput[0]).toContain("Something went wrong");
  });

  it("never throws even with malformed messages", () => {
    expect(() => {
      logMessage("test", null as unknown as SDKMessage);
    }).not.toThrow();

    expect(() => {
      logMessage("test", {} as unknown as SDKMessage);
    }).not.toThrow();
  });

  it("logs user tool results at verbose level only", () => {
    setLogLevel("normal");
    logMessage("test", {
      type: "user",
      tool_use_result: "file contents here",
    } as unknown as SDKMessage);
    expect(consoleOutput).toHaveLength(0);

    setLogLevel("verbose");
    logMessage("test", {
      type: "user",
      tool_use_result: "file contents here",
    } as unknown as SDKMessage);
    expect(consoleOutput).toHaveLength(1);
    expect(consoleOutput[0]).toContain("Tool result");
  });

  it("logs system init at normal level", () => {
    setLogLevel("normal");

    logMessage("test", {
      type: "system",
      subtype: "init",
      model: "claude-test",
      tools: ["Read", "Write"],
    } as unknown as SDKMessage);

    expect(consoleOutput).toHaveLength(1);
    expect(consoleOutput[0]).toContain("Init");
    expect(consoleOutput[0]).toContain("claude-test");
  });

  it("always logs api_retry regardless of level", () => {
    setLogLevel("quiet");

    logMessage("test", {
      type: "system",
      subtype: "api_retry",
      attempt: 1,
      max_retries: 3,
      error: "rate limited",
    } as unknown as SDKMessage);

    expect(consoleOutput).toHaveLength(1);
    expect(consoleOutput[0]).toContain("retry");
    expect(consoleOutput[0]).toContain("rate limited");
  });
});
