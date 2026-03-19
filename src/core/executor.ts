import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Task, ExecutionResult, AgentContext } from "../types.js";
import { buildModelEnv } from "../util.js";

const DEFAULT_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch"];

const INSTRUCTIONS =
  "Complete this task thoroughly. Use available tools as needed. " +
  "Report your results clearly. If you encounter issues, describe what went wrong.";

export async function executeTask(
  task: Task,
  ctx: AgentContext,
  abortController?: AbortController
): Promise<ExecutionResult> {
  const skill = task.skill ? ctx.skills.get(task.skill) : null;
  const modelProfile = ctx.models.resolve(skill?.model ?? ctx.config.defaultModel);

  const startTime = Date.now();
  const prompt = buildPrompt(task, ctx);
  const baseSystemPrompt = skill?.systemPrompt ?? ctx.config.defaultSystemPrompt;
  const systemPrompt = `${baseSystemPrompt}\n\nYour workspace directory is ${ctx.config.workDir}. All files you create or modify MUST be inside this directory.`;

  const controller = abortController ?? new AbortController();

  let accumulatedCostUsd = 0;
  let lastSessionId = "";

  function failureResult(summary: string, abortReason?: "timeout" | "shutdown"): ExecutionResult {
    return {
      summary,
      costUsd: accumulatedCostUsd,
      sessionId: lastSessionId,
      success: false,
      durationMs: Date.now() - startTime,
      abortReason,
    };
  }

  try {
    for await (const message of query({
      prompt,
      options: {
        model: modelProfile.model,
        env: buildModelEnv(modelProfile),
        systemPrompt,
        allowedTools: skill?.tools ?? DEFAULT_TOOLS,
        mcpServers: ctx.skills.getMcpServersForQuery(skill),
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        cwd: ctx.config.workDir,
        abortController: controller,
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block && block.text) {
            console.log(`[executor] Task #${task.id}: ${block.text.slice(0, 200)}`);
          }
        }
      }

      if ("session_id" in message && message.session_id) {
        lastSessionId = message.session_id;
      }

      if (message.type === "result") {
        accumulatedCostUsd = message.total_cost_usd;

        const summary = message.subtype === "success"
          ? message.result
          : message.errors.join("\n") || `Task ended with: ${message.subtype}`;

        return {
          summary,
          costUsd: message.total_cost_usd,
          sessionId: message.session_id,
          success: message.subtype === "success",
          durationMs: Date.now() - startTime,
        };
      }
    }

    if (controller.signal.aborted) {
      return failureResult("Task aborted due to shutdown.", "shutdown");
    }

    return failureResult("Execution ended unexpectedly without a result message.");
  } catch (err) {
    if (controller.signal.aborted && controller.signal.reason === "shutdown") {
      return failureResult("Task aborted due to shutdown.", "shutdown");
    }

    const errorMsg = err instanceof Error ? err.message : String(err);
    return failureResult(`Task execution error: ${errorMsg}`);
  }
}

function buildPrompt(task: Task, ctx: AgentContext): string {
  const recentMemories = ctx.memory.getRecent(10);
  const sections = [`# Task: ${task.title}\n\n${task.description}`];

  if (recentMemories.length > 0) {
    const memoryList = recentMemories
      .map((m) => `- ${m.content.slice(0, 200)}`)
      .join("\n");
    sections.push(`## Recent Activity\n${memoryList}`);
  }

  sections.push(`## Instructions\n${INSTRUCTIONS}`);

  return sections.join("\n\n");
}
