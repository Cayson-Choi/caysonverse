import { describe, expect, it } from "vitest";
import { crownConnection, distToPolyline, envelopeRadius, polyLength, pruneTwigs, skeletonBranches, type GrownTwig } from "./crownGrowth";
import { GREEN_GROW, YOUNG_GROW, broadleafEnvelope, growBroadleaf, growWillow, leafConnection, type LeafCrown } from "./treeCrown";
import { cherryConnection, growCherry } from "./cherryTree";
import { PLAZA_CHERRY_SPECS, VARIANT_SPECS, VILLAGE_TREE_SPECS, WILLOW_SPECS, YOUNG_SPECS, treeSkeleton, type Branch } from "./treeSkeleton";
import type { Vec3 } from "./vegLod";

/** Every grown twig starts on the branch it grew from (a twig, or a baked limb or side branch): a chain to the bark. */
function expectRooted(skeleton: readonly Branch[], twigs: readonly GrownTwig[]) {
  for (const t of twigs) {
    const parent = t.parent >= 0 ? twigs[t.parent] : skeleton[-1 - t.parent];
    expect(parent).toBeDefined();
    expect(distToPolyline(t.pts[0]!, parent!)).toBeLessThan(1e-6);
  }
}

const green = treeSkeleton(VILLAGE_TREE_SPECS.find((s) => s.seed === 312)!);
const street = treeSkeleton(VARIANT_SPECS.street_green);
const crowns: Array<[string, LeafCrown]> = [
  ["village green", growBroadleaf(green, GREEN_GROW, "green")],
  ["street green", growBroadleaf(street, GREEN_GROW, "green")],
  ["young", growBroadleaf(treeSkeleton(YOUNG_SPECS[0]!), YOUNG_GROW, "young")],
  ["willow", growWillow(treeSkeleton(WILLOW_SPECS[1]!))],
];

describe("leafy crowns: every leaf on a twig, every twig back to the limbs", () => {
  for (const [label, c] of crowns) {
    it(`${label}: no gap, no bare twig end, no leaf without a branch`, () => {
      const conn = leafConnection(c);
      expect(conn.clusters).toBe(c.leaves.length);
      expect(conn.unattached).toBe(0);
      expect(conn.maxGap).toBeLessThanOrEqual(0.05);
      expect(conn.bareTips).toBe(0);
      expectRooted(skeletonBranches(c.skeleton), c.twigs);
    });
  }

  it("is deterministic", () => {
    const again = growBroadleaf(green, GREEN_GROW, "green");
    expect(again.leaves.length).toBe(crowns[0]![1].leaves.length);
    expect(again.leaves[123]).toEqual(crowns[0]![1].leaves[123]);
    expect(again.twigs.length).toBe(crowns[0]![1].twigs.length);
  });

  it("grows a full broadleaf crown in the old crown's volume, with sky gaps", () => {
    const c = crowns[0]![1];
    expect(c.leaves.length).toBeGreaterThan(1800);
    expect(c.leaves.length).toBeLessThan(4000);
    const env = broadleafEnvelope(green, GREEN_GROW);
    const inside = c.leaves.filter((l) => envelopeRadius(env, [l.x, l.y, l.z]) < 1.25).length;
    expect(inside / c.leaves.length).toBeGreaterThan(0.97);
    // foliage from the lowest limbs to the top, not a ball floating over the trunk
    const ys = c.leaves.map((l) => l.y);
    expect(Math.min(...ys)).toBeLessThan(green.fork[1] + 1.2);
    expect(Math.max(...ys)).toBeGreaterThan(green.crownC[1] + green.crownH * 0.8);
    // gaps: the shell's density varies (some 0.8 m cells hold several times the leaves of others)
    const cells = new Map<string, number>();
    for (const l of c.leaves) {
      const k = `${Math.floor(l.x / 0.8)},${Math.floor(l.y / 0.8)},${Math.floor(l.z / 0.8)}`;
      cells.set(k, (cells.get(k) ?? 0) + 1);
    }
    const counts = [...cells.values()].sort((a, b) => a - b);
    expect(counts[counts.length - 1]! / Math.max(1, counts[Math.floor(counts.length / 4)]!)).toBeGreaterThan(2.5);
  });

  it("every leaf spray points out of its twig and faces the sky or out of the crown", () => {
    for (const l of crowns[0]![1].leaves) {
      expect(Math.hypot(l.ax, l.ay, l.az)).toBeCloseTo(1, 6);
      expect(Math.hypot(l.fx, l.fy, l.fz)).toBeCloseTo(1, 6);
      expect(Math.abs(l.ax * l.fx + l.ay * l.fy + l.az * l.fz)).toBeLessThan(1e-6);
    }
    const up = crowns[0]![1].leaves.filter((l) => l.fy > 0).length;
    expect(up / crowns[0]![1].leaves.length).toBeGreaterThan(0.8);
  });

  it("hangs the willow's strands down to a metre or two above the ground, leafy to their tips", () => {
    const c = crowns[3]![1];
    const ground = c.skeleton.base[1];
    const low = c.leaves.filter((l) => l.y < ground + 2.5).length;
    expect(low).toBeGreaterThan(200);
    expect(Math.min(...c.leaves.map((l) => l.y))).toBeGreaterThan(ground + 0.3);
    // the strands hang: most sprays point down
    expect(c.leaves.filter((l) => l.ay < -0.5).length / c.leaves.length).toBeGreaterThan(0.7);
  });
});

describe("blossom crowns: every bunch on a twig (spur within 5 cm), no bare twig ends", () => {
  for (const [label, sk, att] of [
    ["plaza cherry", treeSkeleton(PLAZA_CHERRY_SPECS[2]!), 540],
    ["street cherry", treeSkeleton(VARIANT_SPECS.street_cherry), 400],
    ["orchard", treeSkeleton(VARIANT_SPECS.orchard), 170],
  ] as const) {
    it(label, () => {
      const c = growCherry(sk, { attractors: att, bunchStep: 0.08 });
      const conn = cherryConnection(c);
      expect(conn.unattached).toBe(0);
      expect(conn.maxGap).toBeLessThanOrEqual(0.05);
      expect(conn.bareTips).toBe(0);
      expectRooted(skeletonBranches(c.skeleton), c.twigs);
    });
  }
});

describe("pruneTwigs and crownConnection", () => {
  const p = (x: number, y = 0, z = 0): Vec3 => [x, y, z];
  const twig = (a: Vec3, b: Vec3, parent: number, parentS: number): GrownTwig => ({ pts: [a, b], radii: [0.01, 0.003], parent, parentS });
  const limb: Branch = { pts: [p(0), p(2)], radii: [0.05, 0.02] };

  it("cuts a twig back to its last cluster, drops a twig with none, keeps a parent for its child", () => {
    const twigs = [
      twig(p(0.5), p(0.5, 1), -1, 0.5), // 0: a cluster half way: cut back
      twig(p(1), p(1, 1), -1, 1), // 1: nothing: dropped
      twig(p(1.5), p(1.5, 1), -1, 1.5), // 2: only a child at 0.4: cut back to it
      twig(p(1.5, 0.4), p(2.2, 0.4), 2, 0.4), // 3: cluster at its tip
    ];
    const { twigs: kept, map } = pruneTwigs(twigs, [
      { twig: 0, s: 0.5 },
      { twig: 3, s: 0.7 },
    ]);
    expect([...map]).toEqual([0, -1, 1, 2]);
    expect(kept).toHaveLength(3);
    expect(polyLength(kept[0]!)).toBeCloseTo(0.52, 6);
    expect(polyLength(kept[1]!)).toBeCloseTo(0.4, 6);
    expect(kept[2]!.parent).toBe(1);
  });

  it("finds a gap, a bare twig end and a cluster with no branch", () => {
    const twigs = [twig(p(1), p(1, 1), -1, 1)];
    const conn = crownConnection([limb], twigs, [
      { x: 1.08, y: 0.5, z: 0, size: 0.3, twig: 0 }, // 8 cm off its twig
      { x: 2, y: 0, z: 0, size: 0.3, twig: -1 }, // on the limb's tip
      { x: 5, y: 5, z: 5, size: 0.3, twig: 7 }, // no such twig
    ]);
    expect(conn.maxGap).toBeCloseTo(0.08, 6);
    expect(conn.unattached).toBe(1);
    expect(conn.bareTips).toBe(1); // the twig's tip (1, 1) has nothing within reach
  });
});
