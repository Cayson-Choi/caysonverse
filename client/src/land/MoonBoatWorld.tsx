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
  LatheGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { compileSafely } from "../game/compileSafely";
import { BulbHalos } from "./nightGlow";
import { parkMaterial, pickSet } from "./pbr";
import { projectMetreUV } from "./parkShapes";
import { rideMs } from "./rideClock";
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
type MatKey = "ivory" | "gilt" | "gilt2" | "brass" | "steel" | "chrome" | "hullWood" | "goldBright" | "velvet" | "hullOut" | "deck" | "metal" | "concrete" | "gold" | "indigoPaint" | "violet" | "cushion" | "white" | "earpink" | "ink" | "stone";

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
      uv.push(arc / tile, z / tile);
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
function crescentGeometry(r: number, depth: number, bevel = 0.04): BufferGeometry {
  const sh = new Shape();
  sh.absarc(0, 0, r, Math.PI * 0.2, Math.PI * 1.8, false);
  sh.absarc(r * 0.42, 0, r * 0.8, Math.PI * 1.72, Math.PI * 0.28, true);
  const g = new ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 28 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Tufted leather: a 1024 px diamond-tufted, grained height map turned into a normal map, a deep violet colour map with the creases darkened (anisotropic, repeating). */
function leatherMaterial(): MeshStandardMaterial {
  const N = 1024;
  const h = new Float32Array(N * N);
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const lat = (cells: number): Float32Array => Float32Array.from({ length: cells * cells }, rnd);
  const octave = (g: Float32Array, cells: number, x: number, y: number): number => {
    const fx = (x / N) * cells;
    const fy = (y / N) * cells;
    const x0 = Math.floor(fx) % cells;
    const y0 = Math.floor(fy) % cells;
    const x1 = (x0 + 1) % cells;
    const y1 = (y0 + 1) % cells;
    const tx = fx - Math.floor(fx);
    const ty = fy - Math.floor(fy);
    const a = g[y0 * cells + x0]! * (1 - tx) + g[y0 * cells + x1]! * tx;
    const b = g[y1 * cells + x0]! * (1 - tx) + g[y1 * cells + x1]! * tx;
    return a * (1 - ty) + b * ty;
  };
  const g1 = lat(128);
  const g2 = lat(256);
  const col = new Uint8ClampedArray(new ArrayBuffer(N * N * 4));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const a = (x / N) * 4 + (y / N) * 4;
      const b = (x / N) * 4 - (y / N) * 4;
      const fa = Math.abs((((a % 2) + 2) % 2) - 1);
      const fb = Math.abs((((b % 2) + 2) % 2) - 1);
      const pillow = Math.pow(Math.min(1, Math.min(fa, fb) * 1.6), 0.7); // 0 in the creases, 1 on the cushion
      const grain = octave(g1, 128, x, y) * 0.6 + octave(g2, 256, x, y) * 0.4;
      const v = pillow * 0.75 + grain * 0.12;
      h[y * N + x] = v;
      const shade = 0.55 + 0.45 * pillow;
      const o = (y * N + x) * 4;
      col[o] = (150 + grain * 30) * shade;
      col[o + 1] = (38 + grain * 14) * shade;
      col[o + 2] = (52 + grain * 16) * shade;
      col[o + 3] = 255;
    }
  const nrm = new Uint8ClampedArray(new ArrayBuffer(N * N * 4));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const xl = h[y * N + ((x + N - 1) % N)]!;
      const xr = h[y * N + ((x + 1) % N)]!;
      const yu = h[((y + N - 1) % N) * N + x]!;
      const yd = h[((y + 1) % N) * N + x]!;
      let nx = (xl - xr) * 6;
      let ny = (yu - yd) * 6;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      const o = (y * N + x) * 4;
      nrm[o] = (nx * 0.5 + 0.5) * 255;
      nrm[o + 1] = (ny * 0.5 + 0.5) * 255;
      nrm[o + 2] = (nz / l * 0.5 + 0.5) * 255;
      nrm[o + 3] = 255;
    }
  const make = (data: Uint8ClampedArray<ArrayBuffer>, srgb: boolean): CanvasTexture => {
    const c = document.createElement("canvas");
    c.width = c.height = N;
    c.getContext("2d")!.putImageData(new ImageData(data, N, N), 0, 0);
    const t = new CanvasTexture(c);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = SRGBColorSpace;
    return t;
  };
  return new MeshStandardMaterial({ map: make(col, true), normalMap: make(nrm, false), normalScale: new Vector2(1, 1), roughness: 0.42, metalness: 0.0, side: DoubleSide, emissive: new Color("#3a1018"), emissiveIntensity: 0.45 });
}

/** A turned brass finial (a base disc, a neck, a bead, a swell and a point), `r` the bead's radius: about 2.4 r tall. */
function finialGeometry(r: number): BufferGeometry {
  const pts: [number, number][] = [[0, 0], [1.1, 0], [1.1, 0.18], [0.5, 0.34], [0.42, 0.62], [0.9, 0.95], [1.0, 1.3], [0.75, 1.7], [0.32, 2.05], [0, 2.3]];
  return new LatheGeometry(pts.map(([x, y]) => new Vector2(x * r, y * r)), 12);
}

/** A tufted cushion top: a w x d surface pillowed toward its middle and pulled down into a dimple at every button of a quincunx lattice (nx x nz cells), UVs 0..2. Faces +y. */
function tuftedCap(w: number, d: number, nx: number, nz: number, amp: number): BufferGeometry {
  const sx = 16;
  const sz = 12;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const fr = (v: number): number => v - Math.floor(v);
  for (let j = 0; j <= sz; j++)
    for (let i = 0; i <= sx; i++) {
      const u = i / sx;
      const v = j / sz;
      const e = Math.min(u, 1 - u, v, 1 - v);
      const bulge = Math.sin(Math.min(1, e * 3.2) * (Math.PI / 2));
      const a = u * nx;
      const b = v * nz;
      const d1 = Math.hypot(fr(a) - 0.5, fr(b) - 0.5);
      const d2 = Math.hypot(fr(a + 0.5) - 0.5, fr(b + 0.5) - 0.5);
      const dm = Math.min(d1, d2);
      const dimple = Math.exp(-Math.pow(dm * 3.6, 2));
      pos.push((u - 0.5) * w, amp * bulge * (1 - 0.85 * dimple), (v - 0.5) * d);
      uv.push(u * 2, v * 2);
    }
  for (let j = 0; j < sz; j++)
    for (let i = 0; i < sx; i++) {
      const a = j * (sx + 1) + i;
      const b = a + sx + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
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
  const fin = (r: number, x: number, y: number, z: number): void => boat.add('brass', finialGeometry(r), new Matrix4().makeTranslation(x, y, z));

  // ── the boat (axle at the origin, y up, z toward the bow) ──
  const hullOut = new Mesh(loft(outerAt, 56, 3.0), mats.hullWood);
  const hullIn = new Mesh(loft(innerAt, 56, 3.0), mats.deck);
  const cap = new Mesh(rimCap(56), mats.gold);
  for (const m of [hullOut, hullIn, cap]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  // the planking: black caulked seams between the strakes, brass rivet rows along two of them, then the painted flank stripes and the gilt keel
  const outerPt = (z: number, u: number, out = 0.03): Vector3 => {
    const [x, y] = outerAt(z, u);
    return new Vector3(x + Math.sign(u || 1) * out, y, z);
  };
  for (const sg of [-1, 1])
    for (const u of [0.12, 0.3, 0.46, 0.6, 0.86]) {
      const seam: Vector3[] = [];
      for (let z = -HZ * 0.96; z <= HZ * 0.96 + 0.01; z += 0.6) seam.push(outerPt(z, sg * u, 0.012));
      boat.tube("ink", seam, 0.011, 4);
    }
  for (const sg of [-1, 1])
    for (const u of [0.3, 0.6]) for (let z = -HZ * 0.9; z <= HZ * 0.9 + 0.01; z += 0.36) {
      const q = outerPt(z, sg * u, 0.014);
      boat.ball("brass", 0.02, q.x, q.y + 0.045, q.z, 1, 1, 0.6, 6);
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
  // a string of bulbs along each flank stripe
  for (const sg of [-1, 1]) for (let z = -HZ * 0.85; z <= HZ * 0.85 + 0.01; z += 1.2) { const q = outerPt(z, sg * 0.9, 0.08); boatBulbs.push([q.x, q.y, q.z]); }
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
      fin(0.016, xb, fy + 0.78, z + 0.25);
      boat.box("deck", 0.06, 0.82, 0.08, xb, fy + 0.7, z - 0.37); // the back post
      fin(0.02, xb, fy + 1.11, z - 0.37); // its turned brass finial
      boat.rod("gold", [xb, fy + 0.15, z - 0.2], [xb, fy + 0.3, z + 0.25], 0.012, 0.012, 6); // a curved-iron bracket under the seat
    }
    // the slatted back: three planks between the posts and a carved top rail with a gold cap
    for (const yy of [0.52, 0.68, 0.84]) boat.box("deck", half * 2 - 0.08, 0.1, 0.045, 0, fy + yy, z - 0.37);
    boat.box("deck", half * 2 - 0.02, 0.08, 0.07, 0, fy + 1.07, z - 0.37);
    boat.box("gold", half * 2 - 0.02, 0.022, 0.085, 0, fy + 1.115, z - 0.37);
    for (let col = 0; col < MOON_BOAT_COLS; col++) {
      const x = (col - (MOON_BOAT_COLS - 1) / 2) * MOON_SEAT.dx;
      boat.soft("velvet", 0.72, 0.1, 0.56, x, fy + 0.45, z - 0.02, 0.04); // the seat pad's body (top 0.5: the hips settle onto it)
      boat.add("velvet", tuftedCap(0.7, 0.54, 4, 3, 0.045), new Matrix4().makeTranslation(x, fy + 0.5, z - 0.02)); // its tufted, buttoned top
      boat.soft("velvet", 0.66, 0.3, 0.07, x, fy + 0.8, z - 0.34, 0.03, -0.1); // the back pad's body
      boat.add("velvet", tuftedCap(0.64, 0.32, 4, 2, 0.04), new Matrix4().compose(new Vector3(x, fy + 0.8, z - 0.298), new Quaternion().setFromEuler(new Euler(Math.PI / 2 - 0.1, 0, 0)), new Vector3(1, 1, 1))); // its tufted face
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
    boat.rod("chrome", [-half + 0.18, by, z + 0.46], [half - 0.18, by, z + 0.46], 0.032, 0.032, 12);
    for (let col = 0; col < MOON_BOAT_COLS; col++) {
      const x = (col - (MOON_BOAT_COLS - 1) / 2) * MOON_SEAT.dx;
      boat.rod("velvet", [x - 0.3, by, z + 0.46], [x + 0.3, by, z + 0.46], 0.06, 0.06, 12); // the padded sleeve over each rider's lap
    }
    for (const s of [-1, 1]) {
      boat.rod("chrome", [s * (half - 0.18), fy + 0.04, z + 0.46], [s * (half - 0.18), by, z + 0.46], 0.03, 0.03, 10);
      fin(0.02, s * (half - 0.18), by + 0.03, z + 0.46);
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
      boat.ball("deck", 0.026, xm, yo + 0.1, zz, 1, 1.25, 1, 8);
      fin(0.011, xm, yo + 0.3, zz);
      rail.push(new Vector3(xm, yo + 0.31, zz));
    }
    boat.tube("gold", rail, 0.034, 6);
    for (let zz = -HZ * 0.9; zz <= HZ * 0.9 + 0.001; zz += 0.45) {
      const [xo, yo] = outerAt(zz, sg);
      boat.ball("brass", 0.014, xo - sg * 0.01, yo + 0.012, zz, 1, 0.6, 0.8, 6);
    }
  }
  // the swing arms (28 m long): a pair each side, splayed fore and aft from the axle collar to brackets on the rim: steel tubes with ring clamps, cross ties and X braces every 4 m
  for (const sx of [-1, 1]) {
    const x = sx * MOON_FRAME.armX;
    const yTop = -0.15;
    const zb = 0.95;
    const yb = rimY(zb) - 0.1;
    for (const sz of [-1, 1]) {
      boat.rod("steel", [x, yTop, sz * 0.12], [x, yb, sz * zb], 0.14, 0.14, 12);
      boat.ball("gold", 0.2, x, yb, sz * zb, 1, 1, 1, 12);
      boat.rod("gold", [x, yb + 0.25, sz * zb], [x, yb - 0.25, sz * zb], 0.19, 0.19, 12); // the bracket collar
    }
    const nArm = 7;
    for (let k = 1; k <= nArm; k++) {
      const f = k / (nArm + 1);
      const y = yTop + (yb - yTop) * f;
      const z = 0.12 + (zb - 0.12) * f;
      boat.rod("steel", [x, y, -z], [x, y, z], 0.06, 0.06, 6); // a cross tie
      for (const sz of [-1, 1]) boat.rod("gold", [x, y - 0.1, sz * z], [x, y + 0.1, sz * z], 0.17, 0.17, 10); // a ring clamp
      if (k < nArm) {
        const f2 = (k + 1) / (nArm + 1);
        const y2 = yTop + (yb - yTop) * f2;
        const z2 = 0.12 + (zb - 0.12) * f2;
        boat.rod("steel", [x, y, -z], [x, y2, z2], 0.035, 0.035, 5);
        boat.rod("steel", [x, y, z], [x, y2, -z2], 0.035, 0.035, 5);
      }
      if (k % 2 === 0) boatBulbs.push([x + sx * 0.2, y, 0]);
    }
    boat.rod("gold", [x, -0.35, 0], [x, 0.0, 0], 0.26, 0.26, 14);
  }

  // the bow horn: a gold finial, a violet crescent pillow and, standing behind, a gold crescent moon with the sleeping moon-rabbit curled in front of it
  const tipY = moonKeelY(HZ) + 0.38;
  boat.ball("gold", 0.26, 0, tipY - 0.1, HZ - 0.02, 1, 1, 1, 18);
  boat.add("velvet", crescentPillow(0.55), new Matrix4().compose(new Vector3(0, tipY + 0.12, HZ - 0.55), new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)), new Vector3(1, 1, 1)));
  // the moon: a gold crescent upright in the boat's cross plane, behind the rabbit
  // the moon: a gilded crescent carved with a raised inner moulding and a row of brass studs
  boat.add("gilt", crescentGeometry(0.62, 0.16, 0.075), new Matrix4().compose(new Vector3(0, tipY + 0.82, HZ - 0.3), new Quaternion().setFromEuler(new Euler(0, 0, -0.25)), new Vector3(1, 1, 1)));
  boat.add("gilt2", crescentGeometry(0.5, 0.2, 0.05), new Matrix4().compose(new Vector3(0.04, tipY + 0.82, HZ - 0.3), new Quaternion().setFromEuler(new Euler(0, 0, -0.25)), new Vector3(1, 1, 1)));
  for (let k = 0; k < 9; k++) {
    const an = Math.PI * 0.28 + (k / 8) * Math.PI * 1.44 - 0.25;
    boat.ball("brass", 0.018, Math.cos(an) * 0.6, tipY + 0.82 + Math.sin(an) * 0.6, HZ - 0.3 - 0.13, 1, 1, 1, 6);
  }
  boat.add("goldBright", crescentGeometry(0.01, 0.01), new Matrix4().compose(new Vector3(0, tipY + 0.82, HZ - 0.3), new Quaternion().setFromEuler(new Euler(0, 0, -0.25)), new Vector3(1, 1, 1)));
  const rz = HZ - 0.58;
  const ry = tipY + 0.43;
  // the rabbit curled on its side, facing the bow: body, haunch, a head resting on its paws, cheeks and muzzle, two long ears laid back over the shoulder, a puff tail
  boat.ball("ivory", 0.33, 0, ry, rz, 0.95, 0.82, 1.3, 28);
  boat.ball("ivory", 0.24, 0.1, ry + 0.04, rz - 0.22, 1, 0.95, 1.05, 24);
  boat.ball("ivory", 0.095, 0, ry - 0.02, rz - 0.62, 1, 1, 1, 16);
  boat.ball("ivory", 0.235, 0, ry - 0.03, rz + 0.5, 1, 0.95, 1.02, 28);
  for (const sx of [-1, 1]) {
    boat.ball("ivory", 0.095, sx * 0.14, ry - 0.1, rz + 0.55, 1.05, 1, 1, 16);
    boat.ball("ivory", 0.085, sx * 0.1, ry - 0.2, rz + 0.64, 1, 0.8, 1.7, 14);
    for (const dx of [-0.025, 0, 0.025]) boat.ball("ink", 0.007, sx * 0.1 + dx, ry - 0.2, rz + 0.78, 1, 1, 1, 5);
    boat.add("ink", new TorusGeometry(0.05, 0.01, 6, 16, Math.PI), new Matrix4().compose(new Vector3(sx * 0.105, ry + 0.01, rz + 0.69), new Quaternion().setFromEuler(new Euler(0.15, sx * 0.55, Math.PI)), new Vector3(1, 1, 1)));
    boat.ball("ivory", 0.03, sx * 0.11, ry + 0.045, rz + 0.69, 1, 0.5, 1, 6);
    for (const dz of [-0.01, 0.015]) boat.ball("ink", 0.006, sx * 0.17, ry - 0.07 + dz, rz + 0.66, 1, 1, 1, 5);
    const eq = new Quaternion().setFromEuler(new Euler(Math.PI / 2 - 0.35, 0, sx * 0.22));
    boat.add("ivory", new CapsuleGeometry(0.085, 0.5, 6, 16), new Matrix4().compose(new Vector3(sx * 0.13, ry + 0.25, rz + 0.22), eq, new Vector3(1, 1, 0.5)));
    boat.add("earpink", new CapsuleGeometry(0.065, 0.42, 4, 12), new Matrix4().compose(new Vector3(sx * 0.13, ry + 0.275, rz + 0.22), eq, new Vector3(0.7, 1, 0.3)));
  }
  boat.ball("earpink", 0.032, 0, ry - 0.1, rz + 0.73, 1.2, 0.9, 1, 10);
  boat.ball("ivory", 0.09, 0, ry - 0.07, rz + 0.69, 1.2, 0.8, 1, 16);
  const sy = moonKeelY(-HZ) + 0.38;
  boat.ball("gold", 0.26, 0, sy - 0.1, -HZ + 0.02, 1, 1, 1, 18);
  boat.rod("gold", [0, sy, -HZ + 0.3], [0, sy + 0.85, -HZ + 0.3], 0.04, 0.04, 8);
  boat.ball("white", 0.24, 0, sy + 1.1, -HZ + 0.3, 1, 1.2, 1, 16); // the lantern glass
  boat.ball("gold", 0.1, 0, sy + 1.42, -HZ + 0.3, 1, 0.6, 1, 10);
  boatBulbs.push([0, sy + 1.1, -HZ + 0.3]);

  // ── the fixed frame (park frame relative to the site: x east, y up, z south): two A-frames of tubular steel lattice, each leg two chords joined by rungs, zig-zag
  // diagonals and bolted gusset plates, 30 m to the axle; concrete footings with base plates and anchor bolts; ties and X braces between the legs ──
  const HY = MOON_PIVOT_Y + 0.05;
  const zAt = (y: number): number => MOON_FRAME.footZ + (0.5 - MOON_FRAME.footZ) * ((y - 0.45) / HY);
  const CH = MOON_FRAME.chord;
  for (const sx of [-1, 1]) {
    const lx = sx * MOON_FRAME.legX;
    for (const sz of [-1, 1]) {
      const fz = sz * MOON_FRAME.footZ;
      for (const c of [-CH, CH]) {
        frame.rod("steel", [lx + c, 0.45, fz], [lx + c, MOON_PIVOT_Y + 0.5, sz * 0.5], MOON_FRAME.chordR + 0.05, MOON_FRAME.chordR - 0.05, 12);
        frame.soft("concrete", 1.7, 0.5, 1.7, lx + c, 0.25, fz, 0.05);
        frame.rod("gold", [lx + c, 0.5, fz], [lx + c, 0.6, fz], 0.42, 0.42, 16); // the base plate
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
          frame.rod("chrome", [lx + c + Math.cos(a) * 0.32, 0.5, fz + Math.sin(a) * 0.32], [lx + c + Math.cos(a) * 0.32, 0.7, fz + Math.sin(a) * 0.32], 0.035, 0.035, 6); // anchor bolts
        }
      }
      // the lattice between the two chords: a rung and a diagonal at every node (2 m along the leg)
      const nodes = 16;
      for (let k = 0; k <= nodes; k++) {
        const f = (k / nodes) * 0.97 + 0.02;
        const y = 0.6 + (MOON_PIVOT_Y - 0.4) * f;
        const z = sz * zAt(y);
        frame.rod("steel", [lx - CH, y, z], [lx + CH, y, z], 0.05, 0.05, 6);
        if (k < nodes) {
          const f2 = ((k + 1) / nodes) * 0.97 + 0.02;
          const y2 = 0.6 + (MOON_PIVOT_Y - 0.4) * f2;
          const z2 = sz * zAt(y2);
          const a = k % 2 === 0 ? -CH : CH;
          frame.rod("steel", [lx + a, y, z], [lx - a, y2, z2], 0.04, 0.04, 6);
        }
        // a gusset plate with four bolts at the node, and a night bulb on the outer chord
        frame.box("steel", 2 * CH + 0.3, 0.34, 0.07, lx, y, z + sz * 0.0);
        for (const bx of [-CH - 0.1, -CH + 0.1, CH - 0.1, CH + 0.1]) frame.ball("chrome", 0.03, lx + bx, y, z + sz * 0.05, 1, 1, 0.7, 6);
        if (k % 2 === 0) frameBulbs.push([lx + sx * (CH + 0.28), y, z]);
      }
      // painted collars (gold bands) on the chords
      for (const f of [0.3, 0.6, 0.85]) {
        const y = 0.45 + HY * f;
        const z = sz * zAt(y);
        for (const c of [-CH, CH]) frame.rod("gold", [lx + c, y - 0.09, z], [lx + c, y + 0.09, z], 0.3 - 0.1 * f, 0.3 - 0.1 * f, 14);
      }
    }
    // ties and X braces between the two legs of an A-frame, four levels, on both chords
    const levels = [5, 11, 17, 23];
    for (const c of [-CH, CH]) {
      for (let i = 0; i < levels.length; i++) {
        const y = levels[i]!;
        frame.rod("steel", [lx + c, y, -zAt(y)], [lx + c, y, zAt(y)], 0.14, 0.14, 8);
        frame.ball("gold", 0.2, lx + c, y, zAt(y), 1, 1, 1, 10);
        frame.ball("gold", 0.2, lx + c, y, -zAt(y), 1, 1, 1, 10);
        if (i + 1 < levels.length) {
          const y2 = levels[i + 1]!;
          frame.rod("steel", [lx + c, y, -zAt(y)], [lx + c, y2, zAt(y2)], 0.09, 0.09, 6);
          frame.rod("steel", [lx + c, y, zAt(y)], [lx + c, y2, -zAt(y2)], 0.09, 0.09, 6);
        }
      }
    }
    // the bearing housing: a steel block, gold end caps with bolts, a violet finial
    frame.soft("indigoPaint", 1.5, 1.7, 1.9, lx, MOON_PIVOT_Y, 0, 0.14);
    frame.rod("gold", [lx + sx * 0.75, MOON_PIVOT_Y, 0], [lx + sx * 1.0, MOON_PIVOT_Y, 0], 0.9, 0.9, 24);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      frame.ball("chrome", 0.06, lx + sx * 1.02, MOON_PIVOT_Y + Math.cos(a) * 0.68, Math.sin(a) * 0.68, 1, 1, 1, 8);
    }
    frame.ball("violet", 0.42, lx, MOON_PIVOT_Y + 1.25, 0, 1, 1, 1, 18);
    frame.add("goldBright", crescentGeometry(0.7, 0.18), new Matrix4().compose(new Vector3(lx, MOON_PIVOT_Y + 2.3, 0), new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)), new Vector3(1, 1, 1)));
    frameBulbs.push([lx, MOON_PIVOT_Y + 2.3, 0], [lx + sx * 0.4, MOON_PIVOT_Y + 3.1, 0]);
  }
  frame.rod("gold", [-MOON_FRAME.legX - CH - 1.0, MOON_PIVOT_Y, 0], [MOON_FRAME.legX + CH + 1.0, MOON_PIVOT_Y, 0], 0.3, 0.3, 16);

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
    frame.box("deck", 0.06, 0.05, stepsW + 0.1, x + run / 2 - 0.02, h, 0); // the wooden nosing (1 cm proud of the riser: flush it z-fought the step's face)
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
      // lacquered mahogany strakes: the plank map tinted a deep red-brown, the gloss up (roughness scales its map), a little glow so the shade stays wood
      hullWood: parkMaterial(wood, 1, { color: new Color(1.5, 0.78, 0.5), normalScale: 1.0, side: DoubleSide, roughness: 0.62, metalness: 0.02, emissive: new Color("#5a2a14"), emissiveIntensity: 0.5 }),
      // painted tubular steel: the paint's own normal and gloss maps, a deep indigo-blue, a glow floor for the shade
      steel: parkMaterial(metal, [2, 10], { useColor: false, color: new Color("#2d38b0"), normalScale: 0.6, metalness: 0.4, roughness: 0.8, emissive: new Color("#1a2290"), emissiveIntensity: 0.45 }),
      chrome: flat("#e4eaf4", { roughness: 0.25, metalness: 0.7, emissive: new Color("#a7b2cc"), emissiveIntensity: 0.9 }),
      brass: flat("#d8a73f", { roughness: 0.3, metalness: 0.35, emissive: new Color("#5c3f0b"), emissiveIntensity: 0.55, side: DoubleSide }),
      gilt: flat("#ecc055", { roughness: 0.32, metalness: 0.25, emissive: new Color("#a07414"), emissiveIntensity: 1.0, side: DoubleSide }),
      gilt2: flat("#f8dd88", { roughness: 0.28, metalness: 0.25, emissive: new Color("#b8861a"), emissiveIntensity: 1.1, side: DoubleSide }),
      ivory: flat("#fff8ee", { roughness: 0.55, emissive: new Color("#a8957a"), emissiveIntensity: 1.0 }),
      deck: parkMaterial(wood, 1, { color: new Color(1.9, 1.62, 1.3), normalScale: 0.9, side: DoubleSide, emissive: new Color("#6a4524"), emissiveIntensity: 0.55 }), // the emissive floor keeps wood brown, not black, where the sun does not reach (the posts and bench backs in shade)
      metal: parkMaterial(metal, [2, 6], { useColor: false, color: new Color("#4a52dc"), normalScale: 0.5, metalness: 0.45, emissive: new Color("#2a30a0"), emissiveIntensity: 0.5 }),
      concrete: parkMaterial(conc, 1, { color: new Color("#e8e1d3"), normalScale: 0.8 }),
      stone: parkMaterial(conc, 1, { color: new Color("#d9d1c3"), normalScale: 0.9 }),
      gold: flat("#f4c752", { roughness: 0.3, metalness: 0.2, emissive: new Color("#a67a18"), emissiveIntensity: 1.2, side: DoubleSide }),
      goldBright: flat("#ffe08a", { roughness: 0.3, metalness: 0.05, emissive: new Color("#e8b030"), emissiveIntensity: 1.75, side: DoubleSide }),
      indigoPaint: flat("#3a3ea8", { roughness: 0.4, metalness: 0.2, emissive: new Color("#2328a0"), emissiveIntensity: 0.5 }),
      violet: flat("#8b5cf6", { roughness: 0.45 }),
      cushion: flat("#ee9dbb", { roughness: 0.7, emissive: new Color("#40182a"), emissiveIntensity: 0.35 }),
      velvet: leatherMaterial(),
      white: flat("#fbf4e6", { roughness: 0.8, emissive: new Color("#8a7c60"), emissiveIntensity: 0.55 }),
      earpink: flat("#f3a5be", { roughness: 0.8 }),
      ink: flat("#2c2440", { roughness: 0.8 }),
    };
  }, [all]);
  const built = useMemo(() => build(mats), [mats]);
  const boatBulbGeo = useMemo(() => new SphereGeometry(0.025, 8, 6), []);
  const bulbGeo = useMemo(() => new SphereGeometry(0.06, 8, 6), []);
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
    const st = moonBoatAt(rideMs(), ST);
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
        <BulbHalos places={built.frameBulbs} size={1.5} strength={1.0} />
        <group ref={boatRef} name="ride-moonboat-hull" position={[0, MOON_PIVOT_Y, 0]}>
          {built.boat.map((m, i) => (
            <primitive key={i} object={m} />
          ))}
          <instancedMesh ref={boatBulbRef} args={[boatBulbGeo, bulbMat, built.boatBulbs.length]} frustumCulled={false} dispose={null} />
          <instancedMesh ref={starRef} args={[starGeo, starMat, built.stars.length]} frustumCulled={false} dispose={null} />
          <BulbHalos places={built.boatBulbs} size={0.6} strength={0.55} />
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
