import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { VILLAGE_LAYOUT, ZONE_LETTER, zoneLetter } from "@caysonverse/shared/village/villageLayout";
import { FRAME_PROFILE, LOUNGE_PAINTING, ZONE_SIGN, frameGeometry, zoneSigns } from "./hallDressing";

describe("zone signs (owner 2026-11-20: 구역 A, B, C, D in order)", () => {
  it("the letters follow the walk: north wall west → east, then the east wall; ids never change", () => {
    expect(ZONE_LETTER).toEqual({ A: "A", C: "B", B: "C", E: "D" });
    expect(zoneLetter("E")).toBe("D");
    expect(zoneLetter("Z")).toBe("Z");
  });

  it("one sign per bank, in A, B, C, D order, west → east on the north wall and D on the east wall", () => {
    const s = zoneSigns();
    expect(s.map((z) => z.label)).toEqual(["A 구역", "B 구역", "C 구역", "D 구역"]);
    expect(s.map((z) => z.bank)).toEqual(["A", "C", "B", "E"]);
    expect(s[0]!.x).toBeLessThan(s[1]!.x);
    expect(s[1]!.x).toBeLessThan(s[2]!.x);
    const room = VILLAGE_LAYOUT.memorial.interior.room;
    for (const z of s.slice(0, 3)) expect(z.z).toBeGreaterThan(room.minZ); // in front of the north banks
    expect(s[3]!.x).toBeLessThan(room.maxX);
    expect(s[3]!.x).toBeGreaterThan(room.maxX - 0.5);
  });

  it("each sign sits on its bank's bulkhead, above the cubbies, below the 4.5 m ceiling, inside its bank's run", () => {
    for (const w of VILLAGE_LAYOUT.memorial.interior.cubbyWalls) {
      const z = zoneSigns().find((s) => s.bank === w.bank)!;
      const top = w.plinth + w.rows * (w.cell + w.frame) + w.frame;
      expect(z.y - ZONE_SIGN.h / 2).toBeGreaterThan(top + 0.06); // above the cornice
      expect(z.y + ZONE_SIGN.h / 2).toBeLessThan(4.2); // under the cove
      const run = w.cols * (w.cell + w.frame) + w.frame;
      expect(ZONE_SIGN.w).toBeLessThan(run);
    }
  });
});

describe("the lounge painting's frame", () => {
  it("keeps the painting's true aspect ratio (the 2048 x 1630 Met image)", () => {
    expect(LOUNGE_PAINTING.aspect).toBeCloseTo(2048 / 1630, 6);
  });

  it("the moulding is a closed sweep round the rectangle: 4 sides x (profile - 1) facets, all inside the outer box", () => {
    const g = frameGeometry(1.6, 1.3);
    const pos = g.getAttribute("position");
    expect(pos.count).toBe(4 * (FRAME_PROFILE.length - 1) * 6);
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      expect(Math.abs(v.x)).toBeLessThanOrEqual(0.8 + 1e-6);
      expect(Math.abs(v.y)).toBeLessThanOrEqual(0.65 + 1e-6);
      expect(v.z).toBeGreaterThanOrEqual(0);
      expect(v.z).toBeLessThan(0.1);
    }
    const c = g.getAttribute("color");
    for (let i = 0; i < c.count; i++) expect(c.getX(i)).toBeGreaterThan(0.02);
  });
});
