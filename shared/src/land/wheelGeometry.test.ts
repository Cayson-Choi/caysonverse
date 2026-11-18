import { describe, expect, it } from "vitest";
import { WHEEL_N, WHEEL_R, WHEEL_STEP, wheelBottomGondola, wheelAt } from "./wheel";
import {
  DECK_Y,
  GONDOLA_BOXES,
  PLATFORM,
  PLATFORM_BOXES,
  boxGap,
  capsuleBoxClearance,
  frameCapsules,
  gondolaBoxesAt,
  rotorCapsuleAt,
  rotorCapsules,
} from "./wheelGeometry";

const ANGLES = Array.from({ length: 120 }, (_, i) => (i / 120) * Math.PI * 2); // every 3 degrees: a whole revolution

describe("the wheel's solids never pass through a gondola (owner 2026-11-18)", () => {
  it("no spoke, cable, tie, lattice bar, rim or bulb comes within 10 cm of any gondola box, at any angle of the turn, for every gondola", () => {
    const caps = rotorCapsules();
    let worst = Infinity;
    let at = "";
    for (const angle of ANGLES) {
      for (let g = 0; g < WHEEL_N; g++) {
        const boxes = gondolaBoxesAt(g, angle, 0.12);
        const p = boxes[0]!; // (the gondola is near its pivot: only bars within 7 m of it matter)
        const cx = (p.min[0] + p.max[0]) / 2;
        const cy = p.min[1];
        for (const c of caps) {
          const cc = rotorCapsuleAt(c, angle);
          const mx = (cc.a[0] + cc.b[0]) / 2;
          const my = (cc.a[1] + cc.b[1]) / 2;
          if (Math.hypot(mx - cx, my - cy) > WHEEL_R * 0.55) continue; // a bar of 20 m could reach: its midpoint is within 7 m only for the long ones' near part, so be generous
          for (const b of boxes) {
            const d = capsuleBoxClearance(cc, b, 0.15);
            if (d < worst) {
              worst = d;
              at = `${c.name} vs ${b.name} g${g} angle ${((angle * 180) / Math.PI).toFixed(0)}`;
            }
          }
        }
      }
    }
    expect(worst, at).toBeGreaterThan(0.1);
  });
  it("the A-frames' legs keep 15 cm from every gondola at every angle", () => {
    let worst = Infinity;
    let at = "";
    for (const angle of ANGLES) {
      for (let g = 0; g < WHEEL_N; g++) {
        for (const b of gondolaBoxesAt(g, angle, 0.12)) {
          for (const leg of frameCapsules()) {
            const d = capsuleBoxClearance(leg, b, 0.1);
            if (d < worst) {
              worst = d;
              at = `${leg.name} vs ${b.name} g${g} angle ${((angle * 180) / Math.PI).toFixed(0)}`;
            }
          }
        }
      }
    }
    expect(worst, at).toBeGreaterThan(0.15);
  });
  it("the platform, its rails and its steps clear every gondola at every angle (the cabin passes beside the deck, never through it)", () => {
    let worst = Infinity;
    let at = "";
    for (let deg = 0; deg < 360; deg += 1) {
      const angle = (deg * Math.PI) / 180;
      for (let g = 0; g < WHEEL_N; g++) {
        for (const gb of gondolaBoxesAt(g, angle, 0.12)) {
          for (const pb of PLATFORM_BOXES) {
            const gap = boxGap(gb, pb);
            if (gap < worst) {
              worst = gap;
              at = `${pb.name} vs ${gb.name} g${g} angle ${deg}`;
            }
          }
        }
      }
    }
    expect(worst, at).toBeGreaterThan(0.05);
  });
  it("at the loading position the cabin floor is flush with the deck and a small gap away from it", () => {
    for (let c = 0; c < WHEEL_N; c++) {
      const st = wheelAt(c * 18_000 + 4000);
      const g = wheelBottomGondola(c);
      const boxes = gondolaBoxesAt(g, st.angle, 0);
      const plinth = boxes.find((b) => b.name === "plinth")!;
      const cabin = boxes.find((b) => b.name === "cabin")!;
            expect(Math.abs(cabin.min[1] - DECK_Y)).toBeLessThan(0.02);
      const gap = PLATFORM.z0 - plinth.max[2];
      expect(gap).toBeGreaterThan(0.1);
      expect(gap).toBeLessThan(0.35);
      // the platform spans the whole door (the cabin's width) so a rider steps straight across
      expect(PLATFORM.x0).toBeLessThan(cabin.min[0]);
      expect(PLATFORM.x1).toBeGreaterThan(cabin.max[0]);
    }
    expect(WHEEL_STEP).toBeCloseTo((Math.PI * 2) / WHEEL_N, 9);
    expect(GONDOLA_BOXES.length).toBe(4);
  });
});
