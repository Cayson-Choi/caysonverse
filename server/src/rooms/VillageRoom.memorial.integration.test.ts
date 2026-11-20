import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { VILLAGE_ROOM } from "@caysonverse/shared/constants";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { MemorialServerMsg } from "@caysonverse/shared/memorial/messages";
import type { ClaimUpdatedPayload } from "@caysonverse/shared/memorial/types";
import { VillageMsg, VillageServerMsg, type CandleLitPayload, type CandleOutPayload } from "@caysonverse/shared/village/messages";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { Memorial, setMemorialForTest } from "../memorial/service";
import { sha256Hex } from "../memorial/store";
import { deviceKey, tempDir, testConfig } from "../memorial/testUtil";
import { CANDLES } from "./candleBook";
import { rooms, type VillageRoom } from "./index";

/**
 * VillageRoom × memorial stage B: the device key at join (hashed, kept through a reconnect), ClaimUpdated to every hall, and a
 * candle on a family's cubby. Own port (2577) like every integration file.
 */
const PORT = 2577;
const HALL = VILLAGE_LAYOUT.memorial.interior.spawn;
const SLOT = "M1-A-r3-c10";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function pollFor<T>(read: () => T, timeoutMs = 3000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let v = read();
  while (!v && Date.now() < end) {
    await sleep(20);
    v = read();
  }
  return v;
}

let colyseus: ColyseusTestServer;
let m: Memorial;
beforeAll(async () => {
  m = new Memorial(testConfig(tempDir("room")));
  setMemorialForTest(m);
  colyseus = await boot(config({ rooms }), PORT);
});
afterAll(async () => {
  await colyseus.shutdown();
  setMemorialForTest(null);
  m.close();
});
beforeEach(async () => {
  await colyseus.cleanup();
  CANDLES.clear();
});
afterEach(() => CANDLES.clear());

const keyHashOf = (room: VillageRoom, sid: string) => room.memorialKeyHash(sid);

describe("VillageRoom memorial (stage B)", () => {
  it("keeps only the hash of a valid device key; a bad or missing key still joins", async () => {
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const key = deviceKey();
    const a = await colyseus.connectTo(room, { nickname: "가족", appearance: DEFAULT_APPEARANCE, deviceKey: key });
    const b = await colyseus.connectTo(room, { nickname: "손님", appearance: DEFAULT_APPEARANCE, deviceKey: "not-a-key" });
    const c = await colyseus.connectTo(room, { nickname: "옛날", appearance: DEFAULT_APPEARANCE });
    expect(keyHashOf(room, a.sessionId)).toBe(sha256Hex(key));
    expect(keyHashOf(room, b.sessionId)).toBeNull();
    expect(keyHashOf(room, c.sessionId)).toBeNull();
    // the synced player never carries the key
    expect(JSON.stringify(room.state.players.get(a.sessionId)!.toJSON())).not.toContain(key.slice(0, 10));
  });

  it("a reconnect keeps the device's ownership (test matrix: reconnect keeps ownership)", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "5";
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const key = deviceKey();
    const kh = sha256Hex(key);
    const owner = m.store.createOwner(kh);
    const client = await colyseus.connectTo(room, { nickname: "가족", appearance: DEFAULT_APPEARANCE, deviceKey: key });
    const sid = client.sessionId;
    const token = client.reconnectionToken;
    client.reconnection.enabled = false;
    client.connection.close(4010, "test drop");
    expect(await pollFor(() => room.state.players.get(sid)?.connected === false)).toBe(true);
    const back = await colyseus.sdk.reconnect(token);
    expect(back.sessionId).toBe(sid);
    expect(keyHashOf(room, sid)).toBe(kh);
    expect(m.ownerOf(keyHashOf(room, sid))?.ownerId).toBe(owner.ownerId);
    delete process.env.CV_RECONNECT_WINDOW_S;
  });

  it("ClaimUpdated reaches the hall of every room, not the plaza; the family's cubby then takes a candle", async () => {
    const r1 = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const r2 = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const inHall = await colyseus.connectTo(r1, { nickname: "홀손님", appearance: DEFAULT_APPEARANCE });
    const plaza = await colyseus.connectTo(r1, { nickname: "광장", appearance: DEFAULT_APPEARANCE });
    const other = await colyseus.connectTo(r2, { nickname: "다른방", appearance: DEFAULT_APPEARANCE });
    for (const [room, c] of [
      [r1, inHall],
      [r2, other],
    ] as const) {
      const p = room.state.players.get(c.sessionId)!;
      p.area = "hall";
      p.x = HALL.x;
      p.z = HALL.z;
    }
    const heard = { hall: [] as ClaimUpdatedPayload[], plaza: [] as ClaimUpdatedPayload[], other: [] as ClaimUpdatedPayload[] };
    inHall.onMessage(MemorialServerMsg.ClaimUpdated, (p: ClaimUpdatedPayload) => heard.hall.push(p));
    plaza.onMessage(MemorialServerMsg.ClaimUpdated, (p: ClaimUpdatedPayload) => heard.plaza.push(p));
    other.onMessage(MemorialServerMsg.ClaimUpdated, (p: ClaimUpdatedPayload) => heard.other.push(p));
    const lit: CandleLitPayload[] = [];
    inHall.onMessage(VillageServerMsg.CandleLit, (p: CandleLitPayload) => lit.push(p));

    // before the claim, the empty cubby takes no candle
    inHall.send(VillageMsg.LightCandle, { cubby: SLOT });
    await sleep(150);
    expect(lit).toEqual([]);

    const kh = sha256Hex(deviceKey());
    const o = m.store.createOwner(kh);
    m.store.createClaim(o.ownerId, SLOT, { petName: "콩이", species: "dog", born: null, bornPrec: "unknown", passed: null, passedPrec: "unknown", line: "" }, kh);
    m.emit(SLOT, ["claimed"]);
    expect(await pollFor(() => heard.hall.length === 1 && heard.other.length === 1)).toBe(true);
    expect(heard.hall[0]).toEqual({ slotId: SLOT, fields: ["claimed"] });
    await sleep(100);
    expect(heard.plaza).toEqual([]);

    (r1 as unknown as { now: () => number }).now = () => Date.now() + 60_000; // past the 5 s candle cap
    inHall.send(VillageMsg.LightCandle, { cubby: SLOT });
    expect(await pollFor(() => lit.length === 1)).toBe(true);
    expect(lit[0]).toMatchObject({ cubby: SLOT, by: "홀손님" });
  });

  it("the family of a claimed cubby may put out a candle a visitor lit there; another visitor may not (owner 2026-11-20)", async () => {
    const SLOT2 = "M1-A-r3-c09";
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const familyKey = deviceKey();
    const kh = sha256Hex(familyKey);
    const o = m.store.createOwner(kh);
    m.store.createClaim(o.ownerId, SLOT2, { petName: "보리", species: "dog", born: null, bornPrec: "unknown", passed: null, passedPrec: "unknown", line: "" }, kh);
    m.emit(SLOT2, ["claimed"]);
    const visitor = await colyseus.connectTo(room, { nickname: "손님", appearance: DEFAULT_APPEARANCE, deviceKey: deviceKey() });
    const stranger = await colyseus.connectTo(room, { nickname: "지나가던", appearance: DEFAULT_APPEARANCE, deviceKey: deviceKey() });
    const family = await colyseus.connectTo(room, { nickname: "가족", appearance: DEFAULT_APPEARANCE, deviceKey: familyKey });
    for (const c of [visitor, stranger, family]) {
      const p = room.state.players.get(c.sessionId)!;
      p.area = "hall";
      p.x = HALL.x;
      p.z = HALL.z;
    }
    const outs: CandleOutPayload[] = [];
    visitor.onMessage(VillageServerMsg.CandleOut, (p: CandleOutPayload) => outs.push(p));
    visitor.send(VillageMsg.LightCandle, { cubby: SLOT2 });
    expect(await pollFor(() => CANDLES.burning(SLOT2, Date.now()))).toBe(true);
    stranger.send(VillageMsg.PutOutCandle, { cubby: SLOT2 });
    await sleep(200);
    expect(outs).toEqual([]);
    expect(CANDLES.burning(SLOT2, Date.now())).toBe(true);
    family.send(VillageMsg.PutOutCandle, { cubby: SLOT2 });
    expect(await pollFor(() => outs.length === 1)).toBe(true);
    expect(outs[0]).toEqual({ cubby: SLOT2, by: "가족" });
    expect(CANDLES.burning(SLOT2, Date.now())).toBe(false);
  });
});
