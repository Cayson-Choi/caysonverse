import { describe, expect, it } from "vitest";
import { GATE_SPOTS, flagstoneRing, isOldGatePiece, victorianLampGeometry } from "./gateDress";

describe("gateDress", () => {
  it("cuts the old fountain, its shrubs and the topiaries, and nothing of the gate building", () => {
    const f = GATE_SPOTS.fountain;
    expect(isOldGatePiece(f.x + 0.5, 1.2, f.z, "LM_martgate_granite")).toBe(true);
    expect(isOldGatePiece(f.x, 1.5, f.z + 0.4, "M_glass")).toBe(true);
    expect(isOldGatePiece(f.x + 2.0, 0.2, f.z, "M_martgate_goods")).toBe(true);
    const p = GATE_SPOTS.planters[0]!;
    expect(isOldGatePiece(p.x, 1.4, p.z, "M_martgate_goods")).toBe(true);
    expect(isOldGatePiece(p.x, 1.8, p.z + 0.1, "LM_martgate_oak")).toBe(true);
    // the planter itself, the gate's walls and its glass stay
    expect(isOldGatePiece(p.x + 0.6, 0.4, p.z, "LM_martgate_granite")).toBe(false);
    expect(isOldGatePiece(-24, 2, 93.7, "LM_martgate_granite")).toBe(false);
    expect(isOldGatePiece(-17, 2, 93.5, "M_glass")).toBe(false);
  });

  it("builds the flagstones and the lamp at a sane size", () => {
    const flags = flagstoneRing(1.7, 2.5, 14, false);
    flags.computeBoundingBox();
    expect(flags.boundingBox!.max.y).toBeLessThan(0.07);
    expect(flags.boundingBox!.max.x).toBeLessThanOrEqual(2.5 + 1e-6);
    const lamp = victorianLampGeometry(false);
    lamp.computeBoundingBox();
    expect(lamp.boundingBox!.max.y).toBeGreaterThan(3.6);
    expect(lamp.boundingBox!.max.y).toBeLessThan(3.8);
    expect(lamp.getAttribute("position").count / 3).toBeLessThan(4000);
    expect(victorianLampGeometry(true).getAttribute("position").count).toBeLessThan(lamp.getAttribute("position").count);
  });
});

describe("gateDress: the wall's end planters and the far dressing", () => {
  it("cuts the two planters that stand half inside the castle wall's footing, not the turret base", () => {
    expect(isOldGatePiece(-14.9, 0.9, 95.7, "M_martgate_goods")).toBe(true);
    expect(isOldGatePiece(-33.1, 0.33, 95.5, "LM_martgate_granite")).toBe(true);
    expect(isOldGatePiece(-15.5, 1.38, 92.4, "LM_martgate_granite")).toBe(false);
    expect(isOldGatePiece(-24, 0.9, 95.7, "M_martgate_goods")).toBe(false);
  });
});

describe("farDressShown", () => {
  it("keeps the gate's landmark dressing far past the detail reach, with a hysteresis", async () => {
    const { farDressShown, FAR_DRESS_REACH } = await import("./lotsPrep");
    expect(farDressShown(100, false, "phone")).toBe(true);
    expect(farDressShown(FAR_DRESS_REACH.phone + 4, false, "phone")).toBe(false);
    expect(farDressShown(FAR_DRESS_REACH.phone + 4, true, "phone")).toBe(true);
    expect(farDressShown(FAR_DRESS_REACH.pc + 20, true, "pc")).toBe(false);
  });
});
