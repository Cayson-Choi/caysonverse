import { afterEach, describe, expect, it } from "vitest";
import { CANDLE_BURN_MS, VillageServerMsg } from "@caysonverse/shared/village/messages";
import { setLocalArea } from "./villageArea";
import { bindHallCandles, burningCandles, clearCandles, isCandleBurning, noteCandleLit, noteCandleOut, pruneCandles, subscribeCandles } from "./hallCandles";

afterEach(() => clearCandles());

describe("hallCandles — a lit candle burns an hour on every client in the hall (server-kept since 2026-11-14)", () => {
  it("burns an hour from when it was lit, then goes out", () => {
    noteCandleLit("n_3_10", "케이슨", 1000);
    expect(isCandleBurning("n_3_10", 1000 + CANDLE_BURN_MS - 1)).toBe(true);
    expect(isCandleBurning("n_3_10", 1000 + CANDLE_BURN_MS)).toBe(false);
    expect(pruneCandles(1000 + CANDLE_BURN_MS - 1)).toBe(false);
    expect(burningCandles().size).toBe(1);
    expect(pruneCandles(1000 + CANDLE_BURN_MS)).toBe(true);
    expect(burningCandles().size).toBe(0);
    expect(CANDLE_BURN_MS).toBe(3_600_000);
  });

  it("a candle lit 32 minutes ago (as the server says) has 28 minutes left", () => {
    noteCandleLit("c", "케이슨", 10_000_000, 32 * 60_000);
    expect(burningCandles().get("c")).toEqual({ at: 10_000_000 - 32 * 60_000, by: "케이슨", mine: false });
    expect(isCandleBurning("c", 10_000_000 + 28 * 60_000 - 1)).toBe(true);
    expect(isCandleBurning("c", 10_000_000 + 28 * 60_000)).toBe(false);
  });

  it("a later word about the same cubby replaces it; listeners hear every change", () => {
    let calls = 0;
    const off = subscribeCandles(() => (calls += 1));
    noteCandleLit("e_0_5", "밥이", 0);
    noteCandleLit("e_0_5", "캐럴", 50_000);
    expect(isCandleBurning("e_0_5", 100_000)).toBe(true);
    expect(burningCandles().get("e_0_5")).toEqual({ at: 50_000, by: "캐럴", mine: false });
    clearCandles();
    expect(calls).toBe(3);
    off();
  });

  it("the room binding takes CandleLit and CandleState and ignores a malformed one", () => {
    const handlers = new Map<string, (m: unknown) => void>();
    const room = {
      onMessage<T>(type: string, cb: (m: T) => void) {
        handlers.set(type, cb as (m: unknown) => void);
        return () => handlers.delete(type);
      },
    };
    const off = bindHallCandles(room);
    const h = handlers.get(VillageServerMsg.CandleLit)!;
    h({ cubby: "n_0_0", by: "케이슨" });
    h({ cubby: 5 });
    h(null);
    h({ cubby: "" });
    expect([...burningCandles().keys()]).toEqual(["n_0_0"]);
    const st = handlers.get(VillageServerMsg.CandleState)!;
    st({ candles: [{ cubby: "M1-A-r3-c11", by: "밥이", agoMs: 60_000 }, { cubby: 3 }] });
    expect([...burningCandles().keys()]).toEqual(["M1-A-r3-c11"]); // the list replaces what was there
    st({ nope: 1 });
    expect(burningCandles().size).toBe(1);
    off();
    expect(handlers.size).toBe(0);
  });
});

describe("put out (owner 2026-11-20): CandleOut, and which candles are this visitor's own", () => {
  it("a CandleLit with our session id is ours, another's is not; CandleState's mine is kept; CandleOut forgets it", () => {
    const handlers = new Map<string, (m: unknown) => void>();
    const room = {
      sessionId: "me",
      onMessage<T>(type: string, cb: (m: T) => void) {
        handlers.set(type, cb as (m: unknown) => void);
        return () => handlers.delete(type);
      },
    };
    const off = bindHallCandles(room);
    handlers.get(VillageServerMsg.CandleLit)!({ cubby: "a", by: "나", agoMs: 0, sid: "me" });
    handlers.get(VillageServerMsg.CandleLit)!({ cubby: "b", by: "너", agoMs: 0, sid: "you" });
    handlers.get(VillageServerMsg.CandleLit)!({ cubby: "c", by: "옛", agoMs: 0 }); // an old server: no sid
    expect(burningCandles().get("a")?.mine).toBe(true);
    expect(burningCandles().get("b")?.mine).toBe(false);
    expect(burningCandles().get("c")?.mine).toBe(false);
    handlers.get(VillageServerMsg.CandleState)!({ candles: [{ cubby: "a", by: "나", agoMs: 5, mine: true }, { cubby: "b", by: "너", agoMs: 5 }] });
    expect(burningCandles().get("a")?.mine).toBe(true);
    expect(burningCandles().get("b")?.mine).toBe(false);
    let calls = 0;
    const offSub = subscribeCandles(() => (calls += 1));
    handlers.get(VillageServerMsg.CandleOut)!({ cubby: "a", by: "나" });
    handlers.get(VillageServerMsg.CandleOut)!({ cubby: 3 });
    handlers.get(VillageServerMsg.CandleOut)!(null);
    expect([...burningCandles().keys()]).toEqual(["b"]);
    expect(noteCandleOut("zzz")).toBe(false); // nothing burned there: no notice
    expect(calls).toBe(1);
    offSub();
    off();
    expect(handlers.size).toBe(0);
  });
});

describe("the candles go out on this client when it leaves the hall (not on a scene remount)", () => {
  it("leaving the hall clears them; walking in keeps what the server just said", () => {
    setLocalArea("village");
    noteCandleLit("c", "케이슨", 0);
    setLocalArea("hall"); // the CandleState came with the door, just before the area flipped
    expect(burningCandles().size).toBe(1);
    setLocalArea("village");
    expect(burningCandles().size).toBe(0);
  });
});

describe("showInstances — candle meshes with nothing burning are hidden (final fix)", () => {
  it("count 0 hides the mesh and uploads nothing; a candle shows it; going out uploads once more", async () => {
    const { showInstances } = await import("./hallCandles");
    const m = { count: 0, visible: true, instanceMatrix: { needsUpdate: false } };
    showInstances(m, 0);
    expect(m).toEqual({ count: 0, visible: false, instanceMatrix: { needsUpdate: false } });
    showInstances(m, 2);
    expect(m.visible).toBe(true);
    expect(m.count).toBe(2);
    expect(m.instanceMatrix.needsUpdate).toBe(true);
    m.instanceMatrix.needsUpdate = false;
    showInstances(m, 0);
    expect(m.visible).toBe(false);
    expect(m.instanceMatrix.needsUpdate).toBe(true);
  });
});
