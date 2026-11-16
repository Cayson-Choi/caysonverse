import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { VILLAGE_ROOM } from "@caysonverse/shared/constants";
import { MessageType } from "@caysonverse/shared/messages";
import {
  VillageMsg,
  VillageServerMsg,
  type FishingBoardPayload,
  type FishingRejectedPayload,
  type FishingStatePayload,
  type FishingTrophyPayload,
} from "@caysonverse/shared/village/messages";
import { FISHING, fishingPhaseId, type FishKind, type FishingState } from "@caysonverse/shared/village/fishing";
import { LAKE_RENTAL_PAD } from "@caysonverse/shared/village/lakeLayout";
import { LAKE_SEAT_BASE, VILLAGE_SEATS, fishingSeatIndex } from "@caysonverse/shared/village/benchSeats";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { rooms, type VillageRoom } from "./index";

/**
 * 낚시터 (A10, D2) on a real VillageRoom with real clients: the lists of design 12.3 (rent / return), 12.4 (the server's side
 * of a fishing round) and 12.10 (two clients: a fight for a spot, casting from far, striking with no nibble, a hold storm,
 * dropping and coming back). The server's clock is a test seam (`room.now`), so every stage is stepped by hand.
 */

const PORT = 2576;
const JOIN = { nickname: "낚시꾼", appearance: DEFAULT_APPEARANCE };
const JOIN_B = { nickname: "옆자리", appearance: DEFAULT_APPEARANCE };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

interface Listening {
  onMessage(type: string, callback: (message: unknown) => void): unknown;
}

/** Everything a client received, by message type. */
function record(client: Listening) {
  const log: Record<string, unknown[]> = {};
  const types: string[] = [VillageServerMsg.FishingState, VillageServerMsg.FishingRejected, VillageServerMsg.FishingTrophy, VillageServerMsg.FishingBoard, MessageType.SitRejected];
  for (const t of types) {
    log[t] = [];
    client.onMessage(t, (m: unknown) => {
      log[t]!.push(m);
    });
  }
  return {
    states: () => log[VillageServerMsg.FishingState] as FishingStatePayload[],
    rejects: () => (log[VillageServerMsg.FishingRejected] as FishingRejectedPayload[]).map((r) => r.reason),
    trophies: () => log[VillageServerMsg.FishingTrophy] as FishingTrophyPayload[],
    boards: () => log[VillageServerMsg.FishingBoard] as FishingBoardPayload[],
    sitRejected: () => log[MessageType.SitRejected]!,
  };
}

async function until(cond: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

interface FishingInternals {
  fishing: {
    tick(): void;
    random: () => number;
    force: FishKind | "cycle" | null;
    stateOf(sid: string): FishingState | undefined;
    warningsOf(sid: string): number;
    boardEntries(): Array<{ kind: string; cm: number; by: string }>;
  };
}

async function setup() {
  const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
  const clock = { t: Date.now() };
  (room as unknown as { now: () => number }).now = () => clock.t;
  const fishing = (room as unknown as FishingInternals).fishing;
  fishing.random = () => 0; // the first fish of every table, its smallest size, the shortest wait
  const visitor = async (opts: typeof JOIN = JOIN) => {
    const client = await colyseus.connectTo(room, opts);
    const player = room.state.players.get(client.sessionId)!;
    const log = record(client);
    clock.t += 1000; // keep the fishing gaps open
    return { client, player, log, sid: client.sessionId };
  };
  /** Advance the server's clock by `ms` and run the fishing tick. */
  const advance = (ms: number) => {
    clock.t += ms;
    fishing.tick();
  };
  return { room, clock, fishing, visitor, advance };
}

type Visitor = Awaited<ReturnType<Awaited<ReturnType<typeof setup>>["visitor"]>>;

/** Stand on the rental pad and rent. */
async function rent(v: Visitor) {
  v.player.x = LAKE_RENTAL_PAD.x;
  v.player.z = LAKE_RENTAL_PAD.z;
  v.client.send(VillageMsg.FishingRentRod, {});
  await until(() => v.player.rod === 1, "the rod");
}

/** Walk to the get-in spot beside chair `spot` and sit on it with FishingSit. */
async function sitAt(v: Visitor, spot: number, advance: (ms: number) => void) {
  const seat = VILLAGE_SEATS[fishingSeatIndex(spot)]!;
  v.player.x = seat.standX;
  v.player.z = seat.standZ;
  advance(600);
  v.client.send(VillageMsg.FishingSit, { spot });
  await until(() => v.player.fishSpot === spot, `sitting at spot ${spot}`);
}

describe("rent and return (design 12.3, server side)", () => {
  it("rents on the pad: the rod shows in the synced fields and in the owner's state", async () => {
    const { visitor } = await setup();
    const a = await visitor();
    expect(a.player.rod).toBe(0);
    await rent(a);
    expect(a.player.fishPhase).toBe(fishingPhaseId("carry"));
    await until(() => a.log.states().some((s) => s.rod && s.action === "rod_rented"), "the rented state");
  });

  it("refuses a rental from 2.6 m + away (a forged message) and keeps the visitor rodless", async () => {
    const { visitor } = await setup();
    const a = await visitor();
    a.player.x = LAKE_RENTAL_PAD.x + FISHING.rentReachM + 0.1;
    a.player.z = LAKE_RENTAL_PAD.z;
    a.client.send(VillageMsg.FishingRentRod, {});
    await until(() => a.log.rejects().length > 0, "the refusal");
    expect(a.log.rejects()).toEqual(["not_near_rental"]);
    expect(a.player.rod).toBe(0);
  });

  it("returns at the office by button, and by itself on leaving the lake (x < 90)", async () => {
    const { visitor, advance } = await setup();
    const a = await visitor();
    await rent(a);
    a.player.x = LAKE_RENTAL_PAD.x + 3.5;
    advance(300);
    a.client.send(VillageMsg.FishingReturnRod, {});
    await until(() => a.player.rod === 0, "the returned rod");
    expect(a.log.states().some((s) => s.action === "rod_returned")).toBe(true);

    advance(300);
    await rent(a);
    a.player.x = 60; // walked back to the village
    advance(100);
    await until(() => a.player.rod === 0, "the automatic return");
    await until(() => a.log.states().some((s) => s.action === "auto_returned" && !s.rod), "the auto-return message");
    // far from the office: a return by button is refused
    advance(300);
    await rent(a);
    a.player.x = 150;
    advance(300);
    a.client.send(VillageMsg.FishingReturnRod, {});
    await until(() => a.log.rejects().includes("not_near_return"), "the refusal");
    expect(a.player.rod).toBe(1);
  });

  it("dropping the connection removes the rod and frees the spot for the next visitor", async () => {
    const { room, visitor, advance } = await setup();
    const a = await visitor();
    const b = await visitor(JOIN_B);
    await rent(a);
    await sitAt(a, 4, advance);
    expect(a.player.seatIndex).toBe(fishingSeatIndex(4));
    const aSid = a.sid;
    await a.client.leave(true);
    await until(() => !room.state.players.has(aSid), "the leave");
    expect((room as unknown as FishingInternals).fishing.stateOf(aSid)).toBeUndefined();
    await rent(b);
    await sitAt(b, 4, advance); // the same chair is free again
    expect(b.player.seatIndex).toBe(fishingSeatIndex(4));
    expect(b.player.fishPhase).toBe(fishingPhaseId("ready"));
  });
});

describe("a fishing round (design 12.4, server side)", () => {
  it("rent, sit, cast, nibble, bite, strike, lift, land, release: every stage in the owner's messages and the synced fields", async () => {
    const { fishing, visitor, advance, clock, room } = await setup();
    fishing.force = "bluegill"; // a small sinker: no hold stage
    const a = await visitor();
    const watcher = await visitor(JOIN_B); // another client sees the synced fields
    await rent(a);
    await sitAt(a, 0, advance);
    expect(a.player.fishPhase).toBe(fishingPhaseId("ready"));

    clock.t += 2000;
    a.client.send(VillageMsg.FishingCast, {});
    await until(() => a.player.fishPhase === fishingPhaseId("casting"), "casting");
    expect(a.player.fishSeq).toBe(1);
    const plan = fishing.stateOf(a.sid)!.plan!;
    await until(() => watcher.client.state.players.get(a.sid)?.fishSeq === 1, "the watcher seeing the cast");
    expect(watcher.client.state.players.get(a.sid)!.fishAt).toBe(clock.t % 4294967296);

    // a pull while the float is still settling: refused, no penalty
    advance(500);
    a.client.send(VillageMsg.FishingStrike, {});
    await until(() => a.log.rejects().includes("no_bite"), "no_bite");

    clock.t = plan.nibbleAt - 1;
    fishing.tick();
    expect(a.player.fishPhase).toBe(fishingPhaseId("waiting"));
    advance(1);
    expect(a.player.fishPhase).toBe(fishingPhaseId("nibble"));
    expect(a.player.fishSig).toBe(0); // the signal is secret until the bite
    a.client.send(VillageMsg.FishingStrike, {});
    await until(() => a.log.rejects().includes("too_early"), "too_early");
    expect(a.player.fishPhase).toBe(fishingPhaseId("nibble")); // ignored, no penalty

    clock.t = plan.biteAt;
    fishing.tick();
    await until(() => a.log.states().some((s) => s.phase === "bite"), "the bite");
    expect(a.player.fishPhase).toBe(fishingPhaseId("bite"));
    expect(a.player.fishSig).toBe(2); // sink
    const bite = a.log.states().find((s) => s.phase === "bite")!;
    expect(bite).toMatchObject({ signal: "sink", windowOpensInMs: 0, windowClosesInMs: 1200, catch: null });

    advance(300);
    a.client.send(VillageMsg.FishingStrike, {});
    await until(() => a.log.states().some((s) => s.action === "struck"), "the strike");
    expect(a.player.fishPhase).toBe(fishingPhaseId("hooked"));
    expect([a.player.fishKind, a.player.fishCm]).toEqual([2, 8]); // 블루길 8 cm
    expect(a.log.states().find((s) => s.action === "struck")!.catch).toMatchObject({ kind: "bluegill", cm: 8, disposal: "bin", needsNet: false });

    advance(FISHING.hookedMs);
    expect(a.player.fishPhase).toBe(fishingPhaseId("lifting"));
    advance(FISHING.liftMs);
    expect(a.player.fishPhase).toBe(fishingPhaseId("landed"));
    await until(() => a.log.boards().some((b) => b.entries.length === 1), "the board update");
    expect(fishing.boardEntries()).toMatchObject([{ kind: "bluegill", cm: 8, by: "낚시꾼" }]);
    advance(FISHING.landedMs);
    expect(a.player.fishPhase).toBe(fishingPhaseId("releasing"));
    advance(FISHING.releaseMs);
    expect(a.player.fishPhase).toBe(fishingPhaseId("ready"));
    expect([a.player.fishKind, a.player.fishCm, a.player.fishSig]).toEqual([0, 0, 0]);
    await until(() => a.log.states().at(-1)?.phase === "ready", "the ready state");
    expect(room.state.players.get(a.sid)!.fishSpot).toBe(0);

    // standing up pulls everything back to the shoulder
    advance(1000);
    a.client.send(VillageMsg.FishingStand, {});
    await until(() => a.player.seatIndex === -1, "standing up");
    expect(a.player.fishSpot).toBe(-1);
    expect(a.player.fishPhase).toBe(fishingPhaseId("carry"));
    expect(a.player.rod).toBe(1);
  });

  it("a missed bite: too late is missed, no fish, then ready again", async () => {
    const { fishing, visitor, advance, clock } = await setup();
    fishing.force = "carp";
    const a = await visitor();
    await rent(a);
    await sitAt(a, 2, advance);
    clock.t += 2000;
    a.client.send(VillageMsg.FishingCast, {});
    await until(() => a.player.fishPhase === fishingPhaseId("casting"), "casting");
    const plan = fishing.stateOf(a.sid)!.plan!;
    clock.t = plan.biteAt;
    fishing.tick();
    clock.t = plan.windowClosesAt + FISHING.strikeGraceMs;
    fishing.tick();
    expect(a.player.fishPhase).toBe(fishingPhaseId("missed"));
    await until(() => a.log.states().some((s) => s.phase === "missed" && s.lastResult === "missed" && s.catch === null), "the missed state");
    a.client.send(VillageMsg.FishingStrike, {});
    await until(() => a.log.rejects().includes("bite_expired"), "bite_expired");
    advance(FISHING.missedMs);
    expect(a.player.fishPhase).toBe(fishingPhaseId("ready"));
  });

  it("a big fish: hold to the net (a lost 'up' counts for 1.5 s only), then the board", async () => {
    const { fishing, visitor, advance, clock } = await setup();
    fishing.force = "carp"; // random 0: 35 cm, hold 1.5 s
    const a = await visitor();
    await rent(a);
    await sitAt(a, 6, advance);
    clock.t += 2000;
    a.client.send(VillageMsg.FishingCast, {});
    await until(() => a.player.fishPhase === fishingPhaseId("casting"), "casting");
    const plan = fishing.stateOf(a.sid)!.plan!;
    clock.t = plan.biteAt;
    fishing.tick();
    a.client.send(VillageMsg.FishingStrike, {});
    await until(() => a.player.fishPhase === fishingPhaseId("hooked"), "hooked");
    advance(FISHING.hookedMs);
    expect(a.player.fishPhase).toBe(fishingPhaseId("fighting"));
    await until(() => a.log.states().at(-1)?.phase === "fighting", "the fighting state");
    expect(a.log.states().at(-1)).toMatchObject({ phase: "fighting", holdNeedMs: 1500, catch: { needsNet: true } });

    a.client.send(VillageMsg.FishingHold, { down: true });
    await sleep(30);
    advance(900);
    a.client.send(VillageMsg.FishingHold, { down: true });
    await sleep(30);
    advance(700);
    expect(a.player.fishPhase).toBe(fishingPhaseId("netting"));
    advance(FISHING.netMs);
    expect(a.player.fishPhase).toBe(fishingPhaseId("landed"));
    expect(fishing.boardEntries()).toMatchObject([{ kind: "carp", cm: 35 }]);
  });

  it("a fish that is never fought is lost after 6 s of no pressing", async () => {
    const { fishing, visitor, advance, clock } = await setup();
    fishing.force = "carp";
    const a = await visitor();
    await rent(a);
    await sitAt(a, 7, advance);
    clock.t += 2000;
    a.client.send(VillageMsg.FishingCast, {});
    await until(() => a.player.fishPhase === fishingPhaseId("casting"), "casting");
    clock.t = fishing.stateOf(a.sid)!.plan!.biteAt;
    fishing.tick();
    a.client.send(VillageMsg.FishingStrike, {});
    await until(() => a.player.fishPhase === fishingPhaseId("hooked"), "hooked");
    advance(FISHING.hookedMs);
    advance(FISHING.fightIdleMs);
    expect(a.player.fishPhase).toBe(fishingPhaseId("missed"));
    await until(() => a.log.states().at(-1)?.phase === "missed", "the lost state");
    expect(a.log.states().at(-1)).toMatchObject({ phase: "missed", lastResult: "lost", catch: null });
    expect(a.player.fishKind).toBe(0);
  });

  it("trophy alerts go only to who they concern: the lake hears a 대물, the plaza hears none; the village hears a 가물치", async () => {
    const { fishing, visitor, advance, clock } = await setup();
    const a = await visitor();
    const atLake = await visitor(JOIN_B);
    const plaza = await visitor({ nickname: "광장사람", appearance: DEFAULT_APPEARANCE });
    atLake.player.x = 120;
    plaza.player.x = 20; // the plaza: the village area, west of the lake
    await rent(a);
    await sitAt(a, 8, advance);

    async function catchBig(kind: FishKind, randomValue: number) {
      fishing.force = kind;
      fishing.random = () => randomValue;
      clock.t += 2000;
      a.client.send(VillageMsg.FishingCast, {});
      await until(() => a.player.fishPhase === fishingPhaseId("casting"), "casting");
      clock.t = fishing.stateOf(a.sid)!.plan!.biteAt;
      fishing.tick();
      a.client.send(VillageMsg.FishingStrike, {});
      await until(() => a.player.fishPhase === fishingPhaseId("hooked"), "hooked");
      advance(FISHING.hookedMs);
      const need = fishing.stateOf(a.sid)!.holdNeedMs;
      a.client.send(VillageMsg.FishingHold, { down: true });
      await sleep(20);
      for (let i = 0; i < Math.ceil(need / 1000) + 1 && a.player.fishPhase === fishingPhaseId("fighting"); i++) {
        advance(1000);
        a.client.send(VillageMsg.FishingHold, { down: true });
        await sleep(20);
      }
      advance(FISHING.netMs);
      expect(a.player.fishPhase).toBe(fishingPhaseId("landed"));
      advance(FISHING.landedMs + FISHING.releaseMs);
      expect(a.player.fishPhase).toBe(fishingPhaseId("ready"));
      advance(FISHING.castGapMs);
    }

    await catchBig("carp", 0.999999); // 85 cm: a lake-wide alert
    await until(() => atLake.log.trophies().length === 1 && a.log.trophies().length === 1, "the lake alert");
    expect(atLake.log.trophies()[0]).toMatchObject({ by: "낚시꾼", kind: "carp", cm: 85, tier: "lake" });
    await sleep(60);
    expect(plaza.log.trophies()).toHaveLength(0);

    await catchBig("snakehead", 0); // 가물치: the whole village
    await until(() => plaza.log.trophies().length === 1, "the village alert");
    expect(plaza.log.trophies()[0]).toMatchObject({ kind: "snakehead", tier: "village" });
    expect(atLake.log.trophies()).toHaveLength(2);
  });
});

describe("two clients and the cheats (design 12.10)", () => {
  it("a fight for a spot: first come is seated, the other is refused ('spot_taken') and keeps standing", async () => {
    const { visitor, advance } = await setup();
    const a = await visitor();
    const b = await visitor(JOIN_B);
    await rent(a);
    await rent(b);
    const seat = VILLAGE_SEATS[fishingSeatIndex(10)]!;
    for (const v of [a, b]) {
      v.player.x = seat.standX;
      v.player.z = seat.standZ;
    }
    advance(600);
    a.client.send(VillageMsg.FishingSit, { spot: 10 });
    await until(() => a.player.fishSpot === 10, "the first sitter");
    b.client.send(VillageMsg.FishingSit, { spot: "P11" }); // by id: the same chair
    await until(() => b.log.rejects().includes("spot_taken"), "spot_taken");
    expect(b.player.seatIndex).toBe(-1);
    expect(b.player.fishSpot).toBe(-1);
    expect(b.player.fishPhase).toBe(fishingPhaseId("carry"));
  });

  it("sitting needs the real approach: far from the chair, or a spot out of range, is refused and changes nothing", async () => {
    const { visitor, advance } = await setup();
    const a = await visitor();
    await rent(a);
    a.player.x = 100;
    a.player.z = 0;
    advance(600);
    a.client.send(VillageMsg.FishingSit, { spot: 3 });
    await until(() => a.log.rejects().includes("too_far"), "too_far");
    a.client.send(VillageMsg.FishingSit, { spot: 30 });
    a.client.send(VillageMsg.FishingSit, { spot: -1 });
    a.client.send(VillageMsg.FishingSit, { spot: "ZZ9" });
    a.client.send(VillageMsg.FishingSit, "garbage");
    await until(() => a.log.rejects().filter((r) => r === "bad_spot").length === 4, "four bad_spot");
    expect(a.player.seatIndex).toBe(-1);
  });

  it("casting from far away, or without the chair, or without a rod: refused; striking with no bite: refused", async () => {
    const { visitor, advance, clock } = await setup();
    const a = await visitor();
    a.player.x = 150;
    a.client.send(VillageMsg.FishingCast, {});
    await until(() => a.log.rejects().includes("no_rod"), "no_rod");
    await rent(a);
    clock.t += 2000;
    a.player.x = 140;
    a.client.send(VillageMsg.FishingCast, {}); // a rod, standing by the water, not on a chair
    await until(() => a.log.rejects().includes("not_seated"), "not_seated");
    a.client.send(VillageMsg.FishingStrike, {});
    await until(() => a.log.rejects().filter((r) => r === "not_seated").length === 2, "strike not_seated");
    expect(a.player.fishPhase).toBe(fishingPhaseId("carry"));
    // a Sit on a fishing chair with no rod is a plain sit; casting then says no_rod
    const b = await visitor(JOIN_B);
    const seat = VILLAGE_SEATS[fishingSeatIndex(12)]!;
    b.player.x = seat.standX;
    b.player.z = seat.standZ;
    b.client.send(MessageType.Sit, { seatIndex: fishingSeatIndex(12) });
    await until(() => b.player.seatIndex === fishingSeatIndex(12), "a plain sit");
    expect(b.player.fishPhase).toBe(fishingPhaseId("none"));
    advance(600);
    b.client.send(VillageMsg.FishingCast, {});
    await until(() => b.log.rejects().includes("no_rod"), "no_rod while seated");
  });

  it("a hold storm: over 8 messages a second are dropped and only counted, and no progress comes from spam", async () => {
    const { fishing, visitor, advance, clock } = await setup();
    fishing.force = "carp";
    fishing.random = () => 0.999999; // 85 cm: needs 5 s of hold
    const a = await visitor();
    await rent(a);
    await sitAt(a, 14, advance);
    clock.t += 2000;
    a.client.send(VillageMsg.FishingCast, {});
    await until(() => a.player.fishPhase === fishingPhaseId("casting"), "casting");
    clock.t = fishing.stateOf(a.sid)!.plan!.biteAt;
    fishing.tick();
    a.client.send(VillageMsg.FishingStrike, {});
    await until(() => a.player.fishPhase === fishingPhaseId("hooked"), "hooked");
    advance(FISHING.hookedMs);
    expect(a.player.fishPhase).toBe(fishingPhaseId("fighting"));
    clock.t += 15_000; // a quiet spell: the rate windows are empty again
    const before = fishing.warningsOf(a.sid);
    for (let i = 0; i < 60; i++) a.client.send(VillageMsg.FishingHold, { down: true });
    await until(() => fishing.warningsOf(a.sid) - before >= 50, "the dropped messages");
    // 60 messages at one instant: no time passed since the last integration... the 15 s quiet spell had nobody pressing
    expect(fishing.stateOf(a.sid)!.holdMs).toBe(0);
    advance(300);
    expect(fishing.stateOf(a.sid)!.holdMs).toBeLessThanOrEqual(300);
  });

  it("dropping the connection (a transient drop) keeps the same session: the stage, the spot and the rod are still there", async () => {
    const { room, visitor, advance } = await setup();
    const a = await visitor();
    await rent(a);
    await sitAt(a, 5, advance);
    const sid = a.sid;
    const fishing = (room as unknown as FishingInternals).fishing;
    expect(fishing.stateOf(sid)!.phase).toBe("ready");
    a.client.connection.close(4010, "test drop"); // not a consented leave: the reconnection window opens
    await sleep(150);
    expect(room.state.players.get(sid)!.seatIndex).toBe(fishingSeatIndex(5));
    expect(room.state.players.get(sid)!.rod).toBe(1);
    expect(fishing.stateOf(sid)!.phase).toBe("ready");
  });
});

describe("the lake's seats in the room (design 12.2, server side)", () => {
  it("a backless pavilion board past index 127 syncs as an int16 and is sat on from either side, facing the side the sitter came from", async () => {
    const { visitor } = await setup();
    const a = await visitor();
    const b = await visitor();
    // the board's second facing (":b"): its own seat of the board's group
    const idx = VILLAGE_SEATS.findIndex((s) => s.lake === "pavilion" && s.id.endsWith(":b"));
    expect(idx).toBeGreaterThanOrEqual(LAKE_SEAT_BASE);
    expect(idx).toBeGreaterThan(127);
    const seat = VILLAGE_SEATS[idx]!;
    const pair = VILLAGE_SEATS.findIndex((s) => s.group === seat.group && s !== seat);
    expect(pair).toBeGreaterThanOrEqual(LAKE_SEAT_BASE);
    expect(seat.kind).toBe("backless");
    a.player.x = seat.x + Math.sin(seat.yaw) * 0.6;
    a.player.z = seat.z + Math.cos(seat.yaw) * 0.6;
    a.client.send(MessageType.Sit, { seatIndex: idx });
    await until(() => a.player.seatIndex === idx, "sitting on the pavilion board");
    expect(a.player.yaw).toBeCloseTo(seat.yaw, 5);
    await until(() => a.client.state.players.get(a.sid)?.seatIndex === idx, "the client seeing it");
    // the other facing of the same place is taken with it
    const other = VILLAGE_SEATS[pair]!;
    b.player.x = other.x + Math.sin(other.yaw) * 0.6;
    b.player.z = other.z + Math.cos(other.yaw) * 0.6;
    b.client.send(MessageType.Sit, { seatIndex: pair });
    await sleep(80);
    expect(b.player.seatIndex).toBe(-1);
    a.client.send(MessageType.Stand, {});
    await until(() => a.player.seatIndex === -1, "standing");
    expect(a.player.x).toBeCloseTo(seat.standX, 5);
    expect(a.player.z).toBeCloseTo(seat.standZ, 5);
  });

  it("a backed lake bench is sat on from the front only: from behind the backrest the Sit is dropped", async () => {
    const { visitor } = await setup();
    const a = await visitor();
    const idx = VILLAGE_SEATS.findIndex((s) => s.lake === "bench");
    const seat = VILLAGE_SEATS[idx]!;
    a.player.x = seat.x - Math.sin(seat.yaw) * 1.0; // behind the backrest
    a.player.z = seat.z - Math.cos(seat.yaw) * 1.0;
    a.client.send(MessageType.Sit, { seatIndex: idx });
    await sleep(80);
    expect(a.player.seatIndex).toBe(-1);
    a.player.x = seat.x + Math.sin(seat.yaw) * 0.9;
    a.player.z = seat.z + Math.cos(seat.yaw) * 0.9;
    a.client.send(MessageType.Sit, { seatIndex: idx });
    await until(() => a.player.seatIndex === idx, "sitting from the front");
  });

  it("the board: ask for it and get the list (nothing caught yet is an empty list)", async () => {
    const { visitor } = await setup();
    const a = await visitor();
    a.client.send(VillageMsg.FishingBoardRequest, {});
    await until(() => a.log.boards().length >= 1, "the board");
    expect(a.log.boards().at(-1)).toMatchObject({ entries: [] });
  });
});
