import { describe, expect, it } from "vitest";
import { GATE_LEAF_OPEN, GATE_PENNANT_TWIST, GATE_SPOTS, flagstoneRing, gateSpans, isOldGatePiece, spanPoint, victorianLampGeometry } from "./gateDress";
import { GATE_BOARD } from "./gateBoard";

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

describe("gateDress: the park is open", () => {
  it("cuts the belt barrier and the old '곧 문을 열어요' stand out of the gateway, not the leaves or the piers", () => {
    expect(isOldGatePiece(-24, 1.2, 94.17, "LM_martgate_render")).toBe(true); // the old letters
    expect(isOldGatePiece(-24, 1.3, 94.2, "LM_martgate_steel")).toBe(true); // the board's face
    expect(isOldGatePiece(-23, 0.8, 94.2, "LM_martgate_metal")).toBe(true); // a post
    expect(isOldGatePiece(-21.6, 0.88, 94.19, "LM_martgate_steel")).toBe(true); // a belt
    expect(isOldGatePiece(-26.85, 0.5, 94.2, "LM_martgate_metal")).toBe(true); // the last stanchion
    expect(isOldGatePiece(-24, 1.5, 94.8, "LM_martgate_steel")).toBe(false); // the leaves' line
    expect(isOldGatePiece(-27.5, 0.5, 94.2, "LM_martgate_granite")).toBe(false); // the pier's plinth
    expect(isOldGatePiece(-24, 2.4, 94.2, "LM_martgate_metal")).toBe(false);
  });
  it("the welcome board stands beside the way in, clear of the gateway and of the pier, and says the park is open", () => {
    expect(GATE_BOARD.lines.map((l) => l.text).join(" ")).toMatch(/어서 오세요/);
    expect(GATE_BOARD.lines.map((l) => l.text).join(" ")).not.toMatch(/곧|준비/);
    // its panel's ends (the look vector's normal is the panel's run)
    const [lx, lz] = GATE_BOARD.look;
    expect(Math.hypot(lx, lz)).toBeCloseTo(1, 3);
    for (const s of [-1, 1]) {
      const x = GATE_BOARD.x + s * (GATE_BOARD.width / 2 + 0.2) * -lz;
      const z = GATE_BOARD.z + s * (GATE_BOARD.width / 2 + 0.2) * lx;
      expect(x).toBeLessThan(-27.05); // outside the gateway (x -27 .. -21)
      expect(z).toBeLessThan(92.55); // in front of the pier's face (z 92.6)
    }
    expect(GATE_LEAF_OPEN).toBeGreaterThan(1.2);
    expect(GATE_LEAF_OPEN).toBeLessThan(Math.PI / 2);
    expect(GATE_PENNANT_TWIST).toBeGreaterThan(0.3);
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

describe("gate bunting", () => {
  it("every span ends on a lamp's finial or a bracket on the front face, sags, and fits the 80 flags", () => {
    const top = 3.9;
    const { spans, brackets } = gateSpans(top);
    const lampAt = (p: readonly number[]) => GATE_SPOTS.lamps.some((l) => Math.abs(l.x - p[0]!) < 0.05 && Math.abs(l.z - p[2]!) < 0.05 && Math.abs(p[1]! - top) < 1e-6);
    const bracketAt = (p: readonly number[]) => brackets.some((b) => Math.abs(b[0] - p[0]!) < 0.05 && Math.abs(b[1] - p[1]!) < 1e-6 && b[2] - p[2]! > 0.1 && b[2] - p[2]! < 0.5);
    for (const s of spans) {
      expect(lampAt(s.a) || bracketAt(s.a)).toBe(true);
      expect(lampAt(s.b) || bracketAt(s.b)).toBe(true);
      const mid = spanPoint(s, 0.5);
      expect(mid[1]).toBeLessThan((s.a[1] + s.b[1]) / 2 - 0.1); // sags
      for (const p of [s.a, s.b]) for (const tx of [-27.7, -20.3]) expect(Math.abs(p[0] - tx)).toBeGreaterThan(1); // never the towers' axes
    }
    expect(spans.reduce((n, s) => n + s.flags, 0)).toBeLessThanOrEqual(80);
  });
  it("cuts the old steel strings but not the tower trusses or the rails behind the wall", () => {
    expect(isOldGatePiece(-30, 6.3, 88.9, "LM_martgate_steel")).toBe(true);
    expect(isOldGatePiece(-17, 4.7, 86.5, "LM_martgate_steel")).toBe(true);
    expect(isOldGatePiece(-24, 10, 93.2, "LM_martgate_steel")).toBe(false);
    expect(isOldGatePiece(-24, 3.2, 98.4, "LM_martgate_steel")).toBe(false);
  });
});
