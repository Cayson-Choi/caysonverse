/**
 * 케이슨 마을 혼합 부하 봇 (perf/no-hitch, 2026-11-17; 발주자: "100명이 플레이하는데 끊김이나 렉이나 이런게 걸리면 안돼").
 * scripts/loadtest-bots.mjs가 띄운다. 한 프로세스가 `--numClients`명의 봇을 돌리고, 봇마다 실제 사람처럼 할 일을 돌아가며 한다:
 *  - wander: 광장 둘레를 걷거나 달린다(10 Hz, 공유 villageGeometry + resolveCollision: village.ts와 같다)
 *  - sit:    광장 벤치까지 걸어가 앉고(`Sit`), 15-30 s 뒤 일어난다(`Stand`)
 *  - fish:   호수 길로 대여소까지 → 낚싯대 빌리기 → 잔교의 낚시 의자 → 앉아서(`FishingSit`) 던지고 당기기를 되풀이 → 일어나 반납
 *  - hall:   추모관 정문(`UseDoor`) → 안에서 걷기 → 나가는 문
 *  - house:  1번 집 현관 → 번호키(`Keypad` 1004) → 안에서 걷기 → 나가는 문(`UseDoor`)
 *  - bus:    정류장에서 `BusRide board`를 몇 번 청하고(탑승 시간이면 탄다), 한 바퀴 뒤 내린다
 * 채팅 20 %·이모지 30 %·점프 20 %는 village.ts와 같은 비율. 막히면(3 s 제자리) 할 일을 버리고 광장으로 돌아간다.
 *
 * 5초마다 `<statusDir>/mix-status.json`: 입장·끊김·오류, 할 일별 횟수, 받은 바이트(봇 1명이 1초에 받는 평균)와 메시지 크기.
 * 합법 트래픽만 보낸다(서버를 시험하는 게 아니라 용량을 잰다). 실서버에는 절대 돌리지 않는다.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Client, type Room } from "@colyseus/sdk";
import type { WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import { EMOJIS, MOVE_SPEED, PLAYER_RADIUS, RUN_SPEED, VILLAGE_ROOM } from "@caysonverse/shared/constants";
import { randomAppearance } from "@caysonverse/shared/appearance";
import { isBlocked, resolveCollision } from "@caysonverse/shared/collision";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { VillageMsg } from "@caysonverse/shared/village/messages";
import { VILLAGE_SEATS, fishingSeatIndex } from "@caysonverse/shared/village/benchSeats";
import { LAKE_FISHING_SPOTS, LAKE_RENTAL_PAD, LAKE_TRAIL } from "@caysonverse/shared/village/lakeLayout";

const { values: args } = parseArgs({
  options: {
    endpoint: { type: "string", default: "http://localhost:3109" },
    numClients: { type: "string", default: "100" },
    duration: { type: "string", default: "180" },
    statusDir: { type: "string", default: path.join(process.cwd(), "status") },
    /** weights: wander,sit,fish,hall,house,bus */
    mix: { type: "string", default: "40,15,15,10,10,10" },
    offset: { type: "string", default: "0" },
    /** ms between joins */
    joinGap: { type: "string", default: "60" },
  },
});

const NUM = Number(args.numClients);
const DURATION_S = Number(args.duration);
const OFFSET = Number(args.offset) || 0;
const STATUS_FILE = path.join(args.statusDir!, "mix-status.json");
const TICK_MS = 100;
const geo = villageGeometry;
const CHAT_LINES = ["안녕하세요!", "반가워요~", "오늘 마을이 참 예쁘네요", "다들 뭐하고 계세요?", "ㅎㅎㅎ", "좋은 하루 되세요", "물고기 잡았어요!"];
const WANDER = { minX: -28, maxX: 28, minZ: -24, maxZ: 26 };
const PLAZA_SEATS = VILLAGE_SEATS.map((s, i) => ({ s, i })).filter(({ s }) => s.area === "village" && Math.hypot(s.x, s.z) < 30 && !(s as { lake?: string }).lake);
const PIER_SPOTS = LAKE_FISHING_SPOTS.map((s, i) => ({ s, i })).filter(({ s }) => s.group === "pier" && s.anchor.x < 140);
const EXT_PAD = VILLAGE_LAYOUT.memorial.exterior.doorPad;
const INT = VILLAGE_LAYOUT.memorial.interior;
const HALL_ROUTE = [{ x: -20, z: 5 }, { x: -14, z: -20 }, { x: 0, z: -33 }, { x: EXT_PAD.centre.x, z: EXT_PAD.centre.z + 0.8 }];
/** Round the fountain (a straight walk south from the plaza stops at it), then along the lane to house 1's porch. */
const HOUSE_ROUTE = [{ x: -20, z: 5 }, { x: -14, z: -20 }, { x: 0, z: -33 }, { x: 15, z: -34 }, { x: 21, z: -37.15 }, { x: 21, z: -39.3 }];
const HOUSE_IN = { x: 365.3, z: -3.5 };
const HOUSE_OUT = { x: 365.3, z: -0.9 };
const LAKE_ROUTE = [{ x: 30, z: 4 }, ...LAKE_TRAIL.map((p) => ({ x: p.x, z: p.z })), { x: LAKE_RENTAL_PAD.x, z: LAKE_RENTAL_PAD.z + 0.6 }];
const BUS_PAD = [{ x: 30, z: 2 }, { x: 38.5, z: -0.5 }, { x: 36.9, z: -6.0 }];

type Activity = "wander" | "sit" | "fish" | "hall" | "house" | "bus";
const ACTS: Activity[] = ["wander", "sit", "fish", "hall", "house", "bus"];
const WEIGHTS = args.mix!.split(",").map(Number);

const stats = {
  joinAttempts: 0, joined: 0, joinFailures: 0, disconnects: 0, roomErrors: 0,
  movesSent: 0, chats: 0, emojis: 0, jumps: 0, sits: 0, fishCasts: 0, fishSits: 0, rents: 0, hallIn: 0, houseIn: 0, busBoarded: 0, busAsks: 0, gaveUp: 0,
  bytes: 0, msgs: 0, patchBytes: 0, patchMsgs: 0,
  startedAt: Date.now(), firstJoinAt: 0, allJoinedAt: 0,
  rooms: {} as Record<string, number>,
};
function writeStatus(): void {
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    const live = stats.allJoinedAt ? (Date.now() - stats.allJoinedAt) / 1000 : 0;
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...stats, elapsedSec: Math.round((Date.now() - stats.startedAt) / 1000), liveSec: Math.round(live) }, null, 2));
  } catch {
    /* best effort */
  }
}

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function pickActivity(): Activity {
  const total = WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < ACTS.length; i++) if ((r -= WEIGHTS[i] ?? 0) < 0) return ACTS[i]!;
  return "wander";
}

function step(cur: { x: number; z: number }, to: { x: number; z: number }, running: boolean) {
  const dirX = to.x - cur.x;
  const dirZ = to.z - cur.z;
  const dist = Math.hypot(dirX, dirZ) || 1;
  const len = Math.min((running ? RUN_SPEED : MOVE_SPEED) * (TICK_MS / 1000), dist);
  const dx = (dirX / dist) * len;
  const dz = (dirZ / dist) * len;
  const slid = resolveCollision(cur.x, cur.z, dx, dz, PLAYER_RADIUS, geo.obstacles);
  let x = clamp(slid.x, geo.bounds.minX + PLAYER_RADIUS, geo.bounds.maxX - PLAYER_RADIUS);
  let z = clamp(slid.z, geo.bounds.minZ + PLAYER_RADIUS, geo.bounds.maxZ - PLAYER_RADIUS);
  if (isBlocked(x, z, PLAYER_RADIUS, geo.obstacles)) {
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
  if (!stats.firstJoinAt) stats.firstJoinAt = Date.now();
  stats.rooms[room.roomId] = (stats.rooms[room.roomId] ?? 0) + 1;
  rooms.push(room);
  room.onMessage("*", () => {});
  const ws = (room.connection.transport as { ws?: WebSocket }).ws;
  ws?.addEventListener?.("message", (e: MessageEvent) => {
    if (!(e.data instanceof ArrayBuffer)) return;
    const n = e.data.byteLength;
    stats.bytes += n;
    stats.msgs++;
    // Colyseus protocol: 15 = ROOM_STATE_PATCH
    if (new Uint8Array(e.data)[0] === 15) {
      stats.patchBytes += n;
      stats.patchMsgs++;
    }
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
  (room as unknown as { __bye: () => void }).__bye = () => {
    leaving = true;
    stop();
  };

  const me = () => room.state?.players?.get?.(room.sessionId) as unknown as { x: number; z: number; area: string; seatIndex: number; fishPhase?: number; rod?: number } | undefined;
  /** A plan: a list of steps, each a goal to walk to (or a wait) and what to do on arrival. */
  type Step = { to?: { x: number; z: number }; tol?: number; run?: boolean; wait?: number; act?: () => void; until?: () => boolean };
  let plan: Step[] = [];
  let stepAt = 0;
  let stuck = 0;
  let anchor = { x: NaN, z: NaN };
  const wanderStep = (): Step => ({ to: { x: rnd(WANDER.minX, WANDER.maxX), z: rnd(WANDER.minZ, WANDER.maxZ) }, run: Math.random() < 0.3 });
  const area = () => me()?.area ?? "village";
  const send = (t: string, p: unknown = {}) => room.send(t, p);

  const newPlan = (): void => {
    const act = area() === "village" ? pickActivity() : "wander";
    stepAt = Date.now();
    if (act === "wander") plan = [wanderStep(), wanderStep(), wanderStep()];
    else if (act === "sit") {
      const { s, i: idx } = pick(PLAZA_SEATS);
      plan = [
        { to: { x: s.standX, z: s.standZ }, tol: 0.5, act: () => { send(MessageType.Sit, { seatIndex: idx }); stats.sits++; } },
        { wait: rnd(15000, 30000) },
        { wait: 300, act: () => send(MessageType.Stand) },
      ];
    } else if (act === "fish") {
      const { s, i: spot } = pick(PIER_SPOTS);
      const seat = VILLAGE_SEATS[fishingSeatIndex(spot)]!;
      const casts: Step[] = [];
      for (let k = 0; k < 4; k++) {
        casts.push({ wait: 1500, act: () => { send(VillageMsg.FishingCast); stats.fishCasts++; } });
        for (let j = 0; j < 6; j++) casts.push({ wait: 1500, act: () => send(VillageMsg.FishingStrike) });
      }
      plan = [
        ...LAKE_ROUTE.map((to) => ({ to, tol: 1.0 })),
        { wait: 600, act: () => { send(VillageMsg.FishingRentRod); stats.rents++; } },
        { to: { x: 108, z: -12 }, tol: 1.0 },
        { to: { x: seat.standX, z: -12 }, tol: 0.8 },
        { to: { x: seat.standX, z: seat.standZ }, tol: 0.4, act: () => { send(VillageMsg.FishingSit, { spot }); stats.fishSits++; } },
        ...casts,
        { wait: 800, act: () => send(VillageMsg.FishingStand) },
        { to: { x: 108, z: -12 }, tol: 1.0 },
        { to: { x: LAKE_RENTAL_PAD.x, z: LAKE_RENTAL_PAD.z + 0.6 }, tol: 1.0, act: () => send(VillageMsg.FishingReturnRod) },
        ...[...LAKE_ROUTE].reverse().map((to) => ({ to, tol: 1.2 })),
      ];
      void s;
    } else if (act === "hall") {
      plan = [
        ...HALL_ROUTE.map((to) => ({ to, tol: 1.0 })),
        { wait: 400, act: () => send(VillageMsg.UseDoor), until: () => area() === "hall" },
        { wait: 2000, act: () => stats.hallIn++ },
        { to: { x: rnd(INT.room.minX + 1, INT.room.maxX - 1), z: rnd(INT.room.minZ + 2.5, INT.room.maxZ - 2.5) }, tol: 0.8 },
        { to: { x: rnd(INT.room.minX + 1, INT.room.maxX - 1), z: rnd(INT.room.minZ + 2.5, INT.room.maxZ - 2.5) }, tol: 0.8 },
        { to: { x: INT.doorPad.centre.x, z: INT.doorPad.centre.z - 0.4 }, tol: 0.7 },
        { wait: 1300, act: () => send(VillageMsg.UseDoor), until: () => area() === "village" },
      ];
    } else if (act === "house") {
      plan = [
        ...HOUSE_ROUTE.map((to) => ({ to, tol: 1.0 })),
        { wait: 500, act: () => send(VillageMsg.Keypad, { buildingId: "house_1", code: "1004" }), until: () => area().startsWith("house:") },
        { wait: 1500, act: () => stats.houseIn++ },
        { to: { x: HOUSE_IN.x + rnd(-2, 2), z: HOUSE_IN.z + rnd(-1.5, 0.5) }, tol: 0.8 },
        { wait: rnd(4000, 10000) },
        { to: HOUSE_OUT, tol: 0.5 },
        { wait: 1300, act: () => send(VillageMsg.UseDoor), until: () => area() === "village" },
      ];
    } else {
      const asks: Step[] = [];
      for (let k = 0; k < 4; k++) asks.push({ wait: 3000, act: () => { send(MessageType.BusRide, { action: "board" }); stats.busAsks++; } });
      plan = [...BUS_PAD.map((to) => ({ to, tol: 0.8 })), ...asks, { wait: 2000 }];
    }
  };
  newPlan();

  let lastWaitAct = 0;
  let tries = 0;
  timers.push(
    setInterval(() => {
      const self = me();
      if (!self) return;
      const cur = { x: self.x, z: self.z };
      const now = Date.now();
      const st = plan[0];
      if (!st) return newPlan();
      if (st.to) {
        if (Math.hypot(st.to.x - cur.x, st.to.z - cur.z) < (st.tol ?? 0.7)) {
          st.act?.();
          plan.shift();
          stepAt = now;
          stuck = 0;
          return;
        }
        if (Math.hypot(cur.x - anchor.x, cur.z - anchor.z) < 0.05) {
          if (++stuck >= 30) {
            // stuck: give up the plan, back to wandering
            stats.gaveUp++;
            stuck = 0;
            if (self.seatIndex >= 0) send(MessageType.Stand);
            plan = [wanderStep()];
          }
        } else {
          anchor = cur;
          stuck = 0;
        }
        if (self.seatIndex >= 0) return; // seated: the server would drop moves
        send(MessageType.Move, step(cur, st.to, !!st.run));
        stats.movesSent++;
        return;
      }
      // a wait step: run its act once at the start (and again while `until` is not met, up to 5 tries)
      if (now - stepAt >= (st.wait ?? 0)) {
        if (st.until && !st.until()) {
          if (now - lastWaitAct > 1300 && tries < 5) {
            st.act?.();
            lastWaitAct = now;
            tries++;
            return;
          }
          if (tries < 5) return;
          stats.gaveUp++;
        } else if (!st.until) st.act?.();
        tries = 0;
        plan.shift();
        stepAt = now;
      }
    }, TICK_MS),
  );

  const inQuiet = () => area() === "hall";
  if (Math.random() < 0.2) {
    const schedule = (): void => {
      const wait = rnd(8000, 15000);
      const lead = Math.min(rnd(1500, 3000), wait);
      timers.push(setTimeout(() => {
        room.send(MessageType.Typing, { on: true });
        timers.push(setTimeout(() => {
          room.send(MessageType.Chat, { text: pick(CHAT_LINES) });
          room.send(MessageType.Typing, { on: false });
          stats.chats++;
          schedule();
        }, lead));
      }, wait - lead));
    };
    schedule();
  }
  if (Math.random() < 0.2) {
    const schedule = (): void => {
      timers.push(setTimeout(() => {
        if (!inQuiet()) { room.send(MessageType.Jump, {}); stats.jumps++; }
        schedule();
      }, rnd(4000, 10000)));
    };
    schedule();
  }
  if (Math.random() < 0.3) {
    const schedule = (): void => {
      timers.push(setTimeout(() => {
        if (!inQuiet()) { room.send(MessageType.Emoji, { index: Math.floor(Math.random() * EMOJIS.length) }); stats.emojis++; }
        schedule();
      }, rnd(5000, 10000)));
    };
    schedule();
  }
}

const hb = setInterval(writeStatus, 5000);
for (let i = 0; i < NUM; i++) {
  await bot(i);
  await sleep(Number(args.joinGap));
}
stats.allJoinedAt = Date.now();
console.log(`mix bots: ${stats.joined}/${NUM} joined in ${Object.keys(stats.rooms).length} room(s), ${stats.joinFailures} failed; running ${DURATION_S}s (mix ${args.mix})`);
await sleep(DURATION_S * 1000);
clearInterval(hb);
writeStatus();
const ok = stats.joined === NUM && stats.disconnects === 0 && stats.roomErrors === 0;
const live = (Date.now() - stats.allJoinedAt) / 1000;
console.log(
  `mix bots done: joined ${stats.joined}/${NUM}, rooms ${Object.keys(stats.rooms).length}, disconnects ${stats.disconnects}, errors ${stats.roomErrors}, ` +
    `sits ${stats.sits}, fishSits ${stats.fishSits}, casts ${stats.fishCasts}, hall ${stats.hallIn}, house ${stats.houseIn}, busAsks ${stats.busAsks}, gaveUp ${stats.gaveUp}, ` +
    `down ${(stats.bytes / 1024).toFixed(0)} KiB (${((stats.bytes / Math.max(1, stats.joined)) / live / 1024).toFixed(1)} KiB/s per bot, avg patch ${Math.round(stats.patchBytes / Math.max(1, stats.patchMsgs))} B) -> ${ok ? "PASS" : "FAIL"}`,
);
for (const r of rooms) {
  (r as unknown as { __bye?: () => void }).__bye?.();
  void r.leave(true);
}
await sleep(300);
process.exit(ok ? 0 : 1);
