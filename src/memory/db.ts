import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA_VERSION = 1;

const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      skill TEXT,
      priority INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'pending',
      source TEXT NOT NULL DEFAULT 'user',
      result TEXT,
      cost_usd REAL NOT NULL DEFAULT 0,
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority, created_at)`,

    `CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)`,

    // FTS5 virtual table for full-text search on memories
    `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content_rowid='id',
      content='memories'
    )`,

    // Triggers to keep FTS in sync
    `CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END`,
    `CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
    END`,
    `CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END`,

    `CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      cron TEXT NOT NULL,
      task_title TEXT NOT NULL,
      task_description TEXT NOT NULL,
      skill TEXT,
      priority INTEGER NOT NULL DEFAULT 10,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    // Evolution log for self-modification tracking
    `CREATE TABLE IF NOT EXISTS evolution_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      diff TEXT NOT NULL DEFAULT '',
      commit_hash TEXT,
      status TEXT NOT NULL DEFAULT 'failed',
      error_output TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ],
};

export function initDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const currentVersion = getSchemaVersion(db);

  if (currentVersion < SCHEMA_VERSION) {
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);

      for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
        const stmts = MIGRATIONS[v];
        if (!stmts) throw new Error(`Missing migration for version ${v}`);
        for (const sql of stmts) {
          db.exec(sql);
        }
      }

      const existing = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
      if (existing) {
        db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
      } else {
        db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
      }
    })();
  }

  return db;
}

export function checkpoint(db: Database.Database): void {
  db.pragma("wal_checkpoint(TRUNCATE)");
}

function getSchemaVersion(db: Database.Database): number {
  try {
    const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
      | { version: number }
      | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}
