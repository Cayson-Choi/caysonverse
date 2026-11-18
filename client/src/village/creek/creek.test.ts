import { describe, expect, it } from "vitest";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { CASCADES, CREEK_H, CREEK_RECT, CREEK_W, bedAt, centreZ, creekLevelAt, fillHoles, mapBytes, newFoam, newGrid, rasterGround, shoreAt, splatStone, splatWeir } from "./creekMap";
import { planCreek } from "./creekPlan";
import { reedGeometry } from "./creekReeds";
import { mergeStones, stoneGeometry } from "./creekStones";
import { bankGeometry, reshapeWater, sheetGeometry } from "./creekGeometry";
import { depthMapTexture } from "./depthWater";
import { feederLevelAt, waterLevelAt } from "./creekMap";

/** A synthetic channel: ground y = 0 beyond |z - 75| > 4.5, sloping to -1 at the centre (like the carved creek), one big quad grid. */
function channel(): { position: Float32Array; index: Uint32Array } {
  const pos: number[] = [];
  const idx: number[] = [];
  const xs: number[] = [];
  for (let x = -102; x <= 102; x += 2) xs.push(x);
  const zs: number[] = [];
  for (let z = 56; z <= 94; z += 0.5) zs.push(z);
  for (const z of zs) for (const x of xs) pos.push(x, -Math.max(0, 1 - Math.max(0, Math.abs(z - 75) - 0.5) / 4) * (Math.abs(z - 75) < 4.5 ? 1 : 0), z);
  for (let j = 0; j < zs.length - 1; j++)
    for (let i = 0; i < xs.length - 1; i++) {
      const a = j * xs.length + i;
      idx.push(a, a + 1, a + xs.length, a + 1, a + xs.length + 1, a + xs.length);
    }
  return { position: new Float32Array(pos), index: new Uint32Array(idx) };
}

function grid() {
  const g = newGrid();
  rasterGround(g, channel());
  fillHoles(g);
  return g;
}

describe("creek map", () => {
  it("rasterises the ground and reads the bed back", () => {
    const g = grid();
    expect(bedAt(g, 0, 75)).toBeCloseTo(-1, 1);
    expect(bedAt(g, 0, 90)).toBeCloseTo(0, 2);
    expect(Number.isNaN(bedAt(g, 500, 75))).toBe(true);
    expect(g.heights.length).toBe(CREEK_W * CREEK_H);
  });
  it("finds the centre line and the waterlines", () => {
    const g = grid();
    expect(centreZ(g, 10)).toBeCloseTo(75, 0);
    const s = shoreAt(g, 10, -0.57);
    expect(s.north).toBeLessThan(75);
    expect(s.south).toBeGreaterThan(75);
    expect(s.south - s.north).toBeGreaterThan(1);
  });
  it("has the three water levels west to east", () => {
    expect(creekLevelAt(-60)).toBe(-0.43);
    expect(creekLevelAt(0)).toBe(-0.57);
    expect(creekLevelAt(60)).toBe(-0.71);
  });
  it("splats foam and encodes the bytes", () => {
    const g = grid();
    const foam = newFoam();
    splatStone(foam, 10, 75, 0.5);
    splatWeir(foam, CASCADES[0].x, 72, 78);
    const bytes = mapBytes(g, foam);
    expect(bytes.length).toBe(CREEK_W * CREEK_H * 2);
    let max = 0;
    for (let k = 1; k < bytes.length; k += 2) max = Math.max(max, bytes[k]!);
    expect(max).toBeGreaterThan(150);
  });
});

describe("creek plan", () => {
  const g = grid();
  const plan = planCreek(g, { low: false, foam: newFoam() });
  it("is deterministic", () => {
    const again = planCreek(g, { low: false, foam: newFoam() });
    expect(again.stones.length).toBe(plan.stones.length);
    expect(again.stones[3]).toEqual(plan.stones[3]);
  });
  it("lays a diagonal row of stepping stones across the creek above the eastern cascade", () => {
    expect(plan.stepping.length).toBe(6);
    const xs = plan.stepping.map((s) => s.x);
    const zs = plan.stepping.map((s) => s.z);
    expect(Math.max(...xs)).toBeLessThan(CASCADES[1].x);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(3);
    // clear of the water, walkable-looking: crowns 10-25 cm over it
    for (const s of plan.stepping) expect(s.top - CASCADES[1].upY).toBeGreaterThan(0.1);
  });
  it("keeps the footbridge clear and stays inside the walkable creek", () => {
    for (const p of [...plan.stones, ...plan.pebbles]) {
      expect(p.x).toBeGreaterThan(-135);
      expect(p.x).toBeLessThan(100);
      expect(p.x > -29 && p.x < -19 && p.top > -0.4 && p.rx > 0.4).toBe(false);
    }
    expect(plan.reeds.length).toBeGreaterThan(40);
  });
  it("the light tier plants fewer pebbles and reeds", () => {
    const low = planCreek(g, { low: true, foam: newFoam() });
    expect(low.pebbles.length).toBeLessThan(plan.pebbles.length);
    expect(low.reeds.length).toBeLessThan(plan.reeds.length);
  });
});

describe("creek geometry", () => {
  it("builds a stone with normals and colours, merged into one geometry", () => {
    const spec = { x: 1, z: 2, top: 0, rx: 0.5, rz: 0.4, depth: 0.5, yaw: 0.3, flat: 0.8, seed: 5, tone: 1, detail: 3 };
    const g = stoneGeometry(spec);
    expect(g.getAttribute("normal").count).toBe(g.getAttribute("position").count);
    expect(g.getAttribute("color")).toBeTruthy();
    // the crown is flattened near the requested top, the foot is buried
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeLessThan(0.6);
    expect(g.boundingBox!.min.y).toBeLessThan(-0.3);
    const merged = mergeStones([spec, { ...spec, seed: 6, x: 3 }])!;
    expect(merged.getAttribute("position").count).toBe(g.getAttribute("position").count * 2);
  });
  it("builds the reeds with a sway attribute", () => {
    const r = reedGeometry([{ x: 0, y: 0, z: 0, h: 1, seed: 1, sedge: 0 }, { x: 1, y: 0, z: 0, h: 0.6, seed: 2, sedge: 1 }])!;
    expect(r.getAttribute("aSway").count).toBe(r.getAttribute("position").count);
    expect(r.index!.count).toBeGreaterThan(100);
  });
  it("copies only the channel's ground triangles into the bank overlay, lifted 1.2 cm", () => {
    const src = channel();
    const bank = bankGeometry([src])!;
    const total = src.index.length / 3;
    expect(bank.index!.count / 3).toBeLessThan(total);
    expect(bank.index!.count).toBeGreaterThan(0);
    bank.computeBoundingBox();
    expect(bank.boundingBox!.max.y).toBeGreaterThan(0);
    expect(bank.boundingBox!.max.y).toBeLessThan(0.013);
  });
  it("cuts the sloped faces out of a water mesh and pushes its shores out", () => {
    const g = grid();
    const w = new BufferGeometry();
    // a flat quad strip (z 72.5..77.5) with a sloped drop at x 32..32.6
    w.setAttribute("position", new Float32BufferAttribute([30, -0.57, 72.5, 30, -0.57, 77.5, 32, -0.57, 72.5, 32, -0.57, 77.5, 32.6, -0.71, 72.5, 32.6, -0.71, 77.5], 3));
    w.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
    const r = reshapeWater(w, g);
    expect(r.index!.count).toBe(6); // only the flat quad is left
    expect(r.getAttribute("position").getZ(0)).toBeLessThan(72.5);
    expect(w.getAttribute("position").getZ(0)).toBe(72.5); // the source is untouched
  });
  it("makes a falling sheet that ends just over the lower water", () => {
    const s = sheetGeometry(1, 73.8, 79.3);
    s.computeBoundingBox();
    expect(s.boundingBox!.min.y).toBeGreaterThan(CASCADES[1].downY);
    expect(s.boundingBox!.min.y).toBeLessThan(CASCADES[1].downY + 0.03);
    expect(CREEK_RECT.x0).toBeLessThan(CASCADES[0].x);
  });
});

describe("the whole stream", () => {
  it("the feeder's level falls from the falls to the creek and joins the creek's first level", () => {
    expect(feederLevelAt(-58)).toBeCloseTo(-0.3, 3);
    expect(feederLevelAt(66)).toBeCloseTo(-0.43, 2);
    expect(waterLevelAt(-106, 0)).toBe(feederLevelAt(0));
    expect(waterLevelAt(-60, 70)).toBe(-0.43);
  });
  it("ends the feeder and the creek in a culvert each, and dresses the falls' slabs as stones", () => {
    const g = grid();
    const slabs = [{ centre: { x: -102.9, z: -77.4 }, radiusX: 1.65, radiusZ: 2.5, yaw: 0.1, top: 0.04 }];
    const withSlabs = planCreek(g, { low: false, foam: newFoam(), slabs });
    const without = planCreek(g, { low: false, foam: newFoam() });
    expect(withSlabs.stones.length).toBe(without.stones.length + 1);
    expect(withSlabs.stones.some((s) => s.x === -102.9 && s.flat === 1)).toBe(true);
    // two headwalls of dark-cavity + arch + courses
    expect(withSlabs.stones.filter((s) => s.tone < 0.1).length).toBe(2);
    expect(withSlabs.mouths.creek.x).toBeLessThan(-85);
  });
  it("packs a reusable depth map (R bed, G foam)", () => {
    const t = depthMapTexture(2, 1, [-1, 0.4], [0, 1], [-1.6, 0.4]);
    const d = t.image.data as Uint8Array;
    expect(d.length).toBe(4);
    expect(d[0]).toBe(Math.round(((-1 + 1.6) / 2) * 255));
    expect(d[2]).toBe(255);
    expect(d[3]).toBe(255);
  });
});
