import { describe, it, expect } from "vitest";
import { MessageType } from "../messages";
import { CANDLE_BURN_MS, CANDLE_OUT_RATE, CANDLE_RATE, CANDLE_REACH_M, SERVER_TIME_INTERVAL_MS, VillageMsg, VillageServerMsg } from "./messages";

describe("VillageMsg", () => {
  it("keeps village action wire names stable and collision-free", () => {
    expect(VillageMsg).toEqual({
      UseDoor: "UseDoor",
      UseStair: "UseStair",
      LightCandle: "LightCandle",
      PutOutCandle: "PutOutCandle",
      FishingRentRod: "FishingRentRod",
      FishingReturnRod: "FishingReturnRod",
      FishingSit: "FishingSit",
      FishingCast: "FishingCast",
      FishingStrike: "FishingStrike",
      FishingHold: "FishingHold",
      FishingStand: "FishingStand",
      FishingBoardRequest: "FishingBoardRequest",
      Keypad: "Keypad",
      RideBoard: "RideBoard",
      RideLeave: "RideLeave",
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
      CandleState: "CandleState",
      CandleOut: "CandleOut",
      FishingState: "FishingState",
      FishingRejected: "FishingRejected",
      FishingTrophy: "FishingTrophy",
      FishingBoard: "FishingBoard",
      KeypadResult: "KeypadResult",
      RideNotice: "RideNotice",
    });
    const others = new Set<string>([
      ...Object.values(MessageType),
      ...Object.values(VillageMsg),
    ]);
    for (const v of Object.values(VillageServerMsg)) expect(others.has(v), v).toBe(false);
    expect(SERVER_TIME_INTERVAL_MS).toBe(30_000);
  });

  it("candles: from anywhere in the hall (the close-up), one per 5 seconds, burning an hour (owner 2026-11-13)", () => {
    expect(CANDLE_REACH_M).toBe(20);
    expect(CANDLE_RATE).toEqual({ count: 1, windowMs: 5000 });
    expect(CANDLE_BURN_MS).toBe(3_600_000);
    // putting one out (owner 2026-11-20) has its own small cap, so "켜고 바로 끄기" works but a flood does not
    expect(CANDLE_OUT_RATE).toEqual({ count: 2, windowMs: 5000 });
  });
});
