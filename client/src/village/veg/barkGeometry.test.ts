import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { BARK_STYLE, barkColour, barkLight, barkPixels, pointedEnd, skeletonBark, twigBark } from "./barkGeometry";
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
});
