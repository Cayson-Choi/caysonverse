import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { houseIsReady } from "@caysonverse/shared/village/housesGeometry";
import { houseNumberOf } from "@caysonverse/shared/village/houseAreas";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { VILLAGE_ROOM, VILLAGE_MAX_CLIENTS, TYPING_RATE } from "@caysonverse/shared/constants";
import { MessageType } from "@caysonverse/shared/messages";
import type { ChatBroadcast } from "@caysonverse/shared/messages";
import { VillageMsg, VillageServerMsg, type KeypadResultPayload } from "@caysonverse/shared/village/messages";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { keypadEntries } from "@caysonverse/shared/village/buildingAccess";
import { HOUSE_PLACES, HOUSE_POLICY, houseFloorArea } from "@caysonverse/shared/village/houseAreas";
import { ARRIVAL_SPACING_M, SPACING_SLACK_M } from "@caysonverse/shared/village/arrivalSpot";
import { LOT_ROOMS, lotDoorPoint } from "@caysonverse/shared/village/villageLots";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import type { Player } from "@caysonverse/shared/schema";
import { rooms, type VillageRoom } from "./index";

// A real server and real sockets/HTTP: each step takes well under a second alone, but a loaded machine (the whole suite in parallel,
// other worktrees) has pushed a boot past the 10 s hook default and a round trip past the 5 s test default. A hang still fails.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * VillageRoom's houses (집 실내 G): the keypad's way in (code, lock-out, not-ready houses, the 8-player limit, sitting / bus), the stair
 * between the two floors, the way out, and chat that is heard on both floors of one house only. Its own boot on its own port (2572
 * PlayerRoom, 2575 the village, 2576 fishing, 2577 this file, 2578 the memorial).
 */
const PORT = 2577;
const JOIN = (n: number) => ({ nickname: `손님${n}`, appearance: DEFAULT_APPEARANCE });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function pollFor<T>(read: () => T, timeoutMs = 2500, stepMs = 15): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let v = read();
  while (!v && Date.now() < deadline) {
    await sleep(stepMs);
    v = read();
  }
  return v;
}

let colyseus: ColyseusTestServer;
beforeAll(async () => {
  colyseus = await boot(config({ rooms }), PORT);
});
afterAll(async () => {
  await colyseus.shutdown();
});
beforeEach(async () => {
  await colyseus.cleanup();
});

interface Visitor {
  sessionId: string;
  send(type: string | number, message?: unknown): void;
  onMessage(type: string, callback: (payload: any) => void): () => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** The test clock: `now()` answers `t`, which only the test moves. */
function useClock(room: VillageRoom): { t: number } {
  const clock = { t: Date.now() };
  (room as unknown as { now: () => number }).now = () => clock.t;
  return clock;
}

const entry1 = keypadEntries()[0]!; // house_1
const PLACES = HOUSE_PLACES[1];
const AREA1 = houseFloorArea(1, 1);
const AREA2 = houseFloorArea(1, 2);

async function crowd(count: number) {
  const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
  const clock = useClock(room);
  const clients: Visitor[] = [];
  const players: Player[] = [];
  for (let i = 0; i < count; i++) {
    const c = await colyseus.connectTo(room, JOIN(i));
    clients.push(c as unknown as Visitor);
    players.push(room.state.players.get(c.sessionId)!);
  }
  return { room, clock, clients, players };
}

const place = (p: Player, x: number, z: number) => {
  p.x = x;
  p.z = z;
};
const atDoor = (p: Player, e = entry1) => place(p, e.pad.x, e.pad.z);

/** Send a keypad code and wait for the server's reply. */
function keypad(client: Visitor, buildingId: string, code: string): Promise<KeypadResultPayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no KeypadResult")), 3000);
    const off = client.onMessage(VillageServerMsg.KeypadResult, (r: KeypadResultPayload) => {
      clearTimeout(timer);
      off();
      resolve(r);
    });
    client.send(VillageMsg.Keypad, { buildingId, code });
  });
}

describe("the keypad's way in", () => {
  it("1004 at the door: onto the entrance floor, at the entry spot, facing into the room; the reply names the area", async () => {
    const { clients, players } = await crowd(1);
    atDoor(players[0]!);
    const reply = await keypad(clients[0]!, "house_1", "1004");
    expect(reply).toEqual({ ok: true, buildingId: "house_1", area: AREA1 });
    expect(await pollFor(() => players[0]!.area === AREA1)).toBe(true);
    expect(players[0]!.x).toBeCloseTo(PLACES.spawnIn.x, 5);
    expect(players[0]!.z).toBeCloseTo(PLACES.spawnIn.z, 5);
    expect(players[0]!.yaw).toBeCloseTo(Math.PI, 5);
  });

  it("a wrong code or a code from afar changes nothing; the code is checked against the server only (the reply never carries it)", async () => {
    const { clients, players } = await crowd(1);
    atDoor(players[0]!);
    const wrong = await keypad(clients[0]!, "house_1", "1234");
    expect(wrong).toMatchObject({ ok: false, reason: "wrong_code" });
    expect(JSON.stringify(wrong)).not.toContain("1004");
    expect(players[0]!.area).toBe("village");
    place(players[0]!, entry1.pad.x + 10, entry1.pad.z);
    expect(await keypad(clients[0]!, "house_1", "1004")).toMatchObject({ ok: false, reason: "too_far" });
    expect(players[0]!.area).toBe("village");
  });

  it("five wrong numbers lock the pad for 30 s: 1004 is refused meanwhile (locked_out with the time left) and works after", async () => {
    const { clock, clients, players } = await crowd(1);
    atDoor(players[0]!);
    for (let i = 0; i < 4; i++) {
      clock.t += 500;
      expect(await keypad(clients[0]!, "house_1", "0000")).toMatchObject({ ok: false, reason: "wrong_code" });
    }
    clock.t += 500;
    const locked = await keypad(clients[0]!, "house_1", "0000");
    expect(locked).toMatchObject({ ok: false, reason: "locked_out" });
    expect(locked.retryAfterMs).toBeGreaterThan(28_000);
    clock.t += 5000;
    const still = await keypad(clients[0]!, "house_1", "1004");
    expect(still).toMatchObject({ ok: false, reason: "locked_out" });
    expect(still.retryAfterMs).toBeLessThan(26_000);
    expect(players[0]!.area).toBe("village");
    clock.t += 30_000;
    expect(await keypad(clients[0]!, "house_1", "1004")).toMatchObject({ ok: true });
    expect(await pollFor(() => players[0]!.area === AREA1)).toBe(true);
  });

  it("all ten houses are finished: house 2's door opens with 1004 too", async () => {
    const { clients, players } = await crowd(1);
    const e2 = keypadEntries()[1]!;
    atDoor(players[0]!, e2);
    expect(await keypad(clients[0]!, e2.buildingId, "1004")).toMatchObject({ ok: true });
  });

  // (with every house finished no door is "not ready": the rule is kept for a house taken out of generated/houses again)
  const allReady = keypadEntries().every((e) => houseIsReady(houseNumberOf(e.buildingId)!));
  it.skipIf(allReady)("a house with no interior yet stays locked (not_ready) and the attempt is not counted against the lock", async () => {
    const { clients, players } = await crowd(1);
    const e2 = keypadEntries().find((e) => !houseIsReady(houseNumberOf(e.buildingId)!))!;
    atDoor(players[0]!, e2);
    for (let i = 0; i < 7; i++) expect(await keypad(clients[0]!, e2.buildingId, "1004")).toMatchObject({ ok: false, reason: "not_ready" });
    expect(players[0]!.area).toBe("village");
    // the lock was never touched: house 1's right code still works at once
    atDoor(players[0]!);
    expect(await keypad(clients[0]!, "house_1", "1004")).toMatchObject({ ok: true });
  });

  it("sitting: the keypad does nothing (busy), the code is not looked at", async () => {
    const { clients, players } = await crowd(1);
    atDoor(players[0]!);
    players[0]!.seatIndex = 0; // seated (server state)
    expect(await keypad(clients[0]!, "house_1", "1004")).toMatchObject({ ok: false, reason: "busy" });
    expect(players[0]!.area).toBe("village");
  });

  it("at most 8 in one house, both floors together: the 9th right code gets 'full'; a ghost / someone upstairs counts", async () => {
    expect(HOUSE_POLICY.maxOccupants).toBe(8);
    const { room, clock, clients, players } = await crowd(9);
    for (let i = 0; i < 7; i++) {
      atDoor(players[i]!);
      clock.t += 1100;
      expect(await keypad(clients[i]!, "house_1", "1004")).toMatchObject({ ok: true });
    }
    // number 8 goes in, then walks up the stair: still counted
    atDoor(players[7]!);
    expect(await keypad(clients[7]!, "house_1", "1004")).toMatchObject({ ok: true });
    players[7]!.area = AREA2;
    atDoor(players[8]!);
    const full = await keypad(clients[8]!, "house_1", "1004");
    expect(full).toMatchObject({ ok: false, reason: "full" });
    expect(players[8]!.area).toBe("village");
    // someone leaves: the 9th is let in
    players[0]!.area = "village";
    expect(await keypad(clients[8]!, "house_1", "1004")).toMatchObject({ ok: true });
    expect(await pollFor(() => players[8]!.area === AREA1)).toBe(true);
    void room;
  });

  it("two entering in the same tick arrive apart", async () => {
    const { clients, players } = await crowd(2);
    place(players[0]!, entry1.pad.x - 0.3, entry1.pad.z);
    place(players[1]!, entry1.pad.x + 0.3, entry1.pad.z);
    for (const c of clients) c.send(VillageMsg.Keypad, { buildingId: "house_1", code: "1004" });
    expect(await pollFor(() => players.every((p) => p.area === AREA1))).toBe(true);
    expect(Math.hypot(players[0]!.x - players[1]!.x, players[0]!.z - players[1]!.z)).toBeGreaterThanOrEqual(ARRIVAL_SPACING_M - SPACING_SLACK_M);
  });

  it.each(["house", "lot"])("returns the second visitor from a crowded %s entrance when the interior fails to load", async (kind) => {
    const { clients, players, clock } = await crowd(2);
    const room = LOT_ROOMS[0]!;
    const area = kind === "house" ? AREA1 : room.area;
    const pad = kind === "house" ? entry1.pad : lotDoorPoint(room.lot, room.door).pad;
    for (const [i, p] of players.entries()) {
      place(p, pad.x, pad.z);
      if (kind === "house") await keypad(clients[i]!, "house_1", "1004");
      else clients[i]!.send(VillageMsg.UseDoor);
      expect(await pollFor(() => p.area === area)).toBe(true);
    }
    clock.t += 20_000;
    clients[1]!.send(VillageMsg.UseDoor, { loadFailed: true });
    expect(await pollFor(() => players[1]!.area === "village")).toBe(true);
    expect(players[0]!.area).toBe(area);
  });
});

describe("the stair and the way out", () => {
  async function inside(count = 1) {
    const c = await crowd(count);
    for (const p of c.players) {
      p.area = AREA1;
      place(p, PLACES.spawnIn.x, PLACES.spawnIn.z);
    }
    return c;
  }

  it("up the stair from the foot pad, down from the top pad: area flips, spots and facing as the contract says", async () => {
    const { clock, clients, players } = await inside();
    const p = players[0]!;
    place(p, PLACES.upPad.x, PLACES.upPad.z);
    clock.t += 1100;
    clients[0]!.send(VillageMsg.UseStair, {});
    expect(await pollFor(() => p.area === AREA2)).toBe(true);
    expect(p.x).toBeCloseTo(PLACES.spawnUp.x, 5);
    expect(p.z).toBeCloseTo(PLACES.spawnUp.z, 5);
    expect(p.yaw).toBeCloseTo(PLACES.spawnUp.yaw, 5);
    // the arrival is 0.35 m from the down pad: straight back down
    clock.t += 1100;
    clients[0]!.send(VillageMsg.UseStair, {});
    expect(await pollFor(() => p.area === AREA1)).toBe(true);
    expect(p.x).toBeCloseTo(PLACES.spawnDown.x, 5);
    expect(p.z).toBeCloseTo(PLACES.spawnDown.z, 5);
  });

  it("not from the middle of the room, not while sitting, once a second", async () => {
    const { clock, clients, players } = await inside();
    const p = players[0]!;
    clients[0]!.send(VillageMsg.UseStair, {}); // at the entry spot: far from the pad
    await sleep(150);
    expect(p.area).toBe(AREA1);
    place(p, PLACES.upPad.x, PLACES.upPad.z);
    p.seatIndex = 0;
    clients[0]!.send(VillageMsg.UseStair, {});
    await sleep(150);
    expect(p.area).toBe(AREA1);
    p.seatIndex = -1;
    clock.t += 1100;
    clients[0]!.send(VillageMsg.UseStair, {});
    expect(await pollFor(() => p.area === AREA2)).toBe(true);
    // pressed again within the same second: dropped (the door's cap)
    clients[0]!.send(VillageMsg.UseStair, {});
    await sleep(150);
    expect(p.area).toBe(AREA2);
  });

  it("the stair of a house that is not the one you are in does nothing: standing at house 1's pad coordinates in the village", async () => {
    const { clients, players } = await crowd(1);
    place(players[0]!, PLACES.upPad.x, PLACES.upPad.z);
    clients[0]!.send(VillageMsg.UseStair, {});
    await sleep(150);
    expect(players[0]!.area).toBe("village");
  });

  it("the way out (UseDoor on the exit pad) puts you on the porch facing away, in the village", async () => {
    const { clock, clients, players } = await inside();
    const p = players[0]!;
    place(p, PLACES.exitPad.x, PLACES.exitPad.z);
    clock.t += 1100;
    clients[0]!.send(VillageMsg.UseDoor, {});
    expect(await pollFor(() => p.area === "village")).toBe(true);
    expect(p.x).toBeCloseTo(entry1.exit.x, 3);
    expect(p.z).toBeCloseTo(entry1.exit.z, 3);
    expect(p.yaw).toBeCloseTo(entry1.exit.yaw, 3);
  });

});

describe("chat in a house", () => {
  it("is heard on BOTH floors of that house and nowhere else (not the village, not another house)", async () => {
    expect(HOUSE_POLICY.chatScope).toBe("house");
    const { clock, clients, players } = await crowd(5);
    const [down, up, other, outside, sender] = players as [Player, Player, Player, Player, Player];
    down.area = AREA1;
    up.area = AREA2;
    sender.area = AREA1;
    other.area = houseFloorArea(2, 1);
    outside.area = "village";
    const heard: ChatBroadcast[][] = clients.map(() => []);
    clients.forEach((c, i) => c.onMessage(MessageType.Chat, (m: ChatBroadcast) => heard[i]!.push(m)));
    clock.t += 5000;
    clients[4]!.send(MessageType.Chat, { text: "아래층 위층 모두 안녕" });
    expect(await pollFor(() => heard[0]!.length === 1 && heard[1]!.length === 1 && heard[4]!.length === 1)).toBe(true);
    expect(heard[0]![0]).toMatchObject({ text: "아래층 위층 모두 안녕", sid: clients[4]!.sessionId });
    // a typing round trip to the others proves nothing else was queued for them before it
    clients[0]!.send(MessageType.Typing, { on: true });
    clock.t += TYPING_RATE.windowMs + 1;
    await sleep(250);
    expect(heard[2]).toEqual([]);
    expect(heard[3]).toEqual([]);
    // and from upstairs it reaches the ground floor too
    clock.t += 5000;
    clients[1]!.send(MessageType.Chat, { text: "위층이에요" });
    expect(await pollFor(() => heard[0]!.some((m) => m.text === "위층이에요"))).toBe(true);
    expect(heard[2]!.some((m) => m.text === "위층이에요")).toBe(false);
  });
});

describe("house seats are claimed by index, in their own floor only", () => {
  it("a house seat is taken from its floor; from the other floor or the village the Sit is dropped", async () => {
    const { clock, clients, players } = await crowd(2);
    const idx = VILLAGE_SEATS.findIndex((s) => s.area === AREA1);
    expect(idx).toBeGreaterThanOrEqual(0);
    const seat = VILLAGE_SEATS[idx]!;
    const [inFloor, elsewhere] = players as [Player, Player];
    inFloor.area = AREA1;
    place(inFloor, seat.standX, seat.standZ);
    elsewhere.area = AREA2;
    place(elsewhere, seat.standX, seat.standZ); // the same x, z but another floor's area
    clock.t += 1100;
    clients[1]!.send(MessageType.Sit, { seatIndex: idx });
    await sleep(150);
    expect(elsewhere.seatIndex).toBe(-1);
    clients[0]!.send(MessageType.Sit, { seatIndex: idx });
    expect(await pollFor(() => inFloor.seatIndex === idx)).toBe(true);
    expect(inFloor.x).toBeCloseTo(seat.x, 3);
    expect(inFloor.z).toBeCloseTo(seat.z, 3);
    expect(VILLAGE_MAX_CLIENTS).toBeGreaterThan(8);
  });
});
