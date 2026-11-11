import { describe, expect, it } from "vitest";
import { OUTDOOR_CHERRY_SPECS, crownEnvelope, envelopeRadius, growCherry, outdoorCherrySkeletons, plazaCherrySkeletons } from "./cherryTree";

/**
 * The limb tips the art script drew (python, art/village/tools/parts_trees.tree replayed with random.Random(100+i)),
 * in game coordinates. They were checked against `village.glb`'s LM_bark vertices: each tip is within 2 cm of the
 * file's bark (the tube's 2 cm end radius), so the new twigs grow out of the limbs the file really has.
 */
const PY_TIPS: Array<{ fork: [number, number, number]; tip0: [number, number, number] }> = [
  { fork: [-8.838324873221294, 2.612, -16.88216603997739], tip0: [-6.165994462046419, 5.667587373465145, -16.80987845426456] },
];

describe("plaza cherry skeletons (parts_trees replayed)", () => {
  const sks = plazaCherrySkeletons();

  it("has the six plaza cherries on the 19 m ring, in their planters", () => {
    expect(sks).toHaveLength(6);
    for (const s of sks) {
      expect(Math.hypot(s.base[0], s.base[2])).toBeCloseTo(19, 5);
      expect(s.base[1]).toBeCloseTo(0.38, 6);
      expect(s.limbs).toHaveLength(5);
      expect(s.sides).toHaveLength(10);
    }
  });

  it("matches the python script's fork and first limb tip exactly", () => {
    const s = sks[0]!;
    const want = PY_TIPS[0]!;
    for (let k = 0; k < 3; k++) {
      expect(s.fork[k]).toBeCloseTo(want.fork[k]!, 9);
      expect(s.limbs[0]!.pts[3]![k]).toBeCloseTo(want.tip0[k]!, 9);
    }
  });
});

describe("growCherry", () => {
  const sks = plazaCherrySkeletons();
  const crowns = sks.map((s) => growCherry(s));

  it("is deterministic", () => {
    const again = growCherry(sks[2]!);
    expect(again.bunches.length).toBe(crowns[2]!.bunches.length);
    expect(again.bunches[10]).toEqual(crowns[2]!.bunches[10]);
    expect(again.twigs.length).toBe(crowns[2]!.twigs.length);
  });

  it("grows a full crown: hundreds of twigs and 900-1700 bunches per tree", () => {
    for (const c of crowns) {
      expect(c.twigs.length).toBeGreaterThan(200);
      expect(c.bunches.length).toBeGreaterThan(900);
      expect(c.bunches.length).toBeLessThan(1700);
    }
  });

  it("keeps the bunches in the old crown's volume (its baked ground shadow), off the trunk", () => {
    for (const c of crowns) {
      const env = crownEnvelope(c.skeleton);
      for (const b of c.bunches) {
        expect(envelopeRadius(env, [b.x, b.y, b.z])).toBeLessThan(1.3);
        expect(b.y).toBeGreaterThan(c.skeleton.fork[1] - 0.2);
      }
    }
  });

  it("leaves sky gaps: the shell is not covered evenly", () => {
    // count bunches per 0.8 m cell of the outer shell: some cells are empty while their neighbours are full
    const c = crowns[0]!;
    const cells = new Map<string, number>();
    for (const b of c.bunches) {
      if (b.depth < 0.75) continue;
      const k = `${Math.floor(b.x / 0.8)},${Math.floor(b.y / 0.8)},${Math.floor(b.z / 0.8)}`;
      cells.set(k, (cells.get(k) ?? 0) + 1);
    }
    const counts = [...cells.values()].sort((a, b) => a - b);
    expect(counts[counts.length - 1]! / Math.max(1, counts[Math.floor(counts.length / 4)]!)).toBeGreaterThan(2.5);
  });

  it("lights bunches in the old cards' baked range, darker underneath and inside", () => {
    for (const c of crowns) {
      const lights = c.bunches.map((b) => b.light);
      expect(Math.min(...lights)).toBeGreaterThan(0.25);
      expect(Math.max(...lights)).toBeLessThanOrEqual(1.08);
      const under = c.bunches.filter((b) => b.ny < -0.3);
      const top = c.bunches.filter((b) => b.ny > 0.6);
      const mean = (a: typeof under) => a.reduce((s, b) => s + b.light, 0) / Math.max(1, a.length);
      if (under.length > 5 && top.length > 5) expect(mean(under)).toBeLessThan(mean(top));
    }
  });

  it("starts every twig on a branch node and keeps twigs thin", () => {
    for (const c of crowns)
      for (const t of c.twigs) {
        expect(t.radii[0]!).toBeLessThanOrEqual(0.035);
        expect(t.radii[t.radii.length - 1]!).toBeLessThan(0.005);
      }
  });
});

describe("outdoor cherry skeletons", () => {
  it("replays every static cherry outside the plaza at its authored position", () => {
    const specs = OUTDOOR_CHERRY_SPECS;
    const trees = outdoorCherrySkeletons();
    expect(trees).toHaveLength(11);
    expect(trees.map((t) => [t.base[0], t.base[2]])).toEqual(specs.map((s) => [s.x, s.z]));
    for (const tree of trees) {
      expect(tree.limbs).toHaveLength(5);
      expect(tree.sides).toHaveLength(10);
      expect(tree.crownH).toBeGreaterThan(1.5);
    }
  });
});
