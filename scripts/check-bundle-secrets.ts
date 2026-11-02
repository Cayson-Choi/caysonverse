/**
 * scripts/check-bundle-secrets.ts — 번들 정답 검사 (방탈출 1단계 Task 25).
 *
 *   npm run build -w client
 *   npx tsx --tsconfig server/tsconfig.json scripts/check-bundle-secrets.ts [--dist <dir>]
 *
 * 만든 클라이언트(client/dist)의 js·html·css(와 json·map)를 읽어 퍼즐 정답·단서 원문이 들어 있는지 찾는다.
 *   - ROOM_DEFS의 방마다 bundleNeedles(def): 비밀 문자열(정답·숨은 글·힌트·설명·정리 문장)의 글자 그대로 / \uXXXX 형태,
 *     숫자 정답의 따옴표 리터럴, 글자 정답의 이어 붙인 꼴과 배열 꼴. 클라이언트 화면에도 나오는 공개 문구는 뺀다(규칙 E9).
 *   - server/teacher-keys.json 과 e2e 픽스처(e2e/fixtures/teacher-keys.e2e.json)의 sha256 해시 문자열.
 * 하나라도 찾으면 그 파일과 찾은 문자열의 앞 20자를 찍고 종료 코드 1, 깨끗하면 0. 읽을 파일이 없으면(빌드 안 함) 1이다.
 * --dist 로 다른 폴더를 검사할 수 있다(테스트: server/src/tools/bundleSecrets.test.ts).
 * 순수 부분은 scanText / scanFiles 이고 import해서 쓸 수 있다.
 */

import fs from "node:fs";
import path from "node:path";
import { bundleNeedles } from "../server/src/escape/content";
import { ROOM_DEFS } from "../server/src/escape/rooms";

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_DIST = path.join(REPO_ROOT, "client", "dist");
const KEY_FILES = [path.join(REPO_ROOT, "server", "teacher-keys.json"), path.join(REPO_ROOT, "e2e", "fixtures", "teacher-keys.e2e.json")];
const BUNDLE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".html", ".css", ".json", ".map"]);
const SHA256_HEX = /^[0-9a-f]{64}$/i;
/** How much of a found string is printed. */
const EXCERPT_CHARS = 20;

export interface Needle {
  /** Where it comes from, e.g. `room counsel` or `key file e2e/fixtures/teacher-keys.e2e.json`. */
  source: string;
  re: RegExp;
}

export interface Hit {
  file: string;
  source: string;
  /** The first characters of what was found. */
  excerpt: string;
}

/** Every needle that matches `text` (each once), tagged with `file`. */
export function scanText(file: string, text: string, needles: readonly Needle[]): Hit[] {
  const hits: Hit[] = [];
  for (const n of needles) {
    const m = n.re.exec(text);
    if (m) hits.push({ file, source: n.source, excerpt: [...m[0]].slice(0, EXCERPT_CHARS).join("") });
  }
  return hits;
}

/** The bundle files under `dir` (recursive), sorted. */
export function listBundleFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (BUNDLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/** Needles for every room's secrets. */
export function roomNeedles(): Needle[] {
  const out: Needle[] = [];
  for (const [roomId, def] of Object.entries(ROOM_DEFS)) {
    if (!def) continue;
    for (const re of bundleNeedles(def)) out.push({ source: `room ${roomId}`, re });
  }
  return out;
}

/** The sha256 strings of the teacher key files that exist (a case-insensitive literal each). */
export function keyHashNeedles(files: readonly string[] = KEY_FILES): Needle[] {
  const out: Needle[] = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue; // the server skips an unreadable key file too; nothing to look for
    }
    const keys = (parsed as { keys?: unknown } | null)?.keys;
    if (!Array.isArray(keys)) continue;
    for (const k of keys) {
      const h = (k as { sha256?: unknown } | null)?.sha256;
      if (typeof h === "string" && SHA256_HEX.test(h)) out.push({ source: `key hash from ${path.relative(REPO_ROOT, file).split(path.sep).join("/")}`, re: new RegExp(h, "i") });
    }
  }
  return out;
}

export interface ScanResult {
  files: number;
  bytes: number;
  hits: Hit[];
}

/** Scan every bundle file under `dir` with `needles`. */
export function scanFiles(dir: string, needles: readonly Needle[]): ScanResult {
  const files = listBundleFiles(dir);
  const hits: Hit[] = [];
  let bytes = 0;
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    bytes += Buffer.byteLength(text);
    hits.push(...scanText(path.relative(dir, f).split(path.sep).join("/"), text, needles));
  }
  return { files: files.length, bytes, hits };
}

export function main(argv: string[]): number {
  let dist = DEFAULT_DIST;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dist" && argv[i + 1]) dist = path.resolve(argv[++i]);
    else {
      console.error("usage: npx tsx --tsconfig server/tsconfig.json scripts/check-bundle-secrets.ts [--dist <dir>]");
      return 1;
    }
  }
  if (!fs.existsSync(dist) || !fs.statSync(dist).isDirectory()) {
    console.error(`FAIL: 검사할 폴더가 없어요: ${dist} (먼저 npm run build -w client)`);
    return 1;
  }
  const rooms = roomNeedles();
  const keys = keyHashNeedles();
  const result = scanFiles(dist, [...rooms, ...keys]);
  if (result.files === 0) {
    console.error(`FAIL: ${dist} 안에 검사할 파일이 없어요`);
    return 1;
  }
  console.log(`${dist}: ${result.files}개 파일, ${(result.bytes / 1024 / 1024).toFixed(2)} MB — 방 ${Object.keys(ROOM_DEFS).length}개의 패턴 ${rooms.length}개, 키 해시 ${keys.length}개`);
  if (result.hits.length > 0) {
    for (const h of result.hits) console.error(`FAIL: ${h.file}: ${h.source}: "${h.excerpt}"`);
    console.error(`FAIL: 번들에 비밀이 ${result.hits.length}곳 들어 있어요`);
    return 1;
  }
  console.log("PASS: 정답·단서 원문·키 해시가 번들에 없어요");
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
