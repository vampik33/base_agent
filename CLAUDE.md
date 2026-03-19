# Base Agent

Universal self-evolving agent SDK template using `@anthropic-ai/claude-agent-sdk`.

## Setup

```bash
npm install
cp .env.example .env   # Fill in API_KEY (required)
npm run dev
```

Required: `API_KEY`. See `.env.example` for optional config (model, cron, self-evolution).

## Commands

```bash
npm run dev        # Run with tsx (development)
npm run build      # Compile TypeScript
npm start          # Run compiled JS
npm run typecheck  # Type-check without emitting
npm test           # Run tests (vitest)
./run.sh           # Production: auto-restart on self-evolution
```

## Architecture

- **src/config.ts** — Zod v4 validated config from env vars
- **src/types.ts** — Shared TypeScript interfaces
- **src/util.ts** — Helper functions (cleanEnv, buildModelEnv, sleep)
- **src/memory/** — SQLite persistence (db.ts: schema/migrations, store.ts: CRUD + FTS5)
- **src/skills/** — Markdown skill parser (loader.ts) and MCP tool registry (registry.ts: merges skill MCP configs)
- **src/models/** — Multi-model provider profiles (profiles.ts: ModelProfileRegistry with env auto-discovery)
- **src/core/planner.ts** — SQLite-backed priority task queue
- **src/core/executor.ts** — Task execution via Agent SDK query()
- **src/core/scheduler.ts** — Cron-based scheduler (croner)
- **src/core/self-evolve.ts** — Self-modification: branch → edit → typecheck → test → merge → restart
- **src/index.ts** — Bootstrap + wiring

### Tests

Tests mirror `src/` layout under `test/`. Shared test DB helper in `test/helpers/db.ts`. Run: `npm test` (vitest).

## Conventions

- Config: Zod v4 schema with `z.coerce` for env var parsing, `safeParse` with formatted errors
- Database: raw `better-sqlite3` SQL (no ORM), migrations in `src/memory/db.ts`
- Tests: vitest, colocated in `test/` mirroring `src/` structure
- SQLite files (`*.db`, `data/`) are gitignored — ephemeral per-environment
- Agent SDK `query()` uses `tools` property (not `allowedTools`) for tool lists
- Shell commands in `self-evolve.ts`: always `execFileSync` with array args — never `execSync` with string interpolation (command injection risk)
- Skill `tools` field: `null` = use default tool set; `string[]` = restrict to listed tools only

## Extending

### Add a skill

Create `skills/my-skill.md` with sections: `# Name`, `## Description`, `## System Prompt`, `## Tools`, `## Model`, `## MCP Servers`. See `skills/example.md` for a template.

### Add an MCP server

Reference external MCP servers in a skill's `## MCP Servers` section as JSON.

### Add a model provider

Set `PREFIX_BASE_URL` and `PREFIX_API_KEY` env vars. Auto-discovered at startup.

## Self-Evolution

When `SELF_EVOLVE_ENABLED=true`, the agent can modify its own source code:
1. Checks out `DEFAULT_BRANCH` and creates `SELF_EVOLVE_BRANCH` from that branch tip
2. Runs Agent SDK with self-evolve skill
3. Gates: `tsc --noEmit` + `npm test` must pass
4. On success: fast-forward merge back into `DEFAULT_BRANCH`, exit with code 100
5. `run.sh` detects exit 100, rebuilds, and restarts; if rebuild still fails after revert, it exits non-zero

Protected files (cannot be modified by self-evolution):
- `src/core/self-evolve.ts`, `src/config.ts`, `run.sh`, `.env`, `.gitignore`

**Gotcha:** Exit code 100 is the signal for `run.sh` to rebuild and restart. Do not use exit code 100 for other purposes.
