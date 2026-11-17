#!/usr/bin/env node
/**
 * scripts/backup-db.mjs — a consistent online copy of the server's SQLite database (memorial stage B), safe while the game runs
 * (SQLite `VACUUM INTO`; never `cp` the live file). Keeps the newest N copies.
 *
 *   node scripts/backup-db.mjs [--db=<file>] [--out=<dir>] [--keep=14]
 *
 * Defaults follow the server: --db = $CV_DB_PATH or $CV_DATA_DIR/caysonverse.db (CV_DATA_DIR default /var/lib/caysonverse),
 * --out = $CV_DATA_DIR/backups. Photos (media/) are plain files: back them up with the same timer (see
 * docs/designs/memorial-2/deploy-notes.md, e.g. `tar` or `rclone`/`oci os object sync` to Object Storage). Prints no secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const dataDir = process.env.CV_DATA_DIR || "/var/lib/caysonverse";
const db = args.db || process.env.CV_DB_PATH || path.join(dataDir, "caysonverse.db");
const out = args.out || path.join(dataDir, "backups");
const keep = Math.max(1, Number(args.keep || 14));

if (!fs.existsSync(db)) {
  console.error(`no database at ${db}`);
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true, mode: 0o750 });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const file = path.join(out, `caysonverse-${stamp}.db`);
const conn = new DatabaseSync(db);
conn.exec("PRAGMA busy_timeout = 5000");
conn.prepare("VACUUM INTO ?").run(file);
conn.close();
fs.chmodSync(file, 0o640);
const check = new DatabaseSync(file, { readOnly: true });
const ok = check.prepare("PRAGMA integrity_check").get();
const claims = check.prepare("SELECT COUNT(*) AS n FROM claim").get();
check.close();
const old = fs
  .readdirSync(out)
  .filter((f) => /^caysonverse-\d{8}-\d{6}\.db$/.test(f))
  .sort()
  .reverse()
  .slice(keep);
for (const f of old) fs.rmSync(path.join(out, f));
console.log(`backup ${path.basename(file)}: integrity ${Object.values(ok)[0]}, ${claims.n} claims, ${old.length} old copies removed`);
