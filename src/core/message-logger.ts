import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const LOG_LEVELS = { quiet: 0, normal: 1, verbose: 2 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

let cachedLevel: number | null = null;

function level(): number {
  if (cachedLevel === null) {
    const raw = (process.env.LOG_LEVEL ?? "normal").toLowerCase();
    cachedLevel = LOG_LEVELS[raw as LogLevel] ?? LOG_LEVELS.normal;
  }
  return cachedLevel;
}

/** Minimum level check — keeps call sites readable. */
function at(min: LogLevel): boolean {
  return level() >= LOG_LEVELS[min];
}

/**
 * Log an SDK message at the appropriate verbosity.
 * Best-effort: never throws.
 */
export function logMessage(tag: string, message: SDKMessage): void {
  try {
    logMessageInner(tag, message);
  } catch (err) {
    try {
      console.error(`[${tag}] Log error (message.type=${message?.type ?? "?"}):`, err);
    } catch {
      // Absolute last resort — don't let logging crash the agent
    }
  }
}

function logMessageInner(tag: string, message: SDKMessage): void {
  switch (message.type) {
    case "assistant": {
      if (!message.message?.content) break;
      for (const block of message.message.content) {
        if ("type" in block && block.type === "thinking" && "thinking" in block) {
          if (at("verbose")) {
            console.log(`[${tag}] 🧠 Thinking: ${truncate(String(block.thinking), 500)}`);
          }
        } else if ("type" in block && block.type === "text" && "text" in block) {
          if (at("normal")) {
            console.log(`[${tag}] 💬 ${truncate(String(block.text), 1000)}`);
          }
        } else if ("type" in block && block.type === "tool_use") {
          if (at("normal")) {
            const toolBlock = block as { name: string; input: unknown };
            if (at("verbose")) {
              const inputStr = safeStringify(toolBlock.input);
              console.log(`[${tag}] 🔧 Tool: ${toolBlock.name} | Input: ${truncate(inputStr, 300)}`);
            } else {
              console.log(`[${tag}] 🔧 Tool: ${toolBlock.name}`);
            }
          }
        }
      }
      if (message.error) {
        // Always log assistant errors
        console.log(`[${tag}] ⚠️  Assistant error: ${message.error}`);
      }
      break;
    }

    case "user": {
      if (!at("verbose")) break;
      if (message.tool_use_result !== undefined) {
        const result = typeof message.tool_use_result === "string"
          ? message.tool_use_result
          : safeStringify(message.tool_use_result);
        console.log(`[${tag}] ← Tool result: ${truncate(result, 300)}`);
      }
      break;
    }

    case "result": {
      // Always log results
      const cost = `$${message.total_cost_usd.toFixed(4)}`;
      const turns = message.num_turns;
      const duration = `${(message.duration_ms / 1000).toFixed(1)}s`;
      if (message.subtype === "success") {
        console.log(`[${tag}] ✅ Result (${turns} turns, ${duration}, ${cost}): ${truncate(message.result, 500)}`);
      } else {
        const errors = message.errors.join("; ") || message.subtype;
        console.log(`[${tag}] ❌ Error (${turns} turns, ${duration}, ${cost}): ${errors}`);
      }
      break;
    }

    case "system": {
      const sub = "subtype" in message ? message.subtype : "unknown";
      switch (sub) {
        case "init": {
          if (at("normal")) {
            const init = message as { model?: string; tools?: string[] };
            console.log(`[${tag}] ⚙️  Init: model=${init.model ?? "?"}, tools=[${(init.tools ?? []).join(", ")}]`);
          }
          break;
        }
        case "api_retry": {
          // Always log retries — they signal problems
          const retry = message as { attempt: number; max_retries: number; error: string };
          console.log(`[${tag}] 🔄 API retry ${retry.attempt}/${retry.max_retries}: ${retry.error}`);
          break;
        }
        case "status": {
          if (at("verbose")) {
            const status = message as { status: string | null };
            if (status.status) {
              console.log(`[${tag}] 📊 Status: ${status.status}`);
            }
          }
          break;
        }
        case "task_started": {
          if (at("normal")) {
            const task = message as { description: string; task_type?: string };
            console.log(`[${tag}] 🚀 Subagent started: ${task.description} (${task.task_type ?? "default"})`);
          }
          break;
        }
        case "task_progress": {
          if (at("verbose")) {
            const progress = message as { description: string; summary?: string };
            console.log(`[${tag}] 📈 Subagent progress: ${progress.summary ?? progress.description}`);
          }
          break;
        }
        case "task_notification": {
          if (at("normal")) {
            const notif = message as { status: string; summary: string };
            console.log(`[${tag}] 📋 Subagent ${notif.status}: ${truncate(notif.summary, 200)}`);
          }
          break;
        }
        default:
          break;
      }
      break;
    }

    case "tool_progress": {
      if (at("verbose")) {
        const tp = message as { tool_name: string; elapsed_time_seconds: number };
        if (tp.elapsed_time_seconds > 5) {
          console.log(`[${tag}] ⏳ ${tp.tool_name} running for ${tp.elapsed_time_seconds.toFixed(0)}s...`);
        }
      }
      break;
    }

    case "tool_use_summary": {
      if (at("normal")) {
        const tus = message as { summary: string };
        console.log(`[${tag}] 📝 Tool summary: ${truncate(tus.summary, 300)}`);
      }
      break;
    }

    default:
      break;
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "…";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
