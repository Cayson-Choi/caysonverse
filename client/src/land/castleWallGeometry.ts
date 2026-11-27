/**
 * The castle wall's stones (2026-11-20, shared/src/village/parkWall.ts holds the plan): a few small geometries drawn as INSTANCES along a
 * plan's runs and at its towers, so the whole ring (600 m in the village, 1.6 km in the park) is a handful of draw calls.
 *
 *   module   6 m of curtain wall: a buried footing, the body, arrow slits, a corbel table under an overhanging outer parapet with
 *            merlons (crenellations), the wall-walk, a low inner parapet with its own merlons, and on the inner face a stepped
 *            buttress, a string course and a corbel table (stone)
 *   tower    a round tower: footing, shaft, a corbelled flare, a crenellated parapet ring, slit windows, a stone bracket for the lamp (stone)
 *   roof     the tower's bell-kicked cone (tiles)
 *   trim     the gilt eave band, the finial and its spike, the banner's rod (gold)
 *   banner   a swallow-tailed banner on the tower's face (cloth, a canvas texture)
 *   lantern  an iron lantern (group 0: the iron, group 1: the glass that glows at night)
 *
 * Local frame of a module: x along the wall (-3 .. 3), y up from the ground, z OUT of the enclosure. A tower's +z looks at the plan's
 * `facing` point. UVs are in metres (u along the face, v DOWN, the PBR library's glTF convention), so the stone texture keeps its real
 * size whatever the part. Pure geometry: unit-tested in node.
 */
import { BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from "three";
import { WALL, type WallPlan } from "@caysonverse/shared/village/parkWall";

type V3 = [number, number, number];

class Kit {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  groups: { start: number; count: number; mat: number }[] = [];
  get vertices(): number {
    return this.pos.length / 3;
  }
  v(p: V3, n: V3, u: number, w: number, c: number | V3): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, w);
    const cc = typeof c === "number" ? [c, c, c] : c;
    this.col.push(cc[0]!, cc[1]!, cc[2]!);
    return this.vertices - 1;
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }
  /**
   * An axis-aligned box (x0..x1, y0..y1, z0..z1) with metre UVs. `skip` names faces left out ("-y" the underside that sits on
   * something, "-x"/"+x" the ends where the next module continues).
   */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number | V3, skip: string[] = ["-y"]): void {
    const F: [string, V3, V3, V3, V3, V3][] = [
      // name, normal, then the four corners counter-clockwise seen from outside
      ["+z", [0, 0, 1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
      ["-z", [0, 0, -1], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
      ["+x", [1, 0, 0], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
      ["-x", [-1, 0, 0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      ["+y", [0, 1, 0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
      ["-y", [0, -1, 0], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    ];
    for (const [name, n, ...corners] of F) {
      if (skip.includes(name)) continue;
      const ids = corners.map((p) => {
        // u along the face (metres), v down the face (or across a top)
        const u = n[0] !== 0 ? p[2] * -n[0] : p[0] * (n[2] !== 0 ? n[2] : 1);
        const w = n[1] !== 0 ? p[2] : -p[1];
        return this.v(p, n, u, w, c);
      });
      this.quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
    }
  }
  /** A ring surface between (r0, y0) and (r1, y1) round the y axis, `sides` facets, u = arc length (m). `inward` flips it. */
  ring(r0: number, y0: number, r1: number, y1: number, sides: number, c: number | V3, inward = false): void {
    const base = this.vertices;
    const dr = r1 - r0;
    const dy = y1 - y0;
    const len = Math.hypot(dr, dy) || 1;
    const ny = -dr / len;
    const nr = dy / len;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const s = inward ? -1 : 1;
      const n: V3 = [ca * nr * s, ny * s, sa * nr * s];
      // u in metres round the ring, the circumference rounded to whole 3 m stone tiles so the courses close without a seam
      const u = (i / sides) * Math.max(3, Math.round((Math.PI * 2 * Math.max(r0, r1)) / 3) * 3);
      this.v([ca * r0, y0, sa * r0], n, u, -y0, c);
      this.v([ca * r1, y1, sa * r1], n, u, -y1, c);
    }
    for (let i = 0; i < sides; i++) {
      const a = base + i * 2;
      if (inward) this.quad(a, a + 2, a + 3, a + 1);
      else this.quad(a, a + 1, a + 3, a + 2);
    }
  }
  /** A flat annulus at height y between radii rIn and rOut, facing up. */
  annulus(rIn: number, rOut: number, y: number, sides: number, c: number | V3): void {
    const base = this.vertices;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      this.v([ca * rIn, y, sa * rIn], [0, 1, 0], ca * rIn, sa * rIn, c);
      this.v([ca * rOut, y, sa * rOut], [0, 1, 0], ca * rOut, sa * rOut, c);
    }
    for (let i = 0; i < sides; i++) {
      const a = base + i * 2;
      this.quad(a, a + 2, a + 3, a + 1);
    }
  }
  /** A box turned about y by `yaw` (its local x along the tangent), centred at (cx, cz). */
  turnedBox(cx: number, cz: number, yaw: number, hx: number, y0: number, y1: number, hz: number, c: number | V3): void {
    const from = this.vertices;
    this.box(-hx, hx, y0, y1, -hz, hz, c);
    const co = Math.cos(yaw);
    const si = Math.sin(yaw);
    for (let i = from; i < this.vertices; i++) {
      const x = this.pos[3 * i]!;
      const z = this.pos[3 * i + 2]!;
      this.pos[3 * i] = cx + x * co + z * si;
      this.pos[3 * i + 2] = cz - x * si + z * co;
      const nx = this.nor[3 * i]!;
      const nz = this.nor[3 * i + 2]!;
      this.nor[3 * i] = nx * co + nz * si;
      this.nor[3 * i + 2] = -nx * si + nz * co;
    }
  }
  startGroup(mat: number): void {
    this.groups.push({ start: this.idx.length, count: 0, mat });
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    for (let i = 0; i < this.groups.length; i++) {
      const gr = this.groups[i]!;
      const end = i + 1 < this.groups.length ? this.groups[i + 1]!.start : this.idx.length;
      g.addGroup(gr.start, end - gr.start, gr.mat);
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export type WallTier = "high" | "low";

const DARK = 0.13; // the slits' shadowed depth
/** The curtain wall's arrow slit: half width at the face and at the back of its splay, its foot and head (m), the embrasure's depth. */
export const SLIT = Object.freeze({ half: 0.15, back: 0.045, y0: 4.6, y1: 6.4, depth: 0.35 });
const FOOT = -3.6; // how far the footings reach under the ground (the wall steps down slopes)

/** 6 m of curtain wall (see the file's head). */
export function wallModuleGeometry(tier: WallTier): BufferGeometry {
  const k = new Kit();
  const H = WALL.halfThickness;
  const L = WALL.module / 2;
  const P = WALL.parapetOut;
  // the footing (a battered plinth, a little wider) and the body
  k.box(-L, L, FOOT, 0.9, -H - 0.25, H + 0.25, 0.84, ["-y", "-x", "+x"]);
  k.box(-L, L, 0.9, 8.6, -H, H, 1, ["-y", "-x", "+x", "+z"]);
  // the outer face, with the arrow slit CUT INTO it: a splayed embrasure 35 cm deep (stone cheeks narrowing to a dark slot). It used to be
  // a dark slab standing 3 cm proud of the wall, which from the side read as a black bar floating off the stone (owner 2026-11-21)
  {
    const S = SLIT;
    const outer = (x0: number, x1: number, y0: number, y1: number) => {
      const ids = ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as const).map(([x, y]) => k.v([x, y, H], [0, 0, 1], x, -y, 1));
      k.quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
    };
    outer(-L, -S.half, 0.9, 8.6);
    outer(S.half, L, 0.9, 8.6);
    outer(-S.half, S.half, 0.9, S.y0);
    outer(-S.half, S.half, S.y1, 8.6);
    const zb = H - S.depth;
    // the cheeks (their normals turned into the opening), the sill and the head, then the dark slot at the back
    const quadOf = (pts: V3[], n: V3, shade: number | number[]) => {
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      const nn: V3 = [n[0] / len, n[1] / len, n[2] / len];
      const ids = pts.map((p, i) => k.v(p, nn, p[0] + p[2], -p[1], typeof shade === "number" ? shade : shade[i]!));
      k.quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
    };
    const deep = 0.34; // the cheeks fall into shadow toward the slot
    quadOf([[-S.half, S.y0, H], [-S.back, S.y0, zb], [-S.back, S.y1, zb], [-S.half, S.y1, H]], [S.depth, 0, S.half - S.back], [0.8, deep, deep, 0.8]);
    quadOf([[S.back, S.y0, zb], [S.half, S.y0, H], [S.half, S.y1, H], [S.back, S.y1, zb]], [-S.depth, 0, S.half - S.back], [deep, 0.8, 0.8, deep]);
    quadOf([[-S.half, S.y0, H], [S.half, S.y0, H], [S.back, S.y0, zb], [-S.back, S.y0, zb]], [0, 1, 0], [0.86, 0.86, deep, deep]);
    quadOf([[-S.back, S.y1, zb], [S.back, S.y1, zb], [S.half, S.y1, H], [-S.half, S.y1, H]], [0, -1, 0], [deep, deep, 0.6, 0.6]);
    quadOf([[-S.back, S.y0, zb], [S.back, S.y0, zb], [S.back, S.y1, zb], [-S.back, S.y1, zb]], [0, 0, 1], DARK);
  }
  // a weathered offset where the body meets the plinth
  k.box(-L, L, 0.9, 1.12, H, H + 0.13, 0.9, ["-y", "-x", "+x"]);
  // the slit's sill
  k.box(-0.3, 0.3, 4.48, 4.6, H, H + 0.12, 0.9);
  // the corbel table under the overhanging parapet
  const corbels = tier === "high" ? 6 : 3;
  for (let i = 0; i < corbels; i++) {
    const x = -L + (WALL.module / corbels) * (i + 0.5);
    k.box(x - 0.18, x + 0.18, 7.95, 8.6, H, H + P, 0.92);
  }
  // the wall-walk's slab (its edge a projecting string course), the outer parapet and the merlons
  // (their undersides are kept: the slab and the parapet overhang the face, seen from below between the corbels)
  k.box(-L, L, 8.6, 8.85, -H - 0.12, H + P, 0.9, ["-x", "+x"]);
  k.box(-L, L, 8.85, 9.95, H - 0.32, H + P, 1, ["-x", "+x"]);
  // the coping along the embrasures, the merlons on it, each under its own cap stone (a slight overhang that throws a shadow line)
  k.box(-L, L, 9.95, 10.07, H - 0.38, H + P + 0.06, 0.93, ["-x", "+x"]);
  for (const x of [-2, 0, 2]) {
    k.box(x - 0.6, x + 0.6, 10.07, WALL.top - 0.15, H - 0.32, H + P, 0.97);
    k.box(x - 0.68, x + 0.68, WALL.top - 0.15, WALL.top, H - 0.4, H + P + 0.08, 0.92);
  }
  // the low inner parapet under its coping
  k.box(-L, L, 8.85, 9.65, -H - 0.12, -H + 0.3, 0.95, ["-y", "-x", "+x"]);
  k.box(-L, L, 9.65, 9.77, -H - 0.18, -H + 0.36, 0.9, ["-x", "+x"]);
  innerFace(k, tier);
  return k.build();
}

/** The inner face's buttress (m): half widths, depths off the face, the set-off's foot and the upper stage's top. */
export const INNER_BUTTRESS = Object.freeze({ lowerHalf: 0.55, lowerDepth: 0.5, upperHalf: 0.55, upperDepth: 0.32, setOff: 3.4, top: 6.6 });

/**
 * The curtain wall's INNER face (#13 exteriors round 2, owner 2026-11-27 "성벽 뒷면"): it was 7.7 m of plain ashlar with a thin pilaster
 * every 6 m, the merlons hidden behind the walk. Now, as a real curtain wall's back: a weathered offset over the plinth, a stepped
 * BUTTRESS at each module's middle (a deep lower stage, a sloped set-off, a shallower upper stage, a sloped weathering into the wall: no
 * deeper than the old pilaster, so the wall's solids stay as they are), a projecting STRING COURSE at 4.4 m, a corbel table under the
 * walk's slab (PC tier), and two MERLONS with cap stones on the inner parapet, so the battlements read from inside the park too.
 */
function innerFace(k: Kit, tier: WallTier): void {
  const H = WALL.halfThickness;
  const L = WALL.module / 2;
  const z = (d: number) => -H - d; // a depth off the inner face
  // the weathered offset where the body meets the plinth (the outer face has its own)
  k.box(-L, L, 0.9, 1.12, z(0.13), -H, 0.9, ["-y", "-x", "+x", "+z"]);
  // the string course (the buttress passes through it)
  k.box(-L, L, 4.4, 4.6, z(0.12), -H, 0.9, ["-x", "+x", "+z"]);
  // the buttress: lower stage, set-off, upper stage, weathering
  const B = INNER_BUTTRESS;
  k.box(-B.lowerHalf, B.lowerHalf, 0.9, B.setOff, z(B.lowerDepth), -H, 0.94, ["-y", "+z", "+y"]);
  slope(k, -B.lowerHalf, B.lowerHalf, B.setOff, z(B.lowerDepth), B.setOff + 0.3, z(B.upperDepth), 0.86);
  k.box(-B.upperHalf, B.upperHalf, B.setOff + 0.3, B.top, z(B.upperDepth), -H, 0.95, ["-y", "+z", "+y"]);
  slope(k, -B.upperHalf, B.upperHalf, B.top, z(B.upperDepth), B.top + 0.55, -H, 0.86);
  // the corbel table under the walk's projecting slab (the outer face's twin)
  if (tier === "high") for (const x of [-2.1, -1.05, 1.05, 2.1]) k.box(x - 0.15, x + 0.15, 8.1, 8.6, z(0.12), -H, 0.9, ["+z", "+y"]);
  // the inner parapet's merlons, offset from the outer ones (-2, 0, 2) so the battlements read in two ranks from below
  for (const x of [-1, 1]) {
    k.box(x - 0.48, x + 0.48, 9.77, 10.45, -H - 0.12, -H + 0.3, 0.97, ["-y"]);
    k.box(x - 0.55, x + 0.55, 10.45, 10.57, -H - 0.18, -H + 0.36, 0.9);
  }
}

/**
 * A sloped weathering across x0..x1 on the inner face: from (y0, z0) up to (y1, z1) (z1 nearer the wall), with its two side faces. The
 * faces are wound to their normals (the module's test).
 */
function slope(k: Kit, x0: number, x1: number, y0: number, z0: number, y1: number, z1: number, c: number): void {
  const H = WALL.halfThickness;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const l = Math.hypot(dy, dz) || 1;
  const n: V3 = [0, dz / l, -dy / l];
  face(k, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1]], n, c);
  for (const [x, s] of [[x0, -1], [x1, 1]] as const) {
    const pts: V3[] = z1 < -H - 1e-6 ? [[x, y0, z0], [x, y1, z1], [x, y1, -H], [x, y0, -H]] : [[x, y0, z0], [x, y1, z1], [x, y0, -H]];
    face(k, pts, [s, 0, 0], c);
  }
}

/** A flat polygon (3 or 4 corners) with normal n, wound so its winding agrees with n; metre uvs on the plane most facing it. */
function face(k: Kit, pts: V3[], n: V3, c: number): void {
  const [a, b, d] = [pts[0]!, pts[1]!, pts[2]!];
  const cr: V3 = [(b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])];
  const ordered = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0 ? pts : [...pts].reverse();
  const ids = ordered.map((p) => k.v(p, n, Math.abs(n[0]) > 0.5 ? p[2] : p[0], Math.abs(n[1]) > 0.7 ? p[2] : -p[1], c));
  if (ids.length === 4) k.quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
  else k.idx.push(ids[0]!, ids[1]!, ids[2]!);
}

/**
 * A run's end face (where a run stops against nothing of its own: the village wall at the gatehouse's passage): the wall's section closed
 * with stone, in the plane x = 0 of the module's frame, drawn on both sides (whichever end of the run it stands at, one of them looks out).
 * Without it the modules are open tubes: from the gateway one looked into the hollow wall, its walk slab hanging in the air.
 */
export function wallEndGeometry(): BufferGeometry {
  const k = new Kit();
  const H = WALL.halfThickness;
  const P = WALL.parapetOut;
  const plates: [number, number, number, number, number][] = [
    // z0, z1, y0, y1, shade (the module's own section, part by part)
    [-H - 0.25, H + 0.25, FOOT, 0.9, 0.84],
    [-H, H, 0.9, 8.6, 1],
    [H, H + 0.13, 0.9, 1.12, 0.9],
    [-H - 0.12, H + P, 8.6, 8.85, 0.9],
    [H - 0.32, H + P, 8.85, 9.95, 1],
    [H - 0.38, H + P + 0.06, 9.95, 10.07, 0.93],
    [-H - 0.12, -H + 0.3, 8.85, 9.65, 0.95],
    [-H - 0.18, -H + 0.36, 9.65, 9.77, 0.9],
  ];
  for (const [z0, z1, y0, y1, c] of plates) {
    for (const s of [1, -1]) {
      const pts: V3[] = s > 0 ? [[0, y0, z1], [0, y0, z0], [0, y1, z0], [0, y1, z1]] : [[0, y0, z0], [0, y0, z1], [0, y1, z1], [0, y1, z0]];
      const ids = pts.map((p) => k.v(p, [s, 0, 0], -p[2] * s, -p[1], c));
      k.quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
    }
  }
  return k.build();
}

const TOWER_SIDES = { high: 20, low: 14 } as const;

/** A round tower's stone (see the file's head): its +z looks at the viewer. */
export function towerGeometry(tier: WallTier): BufferGeometry {
  const k = new Kit();
  const S = TOWER_SIDES[tier];
  const R = WALL.towerR;
  const RP = WALL.towerParapetR;
  k.ring(R + 0.3, FOOT, R + 0.3, 1.0, S, 0.84);
  k.annulus(R, R + 0.3, 1.0, S, 0.86);
  k.ring(R, 1.0, R, 7.1, S, 1);
  // a projecting string course half way up (its top weathered back to the shaft)
  k.ring(R, 7.1, R + 0.13, 7.1, S, 0.9);
  k.ring(R + 0.13, 7.1, R + 0.13, 7.32, S, 0.92);
  k.ring(R + 0.13, 7.32, R, 7.45, S, 0.92);
  k.ring(R, 7.45, R, 11.4, S, 1);
  // the corbelled flare and the parapet ring (outer and inner faces, its top)
  k.ring(R, 11.4, RP, 12.1, S, 0.9);
  k.ring(RP, 12.1, RP, 12.95, S, 1);
  k.ring(RP - 0.4, 12.1, RP - 0.4, 12.95, S, 0.9, true);
  k.annulus(RP - 0.4, RP, 12.95, S, 0.95);
  // merlons on the parapet ring
  const nm = tier === "high" ? 10 : 8;
  for (let i = 0; i < nm; i++) {
    const a = (i / nm) * Math.PI * 2;
    const rr = RP - 0.2;
    k.turnedBox(Math.sin(a) * rr, Math.cos(a) * rr, a, 0.5, 12.95, WALL.towerTop - 0.14, 0.2, 0.97);
    k.turnedBox(Math.sin(a) * rr, Math.cos(a) * rr, a, 0.57, WALL.towerTop - 0.14, WALL.towerTop, 0.27, 0.92); // its cap stone
  }
  // slit windows: one toward the viewer under the banner's rod, two either side of it, and the lamp's stone bracket
  // each in a dressed stone surround (jambs, lintel, sill) that stands proud of the shaft, the dark opening sunk inside it: a bare dark
  // slab on the round shaft read from the side as a bar floating off the tower (owner 2026-11-21)
  for (const a of [0, 1.15, -1.15]) {
    const y0 = a === 0 ? 2.6 : 6.2;
    const y1 = a === 0 ? 4.0 : 8.2;
    const at = (r: number): [number, number] => [Math.sin(a) * r, Math.cos(a) * r];
    const dark = at(R - 0.02);
    k.turnedBox(dark[0], dark[1], a, 0.17, y0, y1, 0.05, DARK);
    const fr = at(R + 0.02);
    for (const sx of [-1, 1]) {
      // the jambs stand either side of the opening (the box's local x is the tangent)
      const jx = fr[0] + Math.cos(a) * sx * 0.215;
      const jz = fr[1] - Math.sin(a) * sx * 0.215;
      k.turnedBox(jx, jz, a, 0.055, y0 - 0.1, y1 + 0.1, 0.1, 0.9);
    }
    k.turnedBox(fr[0], fr[1], a, 0.3, y1, y1 + 0.14, 0.12, 0.92); // the lintel
    k.turnedBox(fr[0], fr[1], a, 0.32, y0 - 0.12, y0, 0.14, 0.88); // the sill
  }
  k.turnedBox(0.95, R + 0.18, 0, 0.16, 4.3, 4.75, 0.2, 0.88);
  k.turnedBox(-0.95, R + 0.18, 0, 0.16, 4.3, 4.75, 0.2, 0.88);
  return k.build();
}

/** The tower's roof: a bell-kicked cone of tiles rising from inside the parapet. */
export function roofGeometry(tier: WallTier): BufferGeometry {
  const k = new Kit();
  const S = tier === "high" ? 24 : 16;
  const prof: [number, number][] = [
    [WALL.towerParapetR - 0.1, 12.75],
    [WALL.towerR - 0.3, 13.75],
    [2.0, 15.6],
    [1.05, 17.8],
    [0.02, WALL.roofApex],
  ];
  for (let i = 0; i + 1 < prof.length; i++) k.ring(prof[i]![0], prof[i]![1], prof[i + 1]![0], prof[i + 1]![1], S, 1);
  return k.build();
}

/** Gilt trim: the eave band, the finial ball and spike, the banner's rod and its knobs (+z: the viewer side). */
export function trimGeometry(tier: WallTier): BufferGeometry {
  const k = new Kit();
  const S = tier === "high" ? 20 : 14;
  const R = WALL.towerParapetR;
  k.ring(R - 0.02, 12.72, R + 0.05, 12.86, S, 1);
  k.ring(R + 0.05, 12.86, R - 0.08, 13.0, S, 1);
  // the finial: a turned stem, a ball and a spike
  const prof: [number, number][] = [
    [0.18, WALL.roofApex - 0.4],
    [0.3, WALL.roofApex + 0.1],
    [0.12, WALL.roofApex + 0.45],
    [0.34, WALL.roofApex + 0.75],
    [0.38, WALL.roofApex + 1.0],
    [0.3, WALL.roofApex + 1.25],
    [0.06, WALL.roofApex + 1.5],
    [0.03, WALL.roofApex + 2.6],
  ];
  for (let i = 0; i + 1 < prof.length; i++) k.ring(prof[i]![0], prof[i]![1], prof[i + 1]![0], prof[i + 1]![1], 8, 1);
  // the banner's rod and knobs
  k.box(-1.05, 1.05, 10.62, 10.74, WALL.towerR + 0.32, WALL.towerR + 0.44, 1, []);
  k.box(-1.14, -1.02, 10.54, 10.82, WALL.towerR + 0.26, WALL.towerR + 0.5, 1, []);
  k.box(1.02, 1.14, 10.54, 10.82, WALL.towerR + 0.26, WALL.towerR + 0.5, 1, []);
  return k.build();
}

/** A swallow-tailed banner hanging from the rod (both faces; the texture's u 0..1 across, v 0 at the top). */
export function bannerGeometry(): BufferGeometry {
  const k = new Kit();
  const z = WALL.towerR + 0.38;
  const top = 10.6;
  const bot = 6.4;
  const notch = 7.1;
  const w = 0.92;
  for (const s of [1, -1]) {
    const n: V3 = [0, 0, s];
    const a = k.v([-w, top, z], n, 0, 0, 1);
    const b = k.v([w, top, z], n, 1, 0, 1);
    const c = k.v([w, bot, z], n, 1, 1, 1);
    const d = k.v([0, notch, z], n, 0.5, (top - notch) / (top - bot), 1);
    const e = k.v([-w, bot, z], n, 0, 1, 1);
    if (s > 0) k.idx.push(a, e, d, a, d, b, b, d, c);
    else k.idx.push(a, d, e, a, b, d, b, c, d);
  }
  return k.build();
}

/**
 * A banner hung on the curtain wall's inner face (#13 round 2): a swallow-tailed cloth under a gilt rod on two brackets, between the
 * buttresses, under the corbel table. Local frame: the face at z 0, hanging out along +z (group 0: the cloth, both faces; group 1: the
 * rod). The cloth samples the towers' banner texture (u 0..1 across, v 0 at the top).
 */
export const WALL_BANNER = Object.freeze({ top: 7.85, bottom: 5.0, notch: 5.55, half: 0.62, off: 0.09 });
export function wallBannerGeometry(): BufferGeometry {
  const k = new Kit();
  const B = WALL_BANNER;
  k.startGroup(0);
  for (const s of [1, -1]) {
    const n: V3 = [0, 0, s];
    const z = B.off + 0.004 * s;
    const a = k.v([-B.half, B.top, z], n, 0, 0, 1);
    const b = k.v([B.half, B.top, z], n, 1, 0, 1);
    const c = k.v([B.half, B.bottom, z], n, 1, 1, 1);
    const d = k.v([0, B.notch, z], n, 0.5, (B.top - B.notch) / (B.top - B.bottom), 1);
    const e = k.v([-B.half, B.bottom, z], n, 0, 1, 1);
    if (s > 0) k.idx.push(a, e, d, a, d, b, b, d, c);
    else k.idx.push(a, d, e, a, b, d, b, c, d);
  }
  k.startGroup(1);
  k.box(-B.half - 0.1, B.half + 0.1, B.top, B.top + 0.07, B.off - 0.035, B.off + 0.035, 1, []);
  for (const x of [-B.half - 0.04, B.half + 0.04]) k.box(x - 0.025, x + 0.025, B.top - 0.02, B.top + 0.09, 0, B.off + 0.04, 1, ["-z"]);
  return k.build();
}

/** An iron lantern on a bracket (group 0: iron, group 1: the glass). Its back is at z 0, it hangs out along +z. */
export function lanternGeometry(): BufferGeometry {
  const k = new Kit();
  const iron = 1;
  k.startGroup(0);
  k.box(-0.05, 0.05, 0.62, 0.72, 0, 0.42, iron, []); // the arm
  k.box(-0.22, 0.22, 0.5, 0.58, 0.18, 0.62, iron, []); // the lantern's cap
  k.box(-0.12, 0.12, 0.58, 0.7, 0.28, 0.52, iron, []);
  k.box(-0.2, 0.2, -0.04, 0.02, 0.2, 0.6, iron, []); // its base
  k.startGroup(1);
  k.box(-0.17, 0.17, 0.02, 0.5, 0.23, 0.57, 1, []);
  return k.build();
}

// ───────────────────────────────────────── placing the instances ─────────────────────────────────────────

export interface WallInstances {
  modules: Matrix4[];
  /** The end faces of the runs the plan closes (`capA` / `capB`). */
  ends: Matrix4[];
  towers: Matrix4[];
  /** Wall lanterns (on the viewer's face) and tower lanterns, as matrices; their glow centres for the halos. */
  lanterns: Matrix4[];
  glows: V3[];
  /** Banners on the inner face (wallBannerGeometry): every `lampEvery` modules, between the lanterns. */
  banners: Matrix4[];
  /** Triangles drawn (all instances). */
  triangles: number;
}

const up = new Vector3(0, 1, 0);
/** How far the wall banners' back stands off the inner face (clear of the string course's 12 cm). */
const WALL_BANNER_STANDOFF = 0.13;

function placed(x: number, y: number, z: number, yaw: number, sx = 1): Matrix4 {
  return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(up, yaw), new Vector3(sx, 1, 1));
}

/**
 * Every module and tower of `plan` on the ground `heightAt` (world or park-local, as the plan is). `lampsOn`: "inner" puts the wall
 * lanterns on the inner face (the park), "outer" on the outer face of the runs whose outer side looks at the plan's `facing` point
 * (the village side facing the village square).
 */
export function wallInstances(plan: WallPlan, heightAt: (x: number, z: number) => number, lampsOn: "inner" | "outer", lampEvery = lampsOn === "inner" ? 4 : 2): WallInstances {
  const modules: Matrix4[] = [];
  const ends: Matrix4[] = [];
  const towers: Matrix4[] = [];
  const lanterns: Matrix4[] = [];
  const glows: V3[] = [];
  const banners: Matrix4[] = [];
  const H = WALL.halfThickness;
  for (const r of plan.runs) {
    const dx = r.bx - r.ax;
    const dz = r.bz - r.az;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / WALL.module));
    const sx = len / n / WALL.module;
    const ux = dx / len;
    const uz = dz / len;
    // the module's local +z is `out` (R(yaw) * (0, 0, 1) = (sin yaw, cos yaw)); its local x then lies along the run (it is symmetric in x)
    const yawOut = Math.atan2(r.out[0], r.out[1]);
    for (const [cap, ex, ez] of [[r.capA, r.ax, r.az], [r.capB, r.bx, r.bz]] as const) {
      if (!cap) continue;
      let g = Infinity;
      for (const b of [-H, 0, H]) g = Math.min(g, heightAt(ex + r.out[0] * b, ez + r.out[1] * b));
      ends.push(placed(ex, (Number.isFinite(g) ? g : 0) - 0.08, ez, yawOut));
    }
    const facesViewer = r.out[0] * (plan.facing.x - (r.ax + r.bx) / 2) + r.out[1] * (plan.facing.z - (r.az + r.bz) / 2) > 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const cx = r.ax + dx * t;
      const cz = r.az + dz * t;
      const half = (len / n) / 2;
      let g = Infinity;
      for (const [a, b] of [[-half, -H], [half, -H], [-half, H], [half, H], [0, 0]] as const) g = Math.min(g, heightAt(cx + ux * a + r.out[0] * b, cz + uz * a + r.out[1] * b));
      const y = (Number.isFinite(g) ? g : 0) - 0.08;
      modules.push(placed(cx, y, cz, yawOut, sx));
      // a banner on the inner face, the other side of the buttress from where an inner lantern hangs, half way between them
      if (i % lampEvery === 0 && i > 0 && i < n - 1) {
        const fx = cx - r.out[0] * (H + WALL_BANNER_STANDOFF);
        const fz = cz - r.out[1] * (H + WALL_BANNER_STANDOFF);
        banners.push(placed(fx - ux * 1.6, y, fz - uz * 1.6, Math.atan2(-r.out[0], -r.out[1])));
      }
      const lampHere = lampsOn === "inner" || facesViewer;
      if (lampHere && i % lampEvery === Math.floor(lampEvery / 2) && i > 0 && i < n - 1) {
        // on the inner face: the lantern hangs inward (-out); on the outer face: outward
        const s = lampsOn === "inner" ? -1 : 1;
        const fx = cx + r.out[0] * s * H;
        const fz = cz + r.out[1] * s * H;
        const along = 1.4; // beside the pilaster (inside) or the arrow slit (outside)
        const lx = fx + ux * along;
        const lz = fz + uz * along;
        const ly = y + 4.6;
        const lyaw = Math.atan2(r.out[0] * s, r.out[1] * s);
        lanterns.push(placed(lx, ly, lz, lyaw));
        glows.push([lx + r.out[0] * s * 0.4, ly + 0.26, lz + r.out[1] * s * 0.4]);
      }
    }
  }
  for (const t of plan.towers) {
    let g = Infinity;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g = Math.min(g, heightAt(t.x + Math.cos(a) * WALL.towerR, t.z + Math.sin(a) * WALL.towerR));
    }
    g = Math.min(g, heightAt(t.x, t.z));
    const y = (Number.isFinite(g) ? g : 0) - 0.08;
    const yaw = Math.atan2(plan.facing.x - t.x, plan.facing.z - t.z);
    towers.push(placed(t.x, y, t.z, yaw));
    const r = WALL.towerR + 0.38;
    const lx = t.x + Math.sin(yaw) * r;
    const lz = t.z + Math.cos(yaw) * r;
    // two lanterns, either side of the slit window, on the stone brackets
    for (const side of [-0.95, 0.95]) {
      const ox = Math.cos(yaw) * side;
      const oz = -Math.sin(yaw) * side;
      lanterns.push(placed(t.x + Math.sin(yaw) * (WALL.towerR - 0.02) + ox, y + 4.75, t.z + Math.cos(yaw) * (WALL.towerR - 0.02) + oz, yaw));
      glows.push([lx + ox + Math.sin(yaw) * 0.05, y + 5.0, lz + oz + Math.cos(yaw) * 0.05]);
    }
  }
  return { modules, ends, towers, lanterns, glows, banners, triangles: 0 };
}

/** Triangles of a geometry (indexed). */
export const trianglesOf = (g: BufferGeometry): number => (g.index ? g.index.count / 3 : g.getAttribute("position").count / 3);
