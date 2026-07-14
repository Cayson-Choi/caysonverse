/**
 * 100봇 부하 테스트 봇 스크립트 — @colyseus/loadtest의 `cli(main)` 패턴을 따른다.
 *
 * 단독 실행(소규모): `npm run bot -w loadtest -- --room world --numClients 10 --endpoint http://localhost:2567`
 * 100봇 전체 실행: `npm run loadtest` → run.mjs가 이 스크립트를 10개 프로세스로 샤딩한다.
 * (인자는 @colyseus/loadtest의 `cli()`가 직접 process.argv를 파싱한다 — 위 문서 참고)
 *
 * `cli()`는 한 프로세스 안에서 numClients개의 `main()` 호출을 순차적으로(await하며)
 * 실행한다 — 별도 프로세스/워커가 아니다. 각 `main()`은 방에 join한 뒤 인터벌들을
 * 등록하고 즉시 반환하며(테스트 기간 내내 블록하지 않음), 등록된 인터벌들이 이벤트
 * 루프를 살려 둔다.
 *
 * ⚠️ 이 스크립트에서 가장 중요한 한 줄은 `room.onMessage("*", ...)`다. 이것이 없으면
 * SDK가 수신 브로드캐스트(채팅·이모지)마다 console.warn을 호출하고, @colyseus/loadtest의
 * cli()는 console.warn을 가로채 "계속 자라는 TUI 로그 문자열 앞붙이기 + 전체 재렌더"를
 * 한다 — 시간·클라이언트 수에 대해 O(n²)로 비대해져 이벤트 루프를 서서히 질식시키고,
 * WS pong이 서버의 ping 정책(3초 × 2회 = 약 6초)을 놓쳐 프로세스의 전체 봇이 한꺼번에
 * 강제 종료된다(1006). 이 수정 전에는 100봇 단일 프로세스가 조인 완료 약 6초 만에
 * 전멸했고(당시 서버 CPU는 ~2.5%로 멀쩡 — 부하 생성기 쪽 문제), 수정 후에는 단일
 * 프로세스 100봇도 코어의 ~8%로 안정 동작한다. 자세한 진단 수치는 docs/loadtest.md 참고.
 *
 * 환경변수:
 *  - CV_BOT_OFFSET: 닉네임 번호 오프셋 (샤드 간 닉네임 중복 방지, 기본 0)
 *  - CV_LOADTEST_STATUS: 이 프로세스의 통계 하트비트 JSON 경로
 *
 * 이동 정책(바인딩): 봇은 오직 합법적인 트래픽만 보낸다 — 검증기를 시험하는 게
 * 아니라 서버 용량을 시험하는 것이다. 매 틱마다 "지금 서버가 알고 있는 내 위치"
 * (room.state에서 읽은 값)를 기준으로 다음 스텝을 계산하므로, 이전 이동이 드롭되었어도
 * 다음 틱은 항상 권위 있는 상태에 재고정(re-anchor)된다. 장애물 회피는 클라이언트가
 * 실제로 사용하는 것과 동일한 `resolveCollision`(shared/collision.ts)을 재사용해
 * "대략적"이 아니라 정확히 같은 슬라이드 로직으로 처리한다.
 */

import fs from "node:fs";
import path from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import { cli, type Options } from "@colyseus/loadtest";
// TYPE-ONLY: schema.ts runs @colyseus/schema decorators server-side only. We
// borrow WorldState's shape for typing room.state, exactly like the real
// client (client/src/net/connection.ts) — no decorator runtime enters here.
import type { WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import {
  WORLD_ROOM,
  MOVE_SPEED,
  WORLD_BOUNDS,
  PLAYER_RADIUS,
  CHARACTER_COUNT,
  TINT_COUNT,
  EMOJIS,
} from "@caysonverse/shared/constants";
import { OBSTACLES, DOOR_HALF_WIDTH } from "@caysonverse/shared/worldMap";
import { resolveCollision } from "@caysonverse/shared/collision";

// ── Tunables (see docs/loadtest.md for the design-gate rationale) ──

/** Move send rate — matches the client's real 10Hz cadence. */
const MOVE_INTERVAL_MS = 100;
/** Fraction of bots that chat periodically. */
const CHAT_CHANCE = 0.2;
/** Chat interval bounds (ms) — comfortably under CHAT_RATE (3 per 5s). */
const CHAT_INTERVAL_MS: [number, number] = [8000, 15000];
/** Fraction of bots that fire emoji reactions periodically. */
const EMOJI_CHANCE = 0.3;
/** Emoji interval bounds (ms) — comfortably under EMOJI_RATE (1 per 500ms). */
const EMOJI_INTERVAL_MS: [number, number] = [5000, 10000];
/** Distance (m) from the wander target at which a bot picks a new one. */
const ARRIVE_EPS = 0.5;
/**
 * Waypoint x-offset past the divider when routing through the door. Without
 * door routing a bot whose target lies across the divider slides along the wall
 * until its z matches the target, then pushes into the wall FOREVER (measured:
 * within minutes most of 100 bots ended up frozen at x = ±0.65 and patch
 * traffic collapsed to ~0.4KB/s per client). Straight-line random walk is NOT
 * a random walk on this map.
 */
const DOOR_CROSS_X = 1.0;
/** Keep door-crossing waypoints this far inside the gap edges (z margin, m). */
const DOOR_Z_MARGIN = 0.6;
/** Stuck safety net: re-roll the target if we moved less than this in the window. */
const STUCK_DIST = 0.05;
const STUCK_TICKS = 30;

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

// ── Shared (single-process) run stats, written as a heartbeat every 5s so the
// summary survives an abrupt kill (Windows does not deliver SIGTERM to Node
// gracefully — see docs/loadtest.md). ──
const stats = {
  joinAttempts: 0,
  joined: 0,
  joinFailures: 0,
  disconnects: 0,
  roomErrors: 0,
  /** Transient connection drops (SDK auto-reconnect follows; not a final leave). */
  drops: 0,
  /** Successful SDK auto-reconnects after a transient drop. */
  reconnects: 0,
  /** Move ticks skipped because our player was not (yet) in the synced state. */
  ticksSkipped: 0,
  movesSent: 0,
  chatsSent: 0,
  emojisSent: 0,
  /**
   * Total WebSocket bytes received across this process's bots (downstream).
   * Counted with the same raw-socket message hook @colyseus/loadtest's own
   * dashboard uses. Caveat: the listener is attached once after join — a
   * reconnected socket is not re-hooked (fine: a healthy run has no drops).
   */
  bytesReceived: 0,
  startedAt: Date.now(),
};

const STATUS_FILE = process.env.CV_LOADTEST_STATUS ?? path.join(process.cwd(), "loadtest-status.json");

function writeStatus(): void {
  const snapshot = { ...stats, elapsedSec: Math.round((Date.now() - stats.startedAt) / 1000) };
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(snapshot, null, 2));
  } catch {
    // Best-effort — a failed heartbeat write must never crash a bot.
  }
}

const heartbeat = setInterval(writeStatus, 5000);
heartbeat.unref(); // the bots' own timers keep the process alive, not this

process.on("exit", writeStatus); // final snapshot on a graceful exit

function randomInt(exclusiveMax: number): number {
  return Math.floor(Math.random() * exclusiveMax);
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function randomWanderTarget(): { x: number; z: number } {
  const margin = PLAYER_RADIUS + 0.5;
  return {
    x: randomInRange(WORLD_BOUNDS.minX + margin, WORLD_BOUNDS.maxX - margin),
    z: randomInRange(WORLD_BOUNDS.minZ + margin, WORLD_BOUNDS.maxZ - margin),
  };
}

/**
 * The point to walk toward RIGHT NOW: the target itself when it is on our side
 * of the divider, else a waypoint just past the door (x = ±DOOR_CROSS_X, z
 * clamped into the gap) so the divider is crossed through the opening instead
 * of being pushed against. Pure and per-tick, so a drop/re-anchor re-derives it.
 */
function nextWaypoint(
  cur: { x: number; z: number },
  target: { x: number; z: number },
): { x: number; z: number } {
  const sameSide = (cur.x < 0) === (target.x < 0);
  if (sameSide || Math.abs(cur.x) <= DOOR_CROSS_X) return target;
  const doorZ = clamp(cur.z, -(DOOR_HALF_WIDTH - DOOR_Z_MARGIN), DOOR_HALF_WIDTH - DOOR_Z_MARGIN);
  return { x: cur.x < 0 ? DOOR_CROSS_X : -DOOR_CROSS_X, z: doorZ };
}

/** Shard nickname offset so parallel bot processes get distinct numbers. */
const BOT_OFFSET = Number(process.env.CV_BOT_OFFSET ?? 0) || 0;

/** Zero-padded Korean bot nickname, e.g. `봇001` — always 2-12 chars, always legal. */
function botNickname(clientId: number): string {
  return `봇${String(BOT_OFFSET + clientId + 1).padStart(3, "0")}`;
}

async function main(options: Options): Promise<void> {
  const nickname = botNickname(options.clientId);
  const character = randomInt(CHARACTER_COUNT);
  const tint = randomInt(TINT_COUNT);

  const client = new Client(options.endpoint);
  let room: Room<WorldState>;
  stats.joinAttempts++;
  try {
    // The ACTUAL production join verb (never joinOrCreate) — see Task 11's
    // singleton-world topology note in the brief. Joining a not-yet-created or
    // full room throws; that failure is counted and logged, not retried (a
    // bot's job is to add load, not to exercise the client's retry policy).
    room = await client.join<WorldState>(WORLD_ROOM, { nickname, character, tint });
  } catch (err) {
    stats.joinFailures++;
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[${nickname}] join 실패: ${message}\n`);
    return;
  }
  stats.joined++;

  // Consume every broadcast (chat/emoji/chat_rejected) with a no-op wildcard
  // handler. NOT optional: without a handler the SDK console.warn()s per
  // unhandled message, and @colyseus/loadtest's cli() overrides console.warn to
  // prepend into an ever-growing TUI log string and re-render it — O(n^2) over
  // time, which measurably decayed the bots' move cadence (9Hz -> 4.7Hz within
  // 150s) until the process starved. A real client subscribes to these anyway.
  room.onMessage("*", () => {});

  // Downstream measurement: count every incoming frame's bytes on the raw
  // socket (binaryType is "arraybuffer", so event.data has byteLength).
  const rawWs = (room.connection.transport as { ws?: WebSocket }).ws;
  rawWs?.addEventListener?.("message", (event: MessageEvent) => {
    const data: unknown = event.data;
    if (data instanceof ArrayBuffer) stats.bytesReceived += data.byteLength;
  });

  room.onLeave((code) => {
    stats.disconnects++;
    process.stderr.write(`[${nickname}] 연결 종료 (code=${code})\n`);
    clearInterval(moveTimer);
    if (chatTimer) clearTimeout(chatTimer);
    if (emojiTimer) clearTimeout(emojiTimer);
  });
  room.onError((code, message) => {
    stats.roomErrors++;
    process.stderr.write(`[${nickname}] 방 오류 (code=${code}): ${message ?? ""}\n`);
  });
  room.onDrop((code, reason) => {
    stats.drops++;
    process.stderr.write(`[${nickname}] 순단 (code=${code}): ${reason ?? ""}\n`);
  });
  room.onReconnect(() => {
    stats.reconnects++;
    process.stderr.write(`[${nickname}] 재접속 성공\n`);
  });

  let target = randomWanderTarget();
  let stuckAnchor = { x: NaN, z: NaN };
  let stuckCount = 0;

  const moveTimer = setInterval(() => {
    const self = room.state?.players?.get?.(room.sessionId);
    if (!self) {
      stats.ticksSkipped++;
      return; // not yet in synced state — skip this tick
    }

    const cur = { x: self.x, z: self.z }; // re-anchor to the AUTHORITATIVE position

    if (Math.hypot(target.x - cur.x, target.z - cur.z) < ARRIVE_EPS) {
      target = randomWanderTarget();
    }

    // Stuck safety net: barely moved for STUCK_TICKS while far from the target
    // (wedged in a furniture pocket or a wall corner) -> re-roll the target.
    if (Math.hypot(cur.x - stuckAnchor.x, cur.z - stuckAnchor.z) < STUCK_DIST) {
      if (++stuckCount >= STUCK_TICKS) {
        target = randomWanderTarget();
        stuckCount = 0;
      }
    } else {
      stuckAnchor = cur;
      stuckCount = 0;
    }

    // Route divider crossings through the door (see nextWaypoint).
    const waypoint = nextWaypoint(cur, target);
    const dirX = waypoint.x - cur.x;
    const dirZ = waypoint.z - cur.z;
    const dist = Math.hypot(dirX, dirZ) || 1;
    // Walk at exactly MOVE_SPEED (no slack used) — well inside the server's
    // MOVE_SPEED_SLACK-widened budget even under scheduler jitter.
    const stepLen = Math.min(MOVE_SPEED * (MOVE_INTERVAL_MS / 1000), dist);
    const dx = (dirX / dist) * stepLen;
    const dz = (dirZ / dist) * stepLen;

    // Same slide-resolution the real client uses — guarantees the target
    // never lands inside an obstacle, so the server never has cause to drop it.
    const slid = resolveCollision(cur.x, cur.z, dx, dz, PLAYER_RADIUS, OBSTACLES);
    const x = clamp(slid.x, WORLD_BOUNDS.minX + PLAYER_RADIUS, WORLD_BOUNDS.maxX - PLAYER_RADIUS);
    const z = clamp(slid.z, WORLD_BOUNDS.minZ + PLAYER_RADIUS, WORLD_BOUNDS.maxZ - PLAYER_RADIUS);
    const yaw = Math.atan2(dx, dz);

    room.send(MessageType.Move, { x, z, yaw });
    stats.movesSent++;
  }, MOVE_INTERVAL_MS);

  let chatTimer: NodeJS.Timeout | undefined;
  if (Math.random() < CHAT_CHANCE) {
    const scheduleChat = (): void => {
      chatTimer = setTimeout(() => {
        room.send(MessageType.Chat, { text: CHAT_LINES[randomInt(CHAT_LINES.length)] });
        stats.chatsSent++;
        scheduleChat();
      }, randomInRange(...CHAT_INTERVAL_MS));
    };
    scheduleChat();
  }

  let emojiTimer: NodeJS.Timeout | undefined;
  if (Math.random() < EMOJI_CHANCE) {
    const scheduleEmoji = (): void => {
      emojiTimer = setTimeout(() => {
        room.send(MessageType.Emoji, { index: randomInt(EMOJIS.length) });
        stats.emojisSent++;
        scheduleEmoji();
      }, randomInRange(...EMOJI_INTERVAL_MS));
    };
    scheduleEmoji();
  }
}

cli(main);
