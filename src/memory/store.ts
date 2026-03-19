import type Database from "better-sqlite3";
import type { MemoryEntry, CreateMemoryInput, MemoryType } from "../types.js";

interface RawMemoryRow {
  id: number;
  type: string;
  content: string;
  metadata: string;
  created_at: string;
}

function parseJsonSafe(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function toMemoryEntry(row: RawMemoryRow): MemoryEntry {
  return {
    id: row.id,
    type: row.type as MemoryType,
    content: row.content,
    metadata: parseJsonSafe(row.metadata),
    createdAt: row.created_at,
  };
}

export class MemoryStore {
  constructor(private db: Database.Database) {}

  store(input: CreateMemoryInput): MemoryEntry {
    const metadata = JSON.stringify(input.metadata ?? {});
    const stmt = this.db.prepare(`
      INSERT INTO memories (type, content, metadata)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(input.type, input.content, metadata);
    return this.getById(Number(result.lastInsertRowid))!;
  }

  getById(id: number): MemoryEntry | undefined {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as RawMemoryRow | undefined;
    return row ? toMemoryEntry(row) : undefined;
  }

  getByType(type: MemoryType, limit = 50): MemoryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM memories WHERE type = ? ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(type, limit) as RawMemoryRow[];
    return rows.map(toMemoryEntry);
  }

  getRecent(limit = 20): MemoryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM memories ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(limit) as RawMemoryRow[];
    return rows.map(toMemoryEntry);
  }

  search(query: string, limit = 20): MemoryEntry[] {
    const trimmed = query.trim();
    if (!trimmed) return [];

    // Wrap in double-quotes to treat as a phrase, escaping internal quotes.
    // This prevents FTS5 syntax errors from special characters in user input.
    const safeQuery = '"' + trimmed.replace(/"/g, '""') + '"';

    const rows = this.db
      .prepare(`
        SELECT m.* FROM memories m
        JOIN memories_fts f ON m.id = f.rowid
        WHERE memories_fts MATCH ?
        ORDER BY bm25(memories_fts)
        LIMIT ?
      `)
      .all(safeQuery, limit) as RawMemoryRow[];
    return rows.map(toMemoryEntry);
  }

  deleteById(id: number): boolean {
    const result = this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    return result.changes > 0;
  }

  evictOld(maxEntries: number): number {
    const result = this.db
      .prepare(`
        DELETE FROM memories WHERE id IN (
          SELECT id FROM memories
          ORDER BY created_at DESC
          LIMIT -1 OFFSET ?
        )
      `)
      .run(maxEntries);
    return result.changes;
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM memories").get() as { count: number };
    return row.count;
  }
}
