/**
 * Teacher keys (선생님 키). Server-only.
 *
 * A teacher key is issued by the operator with `scripts/teacher-key.mjs` and reaches the
 * server ONLY in the body of `POST /api/class/teacher`. The key file stores nothing but
 * the sha256 of each key:
 *
 *   { "keys": [{ "id": "t1", "label": "새빛초 4-2", "group": "saebit", "sha256": "<64 hex>" }] }
 *
 * The operator code (`ADMIN_CODE`) also works as a teacher key, as the operator.
 * Nothing here logs a key, a hash or the file's content.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { compareAdminCode } from "../rooms/adminAuth";

export interface TeacherKeyEntry {
  id: string;
  label: string;
  group?: string;
  sha256: string;
}

export interface VerifiedKey {
  id: string;
  label: string;
  /** "" when the key has no group; "*" for the operator. */
  group: string;
  operator: boolean;
}

/** The id/group the operator key verifies as. Reserved: a key file cannot use them. */
export const OPERATOR_ID = "operator";
export const OPERATOR_GROUP = "*";
const OPERATOR_KEY: VerifiedKey = { id: OPERATOR_ID, label: "운영자", group: OPERATOR_GROUP, operator: true };

/** Default key file, relative to the repository root (ruling E7). */
export const DEFAULT_KEYS_FILE = "server/teacher-keys.json";

const SHA256_HEX = /^[0-9a-f]{64}$/;

// ─────────────────────────────── key-file location ───────────────────────────────

/**
 * The repository root: the nearest ancestor of `start` whose package.json declares
 * `workspaces`. Works from the source tree (tsx / vitest: server/src/class) and from the
 * production bundle (server/dist) alike; falls back to the working directory.
 */
export function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
        workspaces?: unknown;
      };
      if (pkg && pkg.workspaces !== undefined) return dir;
    } catch {
      // no (readable) package.json here — keep walking up
    }
    const up = path.dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
}

let repoRoot: string | null = null;
function getRepoRoot(): string {
  if (repoRoot === null) repoRoot = findRepoRoot(__dirname);
  return repoRoot;
}

/**
 * The absolute key-file path: `p`, else `TEACHER_KEYS_FILE`, else DEFAULT_KEYS_FILE. A
 * relative path is resolved against the REPOSITORY ROOT, never the working directory —
 * `npm run dev` runs the server from server/, `npm start` from the root (ruling E7).
 */
export function resolveKeysFile(p?: string): string {
  const fromEnv = process.env.TEACHER_KEYS_FILE;
  const chosen = p ?? (fromEnv !== undefined && fromEnv.trim() !== "" ? fromEnv.trim() : DEFAULT_KEYS_FILE);
  return path.isAbsolute(chosen) ? path.normalize(chosen) : path.resolve(getRepoRoot(), chosen);
}

// ─────────────────────────────────── loading ───────────────────────────────────

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** A well-formed, non-reserved entry, normalised (trimmed text, lower-case hash); else null. */
function parseEntry(raw: unknown): TeacherKeyEntry | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!nonEmptyString(r.id) || !nonEmptyString(r.label) || typeof r.sha256 !== "string") return null;
  const id = r.id.trim();
  const sha256 = r.sha256.trim().toLowerCase();
  if (id === OPERATOR_ID || !SHA256_HEX.test(sha256)) return null;
  const entry: TeacherKeyEntry = { id, label: r.label.trim(), sha256 };
  if (r.group !== undefined && r.group !== null) {
    if (typeof r.group !== "string") return null;
    const group = r.group.trim();
    if (group === OPERATOR_GROUP) return null; // reserved for the operator
    if (group !== "") entry.group = group; // "" = no group
  }
  return entry;
}

/**
 * Read the teacher-key file (see `resolveKeysFile`). Re-read on every call so keys can be
 * added or revoked without a restart. A missing file is normal (no teachers yet) → [].
 * Malformed or reserved entries (id "operator", group "*") and repeated ids are skipped.
 * Problems are logged as fixed strings only — never the file's content.
 */
export function loadTeacherKeys(p?: string): TeacherKeyEntry[] {
  const file = resolveKeysFile(p);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[caysonverse] teacher key file could not be read — no teacher keys loaded");
    }
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // The JSON error message would quote the file — never log it.
    console.warn("[caysonverse] teacher key file is not valid JSON — no teacher keys loaded");
    return [];
  }
  const list = (data as { keys?: unknown } | null)?.keys;
  if (typeof data !== "object" || data === null || Array.isArray(data) || !Array.isArray(list)) {
    console.warn('[caysonverse] teacher key file has no "keys" list — no teacher keys loaded');
    return [];
  }
  const out: TeacherKeyEntry[] = [];
  const ids = new Set<string>();
  let skipped = 0;
  for (const raw of list) {
    const entry = parseEntry(raw);
    if (!entry || ids.has(entry.id)) {
      skipped++;
      continue;
    }
    ids.add(entry.id);
    out.push(entry);
  }
  if (skipped > 0) {
    console.warn(`[caysonverse] teacher key file: skipped ${skipped} malformed or duplicate entr${skipped === 1 ? "y" : "ies"}`);
  }
  return out;
}

// ───────────────────────────────── verification ─────────────────────────────────

/** sha256 hex of the trimmed key (the only form a key is ever stored in). */
export function hashKey(key: string): string {
  return createHash("sha256").update(key.trim(), "utf8").digest("hex");
}

/**
 * The key's identity, or null. `provided` comes straight from a request body: anything but
 * a non-blank string is rejected. The operator code (when set) verifies as the operator;
 * otherwise the key's sha256 is compared with every entry in constant time.
 */
export function verifyTeacherKey(
  provided: unknown,
  entries: readonly TeacherKeyEntry[],
  operatorCode: string | undefined,
): VerifiedKey | null {
  if (typeof provided !== "string") return null;
  const key = provided.trim();
  if (key.length === 0) return null;

  if (typeof operatorCode === "string" && compareAdminCode(key, operatorCode.trim())) {
    return { ...OPERATOR_KEY };
  }

  const digest = Buffer.from(hashKey(key), "hex");
  let found: TeacherKeyEntry | null = null;
  for (const entry of entries) {
    if (typeof entry.sha256 !== "string") continue;
    const stored = Buffer.from(entry.sha256.toLowerCase(), "hex");
    // No early exit: every entry is compared, so timing does not reveal which one matched.
    if (stored.length === digest.length && timingSafeEqual(stored, digest) && found === null) {
      found = entry;
    }
  }
  if (!found) return null;
  return { id: found.id, label: found.label, group: found.group ?? "", operator: false };
}

/**
 * May `key` teach the class opened by `opener`? The operator always; otherwise the opener
 * itself (same id) or a colleague of the same non-empty group.
 */
export function canTeach(key: VerifiedKey, opener: { id: string; group: string }): boolean {
  if (key.operator) return true;
  if (key.id === opener.id) return true;
  return key.group !== "" && key.group === opener.group;
}
