import { describe, expect, it } from "vitest";
import type { Client } from "colyseus";
import { COASTER_CYCLE_MS, COASTER_DWELL_MS, COASTER_SEATS, COASTER_UNLOAD_MS } from "@caysonverse/shared/land/coaster";
import { VillageMsg, VillageServerMsg } from "@caysonverse/shared/village/messages";
import { CAROUSEL_CYCLE_MS, CAROUSEL_SEATS } from "@caysonverse/shared/land/carousel";
import { WHEEL_N, WHEEL_STEP_MS, WHEEL_SEATS_PER, boardingSeatsOfWheel } from "@caysonverse/shared/land/wheel";
import { VillageCoaster, type CoasterHost } from "./villageCoaster";

const WHEEL_T0 = 1_900_000_000_000 - (1_900_000_000_000 % (WHEEL_STEP_MS * WHEEL_N));

const CAROUSEL_T0 = 1_900_000_000_000 - (1_900_000_000_000 % CAROUSEL_CYCLE_MS);

interface P {
  rideSeat: number;
  rideId: number;
  seatIndex: number;
  busSeat: number;
  fishSpot: number;
  area: string;
  x: number;
  z: number;
}
const newPlayer = (): P => ({ rideSeat: -1, rideId: 0, seatIndex: -1, busSeat: -1, fishSpot: -1, area: "park", x: -17, z: -46 });
const T0 = 1_900_000_000_000 - (1_900_000_000_000 % COASTER_CYCLE_MS);

function rig() {
  const players = new Map<string, P>();
  const sent: Array<{ sid: string; type: string; msg: unknown }> = [];
  const handlers = new Map<string, (c: Client, p: unknown) => void>();
  let now = T0 + 10_000;
  const clients = new Map<string, Client>();
  const client = (sid: string): Client => {
    let c = clients.get(sid);
    if (!c) {
      c = { sessionId: sid, send: (type: string, msg: unknown) => sent.push({ sid, type, msg }) } as unknown as Client;
      clients.set(sid, c);
    }
    return c;
  };
  const host: CoasterHost = {
    wallClock: () => now,
    player: (sid) => players.get(sid),
    players: () => players.entries(),
    clients: () => clients.values(),
    onMessage: (type, h) => handlers.set(type, h),
  };
  const coaster = new VillageCoaster(host);
  coaster.register();
  return {
    coaster,
    players,
    sent,
    add(sid: string) {
      players.set(sid, newPlayer());
      return client(sid);
    },
    send: (sid: string, type: string, payload: unknown = {}) => handlers.get(type)!(client(sid), payload),
    setNow: (t: number) => {
      now = t;
    },
  };
}

describe("VillageCoaster (server rules)", () => {
  it("gives the lowest free seat while boarding is open, and only one", () => {
    const r = rig();
    r.add("a");
    r.add("b");
    r.send("a", VillageMsg.RideBoard);
    r.send("b", VillageMsg.RideBoard);
    expect(r.players.get("a")!.rideSeat).toBe(0);
    expect(r.players.get("b")!.rideSeat).toBe(1);
    r.send("a", VillageMsg.RideBoard); // already aboard: nothing changes
    expect(r.players.get("a")!.rideSeat).toBe(0);
  });
  it("refuses outside the boarding window (unloading, gate, riding) and says why", () => {
    const r = rig();
    r.add("a");
    for (const t of [T0 + 1000, T0 + COASTER_DWELL_MS - 3000, T0 + COASTER_DWELL_MS + 5000]) {
      r.setNow(t);
      r.send("a", VillageMsg.RideBoard);
      expect(r.players.get("a")!.rideSeat).toBe(-1);
    }
    expect(r.sent.filter((s) => s.type === VillageServerMsg.RideNotice).every((s) => (s.msg as { reason: string }).reason === "closed")).toBe(true);
    expect(r.sent.length).toBe(3);
  });
  it("refuses a seated, bus or fishing player (busy) and a full train (full)", () => {
    const r = rig();
    r.add("sitter");
    r.players.get("sitter")!.seatIndex = 5;
    r.send("sitter", VillageMsg.RideBoard);
    expect(r.players.get("sitter")!.rideSeat).toBe(-1);
    expect((r.sent[0]!.msg as { reason: string }).reason).toBe("busy");
    for (let i = 0; i < COASTER_SEATS; i++) {
      r.add(`p${i}`);
      r.send(`p${i}`, VillageMsg.RideBoard);
    }
    r.add("late");
    r.send("late", VillageMsg.RideBoard);
    expect(r.players.get("late")!.rideSeat).toBe(-1);
    expect((r.sent.at(-1)!.msg as { reason: string }).reason).toBe("full");
    // seats are unique
    const seats = [...r.players.values()].map((p) => p.rideSeat).filter((s) => s >= 0);
    expect(new Set(seats).size).toBe(COASTER_SEATS);
  });
  it("boards only in the park, at the queue gate", () => {
    const r = rig();
    r.add("far");
    r.players.get("far")!.z = -120; // the plaza: out of reach
    r.send("far", VillageMsg.RideBoard);
    expect(r.players.get("far")!.rideSeat).toBe(-1);
    r.add("village");
    r.players.get("village")!.area = "village";
    r.send("village", VillageMsg.RideBoard);
    expect(r.players.get("village")!.rideSeat).toBe(-1);
  });
  it("a leave frees the seat for the next rider", () => {
    const r = rig();
    r.add("a");
    r.add("b");
    r.send("a", VillageMsg.RideBoard);
    r.send("a", VillageMsg.RideLeave);
    expect(r.players.get("a")!.rideSeat).toBe(-1);
    r.send("b", VillageMsg.RideBoard);
    expect(r.players.get("b")!.rideSeat).toBe(0);
  });
  it("the unload is the server's: riders stay through the lap and are put off when the next cycle begins", () => {
    const r = rig();
    r.add("a");
    r.send("a", VillageMsg.RideBoard);
    r.setNow(T0 + COASTER_DWELL_MS + 30_000); // mid-ride
    r.coaster.tick();
    expect(r.players.get("a")!.rideSeat).toBe(0);
    r.setNow(T0 + COASTER_CYCLE_MS - 500); // the train is rolling in
    r.coaster.tick();
    expect(r.players.get("a")!.rideSeat).toBe(0);
    r.setNow(T0 + COASTER_CYCLE_MS + 200); // the next cycle's unloading phase
    r.coaster.tick();
    expect(r.players.get("a")!.rideSeat).toBe(-1);
    void COASTER_UNLOAD_MS;
  });

  it("the carousel: its own pad, its own schedule and its own 24 seats, one ride at a time", () => {
    const r = rig();
    r.add("a");
    r.players.get("a")!.x = 110; // the carousel's pad (110, -119): the coaster's queue gate is far away
    r.players.get("a")!.z = -119;
    r.setNow(CAROUSEL_T0 + 10_000);
    r.send("a", VillageMsg.RideBoard, { ride: "coaster" });
    expect(r.players.get("a")!.rideSeat).toBe(-1); // not at the coaster's pad
    r.send("a", VillageMsg.RideBoard, { ride: "carousel" });
    expect(r.players.get("a")!.rideId).toBe(2);
    expect(r.players.get("a")!.rideSeat).toBe(0);
    r.send("a", VillageMsg.RideBoard, { ride: "carousel" }); // already aboard
    expect(r.players.get("a")!.rideSeat).toBe(0);
    for (let i = 1; i < CAROUSEL_SEATS; i++) {
      r.add(`c${i}`);
      r.players.get(`c${i}`)!.x = 110;
      r.players.get(`c${i}`)!.z = -119;
      r.send(`c${i}`, VillageMsg.RideBoard, { ride: "carousel" });
    }
    r.add("late");
    r.players.get("late")!.x = 110;
    r.players.get("late")!.z = -119;
    r.send("late", VillageMsg.RideBoard, { ride: "carousel" });
    expect(r.players.get("late")!.rideSeat).toBe(-1);
    // the unload at the end of the carousel's cycle
    r.setNow(CAROUSEL_T0 + CAROUSEL_CYCLE_MS + 100);
    r.coaster.tick();
    expect(r.players.get("a")!.rideSeat).toBe(-1);
    expect(r.players.get("a")!.rideId).toBe(0);
  });
  it("an unknown ride or the unbuilt wheel is refused", () => {
    const r = rig();
    r.add("a");
    r.send("a", VillageMsg.RideBoard, { ride: "teacups" });
    expect(r.players.get("a")!.rideSeat).toBe(-1);
    r.send("a", VillageMsg.RideBoard, { ride: "wheel" });
    expect(r.players.get("a")!.rideSeat).toBe(-1);
  });

  it("the wheel: a rider gets a seat of the bottom gondola, cannot get off aloft, and is put off after one revolution", () => {
    const r = rig();
    const a = r.add("a");
    const pa = r.players.get("a")!;
    pa.x = 211;
    pa.z = -134.5;
    r.setNow(WHEEL_T0 + 8000);
    r.send("a", VillageMsg.RideBoard, { ride: "wheel" });
    expect(pa.rideId).toBe(3);
    expect(boardingSeatsOfWheel(WHEEL_T0 + 8000)).toContain(pa.rideSeat);
    // four riders fill the gondola, the fifth gets "full" (the next gondola is not at the platform)
    for (const sid of ["b", "c", "d", "e"]) {
      r.add(sid);
      const p = r.players.get(sid)!;
      p.x = 211;
      p.z = -134.5;
      r.send(sid, VillageMsg.RideBoard, { ride: "wheel" });
    }
    const seated = [...r.players.values()].filter((p) => p.rideSeat >= 0);
    expect(seated.length).toBe(WHEEL_SEATS_PER);
    expect(new Set(seated.map((p) => Math.floor(p.rideSeat / WHEEL_SEATS_PER))).size).toBe(1);
    // aloft: the leave is refused with a notice
    r.setNow(WHEEL_T0 + 25_000);
    r.send("a", VillageMsg.RideLeave);
    expect(pa.rideSeat).toBeGreaterThanOrEqual(0);
    expect(r.sent.some((m) => m.sid === "a" && (m.msg as { reason?: string }).reason === "aloft")).toBe(true);
    // not put off by the next step, but by the same gondola's return
    r.setNow(WHEEL_T0 + WHEEL_STEP_MS * 3 + 5000);
    r.coaster.tick();
    expect(pa.rideSeat).toBeGreaterThanOrEqual(0);
    r.setNow(WHEEL_T0 + WHEEL_STEP_MS * WHEEL_N + 1000);
    r.coaster.tick();
    expect(pa.rideSeat).toBe(-1);
    void a;
  });
});
