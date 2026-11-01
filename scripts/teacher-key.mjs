#!/usr/bin/env node
/**
 * Issue one teacher key (선생님 키).
 *
 *   node scripts/teacher-key.mjs --id <id> --label <이름> [--group <그룹>] [--file server/teacher-keys.json]
 *
 * Makes a random XXXX-XXXX-XXXX-XXXX key, appends ONLY its sha256 to the key file and
 * prints the key once on this terminal. The server re-reads the file on every request, so
 * no restart is needed. Plain `node` — no TypeScript, no workspace imports (ruling E8).
 *
 * --file (default: $TEACHER_KEYS_FILE, else server/teacher-keys.json): a relative path is
 * resolved against the REPOSITORY ROOT, exactly like the server does (ruling E7), so the
 * script and the server always agree on the file wherever this is run from.
 */

import { createHash, randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/**
 * Key symbols: readable, no look-alikes (0/O, 1/I are left out — teachers type these).
 * Deliberately its own constant: plain node cannot import the TS class-code alphabet, and
 * keys need readability, not equality with class codes (ruling E8).
 */
const KEY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const KEY_GROUPS = 4;
const KEY_GROUP_LENGTH = 4;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FILE = "server/teacher-keys.json";
/** Reserved by the server for the operator key (ADMIN_CODE). */
const RESERVED_ID = "operator";
const RESERVED_GROUP = "*";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const MAX_TEXT = 40;

const USAGE = `사용법: node scripts/teacher-key.mjs --id <id> --label <이름> [--group <그룹>] [--file <키 파일>]
  --id     영문·숫자·-·_ (40자 이내, "operator" 제외). 파일 안에서 겹치면 안 돼요.
  --label  선생님/반 이름 (예: "새빛초 4-2"). 운영자 현황에 보여요.
  --group  같은 그룹 선생님끼리 서로의 반에 들어갈 수 있어요 (선택, "*" 제외).
  --file   키 파일 (기본: TEACHER_KEYS_FILE, 없으면 server/teacher-keys.json — 저장소 루트 기준).`;

function die(message) {
  console.error(message);
  console.error(USAGE);
  process.exit(1);
}

function makeKey() {
  const groups = [];
  for (let g = 0; g < KEY_GROUPS; g++) {
    let part = "";
    for (let i = 0; i < KEY_GROUP_LENGTH; i++) part += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
    groups.push(part);
  }
  return groups.join("-");
}

/** Must match server hashKey(): sha256 hex of the trimmed key. */
function hashKey(key) {
  return createHash("sha256").update(key.trim(), "utf8").digest("hex");
}

let args;
try {
  args = parseArgs({
    options: {
      id: { type: "string" },
      label: { type: "string" },
      group: { type: "string" },
      file: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  }).values;
} catch {
  die("알 수 없는 옵션이 있어요.");
}

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const id = (args.id ?? "").trim();
const label = (args.label ?? "").trim();
const group = args.group === undefined ? undefined : args.group.trim();

if (!ID_PATTERN.test(id) || id.toLowerCase() === RESERVED_ID) die("--id 가 올바르지 않아요.");
if (label.length === 0 || label.length > MAX_TEXT) die("--label 이 필요해요 (40자 이내).");
if (group !== undefined && (group.length === 0 || group.length > MAX_TEXT || group === RESERVED_GROUP)) {
  die("--group 이 올바르지 않아요.");
}

const envFile = (process.env.TEACHER_KEYS_FILE ?? "").trim();
const chosen = args.file ?? (envFile !== "" ? envFile : DEFAULT_FILE);
const file = path.isAbsolute(chosen) ? path.normalize(chosen) : path.resolve(REPO_ROOT, chosen);

// Read the existing file (never print its content). A malformed file is left untouched.
let data = { keys: [] };
if (fs.existsSync(file)) {
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    console.error(`키 파일을 읽을 수 없어요(JSON 형식 오류): ${file}`);
    process.exit(1);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data) || !Array.isArray(data.keys)) {
    console.error(`키 파일 형식이 올바르지 않아요("keys" 목록이 없어요): ${file}`);
    process.exit(1);
  }
}
if (data.keys.some((e) => e && typeof e.id === "string" && e.id.trim() === id)) {
  console.error(`이미 있는 id예요: ${id}`);
  process.exit(1);
}

const hashes = new Set(data.keys.map((e) => (e && typeof e.sha256 === "string" ? e.sha256.toLowerCase() : "")));
let key = makeKey();
while (hashes.has(hashKey(key))) key = makeKey();

const entry = { id, label, ...(group !== undefined ? { group } : {}), sha256: hashKey(key) };
data.keys.push(entry);

// Write atomically: a temp file next to the target, then rename over it. The temp name
// keeps the stem and extension (teacher-keys.tmp-<pid>.json) so .gitignore covers it too.
fs.mkdirSync(path.dirname(file), { recursive: true });
const ext = path.extname(file);
const tmp = path.join(path.dirname(file), `${path.basename(file, ext)}.tmp-${process.pid}${ext}`);
fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
fs.renameSync(tmp, file);

console.log("선생님 키를 만들었어요.");
console.log(`  id:   ${id}`);
console.log(`  이름: ${label}`);
console.log(`  그룹: ${group ?? "(없음)"}`);
console.log(`  파일: ${file}`);
console.log("");
console.log(`  키:   ${key}`);
console.log("");
console.log("이 키는 다시 볼 수 없어요. 선생님께 안전하게 전달하세요.");
console.log("(서버는 키 파일을 요청마다 다시 읽으므로 다시 시작할 필요가 없어요.)");
