import { describe, expect, it } from "vitest";
import { FISHING_SPOTS } from "@caysonverse/shared/village/fishing";
import { VillageServerMsg } from "@caysonverse/shared/village/messages";
import { EMPTY_FISHING_STATE, fishingPhaseLabel, fishingRejectLabel, fishingResultLabel, parseFishingResult, parseFishingState } from "./fishingUi";

describe("fishing UI wire guards", () => {
  it("keeps the kiosk and pond anchors inside the walkable east edge", () => {
    expect(FISHING_SPOTS.rental.x).toBeLessThanOrEqual(95);
    expect(FISHING_SPOTS.pond.x).toBeLessThanOrEqual(95);
    expect(FISHING_SPOTS.rental.z).toBe(FISHING_SPOTS.pond.z);
  });

  it("accepts a server state and rejects malformed client-shaped data", () => {
    expect(parseFishingState({ ...EMPTY_FISHING_STATE, phase: "waiting", rodRented: true, castId: 2, serverNowMs: 100 })).toMatchObject({
      phase: "waiting",
      castId: 2,
    });
    expect(parseFishingState({ ...EMPTY_FISHING_STATE, phase: "cheat" })).toBeNull();
    expect(parseFishingState({ ...EMPTY_FISHING_STATE, castId: 1.2 })).toBeNull();
    expect(parseFishingState({ ...EMPTY_FISHING_STATE, catch: { kind: "giant_catfish", label: "메기", lengthCm: 80, caughtAt: 100 } })).not.toBeNull();
  });

  it("shows the submerged bobber and catch result only when the server event says so", () => {
    const result = parseFishingResult({
      phase: "ready",
      rodRented: true,
      castId: 4,
      lastResult: "caught",
      catch: { kind: "koi", label: "비단잉어", lengthCm: 32, caughtAt: 800 },
      serverNowMs: 800,
      event: "caught",
    });
    expect(result?.event).toBe("caught");
    expect(fishingResultLabel(result!)).toBe("비단잉어 32cm를 낚았어요!");
    expect(parseFishingResult({ ...EMPTY_FISHING_STATE, event: "rod_rented" })).toBeNull();
    expect(fishingPhaseLabel("submerged")).toContain("당겨요");
  });

  it("maps server rejection codes to a safe Korean notice", () => {
    expect(fishingRejectLabel({ reason: "not_near_pond" })).toContain("연못");
    expect(fishingRejectLabel({ reason: "bite_expired" })).toContain("헛탕");
    expect(fishingRejectLabel({ reason: "secret" })).toContain("처리하지");
    expect(VillageServerMsg.FishingState).toBe("FishingState");
  });
});
