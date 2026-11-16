import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, type Migration } from "./migrations";

/**
 * The server's one SQLite database (memorial stage B; later houses, wallets — tables use shared names, not `memorial_`).
 * Driver: Node's built-in `node:sqlite` (Node ≥ 22.13 / 24): nothing to compile on the Oracle VM, no native addon to rebuild
 * when Node is upgraded. Synchronous API — every statement here is a few microseconds; the room loop is never blocked long.
 *
 * WAL journal (readers never wait for the writer), foreign keys on, busy timeout 5 s, `synchronous=NORMAL` (safe with WAL:
 * a power cut can lose the last commit but never corrupts the file). Backups: `VACUUM INTO` (see backupTo) — never copy the
 * live file with cp while the server runs.
 */

export type Db = DatabaseSync;

/** Open (creating the folder) and migrate. `":memory:"` for tests. */
export function openDb(file: string, migrations: readonly Migration[] = MIGRATIONS): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db, migrations);
  return db;
}

/** Apply every migration newer than the recorded version, each in its own transaction. Returns the versions applied. */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const done = new Set((db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version));
  const applied: number[] = [];
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (const m of sorted) {
    if (done.has(m.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      m.up(db);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(m.version, m.name, Date.now());
      db.exec("COMMIT");
      applied.push(m.version);
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return applied;
}

/** Run `fn` in one IMMEDIATE transaction (rolled back if it throws). */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** A consistent online copy of the whole database into `file` (must not exist). Used by scripts/backup-db.mjs and tests. */
export function backupTo(db: Db, file: string): void {
  db.prepare("VACUUM INTO ?").run(file);
}
