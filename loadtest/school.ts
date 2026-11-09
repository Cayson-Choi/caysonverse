/**
 * "AI 학교 탈출" 1단계 부하 봇 (Task 26): 반(ClassRoom) N개 × 학생 M명 + 팀 교실(EscapeRoom) 인스턴스.
 *
 * 실행(보통은 run.mjs가 `--scenario school`로 띄운다):
 *   CV_LT_TEACHER_KEY=<시험용 선생님 키> CV_LT_OPERATOR_KEY=<운영자 키> \
 *   npm run loadtest -- --scenario school --endpoint http://localhost:2567 \
 *     --classes 4 --perClass 25 --escapeTeams 30 --duration 630 --statusDir <dir>
 *
 * 한 프로세스가 모든 봇을 돈다(월드 시나리오의 4샤드와 달리). @colyseus/loadtest의 `cli()`는 쓰지 않는다:
 * 봇 수가 인자로 정해지는 단순 `main(clientId)` 반복이 아니라 반 → 학생 → 팀 → 교실의 순서가 있어서다.
 * 그래도 bot.ts의 함정은 그대로 지킨다 — 모든 방(반, 교실)에 `room.onMessage("*", () => {})`를 등록한다
 * (없으면 SDK가 수신 브로드캐스트마다 console.warn을 부른다. docs/loadtest.md 3절).
 *
 * 한 반의 흐름
 *  1. 선생님 봇이 `POST /api/class/teacher`로 반을 열고(반 코드 + 일회용 입장권) 입장권으로 반에 들어온다.
 *  2. 학생 봇이 반 코드로 들어와, 합법 이동(공유 `hubGeometry` + `resolveCollision`)으로 팀 칸(TEAM_ZONE)까지
 *     걸어가 2명씩 팀을 만든다: 짝의 첫째가 `TeamCreate`, 둘째가 `TeamJoin`. 홀수 반의 마지막 학생은 마지막 팀에 붙는다.
 *  3. 모든 학생이 들어오고 팀이 만들어지면 선생님 봇이 `start`(복도 문이 열린다).
 *  4. 교실 팀(`--escapeTeams`개를 반마다 고르게, 반의 앞쪽 팀부터)의 두 봇은 0~20초 뒤에 홀 → (11, 0) → (16.5, 0) →
 *     상담실 문 앞 발판으로 걸어간다. 먼저 모인 봇(`padLeaderSid`)이 `EnterRoom`을 누르고, 두 봇이 입장권을 받아
 *     `joinById`로 상담실(EscapeRoom)에 들어간다. 반 연결은 그대로 둔다(실제 클라이언트도 그렇다).
 *  5. 교실 안: 10 Hz 무작위 걷기(상담실 기하 + `resolveCollision`; 절반은 잠금 장치 물체 쪽으로), 6~12초마다 `Inspect`
 *     (가장 가까운 앵커), 5~10초마다 `LockInput`(틀린 값), 30초마다 `LockSubmit`(틀린 제출), 봇마다 들어온 지 3분에 `HintRequest`
 *     1번, 봇의 20%는 8~15초마다 팀 채팅.
 *  6. 홀에 남은 봇은 bot.ts와 같은 비율(채팅 20%, 이모지 30%, 점프 20%, 달리기 구간 30%, 입력 중)로 홀을 걷는다.
 *
 * 통계·게이트: 5초마다 `/api/operator/status`를 읽어 `<statusDir>/measure-school.csv`에 쌓고, 끝나면 게이트
 * (p95 CPU < 50 %, 최대 RSS < 400 MB, 클라이언트당 다운스트림 ≤ 30 KB/s, 반 입장 100 %, 교실 입장 100 %, 끊김 0,
 * 오류 0, 이벤트 루프 p95 < 50 ms)를 판정해 `summary-school.json`과 함께 남긴다. 종료 코드: 전부 통과 0, 아니면 1.
 * 반 코드는 `<statusDir>/class-codes.txt`(한 줄에 하나)에 쓴다 — `node e2e/task-escape-perf.mjs --mode hub --code <코드>`가
 * 같은 반에 들어가 봇이 가득한 홀을 잰다.
 *
 * 비밀: 선생님 키·운영자 키는 환경변수 CV_LT_TEACHER_KEY / CV_LT_OPERATOR_KEY로만 받는다. 어디에도 쓰거나 찍지 않는다
 * (요청 본문도 오류 메시지도 로그에 넣지 않는다 — 상태 코드와 서버의 고정 문구만).
 */

import fs from "node:fs";
import path from "node:path";
import { Client, type Room } from "@colyseus/sdk";
// TYPE-ONLY: schema.ts runs @colyseus/schema decorators server-side only (same discipline as bot.ts).
import type { ClassState, EscapeState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import { EMOJIS, MOVE_SPEED, PLAYER_RADIUS, ROLE_STUDENT, RUN_SPEED } from "@caysonverse/shared/constants";
import { APPEARANCE_FIELDS, type Appearance } from "@caysonverse/shared/appearance";
import { isBlocked, resolveCollision } from "@caysonverse/shared/collision";
import { CLASS_ROOM, MAX_CLASSES_DEFAULT, MAX_TEAMS, TEAM_COLORS, TEAM_NAMES } from "@caysonverse/shared/escape/constants";
import { ClassMsg, EscapeMsg, type EscapeTicketPayload, type RoomContent } from "@caysonverse/shared/escape/messages";
import { HALL, HUB_DOORS, TEAM_ZONE, hubGeometry, inTeamZone } from "@caysonverse/shared/school/hubMap";
import { ROOM_MAPS } from "@caysonverse/shared/school/roomMaps";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";

// ── Tunables. The hall's social rates are the world bot's (loadtest/bot.ts); docs/loadtest.md has the rationale. ──

/** Move send rate — the client's real 10 Hz cadence. */
const MOVE_INTERVAL_MS = 100;
const CHAT_CHANCE = 0.2;
const CHAT_INTERVAL_MS: [number, number] = [8000, 15000];
const EMOJI_CHANCE = 0.3;
const EMOJI_INTERVAL_MS: [number, number] = [5000, 10000];
const RUN_LEG_CHANCE = 0.3;
const JUMP_CHANCE = 0.2;
const JUMP_INTERVAL_MS: [number, number] = [4000, 10000];
const TYPING_LEAD_MS: [number, number] = [1500, 3000];
const ARRIVE_EPS = 0.5;
const STUCK_DIST = 0.05;
const STUCK_TICKS = 30;

/** Gap between two student joins of one class (run.mjs's world shards use 50 ms too). */
const JOIN_STAGGER_MS = 50;
/** A join that takes longer than this is counted as failed. */
const JOIN_TIMEOUT_MS = 20_000;
/** After the last student joined, the teacher waits this long for the teams, then starts anyway. */
const TEAM_WAIT_MS = 45_000;
/** A team's bots leave for the door 0..this long after the class started (not all in the same tick). */
const WALK_START_SPREAD_MS = 20_000;
/** The two bots of a team stand this far (m) to either side of the pad centre. */
const PAD_SPOT_OFFSET = 0.7;
/** Pressing "입장" again takes at least this long (the class itself waits 2 s between tickets). */
const ENTER_RETRY_MS = 4000;
/** A teammate who finds the classroom already open waits this long for its own ticket before asking. */
const TICKET_PATIENCE_MS = 5000;
/** Puzzle actions begin this long after joining a classroom (its intro is 8 s; actions in the intro are dropped). */
const ESCAPE_ACTIVE_AFTER_MS = 10_000;
const ESCAPE_INSPECT_MS: [number, number] = [6000, 12000];
const ESCAPE_LOCK_INPUT_MS: [number, number] = [5000, 10000];
const ESCAPE_SUBMIT_MS = 30_000;
const ESCAPE_HINT_AT_MS = 180_000;
/** Half of the classroom walks end at the lock's object (it must stand within INSPECT_REACH = 2.2 m of it to act). */
const ESCAPE_ANCHOR_LEG_CHANCE = 0.5;
const ESCAPE_ANCHOR_ARRIVE_EPS = 1.6;
const ESCAPE_DWELL_MS: [number, number] = [3000, 8000];
const STATUS_INTERVAL_MS = 5000;
/** Samples before this (s) are warm-up; the gates read the rest (docs/loadtest.md 4절 used 15 s too). */
const WARMUP_S = 15;

/** Gates (design doc §14 + Task 26). */
const GATE = {
  p95CpuPct: 50,
  maxRssMB: 400,
  downKBsPerClient: 30,
  eventLoopP95Ms: 50,
} as const;

const CHAT_LINES = [
  "안녕하세요!",
  "반가워요~",
  "오늘 여기 사람 많네요",
  "화이팅!",
  "다들 뭐하고 계세요?",
  "ㅎㅎㅎ",
  "좋은 하루 되세요",
  "여기 좋다",
];

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} is missing`);
  return value;
}
const COUNSEL = required(ROOM_MAPS.counsel, "ROOM_MAPS.counsel");
const COUNSEL_DOOR = required(HUB_DOORS.find((d) => d.room === "counsel"), "the counsel door in HUB_DOORS");
type AnyRoom = Room<ClassState> | Room<EscapeState>;

/** All 15 appearance fields at 0 = the default look. */
const APPEARANCE = Object.fromEntries(APPEARANCE_FIELDS.map((f) => [f, 0])) as Appearance;

// ── Arguments ──

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));
const ENDPOINT = (argv.endpoint ?? "http://localhost:2567").replace(/\/+$/, "");
const CLASSES = Number(argv.classes ?? 4);
const PER_CLASS = Number(argv.perClass ?? 25);
const ESCAPE_TEAMS = Number(argv.escapeTeams ?? 30);
const DURATION_S = Number(argv.duration ?? 630);
const STATUS_DIR = argv.statusDir ?? path.join(process.cwd(), "status");
const TEACHER_KEY = (process.env.CV_LT_TEACHER_KEY ?? "").trim();
const OPERATOR_KEY = (process.env.CV_LT_OPERATOR_KEY ?? "").trim();

function die(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
if (!Number.isInteger(CLASSES) || CLASSES < 1) die(`--classes 값이 올바르지 않아요: "${argv.classes}"`);
if (!Number.isInteger(PER_CLASS) || PER_CLASS < 1) die(`--perClass 값이 올바르지 않아요: "${argv.perClass}"`);
if (!Number.isInteger(ESCAPE_TEAMS) || ESCAPE_TEAMS < 0) die(`--escapeTeams 값이 올바르지 않아요: "${argv.escapeTeams}"`);
if (!Number.isFinite(DURATION_S) || DURATION_S < 10) die(`--duration 값이 올바르지 않아요(10초 이상): "${argv.duration}"`);
if (TEACHER_KEY === "") die("환경변수 CV_LT_TEACHER_KEY(시험용 선생님 키)가 필요해요.");
if (CLASSES > MAX_CLASSES_DEFAULT) {
  process.stderr.write(`주의: --classes ${CLASSES}는 서버 기본 반 수 상한(MAX_CLASSES_DEFAULT = ${MAX_CLASSES_DEFAULT})보다 많아요 — 넘는 반은 열리지 않을 수 있어요.\n`);
}

// ── Stats (written as a heartbeat every 5 s so an abrupt kill still leaves a summary) ──

const stats = {
  teachersOpened: 0,
  openFailures: 0,
  /** Class joins of students AND teachers. */
  classJoinAttempts: 0,
  classJoined: 0,
  studentsJoined: 0,
  classJoinFailures: 0,
  escapeJoinAttempts: 0,
  /** Bots inside a classroom (target: escapeTeams x 2). */
  escapeJoined: 0,
  escapeJoinFailures: 0,
  /** Classroom connections that never delivered the room's public content. */
  contentMissing: 0,
  teamsFormed: 0,
  teamFailures: 0,
  disconnects: 0,
  roomErrors: 0,
  drops: 0,
  reconnects: 0,
  /** Personal notices the rooms sent (a healthy run has almost none). */
  notices: 0,
  uncaught: 0,
  sendErrors: 0,
  messagesSent: 0,
  movesSent: 0,
  escapeMovesSent: 0,
  chatsSent: 0,
  teamChatsSent: 0,
  emojisSent: 0,
  jumpsSent: 0,
  typingSent: 0,
  teamMsgsSent: 0,
  enterSent: 0,
  inspectsSent: 0,
  lockInputsSent: 0,
  lockSubmitsSent: 0,
  hintsSent: 0,
  ticksSkipped: 0,
  bytesReceived: 0,
  statusSamples: 0,
  statusErrors: 0,
  startedAt: Date.now(),
};

let finishing = false;
/** Join / disconnect lines are logged at most this many times per kind (counts keep going). */
const LOG_CAP = 30;
const logged = new Map<string, number>();
function logLine(kind: string, message: string): void {
  const n = (logged.get(kind) ?? 0) + 1;
  logged.set(kind, n);
  if (n <= LOG_CAP) process.stderr.write(`[${kind}] ${message}\n`);
  else if (n === LOG_CAP + 1) process.stderr.write(`[${kind}] ... 이하 생략(${LOG_CAP}줄 상한)\n`);
}

const STATUS_FILE = path.join(STATUS_DIR, "school-status.json");
function writeStatus(): void {
  const snapshot = { ...stats, elapsedSec: Math.round((Date.now() - stats.startedAt) / 1000) };
  try {
    fs.mkdirSync(STATUS_DIR, { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(snapshot, null, 2));
  } catch {
    // Best-effort — a failed heartbeat write must never crash a bot.
  }
}
const heartbeat = setInterval(writeStatus, STATUS_INTERVAL_MS);
heartbeat.unref();

process.on("unhandledRejection", (reason) => {
  stats.uncaught++;
  logLine("오류", `처리되지 않은 거부: ${reason instanceof Error ? reason.message : String(reason)}`);
});
process.on("uncaughtException", (err) => {
  stats.uncaught++;
  logLine("오류", `처리되지 않은 예외: ${err.message}`);
});

// ── Small helpers ──

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const randomInt = (exclusiveMax: number) => Math.floor(Math.random() * exclusiveMax);
const randomInRange = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);

interface Pt {
  x: number;
  z: number;
}

/** Evenly spread pick (see bot.ts): true for exactly `chance` of the consecutive indices, shifted by `phase`. */
function picked(index: number, chance: number, phase: number): boolean {
  const eps = 1e-9;
  return Math.floor((index + phase + 1) * chance + eps) > Math.floor((index + phase) * chance + eps);
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p))];
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("시간 초과")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Every send goes through here: counted, and a send on a dead socket never throws into a timer. */
function send(room: AnyRoom, type: string, payload?: unknown): void {
  try {
    room.send(type, payload);
    stats.messagesSent++;
  } catch {
    stats.sendErrors++;
  }
}

function randomWanderTarget(area: { minX: number; maxX: number; minZ: number; maxZ: number }): Pt {
  const margin = PLAYER_RADIUS + 0.5;
  return {
    x: randomInRange(area.minX + margin, area.maxX - margin),
    z: randomInRange(area.minZ + margin, area.maxZ - margin),
  };
}

/**
 * One legal step of 10 Hz walking toward `wp` at `speed` m/s: the same slide resolution the real client uses
 * (resolveCollision against the map's obstacles), clamped into the map's bounds. Always computed from the
 * AUTHORITATIVE position, so a dropped move never accumulates.
 *
 * The authoritative position is a float32, so a bot that slid flush against an obstacle can read back a hair INSIDE
 * the obstacle's grown face (-3.65 becomes -3.6500001); resolveCollision then lets it walk on into the obstacle and the
 * server drops the move — every tick, forever (measured: bots pinned to the team sign for good). So the step is
 * checked with the server's own test (isBlocked) and, when it would be dropped, replaced by its z-only or x-only part,
 * else the bot stays put (null: nothing is sent this tick).
 */
function moveStep(cur: Pt, wp: Pt, speed: number, geo: MapGeometry): { x: number; z: number; yaw: number } | null {
  const dirX = wp.x - cur.x;
  const dirZ = wp.z - cur.z;
  const dist = Math.hypot(dirX, dirZ) || 1;
  const stepLen = Math.min(speed * (MOVE_INTERVAL_MS / 1000), dist);
  const dx = (dirX / dist) * stepLen;
  const dz = (dirZ / dist) * stepLen;
  const slid = resolveCollision(cur.x, cur.z, dx, dz, PLAYER_RADIUS, geo.obstacles);
  const b = geo.bounds;
  const inBounds = (p: Pt): Pt => ({
    x: clamp(p.x, b.minX + PLAYER_RADIUS, b.maxX - PLAYER_RADIUS),
    z: clamp(p.z, b.minZ + PLAYER_RADIUS, b.maxZ - PLAYER_RADIUS),
  });
  const yaw = Math.atan2(dx, dz);
  const candidates = [inBounds(slid)];
  const zOnly = inBounds({ x: cur.x, z: cur.z + dz });
  const xOnly = inBounds({ x: cur.x + dx, z: cur.z });
  candidates.push(...(Math.abs(dz) >= Math.abs(dx) ? [zOnly, xOnly] : [xOnly, zOnly]));
  for (const c of candidates) {
    if (!isBlocked(c.x, c.z, PLAYER_RADIUS, geo.obstacles)) return { x: c.x, z: c.z, yaw };
  }
  return null;
}

/** Stuck safety net (bot.ts): barely moved for STUCK_TICKS ticks → the caller re-rolls its target. */
class StuckWatch {
  private anchor: Pt = { x: NaN, z: NaN };
  private count = 0;
  reset(): void {
    this.anchor = { x: NaN, z: NaN };
    this.count = 0;
  }
  /** True once, when the bot has been wedged for STUCK_TICKS ticks. */
  wedged(cur: Pt): boolean {
    if (Math.hypot(cur.x - this.anchor.x, cur.z - this.anchor.z) < STUCK_DIST) {
      if (++this.count >= STUCK_TICKS) {
        this.count = 0;
        return true;
      }
    } else {
      this.anchor = cur;
      this.count = 0;
    }
    return false;
  }
}

/** Count the raw WebSocket bytes of one room connection (same hook as bot.ts) into `onBytes`. */
function hookBytes(room: AnyRoom, onBytes: (n: number) => void): void {
  const rawWs = (room.connection.transport as { ws?: WebSocket }).ws;
  rawWs?.addEventListener?.("message", (event: MessageEvent) => {
    const data: unknown = event.data;
    if (data instanceof ArrayBuffer) {
      stats.bytesReceived += data.byteLength;
      onBytes(data.byteLength);
    }
  });
}

/**
 * Chat loop with the typing indicator in front of every line (bot.ts's "like a person" sequence):
 * ON, 1.5-3 s later the line, then OFF. Returns the stopper.
 */
function startChatLoop(room: AnyRoom, counter: "chatsSent" | "teamChatsSent"): () => void {
  let typingTimer: NodeJS.Timeout | undefined;
  let chatTimer: NodeJS.Timeout | undefined;
  let stopped = false;
  const schedule = (): void => {
    if (stopped) return;
    const wait = randomInRange(...CHAT_INTERVAL_MS);
    const lead = Math.min(randomInRange(...TYPING_LEAD_MS), wait);
    typingTimer = setTimeout(() => {
      send(room, MessageType.Typing, { on: true });
      stats.typingSent++;
      chatTimer = setTimeout(() => {
        send(room, MessageType.Chat, { text: CHAT_LINES[randomInt(CHAT_LINES.length)] });
        stats[counter]++;
        send(room, MessageType.Typing, { on: false });
        stats.typingSent++;
        schedule();
      }, lead);
    }, wait - lead);
  };
  schedule();
  return () => {
    stopped = true;
    if (typingTimer) clearTimeout(typingTimer);
    if (chatTimer) clearTimeout(chatTimer);
  };
}

/** A self-rescheduling timer with a random gap in `[min, max]` ms; returns the stopper. */
function every(range: [number, number], fn: () => void, firstDelayMs?: number): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const schedule = (delay: number): void => {
    timer = setTimeout(() => {
      if (stopped) return;
      try {
        fn();
      } catch {
        stats.uncaught++;
      }
      schedule(randomInRange(...range));
    }, delay);
  };
  schedule(firstDelayMs ?? randomInRange(...range));
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

// ── Class plan ──

interface ClassCtx {
  index: number;
  /** "" until the teacher opened the class. */
  code: string;
  /** Number of student bots. */
  perClass: number;
  /** Two-student teams: floor(perClass / 2). An odd class's last student joins the last team. */
  pairs: number;
  /** Teams [0, escapePairs) walk to the counselling room. */
  escapePairs: number;
  teacherRoom: Room<ClassState> | null;
  /** Students of this class who joined it. */
  studentsJoined: number;
  studentsSettled: number;
  /** When the teacher sent `start` (ms; 0 = not yet). */
  startedAt: number;
}

/** `total` escape teams spread over the classes (the first classes get the remainder), capped by each class's pairs. */
function planClasses(): ClassCtx[] {
  const pairs = Math.floor(PER_CLASS / 2);
  const base = Math.floor(ESCAPE_TEAMS / CLASSES);
  const extra = ESCAPE_TEAMS % CLASSES;
  const plan: ClassCtx[] = [];
  let capped = false;
  for (let c = 0; c < CLASSES; c++) {
    const want = base + (c < extra ? 1 : 0);
    const escapePairs = Math.min(want, pairs, MAX_TEAMS);
    if (escapePairs < want) capped = true;
    plan.push({ index: c, code: "", perClass: PER_CLASS, pairs, escapePairs, teacherRoom: null, studentsJoined: 0, studentsSettled: 0, startedAt: 0 });
  }
  if (capped) {
    process.stderr.write(`주의: 반마다 팀이 ${pairs}개뿐이라 교실 팀을 --escapeTeams ${ESCAPE_TEAMS}개 모두 채울 수 없어요.\n`);
  }
  return plan;
}

const classes = planClasses();
const PLANNED_ESCAPE_TEAMS = classes.reduce((sum, c) => sum + c.escapePairs, 0);
const PLANNED_ESCAPE_BOTS = PLANNED_ESCAPE_TEAMS * 2;
/**
 * The classroom-entry gate's target: what was ASKED for (`--escapeTeams × 2`), never the capped plan —
 * a run whose classes are too small for its escape teams fails the gate instead of passing on less.
 */
const WANTED_ESCAPE_BOTS = ESCAPE_TEAMS * 2;
/** Status samples a whole run should produce (one per STATUS_INTERVAL_MS). */
const EXPECTED_STATUS_SAMPLES = Math.floor((DURATION_S * 1000) / STATUS_INTERVAL_MS);
/** The server-metric gates count only when at least this share of the expected samples came in. */
const STATUS_COVERAGE_MIN = 0.9;
const PLANNED_CLASS_JOINS = CLASSES * (PER_CLASS + 1);

// ── Per-bot records (for the downstream average and the entry times) ──

interface BotRecord {
  name: string;
  joinedAt: number;
  bytes: number;
}
const records: BotRecord[] = [];
/** ms from the class's `start` until the bot was inside its classroom. */
const enterLatenciesMs: number[] = [];
/** ms the `joinById` itself took (ticket in hand → connected). */
const escapeJoinMs: number[] = [];
/** ms of `client.join` of the class. */
const classJoinMs: number[] = [];

// ── Students ──

type Mode = "toRug" | "team" | "wander" | "toPad" | "onPad" | "inRoom";

let botSeq = 0;

class Student {
  readonly nickname: string;
  readonly botIndex: number;
  private readonly client = new Client(ENDPOINT);
  private readonly record: BotRecord;
  private readonly pair: number;
  private readonly leftover: boolean;
  /** The second of the pair (or the leftover) joins the first's team; the first creates it. */
  private readonly joiner: boolean;
  private readonly walksToDoor: boolean;
  private readonly nameIndex: number;
  private readonly colorIndex: number;

  private classRoom: Room<ClassState> | null = null;
  private escRoom: Room<EscapeState> | null = null;
  private mode: Mode = "toRug";
  private hubMove: NodeJS.Timeout | undefined;
  private escMove: NodeJS.Timeout | undefined;
  private stoppers: Array<() => void> = [];

  // hub walking
  private target: Pt = { x: 0, z: 0 };
  private running = false;
  private readonly stuck = new StuckWatch();
  private stage = 0;
  // teams
  private lastTeamTryAt = 0;
  private teamTries = 0;
  // door
  private goAt = 0;
  private lastEnterAt = 0;
  private roomSeenAt = 0;
  private joiningEscape = false;
  // classroom
  private escTarget: Pt = { x: 0, z: 0 };
  private escTargetIsAnchor = false;
  private dwellUntil = 0;
  private lock: { id: string; length: number; anchor: Pt | null } | null = null;
  private enteredRoomAt = 0;

  constructor(
    private readonly cls: ClassCtx,
    private readonly i: number,
  ) {
    this.botIndex = botSeq++;
    // ≤ 5 characters (NICKNAME_MAX since 2026-11-10): 봇 + class in base 36 + 2-digit student, e.g. 봇101, 봇a07.
    this.nickname = `봇${(cls.index + 1).toString(36)}${String(i + 1).padStart(2, "0")}`;
    this.leftover = cls.pairs > 0 && i >= cls.pairs * 2;
    this.pair = this.leftover ? cls.pairs - 1 : Math.floor(i / 2);
    this.joiner = this.leftover || i % 2 === 1;
    // Only the pair's own two members walk to the door (a leftover stays in the hall).
    this.walksToDoor = !this.leftover && cls.pairs > 0 && this.pair < cls.escapePairs;
    // Unique (name, colour) per team: 12 names x 8 colours = 96 >= MAX_TEAMS (50).
    this.nameIndex = this.pair % TEAM_NAMES.length;
    this.colorIndex = Math.floor(this.pair / TEAM_NAMES.length) % TEAM_COLORS.length;
    this.record = { name: this.nickname, joinedAt: 0, bytes: 0 };
    records.push(this.record);
  }

  async run(): Promise<void> {
    stats.classJoinAttempts++;
    const t0 = Date.now();
    let room: Room<ClassState>;
    try {
      room = await withTimeout(
        this.client.join<ClassState>(CLASS_ROOM, { classCode: this.cls.code, nickname: this.nickname, appearance: APPEARANCE }),
        JOIN_TIMEOUT_MS,
      );
    } catch (err) {
      stats.classJoinFailures++;
      logLine("반 입장 실패", `${this.nickname}: ${errText(err)}`);
      return;
    }
    classJoinMs.push(Date.now() - t0);
    stats.classJoined++;
    stats.studentsJoined++;
    this.cls.studentsJoined++;
    this.classRoom = room;
    this.record.joinedAt = Date.now();
    this.wireRoom(room, "반");
    room.onMessage(ClassMsg.EscapeTicket, (t: EscapeTicketPayload) => this.onTicket(t));
    room.onMessage(ClassMsg.Notice, () => {
      stats.notices++;
    });

    this.pickRugTarget();
    this.hubMove = setInterval(() => {
      try {
        this.hubTick();
      } catch (err) {
        stats.uncaught++;
        logLine("오류", `${this.nickname} hubTick: ${errText(err)}`);
      }
    }, MOVE_INTERVAL_MS);
    this.startHubSocial(room);
  }

  /** Handlers every room of this bot needs: the no-op wildcard, byte counting, leave/error/drop/reconnect. */
  private wireRoom(room: AnyRoom, label: string): void {
    // NOT optional (docs/loadtest.md 3절): without a handler the SDK console.warn()s per unhandled message.
    room.onMessage("*", () => {});
    hookBytes(room, (n) => {
      this.record.bytes += n;
    });
    room.onLeave((code) => {
      if (finishing) return;
      stats.disconnects++;
      logLine("끊김", `${this.nickname} ${label} 연결 종료 (code=${code})`);
      this.stopAll();
    });
    room.onError((code, message) => {
      stats.roomErrors++;
      logLine("방 오류", `${this.nickname} ${label} (code=${code}): ${message ?? ""}`);
    });
    room.onDrop((code, reason) => {
      stats.drops++;
      logLine("순단", `${this.nickname} ${label} (code=${code}): ${reason ?? ""}`);
    });
    room.onReconnect(() => {
      stats.reconnects++;
      logLine("재접속", `${this.nickname} ${label}`);
    });
  }

  /** Stop every timer of this bot (a closed connection, or the end of the run). */
  stopAll(): void {
    if (this.hubMove) clearInterval(this.hubMove);
    if (this.escMove) clearInterval(this.escMove);
    this.hubMove = undefined;
    this.escMove = undefined;
    for (const stop of this.stoppers) stop();
    this.stoppers = [];
  }

  /** What this bot's classroom says about itself (used to check that the puzzle actions were accepted), or null. */
  probe(): { roomId: string; phase: string; wrongAttempts: number; hintsUsed: number; inputs: number } | null {
    const room = this.escRoom;
    if (!room?.state) return null;
    return {
      roomId: room.roomId,
      phase: String(room.state.phase),
      wrongAttempts: Number(room.state.wrongAttempts ?? 0),
      hintsUsed: Number(room.state.hintsUsed ?? 0),
      inputs: Number(room.state.lockInput?.size ?? 0),
    };
  }

  /** One line for CV_LT_DEBUG: where the bot is and what it is doing. */
  debugLine(): string {
    const room = this.classRoom;
    const self = room?.state?.players?.get?.(room.sessionId);
    const pos = self ? `(${self.x.toFixed(1)}, ${self.z.toFixed(1)})` : "(?)";
    return `${this.nickname} ${this.mode} ${pos} -> (${this.target.x.toFixed(1)}, ${this.target.z.toFixed(1)}) team=${self?.teamId ?? "?"}`;
  }

  leave(): void {
    this.stopAll();
    for (const room of [this.escRoom, this.classRoom]) {
      if (!room) continue;
      try {
        void room.leave(true).catch(() => {});
      } catch {
        // already closed
      }
    }
  }

  // ── Hall: social traffic (bot.ts's rates) ──

  private startHubSocial(room: Room<ClassState>): void {
    if (picked(this.botIndex, CHAT_CHANCE, 2)) this.stoppers.push(startChatLoop(room, "chatsSent"));
    if (picked(this.botIndex, JUMP_CHANCE, 0)) {
      this.stoppers.push(
        every(JUMP_INTERVAL_MS, () => {
          send(room, MessageType.Jump, {});
          stats.jumpsSent++;
        }),
      );
    }
    if (Math.random() < EMOJI_CHANCE) {
      this.stoppers.push(
        every(EMOJI_INTERVAL_MS, () => {
          send(room, MessageType.Emoji, { index: randomInt(EMOJIS.length) });
          stats.emojisSent++;
        }),
      );
    }
  }

  // ── Hall: walking, teams, the door ──

  private pickRugTarget(): void {
    this.target = {
      x: randomInRange(TEAM_ZONE.minX + 0.8, TEAM_ZONE.maxX - 0.8),
      z: randomInRange(TEAM_ZONE.minZ + 0.8, TEAM_ZONE.maxZ - 0.8),
    };
    this.running = Math.random() < RUN_LEG_CHANCE;
  }

  private pickWanderTarget(): void {
    this.target = randomWanderTarget(HALL);
    this.running = Math.random() < RUN_LEG_CHANCE;
  }

  private hubTick(): void {
    const room = this.classRoom;
    if (!room || this.mode === "inRoom") return;
    const self = room.state?.players?.get?.(room.sessionId);
    if (!self) {
      stats.ticksSkipped++;
      return;
    }
    const cur = { x: self.x, z: self.z }; // re-anchor to the AUTHORITATIVE position
    const phase = room.state.phase;
    const gateOpen = phase === "running" || phase === "paused";
    const geo = hubGeometry(gateOpen);
    const now = Date.now();

    switch (this.mode) {
      case "toRug":
        if (dist(cur, this.target) < ARRIVE_EPS) {
          this.mode = "team";
          this.teamTries = 0;
          this.lastTeamTryAt = 0;
          return;
        }
        if (this.stuck.wedged(cur)) this.pickRugTarget();
        this.walk(room, cur, this.target, geo);
        return;

      case "team":
        this.teamStep(room, self, cur, now);
        return;

      case "wander":
        if (this.walksToDoor && gateOpen) {
          if (this.goAt === 0) this.goAt = now + randomInRange(0, WALK_START_SPREAD_MS);
          if (now >= this.goAt) {
            this.mode = "toPad";
            this.stage = cur.x > 14 ? 1 : 0;
            this.running = Math.random() < RUN_LEG_CHANCE;
            this.stuck.reset();
            return;
          }
        }
        if (dist(cur, this.target) < ARRIVE_EPS) this.pickWanderTarget();
        if (this.stuck.wedged(cur)) this.pickWanderTarget();
        this.walk(room, cur, this.target, geo);
        return;

      case "toPad": {
        const spot = this.padSpot();
        const waypoints: Pt[] = [
          { x: 11, z: 0 },
          { x: 16.5, z: 0 },
          spot,
        ];
        const eps = this.stage === 2 ? 0.35 : 0.7;
        if (dist(cur, waypoints[this.stage]) < eps) {
          if (this.stage === 2) {
            this.mode = "onPad";
            return;
          }
          this.stage++;
        }
        if (this.stuck.wedged(cur)) this.stage = Math.max(0, this.stage - 1);
        this.walk(room, cur, waypoints[this.stage], geo);
        return;
      }

      case "onPad":
        this.padStep(room, self, now);
        return;
    }
  }

  /** The point on the counselling room's pad this bot stands on (the pair's two bots side by side). */
  private padSpot(): Pt {
    const pad = COUNSEL_DOOR.pad;
    return { x: COUNSEL_DOOR.x + (this.joiner ? PAD_SPOT_OFFSET : -PAD_SPOT_OFFSET), z: (pad.minZ + pad.maxZ) / 2 };
  }

  private walk(room: Room<ClassState>, cur: Pt, wp: Pt, geo: MapGeometry): void {
    const step = moveStep(cur, wp, this.running ? RUN_SPEED : MOVE_SPEED, geo);
    if (!step) return;
    send(room, MessageType.Move, { x: step.x, z: step.z, yaw: step.yaw });
    stats.movesSent++;
  }

  /** On the rug: the first of a pair creates the team, the joiner joins it (until `teamId` shows in our own state). */
  private teamStep(room: Room<ClassState>, self: { teamId: string }, cur: Pt, now: number): void {
    if (self.teamId !== "") {
      stats.teamsFormed++;
      this.mode = "wander";
      this.pickWanderTarget();
      this.stuck.reset();
      return;
    }
    if (this.cls.pairs === 0) {
      this.mode = "wander"; // a one-student class has no team to make
      this.pickWanderTarget();
      return;
    }
    if (!inTeamZone(cur.x, cur.z, 0)) {
      this.mode = "toRug";
      this.pickRugTarget();
      return;
    }
    if (now - this.lastTeamTryAt < 1500) return;
    if (this.joiner) {
      let teamId = "";
      room.state.teams?.forEach?.((team) => {
        if (team.nameIndex === this.nameIndex && team.colorIndex === this.colorIndex) teamId = team.id;
      });
      if (teamId === "") return; // the pair's first has not made the team yet — look again next tick
      this.lastTeamTryAt = now;
      send(room, ClassMsg.TeamJoin, { teamId });
    } else {
      this.lastTeamTryAt = now;
      send(room, ClassMsg.TeamCreate, { nameIndex: this.nameIndex, colorIndex: this.colorIndex });
    }
    stats.teamMsgsSent++;
    if (++this.teamTries > 20) {
      stats.teamFailures++;
      logLine("팀 실패", `${this.nickname}: 20번 시도해도 팀이 되지 않았어요`);
      this.mode = "wander";
      this.pickWanderTarget();
    }
  }

  /** On the door's pad: the pad leader presses "입장" once two are there; a late teammate asks for its own ticket. */
  private padStep(room: Room<ClassState>, self: { teamId: string }, now: number): void {
    if (this.joiningEscape) return;
    const team = self.teamId !== "" ? room.state.teams?.get?.(self.teamId) : undefined;
    if (!team) return;
    if (now - this.lastEnterAt < ENTER_RETRY_MS) return;
    let mayPress: boolean;
    if (team.escapeRoomId !== "") {
      // The classroom is open: our ticket normally arrives with the leader's (we stand on the pad). Ask only after a while.
      if (this.roomSeenAt === 0) this.roomSeenAt = now;
      mayPress = team.escapeDoor === "counsel" && now - this.roomSeenAt >= TICKET_PATIENCE_MS;
    } else {
      mayPress = team.padDoor === "counsel" && team.padCount >= 2 && team.padLeaderSid === room.sessionId;
    }
    if (!mayPress) return;
    this.lastEnterAt = now;
    send(room, ClassMsg.EnterRoom, { room: "counsel" });
    stats.enterSent++;
  }

  // ── Classroom ──

  private onTicket(t: EscapeTicketPayload): void {
    if (this.joiningEscape || this.escRoom) return;
    this.joiningEscape = true;
    void this.joinEscape(t);
  }

  private async joinEscape(t: EscapeTicketPayload): Promise<void> {
    stats.escapeJoinAttempts++;
    const t0 = Date.now();
    let room: Room<EscapeState>;
    try {
      room = await withTimeout(this.client.joinById<EscapeState>(t.roomId, { ticket: t.ticket }), JOIN_TIMEOUT_MS);
    } catch (err) {
      stats.escapeJoinFailures++;
      logLine("교실 입장 실패", `${this.nickname}: ${errText(err)}`);
      this.joiningEscape = false;
      this.roomSeenAt = 0;
      this.lastEnterAt = 0;
      return;
    }
    // Handlers first, synchronously: the room's content arrives right after the join.
    escapeJoinMs.push(Date.now() - t0);
    this.escRoom = room;
    this.wireRoom(room, "교실");
    let gotContent = false;
    room.onMessage(EscapeMsg.Content, (content: RoomContent) => {
      gotContent = true;
      this.onContent(content);
    });
    room.onMessage(EscapeMsg.Notice, () => {
      stats.notices++;
    });
    stats.escapeJoined++;
    if (this.cls.startedAt > 0) enterLatenciesMs.push(Date.now() - this.cls.startedAt);
    setTimeout(() => {
      if (!gotContent && !finishing) {
        stats.contentMissing++;
        logLine("교실 오류", `${this.nickname}: 교실 내용(Content)을 받지 못했어요`);
      }
    }, 5000).unref();

    // Out of the hall: the hall timers stop, the classroom's start.
    this.mode = "inRoom";
    this.stopAll();
    this.enteredRoomAt = Date.now();
    this.startEscapeBehaviour(room);
  }

  private onContent(content: RoomContent): void {
    const lock = content.locks.find((l) => l.kind === "digits");
    if (!lock || lock.kind !== "digits") {
      this.lock = null;
      return;
    }
    const a = COUNSEL.anchors.find((anchor) => anchor.id === lock.objectId);
    this.lock = { id: lock.id, length: lock.length, anchor: a ? { x: a.x, z: a.z } : null };
  }

  private pickEscapeTarget(): void {
    const b = COUNSEL.geometry.bounds;
    const anchor = this.lock?.anchor ?? null;
    this.escTargetIsAnchor = anchor !== null && Math.random() < ESCAPE_ANCHOR_LEG_CHANCE;
    this.escTarget = this.escTargetIsAnchor ? { ...anchor! } : randomWanderTarget(b);
    this.running = Math.random() < RUN_LEG_CHANCE;
  }

  private startEscapeBehaviour(room: Room<EscapeState>): void {
    this.pickEscapeTarget();
    this.stuck.reset();
    this.escMove = setInterval(() => {
      try {
        this.escapeTick(room);
      } catch (err) {
        stats.uncaught++;
        logLine("오류", `${this.nickname} escapeTick: ${errText(err)}`);
      }
    }, MOVE_INTERVAL_MS);

    const sendInspect = (): void => {
      const self = room.state?.players?.get?.(room.sessionId);
      if (!self) return;
      let best: string | null = null;
      let bestD = Infinity;
      for (const a of COUNSEL.anchors) {
        const d = Math.hypot(a.x - self.x, a.z - self.z);
        if (d < bestD) {
          bestD = d;
          best = a.id;
        }
      }
      if (best === null) return;
      send(room, EscapeMsg.Inspect, { objectId: best });
      stats.inspectsSent++;
    };
    // A wrong value on purpose: one digit repeated ("3333"), so it can never be the puzzle's answer by accident.
    const repeatedDigits = (length: number): string => String(randomInt(10)).repeat(length);
    this.stoppers.push(every(ESCAPE_INSPECT_MS, sendInspect, ESCAPE_ACTIVE_AFTER_MS + randomInRange(0, 2000)));
    this.stoppers.push(
      every(
        ESCAPE_LOCK_INPUT_MS,
        () => {
          if (!this.lock) return;
          send(room, EscapeMsg.LockInput, { lockId: this.lock.id, value: repeatedDigits(this.lock.length) });
          stats.lockInputsSent++;
        },
        ESCAPE_ACTIVE_AFTER_MS + randomInRange(0, 3000),
      ),
    );
    this.stoppers.push(
      every(
        [ESCAPE_SUBMIT_MS, ESCAPE_SUBMIT_MS],
        () => {
          if (!this.lock) return;
          // Submits whatever the team's shared input holds — always a repeated digit (see LockInput), so always wrong.
          send(room, EscapeMsg.LockSubmit, { lockId: this.lock.id });
          stats.lockSubmitsSent++;
        },
        ESCAPE_ACTIVE_AFTER_MS + randomInRange(5000, 20_000),
      ),
    );
    // One hint request per bot, 3 minutes after it came in (the second of a pair meets the hint gap — also a path to exercise).
    const hintTimer = setTimeout(() => {
      send(room, EscapeMsg.HintRequest, {});
      stats.hintsSent++;
    }, ESCAPE_HINT_AT_MS);
    this.stoppers.push(() => clearTimeout(hintTimer));
    if (picked(this.botIndex, CHAT_CHANCE, 2)) this.stoppers.push(startChatLoop(room, "teamChatsSent"));
  }

  private escapeTick(room: Room<EscapeState>): void {
    const self = room.state?.players?.get?.(room.sessionId);
    if (!self) {
      stats.ticksSkipped++;
      return;
    }
    const now = Date.now();
    if (this.dwellUntil > now) return; // standing at an object
    const cur = { x: self.x, z: self.z };
    const eps = this.escTargetIsAnchor ? ESCAPE_ANCHOR_ARRIVE_EPS : ARRIVE_EPS;
    if (dist(cur, this.escTarget) < eps) {
      if (this.escTargetIsAnchor) this.dwellUntil = now + randomInRange(...ESCAPE_DWELL_MS);
      this.pickEscapeTarget();
      return;
    }
    if (this.stuck.wedged(cur)) this.pickEscapeTarget();
    const step = moveStep(cur, this.escTarget, this.running ? RUN_SPEED : MOVE_SPEED, COUNSEL.geometry);
    if (!step) return;
    send(room, MessageType.Move, { x: step.x, z: step.z, yaw: step.yaw });
    stats.escapeMovesSent++;
  }
}

// ── Teacher ──

const allStudents: Student[] = [];
const teachers: Array<{ name: string; room: Room<ClassState> | null; record: BotRecord }> = [];

async function openClass(): Promise<{ classCode: string; pass: string }> {
  const res = await withTimeout(
    fetch(`${ENDPOINT}/api/class/teacher`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teacherKey: TEACHER_KEY }),
    }),
    JOIN_TIMEOUT_MS,
  );
  const json = (await res.json().catch(() => null)) as { classCode?: unknown; pass?: unknown; error?: unknown } | null;
  if (!res.ok) throw new Error(`HTTP ${res.status}${typeof json?.error === "string" ? ` ${json.error}` : ""}`);
  if (typeof json?.classCode !== "string" || typeof json?.pass !== "string") throw new Error("응답에 반 코드나 입장권이 없어요");
  return { classCode: json.classCode, pass: json.pass };
}

function writeClassCodes(): void {
  try {
    fs.mkdirSync(STATUS_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATUS_DIR, "class-codes.txt"), `${classes.map((c) => c.code).filter((c) => c !== "").join("\n")}\n`);
  } catch {
    // Best-effort.
  }
}

/** One class: the teacher opens and joins it, the students follow, and the teacher starts it when the teams stand. */
async function runClass(cls: ClassCtx): Promise<void> {
  const teacherName = `선생님${cls.index + 1}`;
  const record: BotRecord = { name: teacherName, joinedAt: 0, bytes: 0 };
  records.push(record);
  const slot = { name: teacherName, room: null as Room<ClassState> | null, record };
  teachers.push(slot);

  let pass: string;
  try {
    const opened = await openClass();
    cls.code = opened.classCode;
    pass = opened.pass;
    stats.teachersOpened++;
    writeClassCodes();
  } catch (err) {
    stats.openFailures++;
    logLine("반 열기 실패", `${teacherName}: ${errText(err)}`);
    return;
  }

  const client = new Client(ENDPOINT);
  stats.classJoinAttempts++;
  const t0 = Date.now();
  let room: Room<ClassState>;
  try {
    room = await withTimeout(
      client.join<ClassState>(CLASS_ROOM, { classCode: cls.code, nickname: teacherName, appearance: APPEARANCE, teacherPass: pass }),
      JOIN_TIMEOUT_MS,
    );
  } catch (err) {
    stats.classJoinFailures++;
    logLine("반 입장 실패", `${teacherName}: ${errText(err)}`);
    return;
  }
  classJoinMs.push(Date.now() - t0);
  stats.classJoined++;
  record.joinedAt = Date.now();
  cls.teacherRoom = room;
  slot.room = room;
  room.onMessage("*", () => {});
  room.onMessage(ClassMsg.Notice, () => {
    stats.notices++;
  });
  hookBytes(room, (n) => {
    record.bytes += n;
  });
  room.onLeave((code) => {
    if (finishing) return;
    stats.disconnects++;
    logLine("끊김", `${teacherName} 연결 종료 (code=${code})`);
  });
  room.onError((code, message) => {
    stats.roomErrors++;
    logLine("방 오류", `${teacherName} (code=${code}): ${message ?? ""}`);
  });
  room.onDrop((code, reason) => {
    stats.drops++;
    logLine("순단", `${teacherName} (code=${code}): ${reason ?? ""}`);
  });
  room.onReconnect(() => {
    stats.reconnects++;
  });

  // Students join one after another (JOIN_STAGGER_MS); each class runs in parallel with the others.
  const students: Promise<void>[] = [];
  for (let i = 0; i < cls.perClass; i++) {
    const student = new Student(cls, i);
    allStudents.push(student);
    students.push(
      student.run().finally(() => {
        cls.studentsSettled++;
      }),
    );
    await sleep(JOIN_STAGGER_MS);
  }
  await Promise.all(students);
  const allJoinedAt = Date.now();

  // Start when everybody who is coming has a team (or after TEAM_WAIT_MS).
  const expectedInTeams = cls.pairs > 0 ? cls.perClass : 0;
  const waitForTeams = setInterval(() => {
    if (finishing || cls.startedAt > 0) return clearInterval(waitForTeams);
    let inTeam = 0;
    room.state?.players?.forEach?.((p) => {
      if (p.role === ROLE_STUDENT && p.teamId !== "") inTeam++;
    });
    const timedOut = Date.now() - allJoinedAt >= TEAM_WAIT_MS;
    if (inTeam >= Math.min(expectedInTeams, cls.studentsJoined) || timedOut) {
      clearInterval(waitForTeams);
      if (timedOut && inTeam < expectedInTeams) logLine("팀 대기", `${teacherName}: ${inTeam}/${expectedInTeams}명만 팀이 되어 시작해요`);
      cls.startedAt = Date.now();
      send(room, ClassMsg.Command, { cmd: "start" });
    }
  }, 500);
}


// ── Operator status → measure-school.csv ──

interface StatusSample {
  elapsedSec: number;
  cpuPct: number;
  rssMB: number;
  heapMB: number;
  eventLoopP95Ms: number;
  classes: number;
  players: number;
  escapeRooms: number;
}
const samples: StatusSample[] = [];
const CSV_FILE = path.join(STATUS_DIR, "measure-school.csv");
let pollingOff = OPERATOR_KEY === "";
/** Set when the polling stopped during the run (a 401 / 429): the server metrics are then incomplete. */
let pollingStopped = false;
let pollBusy = false;

async function pollStatus(): Promise<void> {
  if (pollingOff || pollBusy) return;
  pollBusy = true;
  try {
    const res = await withTimeout(
      fetch(`${ENDPOINT}/api/operator/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operatorKey: OPERATOR_KEY }),
      }),
      4000,
    );
    if (res.status === 401 || res.status === 429) {
      // Never keep knocking: the failure limiter is shared with the teacher route.
      pollingOff = true;
      pollingStopped = true;
      logLine("운영자 상태", `HTTP ${res.status} — 운영자 키를 확인해 주세요. 더는 읽지 않아요.`);
      return;
    }
    const j = (await res.json()) as {
      totals?: { classes?: number; players?: number; escapeRooms?: number };
      process?: { cpuPct?: number; rssMB?: number; heapMB?: number; eventLoopP95Ms?: number };
    };
    const s: StatusSample = {
      elapsedSec: Math.round((Date.now() - stats.startedAt) / 1000),
      cpuPct: Number(j.process?.cpuPct ?? NaN),
      rssMB: Number(j.process?.rssMB ?? NaN),
      heapMB: Number(j.process?.heapMB ?? NaN),
      eventLoopP95Ms: Number(j.process?.eventLoopP95Ms ?? NaN),
      classes: Number(j.totals?.classes ?? 0),
      players: Number(j.totals?.players ?? 0),
      escapeRooms: Number(j.totals?.escapeRooms ?? 0),
    };
    samples.push(s);
    stats.statusSamples++;
    fs.appendFileSync(
      CSV_FILE,
      `${s.elapsedSec},${s.cpuPct},${s.rssMB},${s.heapMB},${s.eventLoopP95Ms},${s.classes},${s.players},${s.escapeRooms}\n`,
    );
  } catch (err) {
    stats.statusErrors++;
    logLine("운영자 상태", `읽기 실패: ${errText(err)}`);
  } finally {
    pollBusy = false;
  }
}

// ── Verdict ──

interface GateRow {
  name: string;
  value: string;
  limit: string;
  pass: boolean;
}

/**
 * The server-metric coverage (Task 26 review I2): the CPU / RSS / event-loop gates must not pass on
 * whatever samples survived — no failed read, the polling never stopped (nor was it off), and at least
 * STATUS_COVERAGE_MIN of the samples a run of DURATION_S should give.
 */
function statusCoverageOk(): boolean {
  return (
    OPERATOR_KEY !== "" &&
    !pollingStopped &&
    stats.statusErrors === 0 &&
    samples.length >= STATUS_COVERAGE_MIN * EXPECTED_STATUS_SAMPLES
  );
}

function buildSummary() {
  const elapsedS = (Date.now() - stats.startedAt) / 1000;
  const steady = samples.filter((s) => s.elapsedSec >= WARMUP_S);
  const cpus = steady.map((s) => s.cpuPct).filter(Number.isFinite).sort((a, b) => a - b);
  const loops = steady.map((s) => s.eventLoopP95Ms).filter(Number.isFinite).sort((a, b) => a - b);
  const allRss = samples.map((s) => s.rssMB).filter(Number.isFinite);
  const avg = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

  const rates = records
    .filter((r) => r.joinedAt > 0)
    .map((r) => r.bytes / 1024 / Math.max(1, (Date.now() - r.joinedAt) / 1000))
    .sort((a, b) => a - b);
  const perClientKBs = avg(rates);
  const wholeRunKBs = stats.bytesReceived / 1024 / Math.max(1, records.length) / Math.max(1, elapsedS);

  const errors =
    stats.roomErrors + stats.classJoinFailures + stats.escapeJoinFailures + stats.openFailures + stats.contentMissing + stats.uncaught + stats.teamFailures;
  const measured = samples.length > 0;
  const rows: GateRow[] = [
    {
      name: "p95 CPU (1 vCPU 기준)",
      value: cpus.length ? `${percentile(cpus, 0.95).toFixed(1)}%` : "측정 없음",
      limit: `< ${GATE.p95CpuPct}%`,
      pass: cpus.length > 0 && percentile(cpus, 0.95) < GATE.p95CpuPct,
    },
    {
      name: "최대 RSS",
      value: allRss.length ? `${Math.max(...allRss).toFixed(1)} MB` : "측정 없음",
      limit: `< ${GATE.maxRssMB} MB`,
      pass: allRss.length > 0 && Math.max(...allRss) < GATE.maxRssMB,
    },
    {
      name: "클라이언트당 다운스트림",
      value: `${perClientKBs.toFixed(1)} KB/s (p95 ${percentile(rates, 0.95).toFixed(1)}, 최대 ${(rates[rates.length - 1] ?? NaN).toFixed(1)})`,
      limit: `≤ ${GATE.downKBsPerClient} KB/s`,
      pass: Number.isFinite(perClientKBs) && perClientKBs <= GATE.downKBsPerClient,
    },
    {
      name: "반 입장",
      value: `${stats.classJoined} / ${PLANNED_CLASS_JOINS} (${((100 * stats.classJoined) / PLANNED_CLASS_JOINS).toFixed(1)}%)`,
      limit: "100%",
      pass: stats.classJoined === PLANNED_CLASS_JOINS,
    },
    {
      name: "교실 입장",
      value:
        `${stats.escapeJoined} / ${WANTED_ESCAPE_BOTS}` +
        (PLANNED_ESCAPE_BOTS < WANTED_ESCAPE_BOTS ? ` (반이 작아 ${PLANNED_ESCAPE_BOTS}명까지만 보낼 수 있어요)` : ""),
      limit: "100% (--escapeTeams × 2)",
      pass: stats.escapeJoined === WANTED_ESCAPE_BOTS,
    },
    { name: "끊김", value: String(stats.disconnects), limit: "0", pass: stats.disconnects === 0 },
    { name: "오류", value: String(errors), limit: "0", pass: errors === 0 },
    {
      name: "서버 지표 수집",
      value: `표본 ${samples.length} / ${EXPECTED_STATUS_SAMPLES}, 읽기 실패 ${stats.statusErrors}${pollingStopped || OPERATOR_KEY === "" ? ", 읽기 꺼짐" : ""}`,
      limit: `실패 0, 꺼지지 않음, 표본 ≥ ${Math.round(STATUS_COVERAGE_MIN * 100)}%`,
      pass: statusCoverageOk(),
    },
    {
      name: "이벤트 루프 p95",
      value: loops.length ? `${percentile(loops, 0.95).toFixed(1)} ms (최대 ${loops[loops.length - 1].toFixed(1)})` : "측정 없음",
      limit: `< ${GATE.eventLoopP95Ms} ms`,
      pass: loops.length > 0 && percentile(loops, 0.95) < GATE.eventLoopP95Ms,
    },
  ];
  // The classrooms' own view (one entry per room): proof that the wrong submits and the hints were really accepted.
  const rooms = new Map<string, NonNullable<ReturnType<Student["probe"]>>>();
  for (const st of allStudents) {
    const p = st.probe();
    if (p) rooms.set(p.roomId, p);
  }
  const phases: Record<string, number> = {};
  let wrongAttempts = 0;
  let hintsUsed = 0;
  let roomsWithInput = 0;
  for (const p of rooms.values()) {
    phases[p.phase] = (phases[p.phase] ?? 0) + 1;
    wrongAttempts += p.wrongAttempts;
    hintsUsed += p.hintsUsed;
    if (p.inputs > 0) roomsWithInput++;
  }
  const sortedEnter = [...enterLatenciesMs].sort((a, b) => a - b);
  const sortedJoin = [...escapeJoinMs].sort((a, b) => a - b);
  const sortedClassJoin = [...classJoinMs].sort((a, b) => a - b);
  return {
    elapsedS: Math.round(elapsedS),
    endpoint: ENDPOINT,
    plan: { classes: CLASSES, perClass: PER_CLASS, escapeTeams: ESCAPE_TEAMS, plannedEscapeTeams: PLANNED_ESCAPE_TEAMS, durationS: DURATION_S },
    measured,
    samples: { total: samples.length, steady: steady.length },
    cpu: { avg: avg(cpus), p95: percentile(cpus, 0.95), max: cpus[cpus.length - 1] ?? NaN },
    rssMB: { max: allRss.length ? Math.max(...allRss) : NaN },
    eventLoopP95Ms: { p95: percentile(loops, 0.95), max: loops[loops.length - 1] ?? NaN },
    downstreamKBs: { perClientMean: perClientKBs, p95: percentile(rates, 0.95), max: rates[rates.length - 1] ?? NaN, wholeRunMean: wholeRunKBs },
    latencyMs: {
      classJoinP50: percentile(sortedClassJoin, 0.5),
      classJoinP95: percentile(sortedClassJoin, 0.95),
      escapeJoinP50: percentile(sortedJoin, 0.5),
      escapeJoinP95: percentile(sortedJoin, 0.95),
      startToInsideP50: percentile(sortedEnter, 0.5),
      startToInsideP95: percentile(sortedEnter, 0.95),
      startToInsideMax: sortedEnter[sortedEnter.length - 1] ?? NaN,
    },
    peak: {
      players: Math.max(0, ...samples.map((s) => s.players)),
      escapeRooms: Math.max(0, ...samples.map((s) => s.escapeRooms)),
      classes: Math.max(0, ...samples.map((s) => s.classes)),
    },
    errors,
    classrooms: { count: rooms.size, phases, wrongAttempts, hintsUsed, withInput: roomsWithInput },
    stats: { ...stats },
    gates: rows,
    pass: measured && rows.every((r) => r.pass),
  };
}

function printSummary(summary: ReturnType<typeof buildSummary>): void {
  const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "-");
  const s = stats;
  console.log("\n=== 방탈출 1단계 부하 요약 ===");
  console.log(
    `반 ${CLASSES}개 × 학생 ${PER_CLASS}명, 교실 팀 ${summary.plan.plannedEscapeTeams}개(요청 ${ESCAPE_TEAMS}), ${summary.elapsedS}초 실행 (endpoint: ${ENDPOINT})`,
  );
  console.log(`선생님 열기 ${s.teachersOpened}/${CLASSES} (실패 ${s.openFailures}), 반 입장 ${s.classJoined}/${PLANNED_CLASS_JOINS} (학생 ${s.studentsJoined}, 실패 ${s.classJoinFailures})`);
  console.log(`팀 만들기 성공 ${s.teamsFormed}명 / 실패 ${s.teamFailures}명`);
  console.log(
    `교실 입장 ${s.escapeJoined}/${WANTED_ESCAPE_BOTS} (보낼 수 있는 봇 ${PLANNED_ESCAPE_BOTS}, 실패 ${s.escapeJoinFailures}, Content 못 받음 ${s.contentMissing})`,
  );
  console.log(`서버 동시 최대: 반 ${summary.peak.classes}, 접속(반) ${summary.peak.players}, 교실 ${summary.peak.escapeRooms}`);
  console.log(`끊김 ${s.disconnects}, 순단/재접속 ${s.drops}/${s.reconnects}, 방 오류 ${s.roomErrors}, 처리 안 된 예외 ${s.uncaught}, 전송 오류 ${s.sendErrors}`);
  console.log(`서버 알림(Notice): ${s.notices}`);
  console.log(
    `전송 ${s.messagesSent} — 홀 이동 ${s.movesSent}, 교실 이동 ${s.escapeMovesSent}, 홀 채팅 ${s.chatsSent}, 팀 채팅 ${s.teamChatsSent}, 이모지 ${s.emojisSent}, 점프 ${s.jumpsSent}, 입력 중 ${s.typingSent}`,
  );
  console.log(
    `       팀 만들기/들어가기 ${s.teamMsgsSent}, 입장 ${s.enterSent}, 살펴보기 ${s.inspectsSent}, 잠금 입력 ${s.lockInputsSent}, 제출 ${s.lockSubmitsSent}, 힌트 ${s.hintsSent}`,
  );
  const c = summary.classrooms;
  console.log(
    `교실이 스스로 말한 것: ${c.count}개 (상태 ${Object.entries(c.phases).map(([k, v]) => `${k} ${v}`).join(", ") || "-"}), 틀린 제출 합계 ${c.wrongAttempts}, 쓴 힌트 합계 ${c.hintsUsed}, 잠금 입력이 보이는 교실 ${c.withInput}개`,
  );
  const l = summary.latencyMs;
  console.log(
    `지연: 반 입장 p50/p95 ${f(l.classJoinP50, 0)}/${f(l.classJoinP95, 0)} ms, 교실 joinById p50/p95 ${f(l.escapeJoinP50, 0)}/${f(l.escapeJoinP95, 0)} ms, 시작→교실 안 p50/p95/최대 ${f(l.startToInsideP50 / 1000)}/${f(l.startToInsideP95 / 1000)}/${f(l.startToInsideMax / 1000)} s`,
  );
  console.log(
    `서버 CPU 평균 ${f(summary.cpu.avg)}% / p95 ${f(summary.cpu.p95)}% / 최대 ${f(summary.cpu.max)}% (샘플 ${summary.samples.steady}개, 워밍업 ${WARMUP_S}초 제외), 최대 RSS ${f(summary.rssMB.max)} MB`,
  );
  console.log(
    `수신 합계 ${(s.bytesReceived / 1024 / 1024).toFixed(1)} MB — 클라이언트당 ${f(summary.downstreamKBs.perClientMean)} KB/s(접속 시간 기준 평균), 전체 시간 기준 ${f(summary.downstreamKBs.wholeRunMean)} KB/s`,
  );
  console.log("\n게이트 판정");
  for (const r of summary.gates) console.log(`  ${r.pass ? "통과" : "실패"}  ${r.name}: ${r.value}  (게이트 ${r.limit})`);
  console.log(`\n결과: ${summary.pass ? "전부 통과" : "게이트 실패"}`);
  if (!summary.measured) console.log("(운영자 키가 없거나 읽지 못해 서버 지표를 못 쟀어요 — CV_LT_OPERATOR_KEY를 확인하세요.)");
}

// ── Main ──

async function main(): Promise<void> {
  fs.mkdirSync(STATUS_DIR, { recursive: true });
  fs.writeFileSync(CSV_FILE, "elapsedSec,cpuPct,rssMB,heapMB,eventLoopP95Ms,classes,players,escapeRooms\n");
  if (pollingOff) process.stderr.write("주의: CV_LT_OPERATOR_KEY가 없어 서버 지표(CPU·RSS·이벤트 루프)를 재지 않아요.\n");
  console.log(
    `반 ${CLASSES}개 × 학생 ${PER_CLASS}명 + 교실 팀 ${PLANNED_ESCAPE_TEAMS}개(봇 ${PLANNED_ESCAPE_BOTS}명) / ${DURATION_S}s 실행 중... (endpoint: ${ENDPOINT})`,
  );

  const poller = setInterval(() => void pollStatus(), STATUS_INTERVAL_MS);
  if (process.env.CV_LT_DEBUG === "1") {
    setInterval(() => {
      for (const s of allStudents) process.stderr.write(`[debug] ${s.debugLine()}
`);
    }, 10_000).unref();
  }
  const progress = setInterval(() => {
    const last = samples[samples.length - 1];
    console.log(
      `[진행 ${Math.round((Date.now() - stats.startedAt) / 1000)}s] 반 입장 ${stats.classJoined}/${PLANNED_CLASS_JOINS}  교실 입장 ${stats.escapeJoined}/${PLANNED_ESCAPE_BOTS}  끊김 ${stats.disconnects}  오류 ${stats.roomErrors + stats.classJoinFailures + stats.escapeJoinFailures}` +
        (last ? `  서버 CPU ${last.cpuPct}%  RSS ${last.rssMB}MB  교실 ${last.escapeRooms}` : ""),
    );
  }, 30_000);

  const running = classes.map((cls) => runClass(cls).catch((err) => {
    stats.uncaught++;
    logLine("오류", `반 ${cls.index + 1}: ${errText(err)}`);
  }));
  void Promise.all(running);

  await sleep(DURATION_S * 1000);
  finishing = true;
  clearInterval(poller);
  clearInterval(progress);
  await pollStatus(); // one last reading

  const summary = buildSummary();
  printSummary(summary);
  try {
    fs.writeFileSync(path.join(STATUS_DIR, "summary-school.json"), JSON.stringify(summary, null, 2));
  } catch {
    // Best-effort.
  }
  writeStatus();

  // Tidy up: end the classes (they close on their own after the grace) and leave.
  for (const t of teachers) if (t.room) send(t.room, ClassMsg.Command, { cmd: "end" });
  await sleep(1500);
  for (const s of allStudents) s.leave();
  for (const t of teachers) {
    try {
      void t.room?.leave(true).catch(() => {});
    } catch {
      // closed
    }
  }
  await sleep(1500);
  process.exit(summary.pass ? 0 : 1);
}

// A failure before or around the run (an unwritable --statusDir, …) must not exit 0: the exit code is the gate channel.
main().catch((err: unknown) => {
  process.stderr.write(`부하 시험을 시작하지 못했어요: ${errText(err)}\n`);
  process.exit(1);
});
