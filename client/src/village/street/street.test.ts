import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { signalPoleSpots } from "@caysonverse/shared/village/crossings";
import { BANNER, BANNER_ATLAS, BANNER_POLES, BANNER_POLE_LIGHT_Y, BANNER_TEXT, BANNER_THEMES, LAMP_POSTS, OLD_BANNER_POLES, OLD_PLAZA_LAMPS, PLAZA_RING, bannerSlot, lanternPositions, ringAzimuth } from "./streetLayout";
import { trimOldStreetFurniture } from "./streetTrim";
import { EDGE_PROFILE, LANES, laneCobble, polylineDistance } from "../ground/groundPaths";
import { lampSpots } from "@caysonverse/shared/village/streetPoles";
import { LIFT_FROM_Y, bannerFabricGeometry, bannerHardwareGeometry, lampPostGeometry, lanternGlassGeometry, shaftRadius } from "./streetGeometry";
import { metalTextures, poolTexture, weaveTexture } from "./streetMaterials";

/** village.glb's node list (its JSON chunk): the light empties the posts stand under. */
function glbNodes(): Array<{ name: string; translation?: number[] }> {
  const buf = readFileSync(fileURLToPath(new URL("../../../public/models/village/village.glb", import.meta.url)));
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString("utf8")).nodes;
}

describe("streetLayout: the posts and poles stand where the bake put them", () => {
  const nodes = glbNodes();
  it("every lamp post is under its glb lantern light (x, z within 2 cm; the lantern's height)", () => {
    for (const p of LAMP_POSTS) {
      const n = nodes.find((o) => o.name === p.light);
      expect(n, p.light).toBeDefined();
      const [x, y, z] = n!.translation!;
      // a moved post (house 5's, 2026-11-28) is checked where the bake put it
      const at = p.baked ?? p;
      expect(Math.abs(x! - at.x), p.light).toBeLessThan(0.02);
      expect(Math.abs(z! - at.z), p.light).toBeLessThan(0.02);
      expect(Math.abs(y! - p.lightY), p.light).toBeLessThan(0.02);
    }
  });
  it("no other glb light at a post's height is left without a post (4.23 m plaza/ring, 3.83 m lanes)", () => {
    const posts = nodes.filter((n) => /^light__lamp_/.test(n.name) && n.translation && [4.23, 3.83].some((h) => Math.abs(n.translation![1]! - h) < 0.005));
    expect(posts.map((n) => n.name).sort()).toEqual(LAMP_POSTS.map((p) => p.light).sort());
  });
  it("vrb2 rebake: the old plaza lamps' lights moved to the plaza ring's posts (lantern 5.03 m), posts 5-6 got light__lamp_44/45", () => {
    const names = ["light__lamp_1", "light__lamp_2", "light__lamp_3", "light__lamp_4", "light__lamp_5", "light__lamp_44", "light__lamp_45"];
    BANNER_POLES.forEach((p, k) => {
      const n = nodes.find((o) => o.name === names[k]);
      expect(n, names[k]).toBeDefined();
      const [x, y, z] = n!.translation!;
      expect(Math.abs(x! - p.x), names[k]).toBeLessThan(0.02);
      expect(Math.abs(z! - p.z), names[k]).toBeLessThan(0.02);
      expect(Math.abs(y! - BANNER_POLE_LIGHT_Y), names[k]).toBeLessThan(0.02);
    });
    for (const o of OLD_PLAZA_LAMPS) {
      const n = nodes.find((m) => m.name === o.light)!;
      expect(Math.hypot(n.translation![0]! - o.x, n.translation![2]! - o.z), o.light).toBeGreaterThan(1);
    }
  });
  it("the plaza has ONE ring of posts: same radius, equal steps, every theme on at least one post", () => {
    expect(BANNER_POLES).toHaveLength(PLAZA_RING.count);
    BANNER_POLES.forEach((p, k) => {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(PLAZA_RING.radius, 6);
      const az = ((Math.atan2(p.x, -p.z) * 180) / Math.PI + 360) % 360;
      expect(az).toBeCloseTo(ringAzimuth(k) % 360, 6);
    });
    for (const t of BANNER_THEMES) expect(BANNER_POLES.some((p) => p.theme === t), t).toBe(true);
  });
  it("no post stands near another (owner 2026-11-16: no doubled posts): every two drawn posts >= 9 m apart", () => {
    const all = [...LAMP_POSTS, ...BANNER_POLES];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(Math.hypot(all[i]!.x - all[j]!.x, all[i]!.z - all[j]!.z), `${i}-${j}`).toBeGreaterThan(9);
  });
  it("the plaza posts keep clear of the lane mouths (>= 3 m from a lane's edge) and the crossings' signal poles (>= 4 m)", () => {
    const seg = (px: number, pz: number, a: { x: number; z: number }, b: { x: number; z: number }) => {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = Math.max(-0.5, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(px - a.x - t * dx, pz - a.z - t * dz);
    };
    for (const p of BANNER_POLES) {
      for (const lane of VILLAGE_LAYOUT.lanes) {
        for (let i = 0; i + 1 < lane.points.length; i++) {
          expect(seg(p.x, p.z, lane.points[i]!, lane.points[i + 1]!) - lane.width / 2, lane.id).toBeGreaterThan(3);
        }
      }
      for (const s of signalPoleSpots()) expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeGreaterThan(4);
      // on the paving, inside its edge (r 30)
      expect(Math.hypot(p.x, p.z) + BANNER.armReach * 0).toBeLessThan(VILLAGE_LAYOUT.plaza.paving.radius);
    }
  });
  it("the two prints of a pole are two different atlas cells, inside the 6 x 2 atlas", () => {
    for (const p of BANNER_POLES) {
      const a = bannerSlot(p.theme, -1);
      const b = bannerSlot(p.theme, 1);
      expect(a).not.toEqual(b);
      for (const s of [a, b]) {
        expect(s.col).toBeGreaterThanOrEqual(0);
        expect(s.col).toBeLessThan(BANNER_ATLAS.cols);
        expect(s.row).toBeLessThan(BANNER_ATLAS.rows);
      }
    }
  });
  it("every theme has its words (A and B), in Korean", () => {
    for (const t of BANNER_THEMES) {
      expect(BANNER_TEXT[t].a).toMatch(/[가-힣]/);
      expect(BANNER_TEXT[t].b).toMatch(/[가-힣]/);
    }
  });
  it("a 60 x 180 cm banner, bottom over 2 m (Korean ordinances), clear of the pole", () => {
    expect(BANNER.width).toBe(0.6);
    expect(BANNER.topY - BANNER.bottomY).toBeCloseTo(1.8, 6);
    expect(BANNER.bottomY).toBeGreaterThan(2);
    expect(BANNER.inner).toBeGreaterThan(shaftRadius(BANNER.topY, 0.8) + 0.03);
    expect(BANNER.armReach).toBeGreaterThan(BANNER.inner + BANNER.width);
  });
  it("lanternPositions: the kept posts and the plaza ring (the old plaza lamps are not drawn)", () => {
    expect(lanternPositions()).toHaveLength(LAMP_POSTS.length + BANNER_POLES.length);
    expect(LAMP_POSTS.some((p) => OLD_PLAZA_LAMPS.some((o) => o.light === p.light))).toBe(false);
  });
});

/** A mesh of the given triangles (world = local), named like a village cell. */
function cell(name: string, tris: number[][]): Mesh {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(tris.flat(), 3));
  g.setIndex([...Array(tris.length * 3).keys()]);
  const m = new Mesh(g, new MeshBasicMaterial());
  m.name = name;
  return m;
}

describe("streetTrim: the baked posts and banner cards go, the paving and the rest stay", () => {
  const L = LAMP_POSTS[0]!;
  const B = OLD_BANNER_POLES[1]!;
  // a strip of the old post's shaft, a paving triangle under it, a house wall a metre off, the old banner's card on local x
  const c = Math.cos(B.yaw);
  const s = Math.sin(B.yaw);
  const onArm = (lx: number, y: number): number[] => [B.x + lx * c, y, B.z - lx * s];
  const tris = [
    [L.x + 0.06, 0.5, L.z, L.x - 0.06, 0.5, L.z, L.x, 3.9, L.z + 0.06],
    [L.x - 2, 0.02, L.z - 2, L.x + 2, 0.02, L.z - 2, L.x, 0.02, L.z + 2],
    [L.x + 1, 0, L.z, L.x + 1, 3, L.z, L.x + 1.2, 3, L.z],
    [...onArm(0.1, 4.2), ...onArm(0.7, 4.2), ...onArm(0.7, 6.2)],
    [...onArm(0.1, 4.2), ...onArm(0.7, 6.2), ...onArm(0.1, 6.2)],
  ];
  it("takes out the post's and the card's triangles only, and restores them", () => {
    const root = new Group();
    const lm = cell("village_lm_11", tris);
    const sky = cell("village_sky", [tris[0]!]);
    root.add(lm, sky);
    const original = lm.geometry;
    const t = trimOldStreetFurniture(root);
    expect(t.stats.trianglesRemoved).toBe(3);
    expect(lm.geometry).not.toBe(original);
    expect(lm.geometry.index!.count).toBe(6);
    expect(sky.geometry.index!.count).toBe(3); // the sky is never touched
    expect(original.index!.count).toBe(15); // the cache's geometry is never edited
    // twice is harmless
    expect(trimOldStreetFurniture(root).stats.trianglesRemoved).toBe(0);
    t.restore();
    expect(lm.geometry).toBe(original);
  });
  it("respects a cell's offset (the clone's cells carry their own position)", () => {
    const root = new Group();
    const shifted = tris.map((t) => t.map((v, i) => (i % 3 === 0 ? v - 10 : v)));
    const lm = cell("village_lm_21", shifted);
    lm.position.x = 10;
    root.add(lm);
    expect(trimOldStreetFurniture(root).stats.trianglesRemoved).toBe(3);
  });
});

describe("streetGeometry", () => {
  const unit = (g: BufferGeometry) => {
    const n = g.getAttribute("normal");
    for (let i = 0; i < n.count; i++) {
      const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
      if (Math.abs(l - 1) > 0.02) return false;
    }
    return true;
  };
  it("the post: smooth round (many faces, unit normals), the attributes the material needs, the lift only above the base", () => {
    const g = lampPostGeometry();
    for (const a of ["position", "normal", "uv", "liftW"]) expect(g.getAttribute(a), a).toBeDefined();
    expect(unit(g)).toBe(true);
    const tris = g.getAttribute("position").count / 3;
    expect(tris).toBeGreaterThan(4000);
    expect(tris).toBeLessThan(20000);
    const pos = g.getAttribute("position");
    const w = g.getAttribute("liftW");
    for (let i = 0; i < pos.count; i++) expect(w.getX(i)).toBe(pos.getY(i) >= LIFT_FROM_Y ? 1 : 0);
    // the base cover is wider than the shaft, the flange wider still
    g.computeBoundingBox();
    expect(g.boundingBox!.max.x).toBeCloseTo(0.252, 2); // the roof's drip edge
  });
  it("the glass rides the lift whole and wraps the lantern's centre", () => {
    const g = lanternGlassGeometry();
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeLessThan(4.23 - 0.2);
    expect(g.boundingBox!.max.y).toBeGreaterThan(4.23 + 0.15);
    const w = g.getAttribute("liftW");
    for (let i = 0; i < w.count; i++) expect(w.getX(i)).toBe(1);
  });
  it("the hardware's arms reach past the fabric on both sides, at the two rods", () => {
    const g = bannerHardwareGeometry(0.8);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.x).toBeGreaterThan(BANNER.inner + BANNER.width);
    expect(g.boundingBox!.min.x).toBeLessThan(-(BANNER.inner + BANNER.width));
    expect(g.boundingBox!.min.y).toBeLessThan(BANNER.bottomY);
    expect(g.boundingBox!.max.y).toBeGreaterThan(BANNER.topY);
  });
  it("the fabric: two faces facing apart, the wind frame on every vertex, the print the right way round on both", () => {
    const g = bannerFabricGeometry();
    const n = g.getAttribute("normal");
    const uv = g.getAttribute("uv");
    const pos = g.getAttribute("position");
    const fab = g.getAttribute("fab");
    expect(fab.count).toBe(pos.count);
    let front = 0;
    let back = 0;
    for (let i = 0; i < n.count; i++) {
      if (fab.getZ(i) !== 1) continue; // the flat faces (the pockets wrap round the rods)
      if (n.getZ(i) === 1) {
        front++;
        // front: u grows with x
        expect(uv.getX(i)).toBeCloseTo((pos.getX(i) - BANNER.inner) / BANNER.width, 5);
      } else if (n.getZ(i) === -1) {
        back++;
        // back (seen from behind, x runs the other way): u falls with x
        expect(uv.getX(i)).toBeCloseTo(1 - (pos.getX(i) - BANNER.inner) / BANNER.width, 5);
      }
    }
    expect(front).toBe(back);
    expect(front).toBeGreaterThan(100);
    // every triangle faces the way its normals say (the winding matches)
    const idx = g.index!;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let t = 0; t < idx.count; t += 3) {
      a.fromBufferAttribute(pos, idx.getX(t));
      b.fromBufferAttribute(pos, idx.getX(t + 1));
      c.fromBufferAttribute(pos, idx.getX(t + 2));
      const face = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const vn = new Vector3().fromBufferAttribute(n, idx.getX(t));
      expect(face.dot(vn), `triangle ${t / 3}`).toBeGreaterThan(0);
    }
  });
});

describe("streetMaterials' small textures", () => {
  it("are tiny and tile (no files)", () => {
    const m = metalTextures();
    expect(m.detail.image.width).toBe(128);
    expect(m.color.image.width).toBe(128);
    expect(weaveTexture().image.width).toBe(64);
    const p = poolTexture();
    // the pool fades to nothing at its edge
    const d = p.image.data as Uint8Array;
    expect(d[3]).toBe(0);
    expect(d[(32 * 64 + 32) * 4 + 3]).toBeGreaterThan(200);
  });
});

// owner 2026-11-28: every path straight on its door — the house 5 lamp stood at the mouth of its new front walk
describe("no street lamp stands on a walk or at its mouth", () => {
  it("every post's base is >= 1 m clear of every lane's and front walk's cobble and edging, the mouth carried 1.5 m back", () => {
    const edge = EDGE_PROFILE[EDGE_PROFILE.length - 1]![0];
    const tight: string[] = [];
    for (const spec of LANES) {
      const c = laneCobble(spec);
      const a = c.mid[0]!;
      const b = c.mid[1]!;
      const n = Math.hypot(b.x - a.x, b.z - a.z);
      const line = [{ x: a.x - ((b.x - a.x) / n) * 1.5, z: a.z - ((b.z - a.z) / n) * 1.5 }, ...c.mid];
      for (const p of [...LAMP_POSTS, ...BANNER_POLES.map((q, i) => ({ light: `banner_${i}`, x: q.x, z: q.z }))]) {
        const gap = polylineDistance(line, p.x, p.z) - c.half - edge - 0.17;
        if (gap < 1) tight.push(`${p.light} by ${spec.id}: ${gap.toFixed(2)} m`);
      }
    }
    expect(tight).toEqual([]);
  });
  it("house 5's lamp: beside its walk as house 10's lamp 9 is beside its own (3 m off the centre line), on the ring's sidewalk", () => {
    const l11 = LAMP_POSTS.find((p) => p.light === "light__lamp_11")!;
    const l9 = LAMP_POSTS.find((p) => p.light === "light__lamp_9")!;
    expect(Math.hypot(l11.x, l11.z)).toBeCloseTo(38.4, 6);
    expect(Math.abs(l11.z - -8)).toBeCloseTo(Math.abs(l9.z - 26.4), 1);
    expect(l11.baked).toEqual({ x: -37.817, z: -6.668 });
    // the shared collider stands where the post is drawn
    const spots = lampSpots(VILLAGE_LAYOUT);
    for (const p of LAMP_POSTS) expect(spots.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 0.01), p.light).toBe(true);
  });
});
