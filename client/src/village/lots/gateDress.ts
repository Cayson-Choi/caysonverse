import {
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  TextureLoader,
  Vector3,
  type Material,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GeoBuilder, type V3 } from "../../land/geoBuilder";
import { versionedUrl } from "../modelUrl";
import { dayNight } from "../dayNightDriver";
import { bushPlant } from "../veg/vegPlants";
import { arc, buildFountainStone, createStoneFountainWater, profile, type FountainDesign } from "../fountain/stoneFountain";
import { GATE_FOUNTAIN } from "../fountain/fountainDesigns";
import { drawnTris, lotSurfaceMaterial, muteLotLampsNear, patchLotLight, type LotNodes } from "./lotsPrep";
import { tintForecourt } from "./entranceGardens";

/**
 * 케이슨랜드's gate lot, dressed again (fix/gate-fountain-park). The owner, on the forecourt: "케이슨 랜드 입구에 이거
 * 분수니 뭐니? 너무 허접하잖아" and "입구에 나무도 너무 허접하고 뒤에 가로등인가? 이것도 너무 허접하내". The lot's file
 * (lot_gate.glb, martgate kit) drew them in a few hundred triangles: an octagonal granite trough, a crude bowl and spike, glass
 * skirts for water; stacked faceted green blobs on a stick (the goods atlas bleeding pink into them); a dark stick with two
 * blank white balls. They are cut out of the lot's detail (triangles by place and material, `cutGateOld`) and drawn anew:
 *
 *  - the fountain: GATE_FOUNTAIN turned in warm limestone (the library's flamed granite set, tinted; the wet faces darker and
 *    glossier) on a ring of flagstones, its water real (stoneFountain.ts);
 *  - the two topiaries in the planters: three clipped boxwood balls on a clear stem (the village's boxwood: sprig cards with
 *    real leaves over a dark core, bushPlant), on bark mulch;
 *  - the four lamps: Victorian cast iron (a moulded foot, a fluted post, a collar, a scrolled twin arm, two opal globes with
 *    a bulb inside, caps and finials), the globes on the same spots as before (the night glow sprites stay true).
 */

/** The old pieces' places (world, from lot_gate.glb's colliders). */
export const GATE_SPOTS = {
  fountain: { x: -24, z: 88.225 },
  planters: [
    { x: -19.1, z: 85.7 },
    { x: -28.9, z: 85.7 },
  ],
  lamps: [
    { x: -14.5, z: 84.5 },
    { x: -33.5, z: 84.5 },
    { x: -14.5, z: 90.5 },
    { x: -33.5, z: 90.5 },
  ],
  /** The planters' tops (m) and their soil's half width. */
  planterTop: 0.62,
  soilHalf: 0.6,
} as const;

/** Which of the old triangles go (centroid in world, the mesh's material name). */
export function isOldGatePiece(x: number, y: number, z: number, material: string): boolean {
  const f = GATE_SPOTS.fountain;
  const d = Math.hypot(x - f.x, z - f.z);
  if (/granite|metal|glass/i.test(material) && d < 1.9) return true; // the trough, the bowls, the spike, the glass "water"
  if (/goods/i.test(material) && d < 2.4 && y < 0.6) return true; // the lumpy shrubs round its foot
  if (/goods|oak/i.test(material) && y > GATE_SPOTS.planterTop - 0.02)
    for (const p of GATE_SPOTS.planters) if (Math.abs(x - p.x) < 0.8 && Math.abs(z - p.z) < 0.8) return true; // the topiaries
  // the two little planters at the front's ends (granite box + boxwood, centres x -14.9 / -33.1, z 95.7) were drawn before the castle wall
  // stood there: half of each is inside the wall's footing (z >= 95.45) and its plant squeezes out of the stone
  if (/granite|goods/i.test(material) && z > 94.6 && y < 1.4)
    for (const px of [-14.9, -33.1]) if (Math.abs(x - px) < 1.5) return true;
  return false;
}

const isMesh = (o: Object3D): o is Mesh => (o as Mesh).isMesh === true;

/** Cut the old fountain and topiaries out of the gate's detail meshes (new index on a copy; the loader's stays). */
export function cutGateOld(detail: Object3D): { made: BufferGeometry[]; removed: number } {
  detail.updateWorldMatrix(true, true);
  const made: BufferGeometry[] = [];
  let removed = 0;
  const v = new Vector3();
  detail.traverse((o) => {
    if (!isMesh(o) || (o as InstancedMesh).isInstancedMesh) return;
    const g = o.geometry;
    const pos = g.getAttribute("position");
    if (!pos) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const idx = g.index;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
    const keep: number[] = [];
    const newGroups: Array<{ start: number; count: number; materialIndex: number }> = [];
    for (const gr of groups) {
      const name = (mats[gr.materialIndex ?? 0] ?? mats[0])!.name;
      const start = keep.length;
      for (let t = gr.start; t + 2 < gr.start + gr.count; t += 3) {
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(pos, idx ? idx.getX(t + k) : t + k).applyMatrix4(o.matrixWorld);
          cx += v.x / 3;
          cy += v.y / 3;
          cz += v.z / 3;
        }
        if (isOldGatePiece(cx, cy, cz, name)) {
          removed++;
          continue;
        }
        for (let k = 0; k < 3; k++) keep.push(idx ? idx.getX(t + k) : t + k);
      }
      newGroups.push({ start, count: keep.length - start, materialIndex: gr.materialIndex ?? 0 });
    }
    const total = groups.reduce((s, gr) => s + gr.count, 0);
    if (keep.length === total) return;
    const out = new BufferGeometry();
    for (const name of Object.keys(g.attributes)) out.setAttribute(name, g.getAttribute(name));
    out.setIndex(keep);
    if (g.groups.length) for (const gr of newGroups) out.addGroup(gr.start, gr.count, gr.materialIndex);
    out.computeBoundingSphere();
    out.computeBoundingBox();
    o.geometry = out;
    made.push(out);
  });
  return { made, removed };
}

// ───────────────────────────────────────── the flagstones ─────────────────────────────────────────

/** A ring of flagstones round the fountain (r0..r1), each a bevelled slab with a joint to the next; metre UVs. */
export function flagstoneRing(r0: number, r1: number, count: number, low: boolean): BufferGeometry {
  const b = new GeoBuilder();
  const top = 0.055;
  const bevel = 0.012;
  const joint = 0.008;
  const steps = low ? 4 : 8;
  for (let k = 0; k < count; k++) {
    const tone = 0.9 + 0.1 * Math.sin(k * 2.3 + 1.1);
    const col: V3 = [tone, tone * 0.98, tone * 0.95];
    const a0 = (k / count) * Math.PI * 2;
    const a1 = ((k + 1) / count) * Math.PI * 2;
    const ja0 = a0 + joint / r0;
    const ja1 = a1 - joint / r0;
    const pt = (r: number, a: number, y: number): V3 => [r * Math.cos(a), y, r * Math.sin(a)];
    // the top face (inset by the bevel) as a strip, the bevel round it, the outer and inner edges down to the lawn
    const ri = r0 + bevel;
    const ro = r1 - bevel;
    const ab0 = ja0 + bevel / r1;
    const ab1 = ja1 - bevel / r1;
    for (let s = 0; s < steps; s++) {
      const s0 = ab0 + ((ab1 - ab0) * s) / steps;
      const s1 = ab0 + ((ab1 - ab0) * (s + 1)) / steps;
      const q = [pt(ri, s0, top), pt(ro, s0, top), pt(ro, s1, top), pt(ri, s1, top)];
      const ids = q.map((p) => b.rawVertex(p, [0, 1, 0], p[0], p[2], col));
      b.idx.push(ids[0]!, ids[2]!, ids[1]!, ids[0]!, ids[3]!, ids[2]!);
      // bevel + face on the outer and inner rims
      for (const [rTop, rLow, sign] of [[ro, r1, 1], [ri, r0, -1]] as const) {
        const n: V3 = [Math.cos((s0 + s1) / 2) * sign * 0.7, 0.7, Math.sin((s0 + s1) / 2) * sign * 0.7];
        const e = [pt(rTop, s0, top), pt(rTop, s1, top), pt(rLow, s1, top - bevel), pt(rLow, s0, top - bevel)];
        const ei = e.map((p) => b.rawVertex(p, n, p[0], p[2] + p[1], col));
        if (sign > 0) b.idx.push(ei[0]!, ei[1]!, ei[2]!, ei[0]!, ei[2]!, ei[3]!);
        else b.idx.push(ei[0]!, ei[2]!, ei[1]!, ei[0]!, ei[3]!, ei[2]!);
        const nf: V3 = [Math.cos((s0 + s1) / 2) * sign, 0, Math.sin((s0 + s1) / 2) * sign];
        const f = [pt(rLow, s0, top - bevel), pt(rLow, s1, top - bevel), pt(rLow, s1, -0.02), pt(rLow, s0, -0.02)];
        const fi = f.map((p) => b.rawVertex(p, nf, (Math.atan2(p[2], p[0]) * rLow), p[1], col));
        if (sign > 0) b.idx.push(fi[0]!, fi[1]!, fi[2]!, fi[0]!, fi[2]!, fi[3]!);
        else b.idx.push(fi[0]!, fi[2]!, fi[1]!, fi[0]!, fi[3]!, fi[2]!);
      }
    }
    // the slab's two radial ends (the joints)
    for (const [a, sign] of [[ja0, -1], [ja1, 1]] as const) {
      const n: V3 = [-Math.sin(a) * sign, 0, Math.cos(a) * sign];
      const e = [pt(r0, a, top), pt(r1, a, top), pt(r1, a, -0.02), pt(r0, a, -0.02)];
      const ei = e.map((p) => b.rawVertex(p, n, Math.hypot(p[0], p[2]), p[1], col));
      if (sign > 0) b.idx.push(ei[0]!, ei[2]!, ei[1]!, ei[0]!, ei[3]!, ei[2]!);
      else b.idx.push(ei[0]!, ei[1]!, ei[2]!, ei[0]!, ei[2]!, ei[3]!);
    }
  }
  return b.build();
}

// ───────────────────────────────────────── the Victorian lamp ─────────────────────────────────────────

/** The lamp's globes: their offset along the arm (m), centre height and radius (the old lamp's, so its night glow fits). */
export const LAMP_GLOBE = { offset: 0.6, y: 3.31, r: 0.19 } as const;

const IRON: readonly [number, number, number] = [0.42, 0.47, 0.43];

/** The cast-iron post (foot, fluted shaft, collars, the hub, the finial) as a turned design (no water). */
const LAMP_POST: FountainDesign = {
  pieces: [
    {
      profile: profile(
        [0.21, 0.0],
        [0.21, 0.05],
        [0.19, 0.07],
        arc(0.17, 0.1, 0.03, -60, 90, 4),
        [0.155, 0.16],
        [0.14, 0.24],
        [0.115, 0.34],
        [0.1, 0.44],
        [0.095, 0.5],
        arc(0.1, 0.52, 0.02, -90, 90, 3),
        [0.115, 0.56],
        [0.085, 0.6],
        [0.072, 0.63],
        [0.06, 2.74],
        [0.08, 2.78],
        arc(0.085, 2.81, 0.03, -90, 90, 4),
        [0.06, 2.85],
        [0.05, 2.98],
        arc(0.075, 3.06, 0.06, -90, 90, 6),
        [0.05, 3.14],
        [0.035, 3.3],
        arc(0.045, 3.36, 0.05, -90, 90, 6),
        [0.03, 3.44],
        [0.012, 3.62],
        [0.0, 3.64],
      ),
      tint: IRON,
      carve: (a, _r, y) => 1 - 0.16 * Math.pow(0.5 + 0.5 * Math.cos(8 * a), 3) * (y > 0.62 && y < 2.75 ? 1 : 0),
      sides: 24,
    },
    {
      // the cups that hold the globes and the caps over them (one profile each, copies at the arm's ends)
      profile: profile([0.0, 3.06], [0.04, 3.07], [0.09, 3.1], [0.105, 3.13], [0.09, 3.14], [0.07, 3.14]),
      tint: IRON,
      sides: 14,
      copies: [
        [-LAMP_GLOBE.offset, 0, 0],
        [LAMP_GLOBE.offset, 0, 0],
      ],
    },
    {
      profile: profile([0.075, 3.48], [0.1, 3.5], [0.09, 3.53], [0.06, 3.57], [0.03, 3.6], [0.02, 3.64], arc(0.0, 3.67, 0.025, -60, 90, 4), [0.0, 3.695]),
      tint: IRON,
      sides: 14,
      copies: [
        [-LAMP_GLOBE.offset, 0, 0],
        [LAMP_GLOBE.offset, 0, 0],
      ],
    },
  ],
  pools: [],
  curtains: [],
  jets: [],
  wet: () => 0,
  glow: [0, 0, 0],
  radius: 0.8,
  height: 3.8,
  uvScale: 2,
};

/** The scrolled iron work: the crossarm to both cups and an S-scroll bracket under each half. */
function lampArms(low: boolean): BufferGeometry {
  const k = low ? 0.5 : 1;
  const b = new GeoBuilder();
  for (const s of [-1, 1]) {
    // the arm: out of the hub, a gentle rise, down into the cup
    const arm: V3[] = [];
    const na = Math.round(10 * k);
    for (let i = 0; i <= na; i++) {
      const t = i / na;
      arm.push([s * (0.06 + (LAMP_GLOBE.offset - 0.06) * t), 3.07 + 0.05 * Math.sin(Math.PI * t) - 0.01 * t, 0]);
    }
    b.tube(arm, 0.017, low ? 5 : 7, [...IRON]);
    // the bracket: from the collar under the arm, out and up, curling under the arm in a scroll
    const br: V3[] = [];
    const nb = Math.round(10 * k);
    for (let i = 0; i <= nb; i++) {
      const t = i / nb;
      const x = 0.06 + 0.32 * t;
      const y = 2.84 + 0.2 * Math.sin((Math.PI / 2) * t);
      br.push([s * x, y, 0]);
    }
    // the curl at its end: a spiral inward
    const cx = 0.38;
    const cy = 2.98;
    const nc = Math.round(9 * k);
    for (let i = 1; i <= nc; i++) {
      const a = -Math.PI / 2 + (i / nc) * Math.PI * 1.6;
      const rr = 0.06 * (1 - (0.64 * i) / nc);
      br.push([s * (cx + rr * Math.cos(a)), cy + 0.06 + rr * Math.sin(a), 0]);
    }
    b.tube(br, 0.011, low ? 4 : 5, [...IRON]);
    // a small drop scroll hanging under the arm's end
    const dr: V3[] = [];
    const nd = Math.round(6 * k);
    for (let i = 0; i <= nd; i++) {
      const a = (i / nd) * Math.PI * 1.5;
      dr.push([s * (LAMP_GLOBE.offset - 0.16 + 0.04 * Math.sin(a)), 3.06 - 0.04 * (1 - Math.cos(a)), 0]);
    }
    b.tube(dr, 0.008, 4, [...IRON]);
  }
  return b.build();
}

/** One lamp's iron as one geometry (metre-ish UVs, the iron's tint in `color`). */
export function victorianLampGeometry(low: boolean): BufferGeometry {
  const post = buildFountainStone(LAMP_POST, low);
  post.clearGroups();
  const arms = lampArms(low);
  const merged = mergeGeometries([post.toNonIndexed(), arms.toNonIndexed()], false)!;
  post.dispose();
  arms.dispose();
  return merged;
}

// ───────────────────────────────────────── the topiary ─────────────────────────────────────────

/** The topiary's balls (centre height above the soil, radius) on their stem. */
export const TOPIARY_BALLS: ReadonlyArray<readonly [number, number]> = [
  [0.47, 0.45],
  [1.13, 0.33],
  [1.62, 0.23],
];

/** The stem: a slightly crooked trunk from the soil to the top ball. */
function topiaryStem(seed: number): BufferGeometry {
  const b = new GeoBuilder();
  const pts: V3[] = [];
  const top = TOPIARY_BALLS[2]![0];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push([0.012 * Math.sin(t * 5 + seed), -0.02 + top * t, 0.01 * Math.cos(t * 4 + seed)]);
  }
  b.tube(pts, 0.03, 8, [0.9, 0.85, 0.8]);
  return b.build();
}

/** A mulch mound in a planter (half width `h`), domed a little, metre UVs. */
function mulchTop(h: number): BufferGeometry {
  const b = new GeoBuilder();
  const n = 10;
  const ids: number[][] = [];
  for (let j = 0; j <= n; j++) {
    const row: number[] = [];
    for (let i = 0; i <= n; i++) {
      const x = -h + (2 * h * i) / n;
      const z = -h + (2 * h * j) / n;
      const e = 1 - Math.max(Math.abs(x), Math.abs(z)) / h;
      const y = 0.035 * Math.min(1, e * 3) + 0.005 * Math.sin(x * 23 + z * 17);
      row.push(b.rawVertex([x, y, z], [0, 1, 0], x, z, [0.95, 0.92, 0.9]));
    }
    ids.push(row);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) b.idx.push(ids[j]![i]!, ids[j + 1]![i]!, ids[j + 1]![i + 1]!, ids[j]![i]!, ids[j + 1]![i + 1]!, ids[j]![i + 1]!);
  const g = b.build();
  g.computeVertexNormals();
  return g;
}

// ───────────────────────────────────────── the install ─────────────────────────────────────────

export interface GateDressMaterials {
  plants: MeshStandardMaterial;
  soil: MeshStandardMaterial;
}

/**
 * Dress the gate lot: cut the old pieces, put in the new (into the lot's detail group, so they show with it). DEV:
 * `?gate=old` keeps the file's own (the before shots).
 */
export function dressGateLot(nodes: LotNodes, low: boolean, mats: GateDressMaterials | null): void {
  const detail = nodes.detail.get("lot_gate");
  if (!detail) return;
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("gate") === "old") return;
  const cut = cutGateOld(detail);
  nodes.own.geometries.push(...cut.made);
  // the old lamps (an instanced kind: posts, arms, two blank globes) and the old fountain's glow in its water
  detail.traverse((o) => {
    if (o.name === "lotinst__lot_gate_lamp") o.visible = false;
  });
  const fglow = nodes.night.find((n) => n.name === "lotnight__lot_gate_fountain");
  if (fglow) {
    nodes.night.splice(nodes.night.indexOf(fglow), 1);
    fglow.removeFromParent();
  }
  muteLotLampsNear(GATE_SPOTS.fountain.x, GATE_SPOTS.fountain.z, 2.5, 1.5);
  const sets = nodes.lotSets.get("lot_gate");
  sets?.add("granite_flamed");
  sets?.add("cast_iron");
  const own = (m: Material) => nodes.own.materials.push(m);
  const source = (name: string) => new MeshStandardMaterial({ name, vertexColors: true, side: DoubleSide });

  // ── the fountain ──
  const f = GATE_SPOTS.fountain;
  const stoneDry = lotSurfaceMaterial(source("LM_gatefountain_stone"), { pbr: "granite_flamed", roughnessScale: 0.92, normalScale: 0.75 });
  const stoneWet = lotSurfaceMaterial(source("LM_gatefountain_wet"), { pbr: "granite_flamed", roughnessScale: 0.32, normalScale: 0.5, albedoGain: [0.6, 0.58, 0.55] });
  stoneDry.side = stoneWet.side = FrontSide; // a closed solid
  for (const m of [stoneDry, stoneWet]) {
    nodes.surfaces.push(m);
    own(m);
  }
  const fountain = new Group();
  fountain.name = "gate_fountain";
  fountain.position.set(f.x, 0, f.z);
  const stoneGeo = buildFountainStone(GATE_FOUNTAIN, low);
  const stone = new Mesh(stoneGeo, [stoneDry, stoneWet]);
  stone.name = "gate_fountain_stone";
  stone.castShadow = true;
  const apronGeo = flagstoneRing(1.7, 2.5, 14, low);
  const apron = new Mesh(apronGeo, stoneDry);
  apron.name = "gate_fountain_flags";
  apron.receiveShadow = true;
  apron.raycast = () => {};
  const water = createStoneFountainWater(GATE_FOUNTAIN, low);
  let lastFrame = -1;
  const pool = water.group.children[0]!;
  pool.onBeforeRender = (renderer) => {
    const frame = renderer.info.render.frame;
    if (frame === lastFrame) return;
    lastFrame = frame;
    water.update(performance.now() / 1000, dayNight.applied);
  };
  fountain.add(stone, apron, water.group);
  detail.add(fountain);
  nodes.own.geometries.push(stoneGeo, apronGeo);
  const waterMats: Material[] = [];
  for (const x of water.own) {
    if (x instanceof BufferGeometry) nodes.own.geometries.push(x);
    else if ((x as Material).isMaterial) waterMats.push(x as Material);
  }
  for (const m of waterMats) own(m);
  const noise = water.uniforms.uNoise!.value as Texture;
  waterMats[0]?.addEventListener("dispose", () => noise.dispose());

  // ── the lamps ──
  const iron = lotSurfaceMaterial(source("LM_gatelamp_iron"), { pbr: "cast_iron", roughnessScale: 0.55, normalScale: 0.6 });
  iron.side = FrontSide;
  nodes.surfaces.push(iron);
  own(iron);
  const one = victorianLampGeometry(low);
  const lampGeos: BufferGeometry[] = [];
  const m4 = new Matrix4();
  for (const l of GATE_SPOTS.lamps) {
    // the old lamps' arms ran along z (their instances turned a quarter): the globes stay where the night glow is
    lampGeos.push(one.clone().applyMatrix4(m4.makeRotationY(Math.PI / 2).setPosition(l.x, 0, l.z)));
  }
  const lampsGeo = mergeGeometries(lampGeos, false)!;
  for (const g of lampGeos) g.dispose();
  one.dispose();
  const lamps = new Mesh(lampsGeo, iron);
  lamps.name = "gate_lamps_iron";
  lamps.castShadow = true;
  lamps.raycast = () => {};
  // opal globes (frosted: they glow through at night) with a bright bulb inside
  const globeGeo = new SphereGeometry(LAMP_GLOBE.r, low ? 16 : 28, low ? 12 : 20);
  const bulbGeo = new SphereGeometry(0.045, 10, 8);
  const globeMat = new MeshStandardMaterial({ name: "M_gatelamp_globe", color: new Color("#f7f2e8"), emissive: new Color("#ffe2b8"), roughness: 0.18, metalness: 0, transparent: true, opacity: 0.62, depthWrite: false });
  const bulbMat = new MeshStandardMaterial({ name: "M_gatelamp_bulb", color: new Color("#fff6e0"), emissive: new Color("#ffd28a"), roughness: 0.4 });
  nodes.glow.lamps.push(globeMat, bulbMat);
  own(globeMat);
  own(bulbMat);
  const count = GATE_SPOTS.lamps.length * 2;
  const globes = new InstancedMesh(globeGeo, globeMat, count);
  const bulbs = new InstancedMesh(bulbGeo, bulbMat, count);
  globes.name = "gate_lamps_globes";
  bulbs.name = "gate_lamps_bulbs";
  let i = 0;
  for (const l of GATE_SPOTS.lamps)
    for (const s of [-1, 1]) {
      m4.makeTranslation(l.x, LAMP_GLOBE.y, l.z + s * LAMP_GLOBE.offset);
      globes.setMatrixAt(i, m4);
      bulbs.setMatrixAt(i, m4);
      i++;
    }
  globes.renderOrder = 3;
  for (const m of [globes, bulbs]) {
    m.raycast = () => {};
    m.computeBoundingSphere();
  }
  detail.add(lamps, bulbs, globes);
  nodes.own.geometries.push(lampsGeo, globeGeo, bulbGeo);

  // ── the topiaries ──
  if (mats) {
    const ballGeo = tintForecourt(bushPlant("boxwood", low ? 1 : 0, 41), new Color(0.78, 0.9, 0.72));
    const balls = new InstancedMesh(ballGeo, mats.plants, GATE_SPOTS.planters.length * TOPIARY_BALLS.length);
    balls.name = "gate_topiary_balls";
    balls.castShadow = true;
    balls.raycast = () => {};
    const q = new Quaternion();
    const sc = new Vector3();
    const p = new Vector3();
    let k = 0;
    const loader = new TextureLoader();
    const bark = (name: string, srgb: boolean): Texture => {
      const t = loader.load(versionedUrl(`/models/village/veg/${name}`));
      t.wrapS = t.wrapT = RepeatWrapping;
      if (srgb) t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    const barkMap = bark("bark_smooth_c512.jpg", true);
    const barkNormal = bark("bark_smooth_n256.jpg", false);
    barkMap.repeat.set(1, 4);
    barkNormal.repeat.set(1, 4);
    const stemMat = new MeshStandardMaterial({ name: "LM_gate_topiary_stem", map: barkMap, normalMap: barkNormal, vertexColors: true, roughness: 0.9 });
    patchLotLight(stemMat, "gate_topiary_stem");
    stemMat.addEventListener("dispose", () => {
      barkMap.dispose();
      barkNormal.dispose();
    });
    own(stemMat);
    const stems: BufferGeometry[] = [];
    const mulch: BufferGeometry[] = [];
    GATE_SPOTS.planters.forEach((pl, n) => {
      const base = GATE_SPOTS.planterTop + 0.03;
      for (const [cy, r] of TOPIARY_BALLS) {
        // bushPlant's unit: 1 across (radius 1), 1 high (an ellipsoid of radii 1 / 0.5 sitting on y 0)
        p.set(pl.x, base + cy - r, pl.z);
        q.setFromAxisAngle(new Vector3(0, 1, 0), n * 1.7 + cy * 3.1);
        sc.set(r, 2 * r, r);
        balls.setMatrixAt(k++, m4.compose(p, q, sc));
      }
      stems.push(topiaryStem(n * 2.1).translate(pl.x, base, pl.z));
      mulch.push(mulchTop(GATE_SPOTS.soilHalf).translate(pl.x, GATE_SPOTS.planterTop - 0.012, pl.z));
    });
    balls.computeBoundingSphere();
    const stemGeo = mergeGeometries(stems, false)!;
    const mulchGeo = mergeGeometries(mulch, false)!;
    for (const g of [...stems, ...mulch]) g.dispose();
    const stem = new Mesh(stemGeo, stemMat);
    stem.name = "gate_topiary_stems";
    stem.castShadow = true;
    stem.raycast = () => {};
    const soil = new Mesh(mulchGeo, mats.soil);
    soil.name = "gate_topiary_mulch";
    soil.raycast = () => {};
    detail.add(balls, stem, soil);
    // the balustrade's urns: their green lumps (a goods-atlas blob each) become small clipped boxwood balls
    const urnKinds = detail.getObjectByName("lotinst__lot_gate_urn");
    const blob = urnKinds?.children.find((c): c is InstancedMesh => (c as InstancedMesh).isInstancedMesh && /goods/i.test(((c as Mesh).material as Material).name));
    if (blob && blob.count) {
      blob.geometry.computeBoundingBox();
      const bb = blob.geometry.boundingBox!;
      const size = bb.getSize(new Vector3());
      const centre = bb.getCenter(new Vector3());
      const r = Math.max(size.x, size.z) * 0.62;
      const urnGeo = tintForecourt(bushPlant("boxwood", low ? 2 : 1, 57), new Color(0.8, 0.92, 0.72));
      const urnBalls = new InstancedMesh(urnGeo, mats.plants, blob.count);
      urnBalls.name = "gate_urn_boxwood";
      urnBalls.raycast = () => {};
      const at = new Matrix4();
      const w = new Vector3();
      for (let u = 0; u < blob.count; u++) {
        blob.getMatrixAt(u, at);
        w.copy(centre).applyMatrix4(at);
        // sit the ball in the urn's mouth: its foot a little under the blob's lowest point
        p.set(w.x, w.y - size.y / 2 - r * 0.25, w.z);
        q.setFromAxisAngle(new Vector3(0, 1, 0), u * 2.3);
        sc.set(r, 2 * r, r);
        urnBalls.setMatrixAt(u, m4.compose(p, q, sc));
      }
      urnBalls.computeBoundingSphere();
      urnBalls.position.copy(blob.position);
      urnBalls.quaternion.copy(blob.quaternion);
      urnBalls.scale.copy(blob.scale);
      blob.visible = false;
      blob.parent!.add(urnBalls);
      nodes.own.geometries.push(urnGeo);
    }
    nodes.own.geometries.push(ballGeo, stemGeo, mulchGeo);
  }
  // the landmark pieces leave the detail group for their own, which the lots' LOD shows far beyond the detail's reach (farDressShown)
  const farGroup = new Group();
  farGroup.name = "gate_far_dress";
  detail.parent?.add(farGroup);
  const goodsGroup = detail.getObjectByName("lotgoods__lot_gate");
  const farKinds = ["lotinst__lot_gate_pennant", "lotinst__lot_gate_bulb", "lotinst__lot_gate_urn"];
  for (const n of ["gate_fountain", "gate_lamps_iron", "gate_lamps_bulbs", "gate_lamps_globes", ...detail.children.filter((c) => c.name.startsWith("gate_topiary")).map((c) => c.name)]) {
    const o = detail.getObjectByName(n);
    if (o) farGroup.attach(o);
  }
  for (const n of farKinds) {
    const o = goodsGroup?.getObjectByName(n);
    if (o) farGroup.attach(o);
  }
  nodes.far.set("lot_gate", farGroup);
  // the budget sheet's numbers: what was cut, what came in (the water's draws counted as the renderer draws them)
  let added = 0;
  let draws = 0;
  for (const o of [fountain, lamps, bulbs, globes, ...detail.children.filter((c) => c.name.startsWith("gate_topiary"))])
    o.traverse((c) => {
      if (!isMesh(c)) return;
      added += c.name === "sf_drops" ? 0 : drawnTris(c);
      draws += Array.isArray(c.material) ? c.material.length : 1;
    });
  nodes.stats.detailTriangles.lot_gate = (nodes.stats.detailTriangles.lot_gate ?? 0) + added - cut.removed;
  nodes.stats.detailDraws.lot_gate = (nodes.stats.detailDraws.lot_gate ?? 0) + draws;
  const box = nodes.boxes.find((b) => b.id === "lot_gate");
  if (box) box.detailTris = nodes.stats.detailTriangles.lot_gate;
}

