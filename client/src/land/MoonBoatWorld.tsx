import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { compileSafely } from "../game/compileSafely";
import { BulbHalos } from "./nightGlow";
import { parkMaterial, pickSet } from "./pbr";
import { projectMetreUV } from "./parkShapes";
import { villageClock } from "../village/villageClock";
import {
  MOON_BOAT_COLS,
  MOON_BOAT_ROWS,
  MOON_BOAT_SITE,
  MOON_FRAME,
  MOON_HULL,
  MOON_PIVOT_Y,
  MOON_SEAT,
  moonBoatAt,
  moonFloorY,
  moonKeelY,
  type MoonBoatState,
} from "@caysonverse/shared/land/moonBoat";
import { MOON_DECK, MOON_DECK_Y, MOON_STEPS } from "@caysonverse/shared/land/moonBoatGeometry";

type V3 = [number, number, number];
type MatKey = "velvet" | "hullOut" | "deck" | "metal" | "concrete" | "gold" | "indigoPaint" | "violet" | "cushion" | "white" | "earpink" | "ink" | "stone";

/** Which keys get UVs in metres (their material tile, m) after merging; the rest keep their own UVs (cylinders' wrap, the hull's explicit ones). */
/** Metres per texture tile. WoodFloor051 has about 24 plank rows to a tile: 3 m a tile makes a plank 12.5 cm wide (a boat deck plank is 12-15 cm). */
const METRE_TILE: Partial<Record<MatKey, number>> = { deck: 3.0, concrete: 2.2, stone: 2.2 };

/** Geometry pieces by material: non-indexed, matrix applied, merged once per material (a handful of draws per group; phone-friendly). */
class Parts {
  private readonly by = new Map<MatKey, BufferGeometry[]>();
  add(key: MatKey, g: BufferGeometry, m?: Matrix4): void {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    if (m) geo.applyMatrix4(m);
    for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") geo.deleteAttribute(name);
    const list = this.by.get(key) ?? [];
    list.push(geo);
    this.by.set(key, list);
  }
  box(key: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    const m = new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(1, 1, 1));
    this.add(key, new BoxGeometry(w, h, d), m);
  }
  soft(key: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, r = 0.06, rx = 0): void {
    const m = new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, 0, 0)), new Vector3(1, 1, 1));
    this.add(key, new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)), m);
  }
  /** A cylinder (or cone) from a to b. */
  rod(key: MatKey, a: V3, b: V3, r0: number, r1 = r0, seg = 10): void {
    const A = new Vector3(...a);
    const B = new Vector3(...b);
    const dir = B.clone().sub(A);
    const len = dir.length();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    const m = new Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new Vector3(1, 1, 1));
    this.add(key, new CylinderGeometry(r1, r0, len, seg, 1), m);
  }
  ball(key: MatKey, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 16): void {
    this.add(key, new SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))), new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(sx, sy, sz)));
  }
  tube(key: MatKey, pts: Vector3[], r: number, seg = 6): void {
    this.add(key, new TubeGeometry(new CatmullRomCurve3(pts), Math.max(8, pts.length * 3), r, seg, false));
  }
  meshes(mats: Record<MatKey, Material>): Mesh[] {
    const out: Mesh[] = [];
    for (const [key, list] of this.by) {
      let geo = mergeGeometries(list, false);
      if (!geo) continue;
      const tile = METRE_TILE[key];
      if (tile) geo = projectMetreUV(geo, tile);
      const mesh = new Mesh(geo, mats[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      out.push(mesh);
    }
    return out;
  }
}

function signTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 384;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 384);
  g.addColorStop(0, "#4b4fd8");
  g.addColorStop(1, "#262a86");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 384);
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, 1000, 360);
  ctx.lineWidth = 3;
  ctx.strokeRect(28, 28, 968, 328);
  ctx.fillStyle = "#f3efea";
  ctx.font = "bold 150px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🌙 달배", 512, 150);
  ctx.font = "46px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#f2c14e";
  ctx.fillText("MOON BOAT", 512, 250);
  ctx.font = "34px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#d8d4f5";
  ctx.fillText("흔들림이 점점 커져요 · 천천히 앉아요", 512, 318);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function starShape(r: number): Shape {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  return s;
}

// ───────────────────────────── the hull: a lofted carved boat ─────────────────────────────

const HZ = MOON_HULL.halfZ;
const GUN_H = 0.9;
const tOf = (z: number): number => Math.min(1, Math.abs(z) / HZ);
const taper = (z: number): number => Math.sqrt(Math.max(0, 1 - Math.pow(tOf(z), 3.5)));
/** The hull's widths at z: outer half width and flat half width, inner ones. */
const wOuter = (z: number): number => 0.08 + 2.14 * taper(z);
const fOuter = (z: number): number => 1.3 * taper(z);
const wInner = (z: number): number => 0.03 + 1.98 * taper(z);
const fInner = (z: number): number => 1.72 * taper(z);
/** The rim's height (boat frame): over the floor by 0.9 amidships, 0.35 at the horns. */
const rimY = (z: number): number => moonFloorY(z) + 0.35 + (GUN_H - 0.35) * (1 - Math.pow(tOf(z), 3));

const A0 = 0.38;
/** A half section at parameter a in [0,1]: a flat bottom out to f, then the wall rising to the rim at w. */
function halfSection(w: number, f: number, yb: number, yt: number, a: number): [number, number] {
  if (a <= A0) return [f * (a / A0), yb];
  const phi = ((a - A0) / (1 - A0)) * (Math.PI / 2);
  return [f + (w - f) * Math.sin(phi), yb + (yt - yb) * (1 - Math.cos(phi))];
}
const A_LIST: number[] = (() => {
  const l = [0, 0.19, A0];
  for (let k = 1; k <= 8; k++) l.push(A0 + ((1 - A0) * k) / 8);
  return l;
})();
const SIGNED: number[] = [...A_LIST.slice(1).reverse().map((a) => -a), ...A_LIST];

function outerAt(z: number, u: number): [number, number] {
  const [x, y] = halfSection(wOuter(z), fOuter(z), moonKeelY(z), rimY(z), Math.abs(u));
  return [Math.sign(u || 1) * x, y];
}
function innerAt(z: number, u: number): [number, number] {
  const [x, y] = halfSection(wInner(z), fInner(z), moonFloorY(z), rimY(z), Math.abs(u));
  return [Math.sign(u || 1) * x, y];
}

function loft(at: (z: number, u: number) => [number, number], nz: number, tile: number): BufferGeometry {
  const ns = SIGNED.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nz; i++) {
    const z = -HZ + (2 * HZ * i) / nz;
    let arc = 0;
    let px = 0;
    let py = 0;
    for (let j = 0; j < ns; j++) {
      const [x, y] = at(z, SIGNED[j]!);
      if (j > 0) arc += Math.hypot(x - px, y - py);
      px = x;
      py = y;
      pos.push(x, y, z);
      uv.push(z / tile, arc / tile);
    }
  }
  for (let i = 0; i < nz; i++)
    for (let j = 0; j < ns - 1; j++) {
      const a = i * ns + j;
      const b = a + ns;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The rim's cap: a strip between the outer and the inner rim edge on each side. */
function rimCap(nz: number): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nz; i++) {
    const z = -HZ + (2 * HZ * i) / nz;
    for (const s of [-1, 1]) {
      const [xo, yo] = outerAt(z, s);
      const [xi, yi] = innerAt(z, s);
      pos.push(xo, yo + 0.01, z, xi, yi + 0.01, z);
      uv.push(z * 0.5, 0, z * 0.5, 1);
    }
  }
  for (let i = 0; i < nz; i++)
    for (let s = 0; s < 2; s++) {
      const a = i * 4 + s * 2;
      const b = a + 4;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A pillow in the shape of a crescent (violet satin), lying flat: outer radius r. */
function crescentPillow(r: number): BufferGeometry {
  const s = new Shape();
  s.absarc(0, 0, r, Math.PI * 0.12, Math.PI * 1.88, false);
  s.absarc(r * 0.36, 0, r * 0.82, Math.PI * 1.78, Math.PI * 0.22, true);
  const g = new ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.07, bevelSegments: 4, curveSegments: 18 });
  g.translate(0, 0, -0.08);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A crescent moon standing upright (in the x-y plane), extruded `depth` thick with a soft bevel. */
function crescentGeometry(r: number, depth: number): BufferGeometry {
  const sh = new Shape();
  sh.absarc(0, 0, r, Math.PI * 0.2, Math.PI * 1.8, false);
  sh.absarc(r * 0.42, 0, r * 0.8, Math.PI * 1.72, Math.PI * 0.28, true);
  const g = new ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 3, curveSegments: 24 });
  g.translate(0, 0, -depth / 2);
  return g;
}

interface BoatBuild {
  boat: Mesh[];
  frame: Mesh[];
  boatBulbs: V3[];
  frameBulbs: V3[];
  stars: { p: V3; side: 1 | -1 }[];
}

function build(mats: Record<MatKey, Material>): BoatBuild {
  const boat = new Parts();
  const frame = new Parts();
  const boatBulbs: V3[] = [];
  const frameBulbs: V3[] = [];

  // ── the boat (axle at the origin, y up, z toward the bow) ──
  const hullOut = new Mesh(loft(outerAt, 56, 1.8), mats.hullOut);
  const hullIn = new Mesh(loft(innerAt, 56, 3.0), mats.deck);
  const cap = new Mesh(rimCap(56), mats.gold);
  for (const m of [hullOut, hullIn, cap]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  // ribs: indigo bands round the outer hull every 1.5 m, and a violet stripe along each flank, gold leaf along the keel
  const outerPt = (z: number, u: number, out = 0.03): Vector3 => {
    const [x, y] = outerAt(z, u);
    return new Vector3(x + Math.sign(u || 1) * out, y, z);
  };
  for (let z = -HZ * 0.82; z <= HZ * 0.82 + 0.01; z += 1.5) {
    const pts: Vector3[] = [];
    for (let j = 0; j < SIGNED.length; j++) pts.push(outerPt(z, SIGNED[j]!, 0.025));
    boat.tube("indigoPaint", pts, 0.05, 6);
  }
  for (const s of [-1, 1]) {
    const flank: Vector3[] = [];
    const flank2: Vector3[] = [];
    for (let z = -HZ * 0.93; z <= HZ * 0.93 + 0.01; z += 0.6) {
      flank.push(outerPt(z, s * 0.72, 0.04));
      flank2.push(outerPt(z, s * 0.9, 0.04));
    }
    boat.tube("violet", flank, 0.09, 6);
    boat.tube("gold", flank2, 0.035, 6);
  }
  const keel: Vector3[] = [];
  for (let z = -HZ * 0.97; z <= HZ * 0.97 + 0.01; z += 0.6) keel.push(new Vector3(0, moonKeelY(z) - 0.03, z));
  boat.tube("gold", keel, 0.07, 6);
  // star inlays on both flanks (instanced separately)
  const stars: { p: V3; side: 1 | -1 }[] = [];
  for (let k = 0; k < 6; k++) {
    const z = -HZ * 0.62 + (k * 1.24 * HZ) / 5;
    const [x, y] = outerAt(z, 0.8);
    stars.push({ p: [x + 0.06, y, z], side: 1 });
    stars.push({ p: [-x - 0.06, y, z], side: -1 });
  }
  // gunwale bulbs along the rim cap, small and realistic
  for (const s of [-1, 1])
    for (let z = -HZ * 0.9; z <= HZ * 0.9 + 0.01; z += 0.7) {
      const [xo, yo] = outerAt(z, s);
      const [xi] = innerAt(z, s);
      boatBulbs.push([(xo + xi) / 2, yo + 0.05, z]);
    }

  // the bench rows: a wooden terrace; each row a real bench: a seat frame, a slatted back with a carved top rail, carved dividers with gold finials and an armrest
  // each, and a tufted velvet pad (gold piping and buttons) per seat; a padded lap bar
  for (let row = 0; row < MOON_BOAT_ROWS; row++) {
    const z = MOON_SEAT.z0 - row * MOON_SEAT.dz;
    const fy = moonFloorY(z);
    const half = fInner(z) - 0.06;
    boat.box("deck", half * 2, 0.34, MOON_SEAT.dz - 0.06, 0, fy - 0.17 + 0.012, z);
    // the seat frame: a plank seat under the pads, a front skirt, gold brackets under it
    boat.box("deck", half * 2 - 0.04, 0.06, 0.62, 0, fy + 0.34, z - 0.04);
    boat.box("deck", half * 2 - 0.04, 0.12, 0.05, 0, fy + 0.28, z + 0.27);
    for (let k = 0; k <= MOON_BOAT_COLS; k++) {
      const xb = (k - MOON_BOAT_COLS / 2) * MOON_SEAT.dx;
      // a divider (an armrest and a back post): a carved board with a gold ball on its top, a rail along its top edge
      boat.box("deck", 0.05, 0.42, 0.52, xb, fy + 0.55, z - 0.03);
      boat.rod("gold", [xb, fy + 0.77, z - 0.26], [xb, fy + 0.77, z + 0.22], 0.025, 0.025, 8);
      boat.ball("gold", 0.045, xb, fy + 0.77, z + 0.25, 1, 1, 1, 10);
      boat.box("deck", 0.06, 0.82, 0.08, xb, fy + 0.7, z - 0.37); // the back post
      boat.ball("gold", 0.055, xb, fy + 1.15, z - 0.37, 1, 1, 1, 12); // its finial
      boat.rod("gold", [xb, fy + 0.15, z - 0.2], [xb, fy + 0.3, z + 0.25], 0.012, 0.012, 6); // a curved-iron bracket under the seat
    }
    // the slatted back: three planks between the posts and a carved top rail with a gold cap
    for (const yy of [0.52, 0.68, 0.84]) boat.box("deck", half * 2 - 0.08, 0.1, 0.045, 0, fy + yy, z - 0.37);
    boat.box("deck", half * 2 - 0.02, 0.08, 0.07, 0, fy + 1.07, z - 0.37);
    boat.box("gold", half * 2 - 0.02, 0.022, 0.085, 0, fy + 1.115, z - 0.37);
    for (let col = 0; col < MOON_BOAT_COLS; col++) {
      const x = (col - (MOON_BOAT_COLS - 1) / 2) * MOON_SEAT.dx;
      boat.soft("velvet", 0.72, 0.15, 0.56, x, fy + 0.425, z - 0.02, 0.07); // the seat pad (top 0.5: the hips settle onto it)
      boat.soft("velvet", 0.66, 0.34, 0.09, x, fy + 0.8, z - 0.33, 0.04, -0.1); // the back pad
      // gold piping round the seat pad's top edge and four tufting buttons on it, two on the back
      boat.rod("gold", [x - 0.36, fy + 0.5, z + 0.25], [x + 0.36, fy + 0.5, z + 0.25], 0.012, 0.012, 6);
      boat.rod("gold", [x - 0.36, fy + 0.5, z - 0.27], [x - 0.36, fy + 0.5, z + 0.25], 0.012, 0.012, 6);
      boat.rod("gold", [x + 0.36, fy + 0.5, z - 0.27], [x + 0.36, fy + 0.5, z + 0.25], 0.012, 0.012, 6);
      for (const bx of [-0.17, 0.17]) {
        for (const bz of [-0.1, 0.12]) boat.ball("gold", 0.02, x + bx, fy + 0.505, z + bz, 1, 0.7, 1, 6);
        boat.ball("gold", 0.02, x + bx, fy + 0.82, z - 0.275, 1, 1, 0.7, 6);
      }
    }
    // the lap bar: a padded indigo bar, posts at the ends with gold caps
    const by = fy + 0.82;
    boat.rod("indigoPaint", [-half + 0.18, by, z + 0.46], [half - 0.18, by, z + 0.46], 0.05, 0.05, 10);
    for (const s of [-1, 1]) {
      boat.rod("indigoPaint", [s * (half - 0.18), fy + 0.04, z + 0.46], [s * (half - 0.18), by, z + 0.46], 0.04, 0.04, 8);
      boat.ball("gold", 0.06, s * (half - 0.18), by + 0.02, z + 0.46, 1, 1, 1, 8);
    }
  }
  // the carved rail along both gunwales: turned balusters (a swelling and a ball) under a gold hand rail, a row of gilded scallops on the rim cap, gold posts at the horns
  for (const sg of [-1, 1]) {
    const rail: Vector3[] = [];
    for (let zz = -HZ * 0.86; zz <= HZ * 0.86 + 0.001; zz += 0.36) {
      const [xo, yo] = outerAt(zz, sg);
      const [xi] = innerAt(zz, sg);
      const xm = (xo + xi) / 2;
      boat.rod("deck", [xm, yo, zz], [xm, yo + 0.3, zz], 0.018, 0.018, 8);
      boat.ball("deck", 0.032, xm, yo + 0.1, zz, 1, 1.3, 1, 8);
      boat.ball("gold", 0.026, xm, yo + 0.3, zz, 1, 1, 1, 8);
      rail.push(new Vector3(xm, yo + 0.31, zz));
    }
    boat.tube("gold", rail, 0.034, 6);
    for (let zz = -HZ * 0.9; zz <= HZ * 0.9 + 0.001; zz += 0.2) {
      const [xo, yo] = outerAt(zz, sg);
      boat.ball("gold", 0.05, xo - sg * 0.01, yo + 0.015, zz, 1, 0.7, 0.8, 8);
    }
  }
  // the swing arms: a pair each side, splayed fore and aft from the axle collar to brackets on the rim (gold)
  for (const sx of [-1, 1]) {
    const x = sx * MOON_FRAME.armX;
    for (const sz of [-1, 1]) {
      const zb = sz * 0.95;
      const yb = rimY(zb) - 0.1;
      boat.rod("metal", [x, -0.15, sz * 0.12], [x, yb, zb], 0.09, 0.09, 12);
      boat.ball("gold", 0.12, x, yb, zb, 1, 1, 1, 10);
    }
    boat.rod("gold", [x, -0.35, 0], [x, 0.0, 0], 0.2, 0.2, 14);
  }

  // the bow horn: a gold finial, a violet crescent pillow and, standing behind, a gold crescent moon with the sleeping moon-rabbit curled in front of it
  const tipY = moonKeelY(HZ) + 0.38;
  boat.ball("gold", 0.26, 0, tipY - 0.1, HZ - 0.02, 1, 1, 1, 18);
  boat.add("violet", crescentPillow(0.55), new Matrix4().compose(new Vector3(0, tipY + 0.12, HZ - 0.55), new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)), new Vector3(1, 1, 1)));
  // the moon: a gold crescent upright in the boat's cross plane, behind the rabbit
  boat.add("gold", crescentGeometry(0.62, 0.16), new Matrix4().compose(new Vector3(0, tipY + 0.82, HZ - 0.3), new Quaternion().setFromEuler(new Euler(0, 0, -0.25)), new Vector3(1, 1, 1)));
  const rz = HZ - 0.58;
  const ry = tipY + 0.43;
  // the rabbit curled on its side, facing the bow: body, haunch, a head resting on its paws, cheeks and muzzle, two long ears laid back over the shoulder, a puff tail
  boat.ball("white", 0.33, 0, ry, rz, 0.95, 0.82, 1.3, 28);
  boat.ball("white", 0.24, 0.1, ry + 0.04, rz - 0.22, 1, 0.95, 1.05, 24);
  boat.ball("white", 0.095, 0, ry - 0.02, rz - 0.62, 1, 1, 1, 16);
  boat.ball("white", 0.235, 0, ry - 0.03, rz + 0.5, 1, 0.95, 1.02, 28);
  for (const sx of [-1, 1]) {
    boat.ball("white", 0.095, sx * 0.14, ry - 0.1, rz + 0.55, 1.05, 1, 1, 16);
    boat.ball("white", 0.085, sx * 0.1, ry - 0.2, rz + 0.64, 1, 0.8, 1.7, 14);
    for (const dx of [-0.025, 0, 0.025]) boat.ball("ink", 0.007, sx * 0.1 + dx, ry - 0.2, rz + 0.78, 1, 1, 1, 5);
    boat.add("ink", new TorusGeometry(0.05, 0.01, 6, 16, Math.PI), new Matrix4().compose(new Vector3(sx * 0.105, ry + 0.01, rz + 0.69), new Quaternion().setFromEuler(new Euler(0.15, sx * 0.55, Math.PI)), new Vector3(1, 1, 1)));
    boat.ball("white", 0.03, sx * 0.11, ry + 0.045, rz + 0.69, 1, 0.5, 1, 6);
    for (const dz of [-0.01, 0.015]) boat.ball("ink", 0.006, sx * 0.17, ry - 0.07 + dz, rz + 0.66, 1, 1, 1, 5);
    const eq = new Quaternion().setFromEuler(new Euler(Math.PI / 2 - 0.35, 0, sx * 0.22));
    boat.add("white", new CapsuleGeometry(0.085, 0.5, 6, 16), new Matrix4().compose(new Vector3(sx * 0.13, ry + 0.25, rz + 0.22), eq, new Vector3(1, 1, 0.5)));
    boat.add("earpink", new CapsuleGeometry(0.065, 0.42, 4, 12), new Matrix4().compose(new Vector3(sx * 0.13, ry + 0.275, rz + 0.22), eq, new Vector3(0.7, 1, 0.3)));
  }
  boat.ball("earpink", 0.032, 0, ry - 0.1, rz + 0.73, 1.2, 0.9, 1, 10);
  boat.ball("white", 0.09, 0, ry - 0.07, rz + 0.69, 1.2, 0.8, 1, 16);
  const sy = moonKeelY(-HZ) + 0.38;
  boat.ball("gold", 0.26, 0, sy - 0.1, -HZ + 0.02, 1, 1, 1, 18);
  boat.rod("gold", [0, sy, -HZ + 0.3], [0, sy + 0.85, -HZ + 0.3], 0.04, 0.04, 8);
  boat.ball("white", 0.24, 0, sy + 1.1, -HZ + 0.3, 1, 1.2, 1, 16); // the lantern glass
  boat.ball("gold", 0.1, 0, sy + 1.42, -HZ + 0.3, 1, 0.6, 1, 10);
  boatBulbs.push([0, sy + 1.1, -HZ + 0.3]);

  // ── the fixed frame (park frame relative to the site: x east, y up, z south) ──
  const zAt = (y: number): number => MOON_FRAME.footZ + (0.5 - MOON_FRAME.footZ) * ((y - 0.45) / (MOON_PIVOT_Y + 0.05));
  for (const sx of [-1, 1]) {
    const lx = sx * MOON_FRAME.legX;
    for (const sz of [-1, 1]) {
      const fz = sz * MOON_FRAME.footZ;
      frame.rod("metal", [lx, 0.45, fz], [lx, MOON_PIVOT_Y + 0.5, sz * 0.5], 0.44, 0.28, 14);
      frame.soft("concrete", 2.8, 0.5, 2.8, lx, 0.25, fz, 0.06);
      frame.rod("gold", [lx, 0.5, fz], [lx, 0.62, fz], 0.62, 0.62, 18); // the base plate
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        frame.rod("gold", [lx + Math.cos(a) * 0.52, 0.5, fz + Math.sin(a) * 0.52], [lx + Math.cos(a) * 0.52, 0.72, fz + Math.sin(a) * 0.52], 0.04, 0.04, 6); // anchor bolts
      }
      for (const f of [0.3, 0.6, 0.85]) {
        const y = 0.45 + (MOON_PIVOT_Y + 0.05) * f;
        const z = sz * zAt(y);
        frame.rod("gold", [lx, y - 0.09, z], [lx, y + 0.09, z], 0.43 - 0.15 * f, 0.43 - 0.15 * f, 16); // gold bands
      }
    }
    // cross bracing: two levels of horizontal ties with X braces between the two legs of an A-frame
    const y1 = 3.4;
    const y2 = 7.0;
    for (const y of [y1, y2]) frame.rod("metal", [lx, y, -zAt(y)], [lx, y, zAt(y)], 0.16, 0.16, 10);
    frame.rod("metal", [lx, y1, -zAt(y1)], [lx, y2, zAt(y2)], 0.1, 0.1, 8);
    frame.rod("metal", [lx, y1, zAt(y1)], [lx, y2, -zAt(y2)], 0.1, 0.1, 8);
    // the bearing housing: an indigo block, gold end caps with bolts, a violet finial
    frame.soft("indigoPaint", 1.1, 1.3, 1.5, lx, MOON_PIVOT_Y, 0, 0.12);
    frame.rod("gold", [lx + sx * 0.55, MOON_PIVOT_Y, 0], [lx + sx * 0.78, MOON_PIVOT_Y, 0], 0.72, 0.72, 24);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      frame.ball("gold", 0.05, lx + sx * 0.8, MOON_PIVOT_Y + Math.cos(a) * 0.55, Math.sin(a) * 0.55, 1, 1, 1, 8);
    }
    frame.ball("violet", 0.34, lx, MOON_PIVOT_Y + 0.98, 0, 1, 1, 1, 18);
    frame.add("gold", crescentGeometry(0.5, 0.14), new Matrix4().compose(new Vector3(lx, MOON_PIVOT_Y + 1.75, 0), new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)), new Vector3(1, 1, 1)));
    // small string-light bulbs up the legs
    for (const sz of [-1, 1])
      for (let k = 0; k < 8; k++) {
        const y = 1.4 + k * 1.45;
        frameBulbs.push([lx + sx * 0.4, y, sz * zAt(y)]);
      }
  }
  frame.rod("gold", [-MOON_FRAME.legX - 0.8, MOON_PIVOT_Y, 0], [MOON_FRAME.legX + 0.8, MOON_PIVOT_Y, 0], 0.26, 0.26, 16);

  // ── the boarding platform: a concrete podium with a plank deck flush with the hull's floor, turned-baluster rails, concrete steps with wooden nosings ──
  const dx = (MOON_DECK.x0 + MOON_DECK.x1) / 2;
  const dw = MOON_DECK.x1 - MOON_DECK.x0;
  const dd = MOON_DECK.z1 - MOON_DECK.z0;
  frame.box("concrete", dw, MOON_DECK_Y - 0.14, dd, dx, (MOON_DECK_Y - 0.14) / 2, 0);
  frame.box("deck", dw + 0.16, 0.14, dd + 0.16, dx, MOON_DECK_Y - 0.07, 0);
  frame.box("gold", dw + 0.2, 0.03, dd + 0.2, dx, MOON_DECK_Y - 0.15, 0);
  const stepsW = MOON_STEPS.z1 - MOON_STEPS.z0;
  const nSteps = 9;
  const run = (MOON_STEPS.x1 - MOON_STEPS.x0) / nSteps;
  for (let i = 0; i < nSteps; i++) {
    const h = MOON_DECK_Y * ((nSteps - i) / (nSteps + 1)) + 0.05;
    const x = MOON_STEPS.x0 + run * (i + 0.5);
    frame.box("stone", run, h, stepsW, x, h / 2, 0);
    frame.box("deck", 0.06, 0.05, stepsW + 0.1, x + run / 2 - 0.03, h, 0); // the wooden nosing
  }
  const railY = MOON_DECK_Y + 1.0;
  const baluster = (x: number, z: number): void => {
    frame.rod("white", [x, MOON_DECK_Y, z], [x, railY, z], 0.03, 0.03, 8);
  };
  for (const z of [MOON_DECK.z0 + 0.06, MOON_DECK.z1 - 0.06]) {
    frame.box("gold", dw, 0.07, 0.09, dx, railY + 0.04, z);
    frame.box("white", dw, 0.05, 0.05, dx, MOON_DECK_Y + 0.22, z);
    for (let x = MOON_DECK.x0 + 0.15; x <= MOON_DECK.x1 - 0.1; x += 0.4) baluster(x, z);
    for (const x of [MOON_DECK.x0 + 0.06, MOON_DECK.x1 - 0.06]) {
      frame.rod("indigoPaint", [x, MOON_DECK_Y, z], [x, railY + 0.18, z], 0.07, 0.07, 10);
      frame.ball("gold", 0.1, x, railY + 0.26, z, 1, 1, 1, 12);
    }
  }
  for (const [z0, z1] of [[MOON_DECK.z0, -2.4], [2.4, MOON_DECK.z1]] as const) {
    const xw = MOON_DECK.x0 + 0.06;
    frame.box("gold", 0.09, 0.07, z1 - z0, xw, railY + 0.04, (z0 + z1) / 2);
    frame.box("white", 0.05, 0.05, z1 - z0, xw, MOON_DECK_Y + 0.22, (z0 + z1) / 2);
    for (let z = z0 + 0.25; z <= z1 - 0.1; z += 0.4) baluster(xw, z);
  }
  for (const z of [-2.4, 2.4]) {
    frame.rod("indigoPaint", [MOON_DECK.x0 + 0.06, MOON_DECK_Y, z], [MOON_DECK.x0 + 0.06, railY + 0.18, z], 0.07, 0.07, 10);
    frame.ball("gold", 0.1, MOON_DECK.x0 + 0.06, railY + 0.26, z, 1, 1, 1, 12);
  }
  // the queue fence: low posts and two rails along both sides of the steps and the path to the pad, a lantern on every third post
  const fenceX0 = MOON_STEPS.x0 + 0.4;
  const fenceX1 = MOON_STEPS.x1 + 4.2;
  const stepTop = (x: number): number => Math.max(0, MOON_DECK_Y * (1 - (x - MOON_STEPS.x0) / (MOON_STEPS.x1 - MOON_STEPS.x0)) * 0.9);
  for (const z of [-2.35, 2.35]) {
    let k = 0;
    for (let x = fenceX0; x <= fenceX1 + 0.01; x += 1.4, k++) {
      const base = stepTop(x);
      const top = base + 1.0;
      frame.rod("indigoPaint", [x, base, z], [x, top, z], 0.05, 0.05, 8);
      frame.ball("gold", 0.07, x, top + 0.05, z, 1, 1, 1, 10);
      if (k % 3 === 1) {
        frame.ball("white", 0.14, x, top + 0.3, z, 1, 1.2, 1, 12);
        frameBulbs.push([x, top + 0.3, z]);
      }
    }
    for (const dy of [0.45, 0.85]) frame.rod("gold", [fenceX0, stepTop(fenceX0) + dy, z], [fenceX1, stepTop(fenceX1) + dy, z], 0.028, 0.028, 6);
  }
  // two lamp posts at the foot of the steps
  for (const z of [-2.9, 2.9]) {
    frame.rod("indigoPaint", [MOON_STEPS.x1 + 0.5, 0, z], [MOON_STEPS.x1 + 0.5, 2.7, z], 0.07, 0.07, 8);
    frame.ball("white", 0.22, MOON_STEPS.x1 + 0.5, 2.85, z, 1, 1.15, 1, 14);
    frameBulbs.push([MOON_STEPS.x1 + 0.5, 2.85, z]);
  }

  return { boat: [...boat.meshes(mats), hullOut, hullIn, cap], frame: frame.meshes(mats), boatBulbs, frameBulbs, stars };
}

const ST: MoonBoatState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, alpha: 0, rideT: 0, departsInMs: 0 };
const nightColor = new Color("#ffcf7a");

/** The 달배: a carved crescent boat swinging on a tall A-frame with the shared clock, a platform to board from, night bulbs and star inlays. */
export function MoonBoatWorld({ all }: { all: Texture[] }) {
  const gl = useThree((s) => s.gl);
  const cam = useThree((s) => s.camera);
  const root = useRef<Group>(null);
  const boatRef = useRef<Group>(null);
  const mats = useMemo<Record<MatKey, Material>>(() => {
    const flat = (color: string, extra: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial => Object.assign(new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 }), extra);
    const wood = pickSet(all, "WoodFloor051");
    const metal = pickSet(all, "PaintedMetal013");
    const conc = pickSet(all, "Concrete034");
    const plas = pickSet(all, "Plaster003");
    return {
      hullOut: parkMaterial(plas, 1, { color: new Color(1.22, 1.16, 1.0), normalScale: 0.5, side: DoubleSide }),
      deck: parkMaterial(wood, 1, { color: new Color(1.9, 1.62, 1.3), normalScale: 0.9, side: DoubleSide }),
      metal: parkMaterial(metal, [2, 6], { useColor: false, color: new Color("#4a52dc"), normalScale: 0.5, metalness: 0.45 }),
      concrete: parkMaterial(conc, 1, { color: new Color("#e8e1d3"), normalScale: 0.8 }),
      stone: parkMaterial(conc, 1, { color: new Color("#d9d1c3"), normalScale: 0.9 }),
      gold: flat("#f2c14e", { roughness: 0.32, metalness: 0.5, emissive: new Color("#6b4a08"), emissiveIntensity: 0.6, side: DoubleSide }),
      indigoPaint: flat("#3a3ea8", { roughness: 0.4, metalness: 0.2 }),
      violet: flat("#8b5cf6", { roughness: 0.45 }),
      cushion: flat("#ee9dbb", { roughness: 0.7, emissive: new Color("#40182a"), emissiveIntensity: 0.35 }),
      velvet: flat("#7a66d0", { roughness: 0.9, emissive: new Color("#2a2070"), emissiveIntensity: 0.7 }),
      white: flat("#fbf4e6", { roughness: 0.8, emissive: new Color("#8a7c60"), emissiveIntensity: 0.55 }),
      earpink: flat("#f3a5be", { roughness: 0.8 }),
      ink: flat("#2c2440", { roughness: 0.8 }),
    };
  }, [all]);
  const built = useMemo(() => build(mats), [mats]);
  const bulbGeo = useMemo(() => new SphereGeometry(0.03, 8, 6), []);
  const bulbMat = useMemo(() => new MeshStandardMaterial({ color: "#fff1c8", emissive: nightColor, emissiveIntensity: 1.8, roughness: 0.3 }), []);
  const boatBulbRef = useRef<InstancedMesh>(null);
  const frameBulbRef = useRef<InstancedMesh>(null);
  const starRef = useRef<InstancedMesh>(null);
  const starGeo = useMemo(() => {
    const g = new ExtrudeGeometry(starShape(0.3), { depth: 0.035, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1 });
    g.translate(0, 0, -0.02);
    g.rotateY(Math.PI / 2);
    return g;
  }, []);
  const starMat = useMemo(() => new MeshStandardMaterial({ color: "#f2c14e", emissive: new Color("#f2c14e"), emissiveIntensity: 0.3, metalness: 0.8, roughness: 0.3 }), []);
  const sign = useMemo(signTexture, []);
  const signMat = useMemo(() => new MeshStandardMaterial({ map: sign, emissive: new Color("#ffffff"), emissiveMap: sign, emissiveIntensity: 0.2, roughness: 0.6 }), [sign]);
  const goldMat = mats.gold;

  useEffect(() => {
    const m = new Matrix4();
    built.boatBulbs.forEach((p, i) => {
      m.makeTranslation(p[0], p[1], p[2]);
      boatBulbRef.current?.setMatrixAt(i, m);
    });
    built.frameBulbs.forEach((p, i) => {
      m.makeTranslation(p[0], p[1], p[2]);
      frameBulbRef.current?.setMatrixAt(i, m);
    });
    if (boatBulbRef.current) boatBulbRef.current.instanceMatrix.needsUpdate = true;
    if (frameBulbRef.current) frameBulbRef.current.instanceMatrix.needsUpdate = true;
    built.stars.forEach((s, i) => {
      m.makeRotationY(s.side > 0 ? 0 : Math.PI);
      m.setPosition(s.p[0], s.p[1], s.p[2]);
      starRef.current?.setMatrixAt(i, m);
    });
    if (starRef.current) starRef.current.instanceMatrix.needsUpdate = true;
  }, [built]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        if (root.current) void compileSafely(gl, root.current, cam);
      } catch {
        /* an optimisation only */
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [gl, cam, built]);

  useFrame(() => {
    const st = moonBoatAt(villageClock.liveMs(), ST);
    // three's rotation about +x by a maps (y, z) -> (y cos a - z sin a, y sin a + z cos a): the boat's swing is its negative
    if (boatRef.current) boatRef.current.rotation.x = -st.angle;
  });

  return (
    <group ref={root}>
      <group position={[MOON_BOAT_SITE.x, 0, MOON_BOAT_SITE.z]}>
        {built.frame.map((m, i) => (
          <primitive key={i} object={m} />
        ))}
        <instancedMesh ref={frameBulbRef} args={[bulbGeo, bulbMat, built.frameBulbs.length]} frustumCulled={false} dispose={null} />
        <BulbHalos places={built.frameBulbs} size={0.7} strength={0.8} />
        <group ref={boatRef} position={[0, MOON_PIVOT_Y, 0]}>
          {built.boat.map((m, i) => (
            <primitive key={i} object={m} />
          ))}
          <instancedMesh ref={boatBulbRef} args={[bulbGeo, bulbMat, built.boatBulbs.length]} frustumCulled={false} dispose={null} />
          <instancedMesh ref={starRef} args={[starGeo, starMat, built.stars.length]} frustumCulled={false} dispose={null} />
          <BulbHalos places={built.boatBulbs} size={0.3} strength={0.35} />
        </group>
        <mesh position={[MOON_STEPS.x1 + 1.5, 2.1, -4.6]} rotation={[0, Math.PI / 2, 0]} material={signMat}>
          <planeGeometry args={[4.2, 1.575]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[MOON_STEPS.x1 + 1.46, 1.05, -4.6 + s * 1.95]} material={goldMat}>
            <cylinderGeometry args={[0.07, 0.07, 2.1, 10]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
