import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase } from "../../src/memory/db.js";
import type Database from "better-sqlite3";

const WAL_SUFFIXES = ["-wal", "-shm"];

export interface TestDatabase {
  db: Database.Database;
  path: string;
}

/**
 * Creates a temporary SQLite database for testing.
 * Call `closeTestDatabase` in afterEach to clean up.
 */
export function openTestDatabase(prefix: string): TestDatabase {
  const path = join(tmpdir(), `${prefix}-${Date.now()}.db`);
  const db = initDatabase(path);
  return { db, path };
}

/**
 * Closes the database and removes all associated files (db, WAL, SHM).
 */
export function closeTestDatabase({ db, path }: TestDatabase): void {
  db.close();
  for (const suffix of ["", ...WAL_SUFFIXES]) {
    try {
      unlinkSync(path + suffix);
    } catch {
      // File may not exist (e.g. WAL not created), safe to ignore
    }
  }
}
