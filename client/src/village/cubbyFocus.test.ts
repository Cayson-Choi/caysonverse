import { afterEach, describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT, cubbyAnchors } from "@caysonverse/shared/village/villageLayout";
import { MEMORIAL_COLLIDERS } from "@caysonverse/shared/village/generated/memorialColliders";
import { FOCUS_GLIDE_S, MIN_EYE_HEIGHT, cubbyFocusPose, cubbyFocusWeight, resetCubbyFocus, setCubbyFocus, stepCubbyFocus, type FocusPose } from "./cubbyFocus";

const anchors = cubbyAnchors(VILLAGE_LAYOUT);
const top = anchors.find((a) => a.bank === "A" && a.row === 7 && a.col === 3)!;
const mid = anchors.find((a) => a.bank === "A" && a.row === 3 && a.col === 3)!;
const east = anchors.find((a) => a.bank === "E" && a.row === 7 && a.col === 9)!;

/** Where `p` shows on the screen (NDC x, y) for a camera at the pose (vertical fov `fov`, aspect `aspect`). */
function ndc(pose: FocusPose, p: { x: number; y: number; z: number }, aspect: number, fov: number) {
  const fx = pose.tx - pose.ex, fy = pose.ty - pose.ey, fz = pose.tz - pose.ez;
  const fl = Math.hypot(fx, fy, fz);
  const f = [fx / fl, fy / fl, fz / fl];
  const r = [-f[2]!, 0, f[0]!]; // forward x up
  const rl = Math.hypot(r[0]!, r[2]!);
  r[0]! /= rl;
  r[2]! /= rl;
  const u = [r[1]! * f[2]! - r[2]! * f[1]!, r[2]! * f[0]! - r[0]! * f[2]!, r[0]! * f[1]! - r[1]! * f[0]!];
  const d = [p.x - pose.ex, p.y - pose.ey, p.z - pose.ez];
  const z = d[0]! * f[0]! + d[1]! * f[1]! + d[2]! * f[2]!;
  const t = Math.tan((fov * Math.PI) / 360);
  return { x: (d[0]! * r[0]! + d[2]! * r[2]!) / (z * t * aspect), y: (d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!) / (z * t) };
}

afterEach(() => resetCubbyFocus());

describe("cubbyFocusPose — the close-up frames ANY cubby at its own height (owner 2026-11-13: the top rows too)", () => {
  it("the eye is straight out from the cubby at the cubby's height (never under the floor margin), looking square into the wall", () => {
    for (const a of [top, mid, east]) {
      const p = cubbyFocusPose(a, 16 / 9, 50, { side: "right", frac: 0 });
      expect(p.ey).toBeCloseTo(Math.max(a.y, MIN_EYE_HEIGHT), 6);
      // out along the facing
      const out = { x: Math.sin(a.yaw), z: Math.cos(a.yaw) };
      const along = (p.ex - p.tx) * out.x + (p.ez - p.tz) * out.z;
      expect(along).toBeGreaterThan(0.7);
      expect(Math.abs((p.ex - p.tx) * out.z - (p.ez - p.tz) * out.x)).toBeLessThan(1e-9);
      const s = ndc(p, a, 16 / 9, 50);
      expect(s.x).toBeCloseTo(0, 6);
      expect(s.y).toBeCloseTo(0, 6);
    }
  });

  it("a top-row cubby is shown as large as a middle one", () => {
    const a = cubbyFocusPose(top, 16 / 9, 50, { side: "right", frac: 0.3 });
    const b = cubbyFocusPose(mid, 16 / 9, 50, { side: "right", frac: 0.3 });
    expect(Math.hypot(a.ex - a.tx, a.ez - a.tz)).toBeCloseTo(Math.hypot(b.ex - b.tx, b.ez - b.tz), 6);
  });

  it("with the card on the right (PC) the cubby sits in the middle of the free left part", () => {
    const p = cubbyFocusPose(top, 16 / 9, 50, { side: "right", frac: 0.3 });
    const s = ndc(p, top, 16 / 9, 50);
    expect(s.x).toBeCloseTo(-0.3, 4);
    expect(s.y).toBeCloseTo(0, 4);
  });

  it("with the sheet at the bottom (a phone upright) the cubby sits in the middle of the free top part, and fits across", () => {
    const aspect = 390 / 844;
    const p = cubbyFocusPose(top, aspect, 50, { side: "bottom", frac: 0.45 });
    const s = ndc(p, top, aspect, 50);
    expect(s.x).toBeCloseTo(0, 4);
    expect(s.y).toBeCloseTo(0.45, 4);
    // the cubby's own width fits well inside the screen's width
    const w = VILLAGE_LAYOUT.memorial.interior.cubbyWalls.find((c) => c.bank === "A")!;
    const edge = { x: top.x + w.along.x * (w.cell / 2), y: top.y, z: top.z + w.along.z * (w.cell / 2) };
    expect(Math.abs(ndc(p, edge, aspect, 50).x)).toBeLessThan(0.75);
  });
});

describe("cubbyFocusPose — the corner columns (review 2026-11-15 round 5: B c13 put the eye in zone E's bank)", () => {
  it("zone B column 13, all 8 rows, PC 1280x720 and phone landscape: the eye stays clear of zone E's bank and the cubby is framed", () => {
    const eBank = MEMORIAL_COLLIDERS.find((b) => b.minX === 307.11)!; // col__cubby_e
    for (const [aspect, frac] of [[1280 / 720, 0.33], [844 / 390, 0.5], [932 / 430, 0.46]] as const) {
      for (let row = 0; row < 8; row++) {
        const a = anchors.find((x) => x.bank === "B" && x.row === row && x.col === 13)!;
        const p = cubbyFocusPose(a, aspect, 50, { side: "right", frac });
        expect(p.ex, a.id).toBeLessThan(eBank.minX - 0.2);
        const s = ndc(p, a, aspect, 50);
        expect(s.x, a.id).toBeCloseTo(-frac, 2);
        expect(s.y, a.id).toBeCloseTo(0, 2);
      }
    }
  });
});

describe("the glide", () => {
  it("eases in over the glide time, out when closed, and is nothing when no cubby is looked at", () => {
    const out: FocusPose = { ex: 0, ey: 0, ez: 0, tx: 0, ty: 0, tz: 0 };
    expect(stepCubbyFocus(0.016, 1.5, 50, out)).toBe(0);
    setCubbyFocus(top);
    let w = 0;
    for (let t = 0; t < FOCUS_GLIDE_S + 0.05; t += 0.05) w = stepCubbyFocus(0.05, 1.5, 50, out);
    expect(w).toBe(1);
    expect(cubbyFocusWeight()).toBe(1);
    expect(out.ey).toBeCloseTo(top.y, 6);
    setCubbyFocus(null);
    w = stepCubbyFocus(0.05, 1.5, 50, out);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1);
    for (let t = 0; t < FOCUS_GLIDE_S + 0.05; t += 0.05) w = stepCubbyFocus(0.05, 1.5, 50, out);
    expect(w).toBe(0);
  });

  it("moving to another row while open slides the close-up there", () => {
    const out: FocusPose = { ex: 0, ey: 0, ez: 0, tx: 0, ty: 0, tz: 0 };
    setCubbyFocus(mid);
    for (let i = 0; i < 20; i++) stepCubbyFocus(0.05, 1.5, 50, out);
    setCubbyFocus(top);
    stepCubbyFocus(0.05, 1.5, 50, out);
    expect(out.ey).toBeGreaterThan(mid.y);
    expect(out.ey).toBeLessThan(top.y);
    for (let i = 0; i < 60; i++) stepCubbyFocus(0.05, 1.5, 50, out);
    expect(out.ey).toBeCloseTo(top.y, 3);
  });
});

/** Screens the close-up must work on: PC with the side card, phones upright with the bottom sheet (its share as CubbyView measures it, up to 0.6). */
const SCREENS = [
  { name: "pc", aspect: 16 / 9, inset: { side: "right" as const, frac: 0.3 } },
  { name: "pc-narrow", aspect: 1.3, inset: { side: "right" as const, frac: 0.38 } },
  { name: "phone45", aspect: 390 / 844, inset: { side: "bottom" as const, frac: 0.45 } },
  { name: "phone60", aspect: 390 / 844, inset: { side: "bottom" as const, frac: 0.6 } },
  // review 2026-11-15 round 5: zone B's last column put the eye inside zone E's bank at these
  { name: "pc1280", aspect: 1280 / 720, inset: { side: "right" as const, frac: 0.33 } },
  { name: "pc1366", aspect: 1366 / 768, inset: { side: "right" as const, frac: 0.31 } },
  { name: "pc1920", aspect: 1920 / 1080, inset: { side: "right" as const, frac: 0.22 } },
  { name: "phone-land844", aspect: 844 / 390, inset: { side: "right" as const, frac: 0.5 } },
  { name: "phone-land932", aspect: 932 / 430, inset: { side: "right" as const, frac: 0.46 } },
  { name: "phone-land-max", aspect: 844 / 390, inset: { side: "right" as const, frac: 0.6 } },
];

describe("cubbyFocusPose — every row of every bank, PC and phone (review 2026-11-15: the bottom rows put the phone camera under the floor)", () => {
  const furniture = MEMORIAL_COLLIDERS.filter((b) => Math.max(b.maxX - b.minX, b.maxZ - b.minZ) < 5);
  // the walls and the cubby banks (A, B, E) and the niche: solid at every height
  const solid = MEMORIAL_COLLIDERS.filter((b) => !furniture.includes(b));
  const room = VILLAGE_LAYOUT.memorial.interior.room;
  for (const scr of SCREENS) {
    it(`${scr.name}: all 416 cubbies — eye above the floor margin and at or above the cubby, in the room, out of the furniture, the cubby in the middle of the free part`, () => {
      expect(anchors).toHaveLength(416);
      for (const a of anchors) {
        const p = cubbyFocusPose(a, scr.aspect, 50, scr.inset);
        expect(p.ey, a.id).toBeGreaterThanOrEqual(MIN_EYE_HEIGHT - 1e-9);
        expect(p.ey, a.id).toBeGreaterThanOrEqual(a.y - 1e-9);
        expect(p.ey, a.id).toBeLessThan(VILLAGE_LAYOUT.memorial.interior.ceilingHeight - 0.5);
        expect(p.ex > room.minX && p.ex < room.maxX && p.ez > room.minZ && p.ez < room.maxZ, a.id).toBe(true);
        const inside = furniture.some((b) => p.ex > b.minX && p.ex < b.maxX && p.ez > b.minZ && p.ez < b.maxZ);
        // clear of every footprint, or (no clear spot) high enough to look over it
        expect(!inside || p.ey >= 1.3, a.id).toBe(true);
        // never in or within 0.2 m of a wall or a cubby bank (another bank's cubbies in front of the lens)
        const nearSolid = solid.find((b) => p.ex > b.minX - 0.2 && p.ex < b.maxX + 0.2 && p.ez > b.minZ - 0.2 && p.ez < b.maxZ + 0.2);
        expect(nearSolid, `${a.id} eye (${p.ex.toFixed(2)}, ${p.ez.toFixed(2)})`).toBeUndefined();
        const s = ndc(p, a, scr.aspect, 50);
        const cx = scr.inset.side === "right" ? -scr.inset.frac : 0;
        const cy = scr.inset.side === "bottom" ? scr.inset.frac : 0;
        expect(Math.abs(s.x - cx), a.id).toBeLessThan(0.02);
        expect(Math.abs(s.y - cy), a.id).toBeLessThan(0.02);
      }
    });
  }

  it("each row 0..7 of banks A, B and E on a phone: the bottom row looks down from above the floor, the top row straight across", () => {
    for (const bank of ["A", "B", "E"] as const) {
      for (let row = 0; row < 8; row++) {
        const a = anchors.find((x) => x.bank === bank && x.row === row && x.col === 4)!;
        const p = cubbyFocusPose(a, 390 / 844, 50, { side: "bottom", frac: 0.45 });
        expect(p.ey, a.id).toBeCloseTo(Math.max(a.y, MIN_EYE_HEIGHT), 6);
        expect(p.ty, `${a.id} looks down a little to lift the cubby above the sheet`).toBeLessThan(p.ey);
      }
    }
  });

  it("the east bench and the letter table no longer hold the phone camera (E r0-r1 c6-c11, A c2-c6 at a 0.6 sheet)", () => {
    const bench = MEMORIAL_COLLIDERS.find((b) => b.minX === 304.64 && b.minZ === -2.9)!;
    expect(bench.minX).toBeCloseTo(304.64, 2); // col__bench_east
    for (const a of anchors.filter((x) => (x.bank === "E" && x.row <= 1 && x.col >= 6 && x.col <= 11) || (x.bank === "A" && x.col >= 2 && x.col <= 6))) {
      for (const frac of [0.45, 0.6]) {
        const p = cubbyFocusPose(a, 390 / 844, 50, { side: "bottom", frac });
        const inBench = p.ex > bench.minX && p.ex < bench.maxX && p.ez > bench.minZ && p.ez < bench.maxZ;
        const inTable = p.ex > 293.4 && p.ex < 295.4 && p.ez > -3.35 && p.ez < -2.55;
        expect(inBench || inTable, a.id).toBe(false);
      }
    }
  });
});
