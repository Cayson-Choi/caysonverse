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
