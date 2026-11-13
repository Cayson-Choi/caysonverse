import { describe, it, expect } from "vitest";
import { MessageType } from "../messages";
import { CANDLE_BURN_MS, CANDLE_RATE, CANDLE_REACH_M, SERVER_TIME_INTERVAL_MS, VillageMsg, VillageServerMsg } from "./messages";

describe("VillageMsg", () => {
  it("keeps village action wire names stable and collision-free", () => {
    expect(VillageMsg).toEqual({
      UseDoor: "UseDoor",
      LightCandle: "LightCandle",
      FishingRentRod: "FishingRentRod",
      FishingCast: "FishingCast",
      FishingReel: "FishingReel",
      Keypad: "Keypad",
    });
    const values = Object.values(VillageMsg);
    expect(new Set(values).size).toBe(values.length);
    // A village client also hears the world messages (VillageRoom is a PlayerRoom).
    const others = new Set<string>(Object.values(MessageType));
    for (const v of values) expect(others.has(v), v).toBe(false);
  });

  it("the server's clock goes out as ServerTime (server → client), a name no other family uses, every 5 minutes", () => {
    expect(VillageServerMsg).toEqual({
      ServerTime: "ServerTime",
      CandleLit: "CandleLit",
      FishingState: "FishingState",
      FishingResult: "FishingResult",
      FishingRejected: "FishingRejected",
      KeypadResult: "KeypadResult",
    });
    const others = new Set<string>([
      ...Object.values(MessageType),
      ...Object.values(VillageMsg),
    ]);
    for (const v of Object.values(VillageServerMsg)) expect(others.has(v), v).toBe(false);
    expect(SERVER_TIME_INTERVAL_MS).toBe(300_000);
  });

  it("candles (Task 9): 1.5 m from the cubby, one per 5 seconds, burning 60 seconds", () => {
    expect(CANDLE_REACH_M).toBe(1.5);
    expect(CANDLE_RATE).toEqual({ count: 1, windowMs: 5000 });
    expect(CANDLE_BURN_MS).toBe(60_000);
  });
});
