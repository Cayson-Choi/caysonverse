import { describe, expect, it } from "vitest";
import { Encoder, Decoder } from "@colyseus/schema";
import type { Client } from "colyseus";
import { Player, WorldState } from "@caysonverse/shared/schema";
import { VillageMsg, VillageServerMsg } from "@caysonverse/shared/village/messages";
import { FISHING, fishingPhaseId, fishingSync, type FishKind } from "@caysonverse/shared/village/fishing";
import { LAKE_RENTAL_PAD } from "@caysonverse/shared/village/lakeLayout";
import { VILLAGE_SEATS, fishingSeatIndex } from "@caysonverse/shared/village/benchSeats";
import { VillageFishing, boardDay, nightAt, parseSpot, type FishingHost } from "./villageFishing";

/** A fake client that records what it is sent. */
function fakeClient(sessionId: string) {
  const sent: Array<{ type: string; message: any }> = [];
  const client = { sessionId, send: (type: string, message: unknown) => void sent.push({ type, message }) } as unknown as Client;
  return { client, sent, of: (type: string) => sent.filter((m) => m.type === type).map((m) => m.message) };
}

/** VillageFishing on a fake room: real Player objects, a hand-set clock, handlers called directly. */
function rig() {
  const clock = { now: 1_000_000, wall: Date.UTC(2026, 10, 16, 3, 0, 0) }; // 12:00 Korean time
  const players = new Map<string, Player>();
  const clients = new Map<string, ReturnType<typeof fakeClient>>();
  const handlers = new Map<string, (c: Client, p: unknown) => void>();
  let fishing!: VillageFishing;
  const host: FishingHost = {
    now: () => clock.now,
    wallClock: () => clock.wall,
    player: (sid) => players.get(sid),
    clients: () => [...clients.values()].map((c) => c.client),
    sit: (client, seatIndex) => {
      const p = players.get(client.sessionId)!;
      const holder = [...players.entries()].find(([, q]) => q.seatIndex === seatIndex);
      if (holder && holder[0] !== client.sessionId) return "taken";
      const seat = VILLAGE_SEATS[seatIndex]!;
      if (Math.hypot(p.x - seat.x, p.z - seat.z) > 1.5) return "dropped";
      p.seatIndex = seatIndex;
      fishing.onSeated(client.sessionId, seatIndex);
      return "seated";
    },
    stand: (client) => {
      fishing.onStood(client.sessionId);
      players.get(client.sessionId)!.seatIndex = -1;
    },
    onMessage: (type, handler) => void handlers.set(type, handler),
  };
  fishing = new VillageFishing(host);
  fishing.force = null;
  fishing.register();
  const join = (sid: string, nickname = sid) => {
    const p = new Player();
    p.nickname = nickname;
    players.set(sid, p);
    const c = fakeClient(sid);
    clients.set(sid, c);
    fishing.join(c.client);
    return { p, c, sid };
  };
  const send = (who: { c: ReturnType<typeof fakeClient> }, type: string, payload: unknown = {}) => handlers.get(type)!(who.c.client, payload);
  const advance = (ms: number) => {
    clock.now += ms;
    fishing.tick();
  };
  return { clock, fishing, join, send, advance, players, handlers };
}
type Rig = ReturnType<typeof rig>;
type Who = ReturnType<Rig["join"]>;

/** Rent, walk to the chair of `spot` and sit on it (through FishingSit). */
function seatAt(r: Rig, who: Who, spot: number) {
  who.p.x = LAKE_RENTAL_PAD.x;
  who.p.z = LAKE_RENTAL_PAD.z;
  r.advance(200);
  r.send(who, VillageMsg.FishingRentRod);
  const seat = VILLAGE_SEATS[fishingSeatIndex(spot)]!;
  who.p.x = seat.x;
  who.p.z = seat.z;
  r.advance(600);
  r.send(who, VillageMsg.FishingSit, { spot });
}

/** One whole small-fish catch with the dice at `dice` (the size follows it). */
function catchSmall(r: Rig, who: Who, kind: FishKind, dice: number) {
  r.fishing.force = kind;
  r.fishing.random = () => dice;
  r.advance(FISHING.castGapMs);
  r.send(who, VillageMsg.FishingCast);
  const plan = r.fishing.stateOf(who.sid)!.plan!;
  r.clock.now = plan.biteAt;
  r.fishing.tick();
  r.send(who, VillageMsg.FishingStrike);
  r.advance(FISHING.hookedMs + FISHING.liftMs);
  r.advance(FISHING.landedMs + FISHING.releaseMs);
}

describe("parseSpot", () => {
  it("takes an index 0..29 or a spot id, and nothing else", () => {
    expect(parseSpot({ spot: 0 })).toBe(0);
    expect(parseSpot({ spot: 29 })).toBe(29);
    expect(parseSpot({ spot: "P01" })).toBe(0);
    expect(parseSpot({ spot: "S3" })).toBe(29);
    for (const bad of [{ spot: 30 }, { spot: -1 }, { spot: 1.5 }, { spot: "nope" }, { spot: null }, { spot: NaN }, {}, null, undefined, "P01", 3]) {
      expect(parseSpot(bad), JSON.stringify(bad)).toBe(-1);
    }
  });
});

describe("the sun clock helpers", () => {
  it("the board's day turns over at 04:00 Korean time", () => {
    const d = (h: number, m = 0) => boardDay(Date.UTC(2026, 10, 16, h, m) - 9 * 3600_000); // h:m KST
    expect(d(3, 59)).toBe(d(0, 0) - 0); // same day as midnight
    expect(d(4, 0)).toBe(d(3, 59) + 1);
    expect(d(23, 59)).toBe(d(4, 0));
    expect(boardDay(Date.UTC(2026, 10, 17, 3, 59) - 9 * 3600_000)).toBe(d(4, 0)); // next day 03:59 KST is still the same board
  });

  it("nightAt: ~0 at noon, ~1 at midnight (Korean time)", () => {
    expect(nightAt(Date.UTC(2026, 10, 16, 3, 0))).toBe(0); // 12:00 KST
    expect(nightAt(Date.UTC(2026, 10, 16, 14, 0))).toBe(1); // 23:00 KST
  });
});

describe("the message caps (design 9.5)", () => {
  it("more than 8 messages in a second, or 40 in 10 seconds, are dropped and only counted", () => {
    const r = rig();
    const a = r.join("a");
    a.p.x = LAKE_RENTAL_PAD.x;
    a.p.z = LAKE_RENTAL_PAD.z;
    for (let i = 0; i < 20; i++) r.send(a, VillageMsg.FishingBoardRequest); // 20 in the same millisecond
    expect(a.c.of(VillageServerMsg.FishingBoard).length).toBe(1 + 8); // the join's, plus the 8 the cap lets through
    expect(r.fishing.warningsOf("a")).toBe(12);
    r.clock.now += 1001;
    for (let i = 0; i < 8; i++) r.send(a, VillageMsg.FishingBoardRequest);
    expect(r.fishing.warningsOf("a")).toBe(12); // a new second: allowed again
    // the long window: 40 per 10 s, however they are spread (8 a second for 5 s = 40, the 41st is dropped)
    const b = r.join("b");
    r.clock.now += 20_000;
    let accepted = 0;
    for (let s = 0; s < 6; s++) {
      for (let i = 0; i < 8; i++) {
        const before = b.c.of(VillageServerMsg.FishingBoard).length;
        r.send(b, VillageMsg.FishingBoardRequest);
        accepted += b.c.of(VillageServerMsg.FishingBoard).length - before;
      }
      r.clock.now += 1001;
    }
    expect(accepted).toBeLessThanOrEqual(40 + 8); // never more than 40 inside one 10 s window
    expect(r.fishing.warningsOf("b")).toBeGreaterThan(0);
  });

  it("a player who is not in the village area gets no fishing at all (silent)", () => {
    const r = rig();
    const a = r.join("a");
    a.p.area = "hall";
    a.p.x = LAKE_RENTAL_PAD.x;
    r.send(a, VillageMsg.FishingRentRod);
    expect(r.fishing.stateOf("a")!.rod).toBe(false);
    expect(a.c.of(VillageServerMsg.FishingRejected)).toHaveLength(0);
    expect(r.fishing.warningsOf("a")).toBe(0);
  });

  it("leaving for the hall with a rod gives it back by itself", () => {
    const r = rig();
    const a = r.join("a");
    seatAt(r, a, 0);
    r.send(a, VillageMsg.FishingStand);
    r.advance(600);
    expect(a.p.rod).toBe(1);
    a.p.area = "hall";
    r.advance(100);
    expect(a.p.rod).toBe(0);
    expect(a.c.of(VillageServerMsg.FishingState).at(-1)).toMatchObject({ rod: false, action: "auto_returned" });
  });
});

describe("the 'today's biggest' board (design 9.6)", () => {
  it("keeps the best 5 of each species, biggest first, and tells the lake when it changes", () => {
    const r = rig();
    const a = r.join("a", "철수");
    const watcher = r.join("w", "영희");
    watcher.p.x = 120; // at the lake
    const far = r.join("f", "먼곳");
    far.p.x = 20; // on the plaza
    seatAt(r, a, 0);
    // bluegill at dice 0 .. .77: sizes 8, 8, 9, 10, 11, 12, 13, 14 -> the top five are 10..14
    for (const dice of [0, 0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77]) catchSmall(r, a, "bluegill", dice);
    const entries = r.fishing.boardEntries();
    expect(entries.map((e) => e.cm)).toEqual([14, 13, 12, 11, 10]);
    expect(entries.every((e) => e.kind === "bluegill" && e.by === "철수")).toBe(true);
    // the watcher at the lake got the updates (join + one per entry that made the list), the plaza visitor only the join's
    expect(watcher.c.of(VillageServerMsg.FishingBoard).length).toBeGreaterThan(1);
    expect(far.c.of(VillageServerMsg.FishingBoard)).toHaveLength(1);
    // a request answers with the same list
    r.clock.now += 5000;
    r.send(far, VillageMsg.FishingBoardRequest);
    expect(far.c.of(VillageServerMsg.FishingBoard).at(-1).entries.map((e: { cm: number }) => e.cm)).toEqual([14, 13, 12, 11, 10]);
  });

  it("starts empty again at 04:00 Korean time", () => {
    const r = rig();
    const a = r.join("a");
    seatAt(r, a, 0);
    catchSmall(r, a, "minnow", 0);
    expect(r.fishing.boardEntries()).toHaveLength(1);
    r.clock.wall += 24 * 3600_000;
    expect(r.fishing.boardEntries()).toHaveLength(0);
    catchSmall(r, a, "minnow", 0);
    expect(r.fishing.boardEntries()).toHaveLength(1);
  });
});

describe("rental tied to the spots and the chairs", () => {
  it("one player per spot: a second FishingSit on a taken chair is spot_taken; the spot frees when the first stands", () => {
    const r = rig();
    const a = r.join("a");
    const b = r.join("b");
    seatAt(r, a, 3);
    expect(a.p.fishSpot).toBe(3);
    seatAt(r, b, 3);
    expect(b.c.of(VillageServerMsg.FishingRejected).at(-1)).toEqual({ reason: "spot_taken" });
    expect(b.p.fishSpot).toBe(-1);
    r.send(a, VillageMsg.FishingStand);
    expect(a.p.fishSpot).toBe(-1);
    r.advance(600);
    r.send(b, VillageMsg.FishingSit, { spot: 3 });
    expect(b.p.fishSpot).toBe(3);
    expect(b.p.fishPhase).toBe(fishingPhaseId("ready"));
  });

  it("all 30 spots can be filled by 30 visitors without an overlap, and every one is ready", () => {
    const r = rig();
    const all = Array.from({ length: 30 }, (_, i) => r.join(`v${i}`));
    all.forEach((w, i) => seatAt(r, w, i));
    expect(new Set(all.map((w) => w.p.fishSpot)).size).toBe(30);
    expect(all.every((w) => w.p.fishPhase === fishingPhaseId("ready") && w.p.rod === 1)).toBe(true);
    // the synced fields equal the pure projection of the state
    for (const w of all) {
      const f = fishingSync(r.fishing.stateOf(w.sid)!);
      expect([w.p.rod, w.p.fishSpot, w.p.fishPhase, w.p.fishSeq]).toEqual([f.rod, f.fishSpot, f.fishPhase, f.fishSeq]);
    }
  });
});

describe("schema size and what goes over the wire (design 12.10)", () => {
  it("30 players fishing: a full snapshot, and the patch of a stage change in every player", () => {
    const state = new WorldState();
    const encoder = new Encoder(state);
    for (let i = 0; i < 30; i++) {
      const p = new Player();
      p.nickname = `낚시꾼${i}`;
      p.x = 100 + i;
      p.z = -10;
      p.seatIndex = 77 + i;
      p.rod = 1;
      p.fishSpot = i;
      p.fishPhase = fishingPhaseId("ready");
      state.players.set(`session${i}`, p);
    }
    const full = encoder.encodeAll().byteLength;
    encoder.discardChanges();
    // a stage change in all 30 at once: phase + seq + at (+ the signal)
    state.players.forEach((p, i) => {
      p.fishPhase = fishingPhaseId("casting");
      p.fishSeq = 1000 + Number(i.slice(7));
      p.fishAt = 1_999_999_999;
    });
    const patchAll = encoder.encode().byteLength;
    encoder.discardChanges();
    // the bite for one: phase + signal + at
    const one = state.players.get("session0")!;
    one.fishPhase = fishingPhaseId("bite");
    one.fishSig = 2;
    one.fishAt = 2_000_000_100;
    const patchOne = encoder.encode().byteLength;
    encoder.discardChanges();
    // an unchanged player costs nothing
    const idle = encoder.encode().byteLength;
    console.log(`[schema] 30 fishing players: full snapshot ${full} B, a casting stage change in all 30 ${patchAll} B (${(patchAll / 30).toFixed(1)} B each), one bite ${patchOne} B, idle patch ${idle} B`);
    // the whole room's stage changes at 1/s stay far below a kilobyte a second per client; a snapshot is a one-off
    expect(patchOne).toBeLessThan(40);
    expect(patchAll / 30).toBeLessThan(24);
    expect(idle).toBeLessThanOrEqual(1);
    expect(full).toBeLessThan(30 * 160);

    const decoded = new WorldState();
    const decoder = new Decoder(decoded);
    decoder.decode(encoder.encodeAll());
    expect(decoded.players.get("session0")!.fishSig).toBe(2);
  });
});
