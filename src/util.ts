import type { ModelProfile } from "./types.js";

/** Filter out undefined values from process.env. */
export function cleanEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
  );
}

/** Build env record for Agent SDK query() with the given model profile. */
export function buildModelEnv(profile: ModelProfile): Record<string, string> {
  return {
    ...cleanEnv(),
    ANTHROPIC_BASE_URL: profile.baseUrl,
    ANTHROPIC_API_KEY: profile.apiKey,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;

  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;

  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;

  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}
