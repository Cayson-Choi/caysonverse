import { describe, expect, it } from "vitest";
import { VillageServerMsg } from "@caysonverse/shared/village/messages";
import { phaseAt, sunAt } from "@caysonverse/shared/village/sunClock";
import { bindVillageClock, createVillageClock, pinFromSearch } from "./villageClock";

/**
 * The village's clock: the server's time of day, not the device's (Task 7A). Every clock here is built on a fake
 * `now`, so "the device is 3 hours wrong" is just a different number.
 */

const HOUR = 3_600_000;
/** 2026-06-21 12:30 KST (the sun is high). */
const NOON = Date.parse("2026-06-21T12:30:00+09:00");

function device(startMs: number) {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => void (t += ms), set: (ms: number) => void (t = ms) };
}

describe("createVillageClock", () => {
  it("reads the device's own clock until the server has spoken", () => {
    const d = device(NOON);
    const c = createVillageClock(d.now);
    expect(c.synced()).toBe(false);
    expect(c.nowMs()).toBe(NOON);
    expect(c.offsetMs()).toBe(0);
  });

  it("keeps the offset to the server's clock: a device 3 h wrong still shows the server's time of day", () => {
    const d = device(NOON + 3 * HOUR); // the phone says 15:30 (or any hour: it is wrong)
    const c = createVillageClock(d.now);
    c.sync(NOON); // the server: it is 12:30 KST
    expect(c.synced()).toBe(true);
    expect(c.offsetMs()).toBe(-3 * HOUR);
    expect(c.nowMs()).toBe(NOON);
    d.advance(90_000); // a minute and a half later on the device ...
    expect(c.nowMs()).toBe(NOON + 90_000); // ... the village is a minute and a half later too
    // The sun over the village is the server's, not the device's.
    const shown = sunAt(c.nowMs()).elevationDeg;
    expect(shown).toBeCloseTo(sunAt(NOON + 90_000).elevationDeg, 9);
    expect(Math.abs(shown - sunAt(d.now()).elevationDeg)).toBeGreaterThan(5);
    expect(phaseAt(shown).day).toBe(1);
  });

  it("a device clock 3 h wrong in either direction, even a whole day off, shows the same village", () => {
    for (const wrong of [-3 * HOUR, 3 * HOUR, 24 * HOUR, -9 * HOUR]) {
      const d = device(NOON + wrong);
      const c = createVillageClock(d.now);
      c.sync(NOON);
      expect(c.nowMs(), `${wrong / HOUR} h`).toBe(NOON);
    }
  });

  it("the next ServerTime corrects drift, and a device clock that was changed between two of them", () => {
    const d = device(NOON);
    const c = createVillageClock(d.now);
    c.sync(NOON);
    d.advance(5 * 60_000);
    c.sync(NOON + 5 * 60_000 + 700); // the server's clock gained 0.7 s in five minutes
    expect(c.offsetMs()).toBe(700);
    expect(c.nowMs()).toBe(NOON + 5 * 60_000 + 700);
    d.set(NOON - 2 * HOUR); // the user changed the device's clock
    expect(Math.abs(c.nowMs() - NOON)).toBeGreaterThan(HOUR); // wrong until the next message ...
    c.sync(NOON + 10 * 60_000);
    expect(c.nowMs()).toBe(NOON + 10 * 60_000); // ... then right again
  });

  it("counts the syncs that moved the clock (a consumer snaps to a jump instead of easing across it); small drift is no jump", () => {
    const d = device(NOON);
    const c = createVillageClock(d.now);
    expect(c.jumps()).toBe(0);
    c.sync(NOON + 3 * HOUR); // the first message moved it by 3 h
    expect(c.jumps()).toBe(1);
    d.advance(300_000);
    c.sync(NOON + 3 * HOUR + 300_400); // 0.4 s of drift
    expect(c.jumps()).toBe(1);
  });

  it("ignores a time that is not a number", () => {
    const c = createVillageClock(device(NOON).now);
    c.sync(Number.NaN);
    c.sync(Number.POSITIVE_INFINITY);
    expect(c.synced()).toBe(false);
  });

  it("a pinned time (DEV ?time=) stands still and wins over the server; releasing it goes back", () => {
    const d = device(NOON);
    const c = createVillageClock(d.now);
    c.sync(NOON + HOUR);
    c.pin(Date.parse("2026-06-21T23:30:00+09:00"));
    d.advance(10 * HOUR);
    expect(c.nowMs()).toBe(Date.parse("2026-06-21T23:30:00+09:00"));
    c.pin(null);
    expect(c.nowMs()).toBe(NOON + 11 * HOUR);
  });
});

describe("pinFromSearch (?time= in DEV)", () => {
  it("reads Korean time unless the text names a zone; anything else is no pin", () => {
    expect(pinFromSearch("?time=2026-06-21T20:30")).toBe(Date.parse("2026-06-21T11:30:00Z"));
    expect(pinFromSearch("?x=1&time=2026-12-21T05:00")).toBe(Date.parse("2026-12-20T20:00:00Z"));
    expect(pinFromSearch("?time=2026-06-21T11:30Z")).toBe(Date.parse("2026-06-21T11:30:00Z"));
    expect(pinFromSearch("")).toBeNull();
    expect(pinFromSearch("?time=")).toBeNull();
    expect(pinFromSearch("?time=midnight")).toBeNull();
  });
});

describe("bindVillageClock: the room's ServerTime message", () => {
  function fakeRoom() {
    const handlers = new Map<string, (m: unknown) => void>();
    return {
      handlers,
      onMessage: (type: string, cb: (m: never) => void) => {
        handlers.set(type, cb as (m: unknown) => void);
        return () => void handlers.delete(type);
      },
    };
  }

  it("listens for ServerTime (the wire name), feeds the clock, and unbinds", () => {
    const d = device(NOON + 3 * HOUR);
    const c = createVillageClock(d.now);
    const room = fakeRoom();
    const off = bindVillageClock(room, c);
    expect([...room.handlers.keys()]).toEqual([VillageServerMsg.ServerTime]);
    room.handlers.get("ServerTime")!({ serverTimeMs: NOON });
    expect(c.nowMs()).toBe(NOON);
    off();
    expect(room.handlers.size).toBe(0);
  });

  it("drops a malformed message without touching the clock", () => {
    const c = createVillageClock(device(NOON).now);
    const room = fakeRoom();
    bindVillageClock(room, c);
    const handler = room.handlers.get("ServerTime")!;
    for (const bad of [undefined, null, {}, { serverTimeMs: "now" }, { serverTimeMs: Number.NaN }]) handler(bad);
    expect(c.synced()).toBe(false);
  });
});
