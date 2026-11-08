import { afterEach, describe, expect, it } from "vitest";
import { CANDLE_BURN_MS, VillageServerMsg } from "@caysonverse/shared/village/messages";
import { bindHallCandles, burningCandles, clearCandles, isCandleBurning, noteCandleLit, pruneCandles, subscribeCandles } from "./hallCandles";

afterEach(() => clearCandles());

describe("hallCandles — a lit candle burns 60 s on every client in the hall (Task 9)", () => {
  it("burns from the moment it was heard for 60 s, then goes out", () => {
    noteCandleLit("n_3_10", "케이슨", 1000);
    expect(isCandleBurning("n_3_10", 1000 + CANDLE_BURN_MS - 1)).toBe(true);
    expect(isCandleBurning("n_3_10", 1000 + CANDLE_BURN_MS)).toBe(false);
    expect(pruneCandles(1000 + CANDLE_BURN_MS - 1)).toBe(false);
    expect(burningCandles().size).toBe(1);
    expect(pruneCandles(1000 + CANDLE_BURN_MS)).toBe(true);
    expect(burningCandles().size).toBe(0);
    expect(CANDLE_BURN_MS).toBe(60_000);
  });

  it("lit again while burning, it starts the 60 s over; listeners hear every change", () => {
    let calls = 0;
    const off = subscribeCandles(() => (calls += 1));
    noteCandleLit("e_0_5", "밥이", 0);
    noteCandleLit("e_0_5", "캐럴", 50_000);
    expect(isCandleBurning("e_0_5", 100_000)).toBe(true);
    expect(burningCandles().get("e_0_5")).toEqual({ at: 50_000, by: "캐럴" });
    clearCandles();
    expect(calls).toBe(3);
    off();
  });

  it("the room binding takes CandleLit and ignores a malformed one", () => {
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
    off();
    expect(handlers.size).toBe(0);
  });
});
