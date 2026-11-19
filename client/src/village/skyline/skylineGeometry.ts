/**
 * 케이슨랜드 skyline (2026-11-19): a LIGHT stand-in of the park that the village sees beyond the south gate, so a visitor sees the park
 * (the coaster's lift hill and loop, the 하늘 등불 바퀴, the carousel roof, the gate castle, trees and lamps) without pressing "enter".
 *
 * Everything is built from the SAME data as the real park (shared/land: the coaster's sampled track, the wheel's radius / hub / frame legs
 * and gondola pivots, the carousel's centre and canopy height, the gate's tower places in ParkWorld) in PARK-LOCAL metres and merged:
 *
 *   static     one mesh: gate, promenade / plaza decals, the wheel's frame, the carousel's platform, the coaster's track and supports,
 *              the station, kiosks, trees, lamp posts
 *   rotor      the wheel's rims, spokes and hub (one mesh, turned by the real wheel's clock)
 *   gondolas   8 instances, hung upright from the rim (the real wheel's pivots and sway)
 *   train      6 instances along the track (the real coaster's clock)
 *   carousel   the turning canopy (the real carousel's clock)
 *   bulbs      two `Points` sets (the wheel's rim, in the rotor's frame; and everything static): soft halos that follow the night weight
 *
 * Vertex colours carry a fixed, baked light (no lights, no normals, no uvs, no textures): ~7 draw calls, ~40 k triangles.
 * Lines and tubes are thickened (the real rail is 6 cm; at 0.4 scale and 150 m it would vanish): the shape reads, the cost stays small.
 * Pure geometry (no React, no DOM): unit-tested in node.
 */
import { BufferGeometry, Float32BufferAttribute } from "three";
import {
  COASTER_CARS,
  STATION_Y,
  coasterTrack,
  type CoasterTrack,
} from "@caysonverse/shared/land/coaster";
import { coasterSupports } from "@caysonverse/shared/land/coasterSupports";
import { GONDOLA_BOXES, frameCapsules, RIM_Z } from "@caysonverse/shared/land/wheelGeometry";
import { WHEEL_HUB_Y, WHEEL_N, WHEEL_R, WHEEL_SITE } from "@caysonverse/shared/land/wheel";
import { CAROUSEL_CANOPY_Y, CAROUSEL_CENTER, CAROUSEL_DECK_Y, CAROUSEL_RADIUS } from "@caysonverse/shared/land/carousel";
import { PARK_PLAZA, COASTER_PAD, DROP_SITE_AT } from "@caysonverse/shared/village/parkArea";
import { DROP_BEAM_YS, DROP_CROWN_Y, DROP_FRAME, dropFrameD } from "@caysonverse/shared/land/dropTowerGeometry";
import { addBellRoof } from "../../land/parkShapes";
import { GeoBuilder, cross, norm, type V3 } from "../../land/geoBuilder";

export type SkylineTier = "high" | "low";

/** Park metres to world metres (uniform): the park, 550 m wide in its own frame, stands in the ~140 m of land south of the village. */
export const SKYLINE_SCALE = 0.4;

/** The gate towers' places (ParkWorld: CZ -186.5, towers at x 31.25 / 48.75, arch 14 m between). */
export const GATE = Object.freeze({ x: 40, z: -186.5, towerDx: 8.75 });

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];

const C = {
  sand: [0.86, 0.76, 0.58] as V3,
  sandDark: [0.68, 0.58, 0.44] as V3,
  roofGreen: [0.1, 0.46, 0.42] as V3,
  gold: [0.98, 0.78, 0.3] as V3,
  indigo: [0.18, 0.2, 0.62] as V3,
  indigoBright: [0.24, 0.27, 0.82] as V3,
  indigoDeep: [0.12, 0.14, 0.45] as V3,
  cream: [0.96, 0.93, 0.86] as V3,
  coral: [0.93, 0.42, 0.32] as V3,
  teal: [0.16, 0.62, 0.58] as V3,
  violet: [0.55, 0.38, 0.88] as V3,
  paving: [0.9, 0.84, 0.72] as V3,
  paveGold: [0.96, 0.8, 0.4] as V3,
  water: [0.35, 0.75, 0.85] as V3,
  steel: [0.86, 0.88, 0.92] as V3,
  post: [0.2, 0.22, 0.26] as V3,
};

/** Mulberry32: a small seeded random, so the skyline is the same every time (and in tests). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

const scaleC = (c: V3, k: number): V3 => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

// ───────────────────────────────────────────── the baked light ─────────────────────────────────────────────

/** A fixed key light (high in the south-west of the village's sun) baked into vertex colours; the top faces stay full, the sides fall off. */
const KEY = norm([0.45, 0.85, -0.3]);
function bake(b: GeoBuilder, from = 0): void {
  for (let i = from; i < b.vertices; i++) {
    const nx = b.nor[3 * i]!;
    const ny = b.nor[3 * i + 1]!;
    const nz = b.nor[3 * i + 2]!;
    const d = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]);
    const k = (0.56 + 0.44 * d) * (0.8 + 0.2 * Math.max(0, ny)); // a little occlusion: sides and undersides darker than tops
    b.col[3 * i] = b.col[3 * i]! * k;
    b.col[3 * i + 1] = b.col[3 * i + 1]! * k;
    b.col[3 * i + 2] = b.col[3 * i + 2]! * k;
  }
}

/** Position + colour only (the skyline's materials are unlit vertex colours): the smallest geometry. */
function finish(b: GeoBuilder): BufferGeometry {
  bake(b);
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(b.pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(b.col, 3));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ───────────────────────────────────────────── small shapes ─────────────────────────────────────────────

/** A low-poly ellipsoid (a tree crown): `seg` columns by `rows` rings, flat shaded by its smooth normals. */
function addBlob(b: GeoBuilder, cx: number, cy: number, cz: number, rx: number, ry: number, color: V3, seg = 6, rows = 3): void {
  const base = b.vertices;
  for (let r = 0; r <= rows; r++) {
    const phi = (r / rows) * Math.PI; // 0 top .. PI bottom
    for (let s = 0; s < seg; s++) {
      const th = (s / seg) * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(th);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(th);
      b.rawVertex([cx + nx * rx, cy + ny * ry, cz + nz * rx], [nx, ny, nz], 0, 0, color);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < seg; s++) {
      const a = base + r * seg + s;
      const a2 = base + r * seg + ((s + 1) % seg);
      const c = a + seg;
      const c2 = a2 + seg;
      if (r > 0) b.idx.push(a, c, a2);
      if (r < rows - 1) b.idx.push(a2, c, c2);
    }
  }
}

/** A cone (conifer / pointed roof): `seg` sides, base ring at `y0` radius `r`, point at `y0 + h`. */
function addCone(b: GeoBuilder, cx: number, y0: number, cz: number, r: number, h: number, color: V3, seg = 6): void {
  const base = b.vertices;
  const slope = r / h;
  for (let s = 0; s < seg; s++) {
    const th = (s / seg) * Math.PI * 2;
    const nx = Math.cos(th);
    const nz = Math.sin(th);
    const n = norm([nx, slope, nz]);
    b.rawVertex([cx + nx * r, y0, cz + nz * r], n, 0, 0, color);
  }
  const apex = b.rawVertex([cx, y0 + h, cz], [0, 1, 0], 0, 0, color);
  for (let s = 0; s < seg; s++) b.idx.push(base + s, apex, base + ((s + 1) % seg));
}

/** A ground-hugging band along a polyline (centre line points p, half width w). */
function addGroundBand(b: GeoBuilder, pts: [number, number][], w: number, color: V3, y: (x: number, z: number) => number, step = 8): void {
  const base = b.vertices;
  const dense: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  dense.push(pts[pts.length - 1]!);
  for (let i = 0; i < dense.length; i++) {
    const p = dense[i]!;
    const q = dense[Math.min(dense.length - 1, i + 1)]!;
    const o = dense[Math.max(0, i - 1)]!;
    const dx = q[0] - o[0];
    const dz = q[1] - o[1];
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l;
    const nz = dx / l;
    for (const s of [-1, 1]) {
      const x = p[0] + nx * w * s;
      const z = p[1] + nz * w * s;
      b.rawVertex([x, y(x, z), z], [0, 1, 0], 0, 0, color);
    }
  }
  for (let i = 0; i < dense.length - 1; i++) {
    const a = base + 2 * i;
    b.idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
}

/** A flat disc / annulus on the ground: `sides` wedges, rings at the given radii. */
function addGroundDisc(b: GeoBuilder, cx: number, cz: number, r0: number, r1: number, sides: number, color: V3, y: (x: number, z: number) => number): void {
  const base = b.vertices;
  for (let s = 0; s < sides; s++) {
    const th = (s / sides) * Math.PI * 2;
    for (const r of [r0, r1]) {
      const x = cx + Math.cos(th) * r;
      const z = cz + Math.sin(th) * r;
      b.rawVertex([x, y(x, z), z], [0, 1, 0], 0, 0, color);
    }
  }
  for (let s = 0; s < sides; s++) {
    const a = base + 2 * s;
    const c = base + 2 * ((s + 1) % sides);
    b.idx.push(a, a + 1, c, c, a + 1, c + 1);
  }
}

// ───────────────────────────────────────────── the build ─────────────────────────────────────────────

export interface SkylineBuild {
  staticGeo: BufferGeometry;
  rotorGeo: BufferGeometry;
  gondolaGeo: BufferGeometry;
  trainGeo: BufferGeometry;
  carouselGeo: BufferGeometry;
  /** The turning canopy's centre (park-local). */
  carouselAt: V3;
  /** Rim bulbs in the rotor's frame, and the static ones (lamps, string lights, gate, canopy, lift hill, loop) in park-local metres. */
  wheelBulbs: Float32Array;
  staticBulbs: Float32Array;
  /** Gondola colours, one per gondola (the instance colour). */
  gondolaColors: V3[];
  triangles: number;
  /** Draw calls the skyline asks for (7: static, rotor, gondolas, train, carousel, two bulb sets). */
  drawCalls: number;
  track: CoasterTrack;
}

export const TRAIN_WIDEN = 1.5;

/** The ground's height in park-local metres at (x, z): below 0 is under the skyline's reference plane. */
export type GroundLocal = (x: number, z: number) => number;

export function buildSkyline(tier: SkylineTier, ground: GroundLocal = () => 0): SkylineBuild {
  const high = tier === "high";
  const track = coasterTrack();
  const rand = rng(20261119);
  const gy = (lift: number) => (x: number, z: number) => ground(x, z) + lift;

  // ───────── static ─────────
  const s = new GeoBuilder();

  // — the 구름 낙하탑 (the cloud drop tower): the real tower's column, four leaning legs with ring beams, indigo bands, the cloud bank on top and the gold moon —
  {
    const gx = DROP_SITE_AT.x;
    const gz = DROP_SITE_AT.z;
    const g0 = ground(gx, gz);
    const CY = DROP_CROWN_Y;
    const S = 1.3; // the crown's scale (as in DropTowerWorld)
    const CLOUD: V3 = [1.3, 1.3, 1.34]; // over-bright, so the baked light still leaves the cloud white
    const legR = (y: number): number => 0.8 - 0.42 * (y / CY);
    s.box([gx, g0 + 0.5, gz], X, Y, 3.8, 1.0, 3.8, C.sandDark);
    s.box([gx, g0 + CY / 2, gz], X, Y, 1.05, CY / 2, 1.05, C.cream);
    for (const y of DROP_BEAM_YS.slice(1)) s.box([gx, g0 + y, gz], X, Y, 1.4, 0.5, 1.4, C.indigoDeep);
    const ys = [0.9, ...DROP_BEAM_YS.slice(1), CY + 0.4];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        for (let i = 0; i + 1 < ys.length; i++) s.cylinder([gx + sx * dropFrameD(ys[i]!), g0 + ys[i]!, gz + sz * dropFrameD(ys[i]!)], [gx + sx * dropFrameD(ys[i + 1]!), g0 + ys[i + 1]!, gz + sz * dropFrameD(ys[i + 1]!)], legR(ys[i]!), legR(ys[i + 1]!), 6, C.cream);
        for (const y of DROP_BEAM_YS.slice(1)) s.box([gx + sx * dropFrameD(y), g0 + y, gz + sz * dropFrameD(y)], X, Y, legR(y) * 1.3, 0.5, legR(y) * 1.3, C.indigo);
        s.box([gx + sx * dropFrameD(0.9), g0 + 1.3, gz + sz * dropFrameD(0.9)], X, Y, 0.95, 1.3, 0.95, C.sandDark);
      }
    for (const y of DROP_BEAM_YS) {
      const d = dropFrameD(y);
      s.box([gx, g0 + y, gz - d], X, Y, d, 0.25, DROP_FRAME.beamHalf, C.indigo);
      s.box([gx, g0 + y, gz + d], X, Y, d, 0.25, DROP_FRAME.beamHalf, C.indigo);
      s.box([gx - d, g0 + y, gz], X, Y, DROP_FRAME.beamHalf, 0.25, d, C.indigo);
      s.box([gx + d, g0 + y, gz], X, Y, DROP_FRAME.beamHalf, 0.25, d, C.indigo);
    }
    s.box([gx, g0 + CY - 0.7, gz], X, Y, 2.4, 0.9, 2.4, C.indigoDeep);
    addBlob(s, gx, g0 + CY + 0.9 * S, gz, 6.2 * S, 1.6 * S, CLOUD, high ? 10 : 7, 3);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      addBlob(s, gx + Math.cos(a) * 5.2 * S, g0 + CY + 1.3 * S, gz + Math.sin(a) * 5.2 * S, 1.9 * S, 1.5 * S, CLOUD, high ? 8 : 6, 3);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.6;
      addBlob(s, gx + Math.cos(a) * 2.6 * S, g0 + CY + 3.1 * S, gz + Math.sin(a) * 2.6 * S, 2.0 * S, 1.6 * S, CLOUD, high ? 8 : 6, 3);
    }
    addBlob(s, gx, g0 + CY + 4.9 * S, gz, 2.7 * S, 2.1 * S, CLOUD, high ? 8 : 6, 3);
    s.cylinder([gx, g0 + CY + 6.5 * S, gz], [gx, g0 + CY + 10.2 * S, gz], 0.15, 0.09, 4, C.gold);
    addBlob(s, gx, g0 + CY + 11.5 * S, gz, 1.5 * S, 1.5 * S, C.gold, high ? 8 : 6, 4); // the moon orb
    for (const a of [0, 1, 2, 3, 4, 5]) s.box([gx + Math.cos((a / 6) * Math.PI * 2) * 3.1 * S, g0 + CY + (9.4 + (a % 2) * 0.9) * S, gz + Math.sin((a / 6) * Math.PI * 2) * 3.1 * S], X, Y, 0.45 * S, 0.45 * S, 0.2, C.gold); // the star wheel
  }

  // — the gate castle: two towers with bell spires, the lintel and the indigo name board between them —
  {
    const CZ = GATE.z;
    for (const sx of [-1, 1]) {
      const tx = GATE.x + sx * GATE.towerDx;
      s.box([tx, 5, CZ], X, Y, 1.9, 5, 3.6, C.sand);
      s.box([tx, 10.35, CZ], X, Y, 2.3, 0.35, 3.9, C.sandDark);
      s.box([tx, 0.25, CZ], X, Y, 2.15, 0.9, 3.85, C.sandDark); // plinth, buried a little
      s.box([tx, 6.4, CZ], X, Y, 2.05, 0.14, 3.75, C.cream);
      addBellRoof(s, tx, 10.6, CZ, 2.25, 3.8, 7.2, C.roofGreen, 2, high ? 14 : 10);
      s.cylinder([tx, 17.6, CZ], [tx, 20.6, CZ], 0.12, 0.05, 4, C.gold);
      s.box([tx, 18.1, CZ], X, Y, 0.34, 0.34, 0.34, C.gold);
      for (const sz of [-1, 1]) s.box([tx, 8.0, CZ + sz * 3.65], X, Y, 0.45, 1.0, 0.08, [0.1, 0.1, 0.16]); // a dark window slit
    }
    // the arch's lintel and the name board (both faces), the opening below it
    s.box([GATE.x, 8.4, CZ], X, Y, GATE.towerDx - 1.8, 1.9, 2.0, C.sand);
    for (const sz of [-1, 1]) {
      s.box([GATE.x, 8.5, CZ + sz * 2.08], X, Y, 5.6, 1.55, 0.1, C.indigoDeep);
      s.box([GATE.x, 8.5, CZ + sz * 2.14], X, Y, 5.7, 1.65, 0.04, C.gold);
      s.box([GATE.x, 8.5, CZ + sz * 2.2], X, Y, 5.45, 1.4, 0.04, C.indigo);
    }
    s.cylinder([GATE.x, 10.3, CZ], [GATE.x, 12.9, CZ], 1.45, 0.05, 5, C.gold); // the gold star, a spire of five facets
    // the low arcade wings
    for (const sx of [-1, 1]) {
      s.box([GATE.x + sx * 17, 2.2, CZ], X, Y, 6.2, 2.2, 3.0, C.sand);
      s.box([GATE.x + sx * 17, 4.5, CZ], X, Y, 6.6, 0.25, 3.4, C.coral);
    }
  }

  // — the promenade, the star plaza and the side paths (flat patches that follow the ground) —
  {
    const lift = gy(0.5);
    addGroundBand(s, [[GATE.x, GATE.z + 6], [GATE.x, PARK_PLAZA.z - PARK_PLAZA.radius + 2]], 7.5, C.paving, lift, 10);
    addGroundDisc(s, PARK_PLAZA.x, PARK_PLAZA.z, 0, PARK_PLAZA.radius, high ? 36 : 24, C.paving, lift);
    addGroundDisc(s, PARK_PLAZA.x, PARK_PLAZA.z, 23.4, 24.8, high ? 36 : 24, C.paveGold, gy(0.62));
    addGroundDisc(s, PARK_PLAZA.x, PARK_PLAZA.z, 9, 10.2, high ? 28 : 18, C.paveGold, gy(0.62));
    // the fountain: a basin, a tier and the gold star
    const fy = ground(PARK_PLAZA.x, PARK_PLAZA.z);
    s.cylinder([PARK_PLAZA.x, fy + 0.4, PARK_PLAZA.z], [PARK_PLAZA.x, fy + 1.6, PARK_PLAZA.z], 4.6, 4.2, 12, C.cream, true);
    s.cylinder([PARK_PLAZA.x, fy + 1.6, PARK_PLAZA.z], [PARK_PLAZA.x, fy + 1.9, PARK_PLAZA.z], 3.9, 3.9, 12, C.water, true);
    s.cylinder([PARK_PLAZA.x, fy + 1.9, PARK_PLAZA.z], [PARK_PLAZA.x, fy + 5.2, PARK_PLAZA.z], 0.8, 0.35, 6, C.cream, true);
    s.cylinder([PARK_PLAZA.x, fy + 5.2, PARK_PLAZA.z], [PARK_PLAZA.x, fy + 7.6, PARK_PLAZA.z], 1.1, 0.05, 5, C.gold);
    // west to the coaster's queue, east to the carousel and the wheel
    addGroundBand(s, [[PARK_PLAZA.x - 22, PARK_PLAZA.z + 6], [COASTER_PAD.x, COASTER_PAD.z + 4]], 3.6, C.paving, lift, 12);
    addGroundBand(s, [[PARK_PLAZA.x + 24, PARK_PLAZA.z - 4], [CAROUSEL_CENTER.x, CAROUSEL_CENTER.z + 24], [WHEEL_SITE.x, WHEEL_SITE.z + 12]], 3.6, C.paving, lift, 12);
  }

  // — the carousel's platform (the canopy turns, so it is its own mesh) —
  {
    const cx = CAROUSEL_CENTER.x;
    const cz = CAROUSEL_CENTER.z;
    const gh = Math.min(ground(cx, cz), ground(cx + 12, cz), ground(cx - 12, cz), ground(cx, cz + 12), ground(cx, cz - 12));
    s.cylinder([cx, gh - 1.5, cz], [cx, CAROUSEL_DECK_Y, cz], CAROUSEL_RADIUS + 0.6, CAROUSEL_RADIUS + 0.6, high ? 20 : 14, C.cream, true);
    s.cylinder([cx, CAROUSEL_DECK_Y, cz], [cx, CAROUSEL_DECK_Y + 0.12, cz], CAROUSEL_RADIUS, CAROUSEL_RADIUS, high ? 20 : 14, C.coral, true);
  }

  // — the wheel's A-frames (the real frame capsules) and its boarding platform —
  {
    const wx = WHEEL_SITE.x;
    const wz = WHEEL_SITE.z;
    for (const cap of frameCapsules()) {
      const a: V3 = [wx + cap.a[0], cap.a[1] - 1.8, wz + cap.a[2]];
      const bb: V3 = [wx + cap.b[0], cap.b[1], wz + cap.b[2]];
      s.cylinder(a, bb, 1.05, 0.8, 5, C.cream);
    }
    for (const z of [-2.75, 5.7]) s.cylinder([wx - 7, 7.5, wz + z], [wx + 7, 7.5, wz + z], 0.35, 0.35, 4, C.steel); // the cross tie of each A
    s.cylinder([wx, WHEEL_HUB_Y - 0.5, wz - 2.75], [wx, WHEEL_HUB_Y - 0.5, wz + 5.7], 0.5, 0.5, 4, C.steel);
    const pg = Math.min(ground(wx, wz + 8), ground(wx + 4, wz + 8), ground(wx - 4, wz + 8));
    s.box([wx, (pg + 1.0) / 2 - 0.4, wz + 6.6], X, Y, 3.6, (1.0 - pg) / 2 + 0.4, 2.3, C.sandDark);
    s.box([wx + 7.5, 0.4, wz + 9.6], X, Y, 2.1, 1.4, 0.2, C.indigo); // the name sign
  }

  // — the coaster: track, supports, the station and its queue hall —
  const bulbsStatic: number[] = [];
  {
    const n = track.n;
    const step = high ? 6 : 9;
    const loopFrom = track.marks.loopFrom ?? -1;
    const loopTo = track.marks.loopTo ?? -1;
    const idx: number[] = [];
    for (let i = 0; i < n; ) {
      idx.push(i);
      i += i >= loopFrom - 4 && i <= loopTo + 4 ? Math.max(3, Math.round(step / 2)) : step;
    }
    idx.push(n); // closes the ring at sample 0
    const at = (i: number): V3 => {
      const k = i % n;
      return [track.pos[3 * k]!, track.pos[3 * k + 1]!, track.pos[3 * k + 2]!];
    };
    const upv = (i: number): V3 => {
      const k = i % n;
      return [track.up[3 * k]!, track.up[3 * k + 1]!, track.up[3 * k + 2]!];
    };
    const tanv = (i: number): V3 => {
      const k = i % n;
      return [track.tan[3 * k]!, track.tan[3 * k + 1]!, track.tan[3 * k + 2]!];
    };
    const GAUGE_W = 0.95; // the rail pair, widened from 0.62 so the two lines read
    const left: V3[] = [];
    const right: V3[] = [];
    const spine: V3[] = [];
    const bA: V3[] = [];
    const bB: V3[] = [];
    for (const i of idx) {
      const p = at(i);
      const u = upv(i);
      const r = norm(cross(tanv(i), u));
      left.push([p[0] - r[0] * GAUGE_W, p[1] - r[1] * GAUGE_W, p[2] - r[2] * GAUGE_W]);
      right.push([p[0] + r[0] * GAUGE_W, p[1] + r[1] * GAUGE_W, p[2] + r[2] * GAUGE_W]);
      spine.push([p[0] - u[0] * 0.75, p[1] - u[1] * 0.75, p[2] - u[2] * 0.75]);
      bA.push(r);
      bB.push(u);
    }
    s.sweep(left, bA, bB, 0.34, 4, C.steel, 0.1);
    s.sweep(right, bA, bB, 0.34, 4, C.steel, 0.1);
    s.sweep(spine, bA, bB, 0.85, 5, C.indigoBright, 0.1);

    // supports: the park's own (shared/land/coasterSupports.ts, the phone set: a braced pair per column, a mast and an arm under the
    // upside-down stretches), every other one, widened so they read at this scale
    const sups = coasterSupports(track, "light");
    for (let k = 0; k < sups.length; k += high ? 1 : 2) {
      const sp = sups[k]!;
      for (const leg of sp.legs) {
        const g0 = ground(leg.foot[0], leg.foot[2]) - 0.8;
        if (leg.top[1] - g0 < 2.2) continue;
        s.cylinder([leg.foot[0], g0, leg.foot[2]], leg.top, 1.1, 0.7, 5, C.cream);
      }
      if (sp.kind === "arm" && sp.armFrom) s.cylinder(sp.armFrom, sp.spine, 0.6, 0.6, 4, C.cream);
      else if (sp.legs.length === 2 && sp.spine[1] > 6) {
        const [l0, l1] = sp.legs;
        const m0: V3 = [(l0!.foot[0] + l0!.top[0]) / 2, (l0!.foot[1] + l0!.top[1]) / 2, (l0!.foot[2] + l0!.top[2]) / 2];
        const m1: V3 = [(l1!.foot[0] + l1!.top[0]) / 2, (l1!.foot[1] + l1!.top[1]) / 2, (l1!.foot[2] + l1!.top[2]) / 2];
        s.cylinder(m0, m1, 0.28, 0.28, 4, C.steel);
      }
    }
    // the tunnel on the brake run: a cream shed under an indigo vault
    {
      const a0 = track.marks.tunnelFrom;
      const a1 = track.marks.tunnelTo;
      if (a0 !== undefined && a1 !== undefined) {
        for (let i = a0 - 4; i < a1 + 4; i += 12) {
          const p = at(i);
          const q = at(Math.min(a1 + 4, i + 12));
          const ax = norm([q[0] - p[0], 0, q[2] - p[2]]);
          const c: V3 = [(p[0] + q[0]) / 2, 0, (p[2] + q[2]) / 2];
          const half = Math.hypot(q[0] - p[0], q[2] - p[2]) / 2 + 0.1;
          const gy0 = ground(c[0], c[2]);
          s.box([c[0], gy0 + 1.4, c[2]], ax, Y, half, 2.2, 4.1, C.cream);
          s.box([c[0], gy0 + 4.0, c[2]], ax, Y, half, 0.9, 3.4, C.indigoBright);
        }
      }
    }
    // string lights along the lift hill and round the loop (lit at night)
    const liftFrom = track.liftFrom;
    const liftTo = track.liftTo;
    for (let i = liftFrom; i <= liftTo; i += high ? 10 : 18) {
      const p = at(i);
      bulbsStatic.push(p[0], p[1] + 1.4, p[2]);
    }
    for (let i = loopFrom; i <= loopTo; i += high ? 8 : 14) {
      const p = at(i);
      bulbsStatic.push(p[0], p[1] + 1.2, p[2]);
    }
    // the station platform (park-local: x -9 .. 9.6); the coaster boards from it, there is no queue pavilion
    const sg = Math.min(ground(0, -3), ground(0, 4), ground(-10, 0), ground(10, 0));
    s.box([0.3, (sg + STATION_Y) / 2 - 0.3, -3.2], X, Y, 11, (STATION_Y - sg) / 2 + 0.3, 3.2, C.sandDark);
    s.box([0.3, STATION_Y + 5.2, -3.2], X, Y, 12, 0.35, 4.2, C.coral);
    for (const sx of [-1, 1]) s.box([0.3 + sx * 10.5, STATION_Y + 2.6, -3.2], X, Y, 0.3, 2.6, 0.3, C.cream);
  }

  // — lamp posts along the promenade and round the plaza, and the string lights between them —
  {
    const posts: [number, number][] = [];
    for (let z = GATE.z + 12; z < PARK_PLAZA.z - PARK_PLAZA.radius; z += high ? 12 : 18) posts.push([GATE.x - 9.5, z], [GATE.x + 9.5, z]);
    const ringN = high ? 14 : 10;
    for (let k = 0; k < ringN; k++) {
      const a = (k / ringN) * Math.PI * 2;
      posts.push([PARK_PLAZA.x + Math.cos(a) * 25.5, PARK_PLAZA.z + Math.sin(a) * 25.5]);
    }
    for (const [x, z] of posts) {
      const g = ground(x, z);
      s.cylinder([x, g - 0.3, z], [x, g + 4.4, z], 0.28, 0.2, 4, C.post);
      s.box([x, g + 4.7, z], X, Y, 0.34, 0.34, 0.34, C.cream);
      bulbsStatic.push(x, g + 4.9, z);
    }
    // the string across the promenade between each opposite pair, and a garland round the plaza ring
    for (let i = 0; i + 1 < posts.length && i < (posts.length - ringN); i += 2) {
      const a = posts[i]!;
      const b2 = posts[i + 1]!;
      for (let k = 1; k < 8; k++) {
        const t = k / 8;
        const x = a[0] + (b2[0] - a[0]) * t;
        const z = a[1] + (b2[1] - a[1]) * t;
        const sag = 1.1 * Math.sin(t * Math.PI);
        bulbsStatic.push(x, ground(x, z) + 4.6 - sag, z);
      }
    }
    for (let k = 0; k < ringN; k++) {
      const a0 = (k / ringN) * Math.PI * 2;
      const a1 = ((k + 1) / ringN) * Math.PI * 2;
      for (let j = 1; j < 5; j++) {
        const t = j / 5;
        const a = a0 + (a1 - a0) * t;
        const x = PARK_PLAZA.x + Math.cos(a) * 25.5;
        const z = PARK_PLAZA.z + Math.sin(a) * 25.5;
        bulbsStatic.push(x, ground(x, z) + 4.6 - 0.9 * Math.sin(t * Math.PI), z);
      }
    }
    // the carousel's canopy ring of bulbs
    const ringB = high ? 28 : 16;
    for (let k = 0; k < ringB; k++) {
      const a = (k / ringB) * Math.PI * 2;
      bulbsStatic.push(CAROUSEL_CENTER.x + Math.cos(a) * (CAROUSEL_RADIUS + 0.4), CAROUSEL_CANOPY_Y - 0.1, CAROUSEL_CENTER.z + Math.sin(a) * (CAROUSEL_RADIUS + 0.4));
    }
    // the gate's name board
    for (let k = 0; k < (high ? 14 : 8); k++) {
      const x = GATE.x - 6 + (12 * k) / ((high ? 14 : 8) - 1);
      bulbsStatic.push(x, 10.4, GATE.z + 2.4, x, 6.6, GATE.z + 2.4);
    }
  }

  // — kiosks round the plaza: a box and a striped pyramid roof —
  {
    const ks = high ? 8 : 5;
    const cols = [C.coral, C.teal, C.violet, C.gold];
    for (let k = 0; k < ks; k++) {
      const a = ((k + 0.5) / ks) * Math.PI * 2;
      const x = PARK_PLAZA.x + Math.cos(a) * 38;
      const z = PARK_PLAZA.z + Math.sin(a) * 38;
      if (z < PARK_PLAZA.z - 24 && Math.abs(x - PARK_PLAZA.x) < 16) continue; // not across the promenade
      const g = Math.min(ground(x - 3, z - 3), ground(x + 3, z + 3), ground(x - 3, z + 3), ground(x + 3, z - 3));
      s.box([x, (g + 3.2) / 2 - 0.4, z], X, Y, 3, (3.2 - g) / 2 + 0.4, 3, C.cream);
      addCone(s, x, 3.2, z, 4.6, 3.2, cols[k % cols.length]!, 4);
    }
  }

  // — trees: an avenue along the promenade, then seeded clusters round the park (not on the paving or the rides) —
  {
    const avoid: ((x: number, z: number) => boolean)[] = [
      (x, z) => Math.abs(x - GATE.x) < 14 && z < PARK_PLAZA.z + 10 && z > GATE.z - 8,
      (x, z) => Math.hypot(x - PARK_PLAZA.x, z - PARK_PLAZA.z) < 44,
      (x, z) => Math.hypot(x - CAROUSEL_CENTER.x, z - CAROUSEL_CENTER.z) < 20,
      (x, z) => Math.hypot(x - WHEEL_SITE.x, z - WHEEL_SITE.z - 2) < 20,
      (x, z) => x > -25 && x < 30 && z > -62 && z < 8,
      (x, z) => z > -70 && z < -10 && Math.hypot(x - 20, z + 40) < 55,
      // the side paths (the plaza to the queue, and to the carousel and the wheel)
      (x, z) => distToSeg(x, z, PARK_PLAZA.x - 22, PARK_PLAZA.z + 6, COASTER_PAD.x, COASTER_PAD.z + 4) < 8,
      (x, z) => distToSeg(x, z, PARK_PLAZA.x + 24, PARK_PLAZA.z - 4, CAROUSEL_CENTER.x, CAROUSEL_CENTER.z + 24) < 8 || distToSeg(x, z, CAROUSEL_CENTER.x, CAROUSEL_CENTER.z + 24, WHEEL_SITE.x, WHEEL_SITE.z + 12) < 8,
    ];
    const greens: V3[] = [
      [0.17, 0.27, 0.07],
      [0.13, 0.24, 0.06],
      [0.2, 0.3, 0.09],
      [0.1, 0.22, 0.07],
      [0.15, 0.26, 0.1],
    ];
    const pines: V3[] = [
      [0.05, 0.17, 0.09],
      [0.07, 0.2, 0.1],
    ];
    const plant = (x: number, z: number, big: boolean): void => {
      const g = ground(x, z);
      const h = (big ? 8.5 : 6.4) * (0.8 + rand() * 0.5);
      const col = greens[Math.floor(rand() * greens.length)]!;
      if (rand() < 0.3) {
        // a conifer: two stacked skirts
        const pc = pines[Math.floor(rand() * pines.length)]!;
        s.cylinder([x, g - 0.3, z], [x, g + 1.2, z], 0.4, 0.34, 4, [0.3, 0.22, 0.16]);
        addCone(s, x, g + 0.8, z, h * 0.4, h * 0.8, pc, high ? 7 : 5);
        addCone(s, x, g + 0.8 + h * 0.45, z, h * 0.3, h * 0.65, scaleC(pc, 1.1), high ? 7 : 5);
      } else {
        // a broadleaf: a trunk and three overlapping lobes
        s.cylinder([x, g - 0.3, z], [x, g + h * 0.5, z], 0.5, 0.34, 4, [0.3, 0.22, 0.16]);
        const rr = h * 0.46;
        addBlob(s, x, g + h * 0.74, z, rr, h * 0.4, col, high ? 8 : 6, 3);
        addBlob(s, x + rr * 0.55, g + h * 0.62, z + rr * 0.2, rr * 0.7, h * 0.3, scaleC(col, 1.12), high ? 7 : 5, 3);
        addBlob(s, x - rr * 0.45, g + h * 0.66, z - rr * 0.35, rr * 0.7, h * 0.32, scaleC(col, 0.9), high ? 7 : 5, 3);
      }
    };
    // the avenue: both sides of the promenade
    for (let z = GATE.z + 14; z < PARK_PLAZA.z - 32; z += high ? 13 : 20) {
      plant(GATE.x - 17 - rand() * 2, z + rand() * 3, false);
      plant(GATE.x + 17 + rand() * 2, z + rand() * 3, false);
    }
    // groves: clusters round the park's edges and in the gaps between the rides (not on the paving or the rides)
    const groves: [number, number, number][] = [
      [-100, -150, 22], [-60, -120, 18], [-20, -170, 14], [95, -178, 16], [150, -176, 20], [215, -170, 22], [275, -150, 24], [330, -120, 24],
      [-130, -70, 22], [-95, -25, 22], [320, -70, 24], [345, -20, 22], [150, -95, 16], [260, -100, 18], [-60, -85, 16],
      [60, -62, 14], [100, -40, 20], [170, -45, 20], [240, -30, 18], [140, 10, 22], [60, 12, 16], [-70, 20, 20], [300, 15, 20],
    ];
    const perGrove = high ? 7 : 4;
    for (const [gx, gz, rad] of groves) {
      for (let k = 0; k < perGrove; k++) {
        const a = rand() * Math.PI * 2;
        const rr = rad * Math.sqrt(rand());
        const x = gx + Math.cos(a) * rr;
        const z = gz + Math.sin(a) * rr;
        if (avoid.some((f) => f(x, z))) continue;
        plant(x, z, rand() < 0.6);
      }
    }
    // a green wall along the park's north edge, either side of the gate (against the village's own forest)
    for (let x = -150; x < 370; x += high ? 15 : 24) {
      if (Math.abs(x - GATE.x) < 30) continue;
      plant(x + rand() * 5, GATE.z - 3 - rand() * 6, true);
    }
  }

  const staticGeo = finish(s);

  // ───────── rotor ─────────
  const rb = new GeoBuilder();
  const wheelBulbs: number[] = [];
  {
    const sidesRim = 4;
    const nRim = high ? 40 : 28;
    const ring = (r: number, z: number, tube: number, col: V3, n: number): void => {
      const pts: V3[] = [];
      const a: V3[] = [];
      const bb: V3[] = [];
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2;
        pts.push([Math.sin(t) * r, Math.cos(t) * r, z]);
        a.push([Math.sin(t), Math.cos(t), 0]);
        bb.push([0, 0, 1]);
      }
      rb.sweep(pts, a, bb, tube, sidesRim, col, 0.1);
    };
    for (const z of [-RIM_Z, RIM_Z]) {
      ring(WHEEL_R, z, 0.5, C.cream, nRim);
      ring(WHEEL_R - 2.4, z, 0.3, C.steel, high ? 28 : 20);
      const spokes = high ? 20 : 12;
      for (let i = 0; i < spokes; i++) {
        const t = (i / spokes) * Math.PI * 2;
        rb.cylinder([Math.sin(t) * 1.9, Math.cos(t) * 1.9, z], [Math.sin(t) * (WHEEL_R - 2.4), Math.cos(t) * (WHEEL_R - 2.4), z], 0.2, 0.2, 4, C.indigo);
      }
      // the zig-zag lattice between the rim and the inner ring
      if (high) {
        for (let i = 0; i < 24; i++) {
          const a0 = (i / 24) * Math.PI * 2;
          const a1 = ((i + 1) / 24) * Math.PI * 2;
          const [r0, r1] = i % 2 === 0 ? [WHEEL_R, WHEEL_R - 2.4] : [WHEEL_R - 2.4, WHEEL_R];
          rb.cylinder([Math.sin(a0) * r0, Math.cos(a0) * r0, z], [Math.sin(a1) * r1, Math.cos(a1) * r1, z], 0.14, 0.14, 3, C.steel);
        }
      }
    }
    const ties = high ? 24 : 12;
    for (let i = 0; i < ties; i++) {
      const t = (i / ties) * Math.PI * 2;
      rb.cylinder([Math.sin(t) * WHEEL_R, Math.cos(t) * WHEEL_R, -RIM_Z], [Math.sin(t) * WHEEL_R, Math.cos(t) * WHEEL_R, RIM_Z], 0.18, 0.18, 3, C.cream);
    }
    rb.cylinder([0, 0, -3.2], [0, 0, 3.2], 2.3, 2.3, 8, C.gold, true); // the hub
    rb.cylinder([0, 0, -3.8], [0, 0, 3.8], 1.0, 1.0, 6, C.indigo, true);
    const nb = high ? 48 : 24;
    for (const z of [-RIM_Z, RIM_Z]) {
      for (let k = 0; k < nb; k++) {
        const t = (k / nb) * Math.PI * 2;
        wheelBulbs.push(Math.sin(t) * (WHEEL_R + 0.55), Math.cos(t) * (WHEEL_R + 0.55), z * 1.12);
      }
    }
    for (let k = 0; k < 8; k++) {
      const t = (k / 8) * Math.PI * 2;
      wheelBulbs.push(Math.sin(t) * 7, Math.cos(t) * 7, RIM_Z * 1.12);
    }
  }
  const rotorGeo = finish(rb);

  // ───────── gondolas (instanced; the real pivots) ─────────
  const gb = new GeoBuilder();
  {
    const cols: Record<string, V3> = { plinth: C.sandDark, cabin: C.cream, roof: [1, 1, 1], globe: C.gold };
    for (const box of GONDOLA_BOXES) {
      const cx = (box.min[0] + box.max[0]) / 2;
      const cy = (box.min[1] + box.max[1]) / 2;
      const cz = (box.min[2] + box.max[2]) / 2;
      // a little oversize so the cabin reads at 150 m
      gb.box([cx, cy, cz], X, Y, ((box.max[0] - box.min[0]) / 2) * 1.12, (box.max[1] - box.min[1]) / 2, ((box.max[2] - box.min[2]) / 2) * 1.12, cols[box.name] ?? C.cream);
    }
    gb.cylinder([0, 0.1, 0], [0, 0.1, 3.4], 0.2, 0.2, 4, C.steel); // the hanger from the pivot to the cabin's roof
  }
  const gondolaGeo = finish(gb);
  const gondolaColors: V3[] = [];
  const gcols = [C.coral, C.teal, C.violet, C.gold];
  for (let g = 0; g < WHEEL_N; g++) gondolaColors.push(gcols[g % gcols.length]!);

  // ───────── the train ─────────
  const tb = new GeoBuilder();
  {
    // a car in the track-frame the real car uses: +x left, +y up, +z forward. 3.1 m pitch, the body a little wider and taller
    tb.box([0, 0.62, 0], X, Y, 0.78 * TRAIN_WIDEN, 0.5, 1.45, C.indigoDeep);
    tb.box([0, 1.2, -0.35], X, Y, 0.68 * TRAIN_WIDEN, 0.14, 0.9, C.gold);
    tb.box([0, 0.2, 0.05], X, Y, 0.5 * TRAIN_WIDEN, 0.12, 1.6, C.steel);
  }
  const trainGeo = finish(tb);

  // ───────── the carousel's canopy (turns about y at its own origin) ─────────
  const cb = new GeoBuilder();
  {
    const N = high ? 12 : 8;
    const R = CAROUSEL_RADIUS + 0.9;
    const y0 = CAROUSEL_CANOPY_Y;
    const apexY = y0 + 4.4;
    const wedge = (k: number): void => {
      const a0 = (k / N) * Math.PI * 2;
      const a1 = ((k + 1) / N) * Math.PI * 2;
      const col = k % 2 === 0 ? C.coral : C.cream;
      const n = norm([Math.cos((a0 + a1) / 2), 0.9, Math.sin((a0 + a1) / 2)]);
      const i0 = cb.rawVertex([Math.cos(a0) * R, y0, Math.sin(a0) * R], n, 0, 0, col);
      const i1 = cb.rawVertex([Math.cos(a1) * R, y0, Math.sin(a1) * R], n, 0, 0, col);
      const ia = cb.rawVertex([0, apexY, 0], n, 0, 0, col);
      cb.idx.push(i0, ia, i1);
      // the straight valance band under the roof
      const nb = norm([Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)]);
      const j0 = cb.rawVertex([Math.cos(a0) * R, y0, Math.sin(a0) * R], nb, 0, 0, k % 2 === 0 ? C.cream : C.coral);
      const j1 = cb.rawVertex([Math.cos(a1) * R, y0, Math.sin(a1) * R], nb, 0, 0, k % 2 === 0 ? C.cream : C.coral);
      const j2 = cb.rawVertex([Math.cos(a0) * R, y0 - 1.1, Math.sin(a0) * R], nb, 0, 0, k % 2 === 0 ? C.cream : C.coral);
      const j3 = cb.rawVertex([Math.cos(a1) * R, y0 - 1.1, Math.sin(a1) * R], nb, 0, 0, k % 2 === 0 ? C.cream : C.coral);
      cb.idx.push(j0, j2, j1, j1, j2, j3);
      // the underside, so the cone is closed from below
      const m0 = cb.rawVertex([Math.cos(a0) * R, y0, Math.sin(a0) * R], [0, -1, 0], 0, 0, [0.85, 0.8, 0.7]);
      const m1 = cb.rawVertex([Math.cos(a1) * R, y0, Math.sin(a1) * R], [0, -1, 0], 0, 0, [0.85, 0.8, 0.7]);
      const m2 = cb.rawVertex([0, y0, 0], [0, -1, 0], 0, 0, [0.85, 0.8, 0.7]);
      cb.idx.push(m0, m1, m2);
    };
    for (let k = 0; k < N; k++) wedge(k);
    cb.cylinder([0, CAROUSEL_DECK_Y, 0], [0, y0, 0], 2.3, 2.3, 8, C.cream);
    cb.cylinder([0, apexY, 0], [0, apexY + 2.4, 0], 0.18, 0.05, 4, C.gold);
    cb.box([0, apexY + 0.2, 0], X, Y, 0.45, 0.45, 0.45, C.gold);
    const poles = high ? 12 : 8;
    for (let k = 0; k < poles; k++) {
      const a = (k / poles) * Math.PI * 2;
      cb.cylinder([Math.cos(a) * 11.2, CAROUSEL_DECK_Y, Math.sin(a) * 11.2], [Math.cos(a) * 11.2, y0 - 1, Math.sin(a) * 11.2], 0.2, 0.2, 4, C.gold);
    }
    // the horses, as a ring of little bright blocks on the deck (they bob and turn with the canopy)
    for (let k = 0; k < (high ? 16 : 8); k++) {
      const a = (k / (high ? 16 : 8)) * Math.PI * 2;
      const rr = k % 2 === 0 ? 9.6 : 6.6;
      cb.box([Math.cos(a) * rr, CAROUSEL_DECK_Y + 1.3, Math.sin(a) * rr], [-Math.sin(a), 0, Math.cos(a)], Y, 0.45, 0.8, 1.1, [C.cream, C.coral, C.teal, C.violet][k % 4]!);
    }
  }
  const carouselGeo = finish(cb);

  const triangles = [staticGeo, rotorGeo, gondolaGeo, trainGeo, carouselGeo].reduce((n, g) => n + (g.index?.count ?? 0) / 3, 0);
  // the gondolas and the train are drawn as instances: their triangles count once per instance
  const instanced = ((gondolaGeo.index?.count ?? 0) / 3) * (WHEEL_N - 1) + ((trainGeo.index?.count ?? 0) / 3) * (COASTER_CARS - 1);
  return {
    staticGeo,
    rotorGeo,
    gondolaGeo,
    trainGeo,
    carouselGeo,
    carouselAt: [CAROUSEL_CENTER.x, 0, CAROUSEL_CENTER.z],
    wheelBulbs: new Float32Array(wheelBulbs),
    staticBulbs: new Float32Array(bulbsStatic),
    gondolaColors,
    triangles: Math.round(triangles + instanced),
    drawCalls: 7,
    track,
  };
}
