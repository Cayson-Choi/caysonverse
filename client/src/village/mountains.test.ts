import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BufferGeometry, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { BACKDROP_CUT_RADIUS, buildMountainGeometry, cutFarBackdrop, mountainLandTint, parseMountains } from "./mountains";
import { stateFor } from "./dayNightBlend";

const file = fileURLToPath(new URL("../../public/models/village/mountains.v1.bin", import.meta.url));
const bytes = readFileSync(file);
const layers = parseMountains(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

describe("distant mountains (B6)", () => {
  it("reads 4 ridge layers, near to far, their crests rising out of the village's own hills", () => {
    expect(layers.length).toBe(4);
    let lastCrest = 0;
    for (const L of layers) {
      expect(L.radius.length).toBe(L.segs * L.rows);
      expect(L.t[0]).toBeCloseTo(0, 5);
      expect(L.t[L.rows - 1]).toBeCloseTo(1, 5);
      const crest = L.radius.subarray((L.rows - 1) * L.segs);
      const mean = crest.reduce((a, b) => a + b, 0) / crest.length;
      expect(mean).toBeGreaterThan(lastCrest);
      lastCrest = mean;
      // the foot sits low (under the village's hills / behind the layer in front)
      for (let s = 0; s < L.segs; s++) expect(L.height[s]!).toBeLessThan(5);
    }
    // the nearest foot starts inside the old backdrop's cut (no gap of sky under the near ridge)
    expect(Math.min(...layers[0]!.radius.subarray(0, layers[0]!.segs))).toBeLessThan(BACKDROP_CUT_RADIUS);
    // inside the 1.4 km sky dome and the 1.6 km far plane
    expect(Math.max(...layers[3]!.radius)).toBeLessThan(1350);
  });

  it("keeps the ridges below 16° from the plaza (a backdrop, not a wall) and above the near hills somewhere in every quarter", () => {
    for (let q = 0; q < 4; q++) {
      let best = 0;
      for (const L of layers) {
        const top = (L.rows - 1) * L.segs;
        for (let s = Math.floor((q * L.segs) / 4); s < ((q + 1) * L.segs) / 4; s++) {
          const el = (Math.atan2(L.height[top + s]! - 1.6, L.radius[top + s]!) * 180) / Math.PI;
          expect(el).toBeLessThan(16);
          best = Math.max(best, el);
        }
      }
      expect(best).toBeGreaterThan(8);
    }
  });

  it("rounds each crest through the north seam and between neighbouring azimuth samples", () => {
    for (const layer of layers) {
      const first = (layer.rows - 1) * layer.segs;
      const elevations = layer.height.subarray(first).map((y, c) =>
        Math.atan2(y - 1.6, layer.radius[first + c]!) * 180 / Math.PI,
      );
      let worst = 0;
      for (let c = 0; c < layer.segs; c++) {
        const previous = elevations[(c - 1 + layer.segs) % layer.segs]!;
        const next = elevations[(c + 1) % layer.segs]!;
        // How far this sample protrudes from the line between its neighbours (degrees of elevation).
        worst = Math.max(worst, Math.abs(elevations[c]! - (previous + next) / 2));
      }
      expect(worst).toBeLessThan(0.07);
    }
  });

  it("builds one indexed mesh whose faces look toward the village", () => {
    const g = buildMountainGeometry(layers);
    const pos = g.getAttribute("position");
    const idx = g.index!;
    const tris = layers.reduce((n, L) => n + L.segs * (L.rows - 1) * 2, 0);
    expect(idx.count / 3).toBe(tris);
    expect(tris).toBeLessThan(30000);
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    let inward = 0;
    for (let t = 0; t < idx.count / 3; t += 97) {
      a.fromBufferAttribute(pos, idx.getX(t * 3));
      b.fromBufferAttribute(pos, idx.getX(t * 3 + 1));
      c.fromBufferAttribute(pos, idx.getX(t * 3 + 2));
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      const centre = a.clone().add(b).add(c).divideScalar(3);
      if (n.dot(new Vector3(0, 1.6, 0).sub(centre)) > 0) inward++;
    }
    // front faces toward the plaza's eye (a few up-facing ones on the far side of a ravine turn away: the material is double-sided)
    expect(inward / Math.ceil(idx.count / 3 / 97)).toBeGreaterThan(0.85);
  });

  it("cuts the old far range out of a clone: triangles wholly outside the radius and the forest cards there; restore puts them back", () => {
    const root = new Group();
    const pos: number[] = [];
    // one triangle near (r ~ 100), one far (r ~ 500), one across the cut
    pos.push(100, 0, 0, 101, 0, 0, 100, 0, 1, 500, 0, 0, 501, 0, 0, 500, 0, 1, 200, 0, 0, 300, 0, 0, 200, 0, 5);
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const backdrop = new Mesh(g, new MeshBasicMaterial());
    backdrop.name = "village_backdrop";
    root.add(backdrop);
    const cards = new InstancedMesh(new BufferGeometry(), new MeshBasicMaterial(), 3);
    cards.name = "inst__far_0_0";
    [100, 400, 230].forEach((x, i) => cards.setMatrixAt(i, new Matrix4().makeTranslation(x, 0, 0)));
    root.add(cards);
    const cut = cutFarBackdrop(root);
    expect(cut.trianglesRemoved).toBe(1);
    expect(backdrop.geometry).not.toBe(g);
    expect(backdrop.geometry.index!.count).toBe(6);
    expect(cut.instancesRemoved).toBe(1);
    expect(cards.count).toBe(2);
    const m = new Matrix4();
    cards.getMatrixAt(1, m);
    expect(m.elements[12]).toBe(230);
    cut.restore();
    expect(backdrop.geometry).toBe(g);
    expect(cards.count).toBe(3);
    cards.getMatrixAt(1, m);
    expect(m.elements[12]).toBe(400);
  });

  it("tints the land white by day, warm at the golden hour and dark blue at night", () => {
    const day = mountainLandTint(stateFor(40, 180));
    expect(day.every((v) => Math.abs(v - 1) < 1e-6)).toBe(true);
    const gold = mountainLandTint(stateFor(3, 250));
    expect(gold[0]).toBeGreaterThan(gold[2]);
    const night = mountainLandTint(stateFor(-30, 0));
    expect(night[2]).toBeGreaterThan(night[0]);
    expect(Math.max(...night)).toBeLessThan(0.15);
  });
});
