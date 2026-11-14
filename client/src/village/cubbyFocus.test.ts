import { afterEach, describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT, cubbyAnchors } from "@caysonverse/shared/village/villageLayout";
import { FOCUS_GLIDE_S, cubbyFocusPose, cubbyFocusWeight, resetCubbyFocus, setCubbyFocus, stepCubbyFocus, type FocusPose } from "./cubbyFocus";

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
  it("the eye is straight out from the cubby at the cubby's height, looking square into the wall", () => {
    for (const a of [top, mid, east]) {
      const p = cubbyFocusPose(a, 16 / 9, 50, { side: "right", frac: 0 });
      expect(p.ey).toBeCloseTo(a.y, 6);
      expect(p.ty).toBeCloseTo(a.y, 6);
      // out along the facing
      const out = { x: Math.sin(a.yaw), z: Math.cos(a.yaw) };
      const along = (p.ex - p.tx) * out.x + (p.ez - p.tz) * out.z;
      expect(along).toBeGreaterThan(0.7);
      expect(Math.abs((p.ex - p.tx) * out.z - (p.ez - p.tz) * out.x)).toBeLessThan(1e-9);
      expect(ndc(p, a, 16 / 9, 50).x).toBeCloseTo(0, 6);
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
    expect(Math.abs(ndc(p, edge, aspect, 50).x)).toBeLessThan(0.6);
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
