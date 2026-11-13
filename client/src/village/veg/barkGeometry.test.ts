import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { BARK_STYLE, barkColour, barkLight, barkPixels, forkLimb, pointedEnd, skeletonBark, twigBark } from "./barkGeometry";
import { YOUNG_SPECS } from "./treeSkeleton";
import { bakedBarkIndex } from "./bakedBark";
import { GREEN_GROW, growBroadleaf } from "./treeCrown";
import { PLAZA_CHERRY_SPECS, VILLAGE_TREE_SPECS, WILLOW_SPECS, treeSkeleton } from "./treeSkeleton";
import type { Vec3 } from "./vegLod";

const SUN: Vec3 = [0.5, 0.7, 0.5];
const greenSk = treeSkeleton(VILLAGE_TREE_SPECS.find((s) => s.kind === "green")!);

describe("runtime bark: one bark from the ground to the twig tips", () => {
  it("the colour follows the radius alone: a twig leaving a limb has the limb's colour there", () => {
    for (const style of Object.values(BARK_STYLE)) {
      const a = barkColour(style, 0.02);
      const b = barkColour(style, 0.0201);
      for (let k = 0; k < 3; k++) expect(Math.abs(a[k]! - b[k]!)).toBeLessThan(0.002);
      // the thick end is all old bark
      expect(barkColour(style, 0.2)).toEqual(barkColour(style, 0.06));
    }
  });

  it("the light is one function of the place: darker inside the crown and at the foot", () => {
    const sk = greenSk;
    const light = barkLight(sk.crownC, sk.R, sk.base[1], SUN);
    expect(light(sk.crownC, [1, 0, 0])).toBeLessThan(light([sk.base[0], sk.base[1] + 1.2, sk.base[2]], [1, 0, 0]));
    expect(light([sk.base[0], sk.base[1] + 0.05, sk.base[2]], [1, 0, 0])).toBeLessThan(light([sk.base[0], sk.base[1] + 1, sk.base[2]], [1, 0, 0]));
  });

  it("a tree's bark covers its whole skeleton, closed at the tips, with texture coordinates", () => {
    const sk = treeSkeleton(WILLOW_SPECS[0]!);
    const g = skeletonBark(sk, false, barkLight(sk.crownC, sk.R, sk.base[1], SUN));
    g.computeBoundingBox();
    const bb = g.boundingBox!.expandByScalar(1e-4);
    for (const b of [sk.trunk, ...sk.limbs, ...sk.sides]) for (const p of b.pts) expect(bb.containsPoint(new Vector3(p[0], p[1], p[2]))).toBe(true);
    expect(g.getAttribute("uv")).toBeDefined();
    const tip = pointedEnd(sk.sides[0]!);
    expect(tip.radii[tip.radii.length - 1]).toBeLessThanOrEqual(0.002);
    // the phone's is lighter
    const low = skeletonBark(sk, true, barkLight(sk.crownC, sk.R, sk.base[1], SUN));
    expect(low.index!.count).toBeLessThan(g.index!.count);
  });

  it("twigs are drawn in the same bark", () => {
    const crown = growBroadleaf(greenSk, GREEN_GROW, "green");
    const g = twigBark(crown.twigs, BARK_STYLE.green, false, barkLight(greenSk.crownC, greenSk.R, greenSk.base[1], SUN));
    expect(g.getAttribute("position").count).toBeGreaterThan(crown.twigs.length * 6);
  });

  it("every pattern's texture averages the same (the colours keep their calibration)", () => {
    for (const pattern of ["cherry", "plates", "willow", "smooth", "plum"] as const) {
      const px = barkPixels(pattern);
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += px[i]!;
      expect(sum / (px.length / 4) / 255).toBeCloseTo(0.78, 1);
    }
  });

  it("the file's bark is cut only near a replayed tree", () => {
    const sk = treeSkeleton(PLAZA_CHERRY_SPECS[0]!);
    const tri = (c: Vec3) => [c[0], c[1], c[2], c[0] + 0.01, c[1], c[2], c[0], c[1] + 0.01, c[2]];
    const on = sk.limbs[0]!.pts[1]!;
    const off: Vec3 = [sk.base[0] + 30, 1, sk.base[2]];
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array([...tri(on), ...tri(off)]), 3));
    const cut = bakedBarkIndex(g, [sk])!;
    expect(cut.dropped).toBe(1);
    expect([...cut.index]).toEqual([3, 4, 5]);
    expect(bakedBarkIndex(g, [treeSkeleton(WILLOW_SPECS[0]!)])).toBeNull();
  });

  it("every limb starts on the trunk's last ring (below the fork), runs on up its line, then onto the limb's own line", () => {
    for (const spec of [WILLOW_SPECS[0]!, VILLAGE_TREE_SPECS[0]!, YOUNG_SPECS[3]!]) {
      const sk = treeSkeleton(spec);
      const top = sk.trunk.pts[3]!;
      const a = sk.trunk.pts[0]!;
      const l = Math.hypot(top[0] - a[0], top[1] - a[1], top[2] - a[2]);
      const dirT: Vec3 = [(top[0] - a[0]) / l, (top[1] - a[1]) / l, (top[2] - a[2]) / l];
      const part: Vec3 = [top[0] - dirT[0] * 0.25, top[1] - dirT[1] * 0.25, top[2] - dirT[2] * 0.25];
      const partR = sk.trunk.radii[3]! * 1.03;
      for (const limb of sk.limbs) {
        const g = forkLimb(limb, part, partR, dirT);
        expect(g.pts[0]).toEqual(part);
        expect(g.radii[0]).toBe(partR);
        // leaving along the trunk's line: its second point still close to the trunk's axis
        const p1 = g.pts[1]!;
        const rel: Vec3 = [p1[0] - part[0], p1[1] - part[1], p1[2] - part[2]];
        const along = rel[0] * dirT[0] + rel[1] * dirT[1] + rel[2] * dirT[2];
        expect(Math.hypot(rel[0] - dirT[0] * along, rel[1] - dirT[1] * along, rel[2] - dirT[2] * along)).toBeLessThan(along * 0.6);
        // and ends on the limb's own line, at its own tip, never thicker than where it starts
        expect(g.pts[g.pts.length - 1]).toEqual(limb.pts[limb.pts.length - 1]);
        for (const r of g.radii) expect(r).toBeLessThanOrEqual(partR + 1e-9);
      }
    }
  });

  it("a branch tapers out to a fine point at its tip, never thicker toward it (a young tree's limbs too)", () => {
    for (const spec of [YOUNG_SPECS[2]!, PLAZA_CHERRY_SPECS[1]!]) {
      const sk = treeSkeleton(spec);
      for (const b of [...sk.limbs, ...sk.sides]) {
        const t = pointedEnd(b);
        for (let i = 1; i < t.radii.length; i++) expect(t.radii[i]).toBeLessThanOrEqual(t.radii[i - 1]! + 1e-9);
        expect(t.radii[t.radii.length - 1]).toBeLessThanOrEqual(0.0015);
        // the file's last point no more than a third of the branch's base (no sawn-off log end)
        expect(t.radii[b.radii.length - 1]).toBeLessThanOrEqual(Math.max(0.0035, b.radii[0]! * 0.33) + 1e-9);
      }
    }
  });
});
