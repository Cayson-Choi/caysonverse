/**
 * 케이슨 마을 부하 봇 (1단계 Task 10): 마을 방(VillageRoom)에 `joinOrCreate`로 들어가 걷고, 말하고, 문을 쓰는 봇들.
 *
 * 실행(보통은 run.mjs가 `--scenario village`로 띄운다):
 *   npm run loadtest -- --scenario village --endpoint http://localhost:2567 --numClients 29 --duration 120 --statusDir <dir>
 *
 * 한 프로세스가 모든 봇을 돈다(school.ts와 같다). 마을은 한 방이 30명이라(VILLAGE_MAX_CLIENTS) `joinOrCreate`는 30명째에서
 * 새 샤드를 만든다 - 봇 `--numClients`가 30의 배수가 아니면 마지막 샤드가 덜 찬다. 화면 측정(e2e/village-perf.mjs)은
 * 측정하는 탭이 30번째 사람이 되도록 **29봇**으로 돌린다(그래서 한 마을 방에 정확히 30명).
 *
 * 봇이 하는 일(합법 트래픽만 - 서버를 시험하는 게 아니라 용량을 재는 것이다. bot.ts의 원칙 그대로):
 *  - 10 Hz로 걷는다. 매 틱 "서버가 아는 내 위치"에서 다음 걸음을 계산하고, 공유 `villageGeometry` + `resolveCollision`으로 미끄러진다.
 *    목표는 광장 둘레에서 뽑고(막히면 다시 뽑는다), 30%는 달리기 구간이다.
 *  - 채팅 20 %(입력 중 켜기 -> 채팅 -> 끄기), 이모지 30 %, 점프 20 % - bot.ts와 같은 비율.
 *  - 문: `--doorShare`(기본 0.15)의 봇은 추모관 정문으로 걸어가 `UseDoor`를 보내 안으로 들어가고, 안에서 `--hallStayMs`(기본 25 s)
 *    돌아다닌 뒤 나가는 문에서 `UseDoor`로 마을로 돌아와 다시 광장을 걷는다. `--hallStayMs 0`이면 들어가서 나오지 않는다
 *    (추모관 안 화면 측정: `--doorShare 1 --hallStayMs 0`). 안에서는 이모지·점프가 서버에서 버려지므로 보내지 않고, 채팅만 한다.
 *
 * bot.ts의 함정은 그대로 지킨다: 방마다 `room.onMessage("*", () => {})`(없으면 SDK가 수신 브로드캐스트마다 console.warn,
 * docs/loadtest.md 3절).
 *
 * 통계: 5초마다 `<statusDir>/village-status.json`을 쓴다(입장 수, 문 통과 수, 오류·끊김, 받은 바이트). 끝나면 게이트
 * (입장 100 %, 끊김 0, 방 오류 0)를 판정해 종료 코드로 알린다(통과 0, 실패 1).
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Client, type Room } from "@colyseus/sdk";
// TYPE-ONLY: schema.ts runs @colyseus/schema decorators server-side only (same discipline as bot.ts).
import type { WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import { EMOJIS, MOVE_SPEED, PLAYER_RADIUS, RUN_SPEED, VILLAGE_ROOM } from "@caysonverse/shared/constants";
import { randomAppearance } from "@caysonverse/shared/appearance";
import { isBlocked, resolveCollision } from "@caysonverse/shared/collision";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { VillageMsg } from "@caysonverse/shared/village/messages";

const { values: args } = parseArgs({
  options: {
    endpoint: { type: "string", default: "http://localhost:2567" },
    numClients: { type: "string", default: "29" },
    duration: { type: "string", default: "120" },
    statusDir: { type: "string", default: path.join(process.cwd(), "status") },
    doorShare: { type: "string", default: "0.15" },
    hallStayMs: { type: "string", default: "25000" },
    offset: { type: "string", default: "0" },
  },
});

const NUM = Number(args.numClients);
const DURATION_S = Number(args.duration);
const DOOR_SHARE = Number(args.doorShare);
const HALL_STAY_MS = Number(args.hallStayMs);
const OFFSET = Number(args.offset) || 0;
const STATUS_FILE = path.join(args.statusDir!, "village-status.json");

const MOVE_INTERVAL_MS = 100;
const CHAT_CHANCE = 0.2;
const CHAT_INTERVAL_MS: [number, number] = [8000, 15000];
const EMOJI_CHANCE = 0.3;
const EMOJI_INTERVAL_MS: [number, number] = [5000, 10000];
const RUN_LEG_CHANCE = 0.3;
const JUMP_CHANCE = 0.2;
const JUMP_INTERVAL_MS: [number, number] = [4000, 10000];
const TYPING_LEAD_MS: [number, number] = [1500, 3000];
const ARRIVE_EPS = 0.6;
const STUCK_DIST = 0.05;
const STUCK_TICKS = 30;
const CHAT_LINES = ["안녕하세요!", "반가워요~", "오늘 마을이 참 예쁘네요", "다들 뭐하고 계세요?", "ㅎㅎㅎ", "좋은 하루 되세요"];

const geo = villageGeometry;
/** Around the plaza (the fountain and benches get in the way: the stuck re-roll handles it). */
const WANDER = { minX: -30, maxX: 30, minZ: -25, maxZ: 28 };
const EXT_PAD = VILLAGE_LAYOUT.memorial.exterior.doorPad;
const INT = VILLAGE_LAYOUT.memorial.interior;
/** Waypoints from the plaza to the memorial's front door (the same legs e2e/village-hall.mjs walks). */
const DOOR_ROUTE = [
  { x: -20, z: 5 },
  { x: -14, z: -20 },
  { x: 0, z: -33 },
  { x: EXT_PAD.centre.x, z: EXT_PAD.centre.z + 0.8 },
];

const stats = {
  joinAttempts: 0, joined: 0, joinFailures: 0, disconnects: 0, roomErrors: 0, drops: 0, reconnects: 0,
  movesSent: 0, chatsSent: 0, emojisSent: 0, jumpsSent: 0, doorUses: 0, enteredHall: 0, leftHall: 0, bytesReceived: 0,
  startedAt: Date.now(),
};
function writeStatus(): void {
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...stats, elapsedSec: Math.round((Date.now() - stats.startedAt) / 1000) }, null, 2));
  } catch {
    /* best effort */
  }
}

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pickInt = (n: number) => Math.floor(Math.random() * n);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** True for exactly `chance` of consecutive indices (bot.ts `picked`). */
function picked(index: number, chance: number, phase: number): boolean {
  const eps = 1e-9;
  return Math.floor((index + phase + 1) * chance + eps) > Math.floor((index + phase) * chance + eps);
}

function step(cur: { x: number; z: number }, to: { x: number; z: number }, running: boolean) {
  const dirX = to.x - cur.x;
  const dirZ = to.z - cur.z;
  const dist = Math.hypot(dirX, dirZ) || 1;
  const len = Math.min((running ? RUN_SPEED : MOVE_SPEED) * (MOVE_INTERVAL_MS / 1000), dist);
  const dx = (dirX / dist) * len;
  const dz = (dirZ / dist) * len;
  const slid = resolveCollision(cur.x, cur.z, dx, dz, PLAYER_RADIUS, geo.obstacles);
  let x = clamp(slid.x, geo.bounds.minX + PLAYER_RADIUS, geo.bounds.maxX - PLAYER_RADIUS);
  let z = clamp(slid.z, geo.bounds.minZ + PLAYER_RADIUS, geo.bounds.maxZ - PLAYER_RADIUS);
  if (isBlocked(x, z, PLAYER_RADIUS, geo.obstacles)) {
    // The server would drop it: try the single-axis parts, else stand still.
    const tries = [{ x: cur.x + dx, z: cur.z }, { x: cur.x, z: cur.z + dz }];
    const ok = tries.find((c) => !isBlocked(c.x, c.z, PLAYER_RADIUS, geo.obstacles));
    ({ x, z } = ok ?? cur);
  }
  return { x, z, yaw: Math.atan2(dx, dz) };
}

const rooms: Room[] = [];

async function bot(i: number): Promise<void> {
  const nickname = `봇${String(OFFSET + i + 1).padStart(3, "0")}`;
  const client = new Client(args.endpoint!);
  stats.joinAttempts++;
  let room: Room<WorldState>;
  try {
    room = await client.joinOrCreate<WorldState>(VILLAGE_ROOM, { nickname, appearance: randomAppearance(Math.random) });
  } catch (err) {
    stats.joinFailures++;
    process.stderr.write(`[${nickname}] join 실패: ${err instanceof Error ? err.message : String(err)}\n`);
    return;
  }
  stats.joined++;
  rooms.push(room);
  room.onMessage("*", () => {});
  const ws = (room.connection.transport as { ws?: WebSocket }).ws;
  ws?.addEventListener?.("message", (e: MessageEvent) => {
    if (e.data instanceof ArrayBuffer) stats.bytesReceived += e.data.byteLength;
  });
  const timers: NodeJS.Timeout[] = [];
  const stop = () => timers.forEach((t) => (clearInterval(t), clearTimeout(t)));
  let leaving = false;
  room.onLeave((code) => {
    stop();
    if (leaving) return;
    stats.disconnects++;
    process.stderr.write(`[${nickname}] 연결 종료 (code=${code})\n`);
  });
  room.onError((code, msg) => {
    stats.roomErrors++;
    process.stderr.write(`[${nickname}] 방 오류 (code=${code}): ${msg ?? ""}\n`);
  });
  room.onDrop(() => stats.drops++);
  room.onReconnect(() => stats.reconnects++);
  (room as unknown as { __bye: () => void }).__bye = () => {
    leaving = true;
    stop();
  };

  const doorBot = picked(i, DOOR_SHARE, 1);
  // plaza: wander | toDoor: route to the front door | hall: inside | toExit: to the way out
  let mode: "plaza" | "toDoor" | "hall" | "toExit" = DOOR_SHARE >= 1 ? "toDoor" : "plaza";
  let routeIdx = 0;
  let hallSince = 0;
  let target = { x: rnd(WANDER.minX, WANDER.maxX), z: rnd(WANDER.minZ, WANDER.maxZ) };
  let running = Math.random() < RUN_LEG_CHANCE;
  let anchor = { x: NaN, z: NaN };
  let stuck = 0;
  let nextDoorAt = Date.now() + (DOOR_SHARE >= 1 ? 0 : rnd(8000, 30000));
  let lastDoor = 0;
  const reroll = () => {
    if (mode === "hall") target = { x: rnd(INT.room.minX + 1, INT.room.maxX - 1), z: rnd(INT.room.minZ + 2.5, INT.room.maxZ - 2.5) };
    else target = { x: rnd(WANDER.minX, WANDER.maxX), z: rnd(WANDER.minZ, WANDER.maxZ) };
    running = Math.random() < RUN_LEG_CHANCE;
  };

  timers.push(setInterval(() => {
    const self = room.state?.players?.get?.(room.sessionId);
    if (!self) return;
    const cur = { x: self.x, z: self.z };
    const now = Date.now();
    const area = self.area as string;
    // The server flipped us across a door.
    if (mode === "toDoor" && area === "hall") { mode = "hall"; hallSince = now; stats.enteredHall++; reroll(); }
    if (mode === "toExit" && area === "village") { mode = "plaza"; stats.leftHall++; nextDoorAt = now + rnd(20000, 40000); reroll(); }
    if (mode === "plaza" && doorBot && now >= nextDoorAt && area === "village") { mode = "toDoor"; routeIdx = 0; }
    if (mode === "hall" && HALL_STAY_MS > 0 && now - hallSince > HALL_STAY_MS) mode = "toExit";

    let goal = target;
    if (mode === "toDoor") {
      goal = DOOR_ROUTE[routeIdx];
      if (Math.hypot(goal.x - cur.x, goal.z - cur.z) < 1.0) {
        if (routeIdx < DOOR_ROUTE.length - 1) routeIdx++;
        else if (now - lastDoor > 1200) { room.send(VillageMsg.UseDoor, {}); lastDoor = now; stats.doorUses++; }
      }
    } else if (mode === "toExit") {
      goal = { x: INT.doorPad.centre.x, z: INT.doorPad.centre.z - 0.4 };
      if (Math.hypot(goal.x - cur.x, goal.z - cur.z) < 0.9 && now - lastDoor > 1200) { room.send(VillageMsg.UseDoor, {}); lastDoor = now; stats.doorUses++; }
    } else if (Math.hypot(target.x - cur.x, target.z - cur.z) < ARRIVE_EPS) reroll();

    if (Math.hypot(cur.x - anchor.x, cur.z - anchor.z) < STUCK_DIST) {
      if (++stuck >= STUCK_TICKS && mode !== "toDoor" && mode !== "toExit") { reroll(); stuck = 0; }
    } else { anchor = cur; stuck = 0; }

    room.send(MessageType.Move, step(cur, goal, running && (mode === "plaza" || mode === "hall")));
    stats.movesSent++;
  }, MOVE_INTERVAL_MS));

  const inHall = () => (room.state?.players?.get?.(room.sessionId)?.area as string) === "hall";
  if (picked(i, CHAT_CHANCE, 2)) {
    const schedule = (): void => {
      const wait = rnd(...CHAT_INTERVAL_MS);
      const lead = Math.min(rnd(...TYPING_LEAD_MS), wait);
      timers.push(setTimeout(() => {
        room.send(MessageType.Typing, { on: true });
        timers.push(setTimeout(() => {
          room.send(MessageType.Chat, { text: CHAT_LINES[pickInt(CHAT_LINES.length)] });
          room.send(MessageType.Typing, { on: false });
          stats.chatsSent++;
          schedule();
        }, lead));
      }, wait - lead));
    };
    schedule();
  }
  if (picked(i, JUMP_CHANCE, 0)) {
    const schedule = (): void => {
      timers.push(setTimeout(() => {
        if (!inHall()) { room.send(MessageType.Jump, {}); stats.jumpsSent++; } // the hall is quiet: dropped there
        schedule();
      }, rnd(...JUMP_INTERVAL_MS)));
    };
    schedule();
  }
  if (Math.random() < EMOJI_CHANCE) {
    const schedule = (): void => {
      timers.push(setTimeout(() => {
        if (!inHall()) { room.send(MessageType.Emoji, { index: pickInt(EMOJIS.length) }); stats.emojisSent++; }
        schedule();
      }, rnd(...EMOJI_INTERVAL_MS)));
    };
    schedule();
  }
}

const hb = setInterval(writeStatus, 5000);
for (let i = 0; i < NUM; i++) {
  await bot(i);
  await sleep(80);
}
console.log(`village bots: ${stats.joined}/${NUM} joined, ${stats.joinFailures} failed; running ${DURATION_S}s (doorShare ${DOOR_SHARE}, hallStayMs ${HALL_STAY_MS})`);
await sleep(DURATION_S * 1000);
clearInterval(hb);
writeStatus();
const ok = stats.joined === NUM && stats.disconnects === 0 && stats.roomErrors === 0;
console.log(
  `village bots done: joined ${stats.joined}/${NUM}, door uses ${stats.doorUses} (in ${stats.enteredHall}, out ${stats.leftHall}), ` +
    `disconnects ${stats.disconnects}, room errors ${stats.roomErrors}, down ${(stats.bytesReceived / 1024).toFixed(0)} KiB -> ${ok ? "PASS" : "FAIL"}`,
);
for (const r of rooms) {
  (r as unknown as { __bye?: () => void }).__bye?.();
  void r.leave(true);
}
await sleep(300);
process.exit(ok ? 0 : 1);
