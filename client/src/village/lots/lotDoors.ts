import { BufferGeometry, Color, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D } from "three";
import { GeoBuilder, type V3 } from "../../land/geoBuilder";
import { patchLotLight, type LotNodes } from "./lotsPrep";

/**
 * #13 exteriors, round 2 (fix/exteriors-r2, owner 2026-11-27 "도서관·교회 정문 판"): the library's and the church's front doors were two
 * flat 8 cm oak boards each (the kit's leaves: a slab, a painted handle, the library's top glass buried inside the slab). They become real
 * joinery, built here in the leaves' own frames so they still swing with the door rig (prepareLots' pivots) and the door pads, colliders
 * and the enter button stay exactly as they were:
 *
 *  - every leaf: oak stiles and rails (full 8 cm, the grain along each member), RAISED-AND-FIELDED panels on both faces (a thinner panel
 *    with a bevelled margin rising to a flat field), bolection mouldings round the panels on the street face;
 *  - the library (Edwardian brick and ashlar): two panels under a lock rail, a GLAZED top light in each leaf (the kit's own glass, now
 *    seen: a frame opening with glazing bars), brass lever handles on roses, brass kick plates, an astragal over the meeting stiles, the
 *    butt hinges' brass knuckles on the room side (inward-opening doors hide their hinges from the street);
 *  - the church (white clapboard): three panels, black iron strap hinges with round terminals and nail heads across each leaf, iron ring
 *    pulls on round bosses, a keyhole escutcheon, the astragal;
 *  - both: an oak threshold across the opening (static, on the door's node).
 *
 * The leaves stay live-lit (they never had the shell's baked maps); the counts stay per leaf: oak + metal (+ glass) = the kit's own draws.
 */

/** Which doors are rebuilt, and how. */
export const REAL_DOORS = {
  lot_library_main: { style: "library" },
  lot_church_main: { style: "church" },
} as const satisfies Record<string, { style: "library" | "church" }>;
export type RealDoorStyle = (typeof REAL_DOORS)[keyof typeof REAL_DOORS]["style"];

/** A leaf in "door space": s along the opening (metres), y up, t out of the building (0 = the leaf's mid-plane). */
export interface LeafSpec {
  /** The leaf's extent along the opening; `hinge` is the end it hangs on. */
  s0: number;
  s1: number;
  hinge: "s0" | "s1";
  y0: number;
  y1: number;
  /** Half the leaf's thickness. */
  ht: number;
}

/** The joinery's sizes (m). */
export const DOOR_JOINERY = {
  stile: 0.135,
  topRail: 0.14,
  bottomRail: 0.26,
  lockRail: 0.19,
  /** The library's rail under its glazed light, and the church's upper intermediate rail. */
  frieze: 0.13,
  /** The panel's edge half-thickness, its field's (proud of the edge), and the bevel's width. */
  panelEdge: 0.012,
  panelField: 0.026,
  bevel: 0.075,
  /** The bolection moulding's width and how far it stands off the stiles' face. */
  bolection: 0.032,
  bolectionProud: 0.012,
  /** The library's lock rail centre and glazed light's foot; the church's lock rail and upper rail centres. */
  libraryLock: 1.05,
  libraryGlassFoot: 2.33,
  churchLock: 1.05,
  churchUpper: 2.35,
} as const;

type Emit = (p: V3) => V3;

/** Door-space builders: geometry in (s, y, t), the colour given; UVs in metres with the oak's grain along `grain` (the set runs it along u). */
export class DoorKit {
  readonly g = new GeoBuilder();
  /**
   * `shade`: the joinery's contact shadow in the vertex colour (the leaves are live-lit, without a bake): faces square to the leaf full,
   * the bevels a little darker, the frame's inner edges and undersides darker still, so the panels read in the porch's shade too.
   */
  constructor(readonly colour: V3, readonly shade = false) {}
  /** One quad (corners counter-clockwise seen from its front), metre UVs: v along the grain axis (the oak set's grain runs along v), u across. */
  quad(a: V3, b: V3, c: V3, d: V3, grain: "s" | "y"): void {
    const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: V3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const nn: V3 = [n[0] / l, n[1] / l, n[2] / l];
    const uv = (p: V3): [number, number] => {
      // the grain along s (rails) or y (stiles, panels): a face's u is that axis; v the other one in its plane
      const along = grain === "s" ? p[0] : p[1];
      const across = Math.abs(nn[2]) > 0.5 ? (grain === "s" ? p[1] : p[0]) : Math.abs(nn[0]) > 0.5 ? p[2] + (grain === "s" ? 0 : p[1]) : p[2] + (grain === "s" ? 0 : p[0]);
      return [across, along];
    };
    let col = this.colour;
    if (this.shade) {
      const sq = Math.abs(nn[2]);
      const k = sq > 0.98 ? 1 : sq > 0.3 ? 0.6 + 0.12 * Math.sign(nn[1]) : nn[1] > 0.5 ? 0.78 : 0.42;
      col = [this.colour[0] * k, this.colour[1] * k, this.colour[2] * k];
    }
    const ids = [a, b, c, d].map((p) => {
      const [u, v] = uv(p);
      return this.g.rawVertex(p, nn, u, v, col);
    });
    this.g.idx.push(ids[0]!, ids[1]!, ids[2]!, ids[0]!, ids[2]!, ids[3]!);
  }
  /** An axis-aligned box in door space (s0..s1, y0..y1, t0..t1); `skip` faces by name. */
  box(s0: number, s1: number, y0: number, y1: number, t0: number, t1: number, grain: "s" | "y", skip: readonly string[] = []): void {
    const F: Array<[string, V3, V3, V3, V3]> = [
      ["+t", [s0, y0, t1], [s1, y0, t1], [s1, y1, t1], [s0, y1, t1]],
      ["-t", [s1, y0, t0], [s0, y0, t0], [s0, y1, t0], [s1, y1, t0]],
      ["+s", [s1, y0, t1], [s1, y0, t0], [s1, y1, t0], [s1, y1, t1]],
      ["-s", [s0, y0, t0], [s0, y0, t1], [s0, y1, t1], [s0, y1, t0]],
      ["+y", [s0, y1, t1], [s1, y1, t1], [s1, y1, t0], [s0, y1, t0]],
      ["-y", [s0, y0, t0], [s1, y0, t0], [s1, y0, t1], [s0, y0, t1]],
    ];
    for (const [name, a, b, c, d] of F) if (!skip.includes(name)) this.quad(a, b, c, d, grain);
  }
  /** A disc facing ±t (a boss, a rose, a nail head): a short cylinder with its outer cap. */
  disc(s: number, y: number, t: number, r: number, depth: number, sides = 12): void {
    const sign = Math.sign(depth) || 1;
    this.g.cylinder([s, y, t], [s, y, t + depth], r, r * 0.92, sides, this.colour, false);
    const base = this.g.vertices;
    const n: V3 = [0, 0, sign];
    const c = this.g.rawVertex([s, y, t + depth], n, s, y, this.colour);
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      this.g.rawVertex([s + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92, t + depth], n, s, y, this.colour);
    }
    for (let i = 0; i < sides; i++) this.g.idx.push(...(sign > 0 ? [c, base + 1 + i, base + 2 + i] : [c, base + 2 + i, base + 1 + i]));
  }
  build(map: Emit): BufferGeometry {
    for (let i = 0; i < this.g.pos.length; i += 3) {
      const p = map([this.g.pos[i]!, this.g.pos[i + 1]!, this.g.pos[i + 2]!]);
      this.g.pos[i] = p[0];
      this.g.pos[i + 1] = p[1];
      this.g.pos[i + 2] = p[2];
    }
    return this.g.build();
  }
}

/**
 * A raised-and-fielded panel filling the frame opening (sa..sb, ya..yb) on both faces: the panel's edge (±panelEdge, let into the frame's
 * groove a little), a bevelled margin rising to the field (±panelField) and the flat field. Grain vertical.
 */
export function fieldedPanel(k: DoorKit, sa: number, sb: number, ya: number, yb: number): void {
  const J = DOOR_JOINERY;
  const g = 0.006; // into the groove: no gap at the frame's edge however it is seen
  const bw = Math.min(J.bevel, (sb - sa) / 4, (yb - ya) / 4);
  for (const f of [1, -1]) {
    const e = f * J.panelEdge;
    const fd = f * J.panelField;
    const o: V3[] = [[sa - g, ya - g, e], [sb + g, ya - g, e], [sb + g, yb + g, e], [sa - g, yb + g, e]];
    const i: V3[] = [[sa + bw, ya + bw, fd], [sb - bw, ya + bw, fd], [sb - bw, yb - bw, fd], [sa + bw, yb - bw, fd]];
    // the field, then the four bevels (each from the outer edge up to the field), wound to face out of this side
    const q = (a: V3, b: V3, c: V3, d: V3) => (f > 0 ? k.quad(a, b, c, d, "y") : k.quad(d, c, b, a, "y"));
    q(i[0]!, i[1]!, i[2]!, i[3]!);
    q(o[0]!, o[1]!, i[1]!, i[0]!);
    q(o[1]!, o[2]!, i[2]!, i[1]!);
    q(o[2]!, o[3]!, i[3]!, i[2]!);
    q(o[3]!, o[0]!, i[0]!, i[3]!);
  }
}

/** A bolection moulding round a frame opening on one face (side f): four mitred-looking strips standing off the stiles' face. */
function bolection(k: DoorKit, sa: number, sb: number, ya: number, yb: number, face: number, ht: number): void {
  const J = DOOR_JOINERY;
  const w = J.bolection;
  const t0 = face > 0 ? ht - 0.004 : -ht - J.bolectionProud;
  const t1 = face > 0 ? ht + J.bolectionProud : -ht + 0.004;
  k.box(sa - w * 0.35, sb + w * 0.35, ya - w * 0.35, ya + w * 0.65, t0, t1, "s");
  k.box(sa - w * 0.35, sb + w * 0.35, yb - w * 0.65, yb + w * 0.35, t0, t1, "s");
  k.box(sa - w * 0.35, sa + w * 0.65, ya + w * 0.65, yb - w * 0.65, t0, t1, "y");
  k.box(sb - w * 0.65, sb + w * 0.35, ya + w * 0.65, yb - w * 0.65, t0, t1, "y");
}

/** One leaf's parts in door space: oak (frame, panels, mouldings), metal (the style's fittings) and glass (the library's light). */
export function leafParts(style: RealDoorStyle, L: LeafSpec, oak: V3, metal: V3): { oak: DoorKit; metal: DoorKit; glass: DoorKit | null } {
  const J = DOOR_JOINERY;
  const k = new DoorKit(oak, true);
  const m = new DoorKit(metal);
  const glass = style === "library" ? new DoorKit([1, 1, 1]) : null;
  const { s0, s1, y0, y1, ht } = L;
  const inner = L.hinge === "s0" ? s1 : s0; // the meeting edge
  const toward = L.hinge === "s0" ? -1 : 1; // from the meeting edge into the leaf (along s)
  const sa = s0 + J.stile;
  const sb = s1 - J.stile;
  // stiles full height (vertical grain), rails between them (horizontal grain)
  k.box(s0, sa, y0, y1, -ht, ht, "y");
  k.box(sb, s1, y0, y1, -ht, ht, "y");
  const rails: Array<[number, number]> = [[y0, y0 + J.bottomRail], [y1 - J.topRail, y1]];
  const lock = style === "library" ? J.libraryLock : J.churchLock;
  rails.push([lock - J.lockRail / 2, lock + J.lockRail / 2]);
  const upper = style === "library" ? J.libraryGlassFoot : J.churchUpper;
  rails.push([upper - J.frieze, upper]);
  rails.sort((a, b) => a[0] - b[0]);
  for (const [a, b] of rails) k.box(sa, sb, a, b, -ht, ht, "s", ["+s", "-s"]);
  // the openings between the rails: panels (and the library's glazed top)
  const openings: Array<[number, number]> = [];
  for (let i = 0; i + 1 < rails.length; i++) openings.push([rails[i]![1], rails[i + 1]![0]]);
  openings.forEach(([ya, yb], i) => {
    const top = i === openings.length - 1;
    if (top && glass) {
      // the glazed light: the kit's glass at the mid-plane, a glazing bar each way, putty beads both faces
      const sm = (sa + sb) / 2;
      const ym = (ya + yb) / 2;
      // (one face: the lots' glass is drawn from both sides)
      glass.quad([sa, ya, 0], [sb, ya, 0], [sb, yb, 0], [sa, yb, 0], "s");
      const bar = 0.019;
      const bt = ht * 0.72;
      k.box(sm - bar, sm + bar, ya, yb, -bt, bt, "y", ["+y", "-y"]);
      k.box(sa, sm - bar, ym - bar, ym + bar, -bt, bt, "s", ["-s"]);
      k.box(sm + bar, sb, ym - bar, ym + bar, -bt, bt, "s", ["+s"]);
      for (const f of [1, -1]) {
        const t0 = f > 0 ? 0.004 : -ht;
        const t1 = f > 0 ? ht : -0.004;
        k.box(sa, sb, ya, ya + 0.022, t0, t1, "s", ["+s", "-s"]);
        k.box(sa, sb, yb - 0.022, yb, t0, t1, "s", ["+s", "-s"]);
        k.box(sa, sa + 0.022, ya + 0.022, yb - 0.022, t0, t1, "y", ["+y", "-y"]);
        k.box(sb - 0.022, sb, ya + 0.022, yb - 0.022, t0, t1, "y", ["+y", "-y"]);
      }
      return;
    }
    fieldedPanel(k, sa, sb, ya, yb);
    if (style === "library") bolection(k, sa, sb, ya, yb, 1, ht);
  });
  // the astragal over the meeting stiles (the right leaf's: s0 hinge = the leaf on the + side carries it)
  if (L.hinge === "s1") k.box(inner - 0.028, inner + 0.028, y0 + 0.02, y1 - 0.02, ht - 0.002, ht + 0.014, "y");

  if (style === "library") {
    // a brass lever on a round rose both faces, at the lock rail, beside the meeting stile; a brass kick plate on the street face
    const hs = inner + toward * 0.075;
    for (const f of [1, -1]) {
      const t = f * ht;
      m.disc(hs, lock, t, 0.032, f * 0.012, 14);
      m.g.cylinder([hs, lock, t + f * 0.012], [hs, lock, t + f * 0.055], 0.011, 0.011, 8, metal, false);
      m.box(Math.min(hs, hs + toward * 0.13), Math.max(hs, hs + toward * 0.13), lock - 0.011, lock + 0.011, t + f * 0.045 - 0.011, t + f * 0.045 + 0.011, "s");
      // a keyhole escutcheon under the lever
      m.disc(hs, lock - 0.13, t, 0.016, f * 0.004, 10);
    }
    m.box(s0 + 0.03, s1 - 0.03, y0 + 0.03, y0 + 0.23, ht - 0.002, ht + 0.0035, "s");
    // the butt hinges' knuckles on the room side of the hinge edge
    const hingeS = L.hinge === "s0" ? s0 : s1;
    for (const hy of [y0 + 0.3, (y0 + y1) / 2, y1 - 0.3]) m.g.cylinder([hingeS, hy - 0.06, -ht], [hingeS, hy + 0.06, -ht], 0.012, 0.012, 8, metal, true);
  } else {
    // black iron strap hinges across the leaf from its hinge edge (the street face), each with a round terminal and nail heads
    const hingeS = L.hinge === "s0" ? s0 : s1;
    const into = L.hinge === "s0" ? 1 : -1;
    const len = (s1 - s0) * 0.72;
    const strapT0 = ht - 0.002;
    const strapT1 = ht + 0.007;
    for (const hy of [y0 + 0.42, y1 - 0.42, (y0 + y1) / 2 + 0.2]) {
      const sEnd = hingeS + into * len;
      // a tapering strap: a wide part at the hinge, narrower to the end, then a round terminal
      m.box(Math.min(hingeS, hingeS + into * len * 0.45), Math.max(hingeS, hingeS + into * len * 0.45), hy - 0.032, hy + 0.032, strapT0, strapT1, "s");
      m.box(Math.min(hingeS + into * len * 0.45, sEnd), Math.max(hingeS + into * len * 0.45, sEnd), hy - 0.022, hy + 0.022, strapT0, strapT1, "s");
      m.disc(sEnd, hy, strapT1 - 0.002, 0.045, 0.006, 14);
      for (let n = 1; n <= 4; n++) m.disc(hingeS + into * len * (n / 5), hy, strapT1 - 0.001, 0.011, 0.006, 6);
      // the knuckle at the hinge edge
      m.g.cylinder([hingeS, hy - 0.07, ht + 0.012], [hingeS, hy + 0.07, ht + 0.012], 0.018, 0.018, 8, metal, true);
    }
    // the ring pull on its boss (street face), a plain boss on the room side, the keyhole escutcheon on the right leaf
    const rs = inner + toward * 0.12;
    m.disc(rs, lock + 0.05, ht, 0.06, 0.012, 16);
    m.disc(rs, lock + 0.05, -ht, 0.05, -0.012, 12);
    const ring: V3[] = [];
    const R = 0.068;
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      ring.push([rs + Math.sin(a) * R, lock + 0.05 - R + Math.cos(a) * R, ht + 0.026]);
    }
    m.g.tube(ring, 0.0085, 6, metal);
    if (L.hinge === "s1") m.disc(rs, lock - 0.14, ht, 0.022, 0.005, 10);
  }
  return { oak: k, metal: m, glass };
}

/** The leaf frame of a lot door: door space -> world (the door's centre on the ground, `along` the opening, `out` of the building). */
export interface DoorFrame {
  origin: Vector3;
  along: Vector3;
  out: Vector3;
}
export function doorToWorld(f: DoorFrame): Emit {
  return ([s, y, t]) => [f.origin.x + f.along.x * s + f.out.x * t, y, f.origin.z + f.along.z * s + f.out.z * t];
}

function isMesh(o: Object3D): o is Mesh {
  return (o as Mesh).isMesh === true;
}
function firstMat(o: Mesh): Material {
  return (Array.isArray(o.material) ? o.material[0] : o.material) as Material;
}
function vertexTint(o: Mesh): V3 {
  const c = o.geometry.getAttribute("color");
  return c ? [c.getX(0), c.getY(0), c.getZ(0)] : [1, 1, 1];
}

/** The fittings' metals: polished brass (the library), black iron (the church: its own lot material when there is one). */
function brassMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ name: "door_brass", color: new Color(0.78, 0.58, 0.26), roughness: 0.32, metalness: 0.55, vertexColors: true });
  patchLotLight(m, "door-brass");
  return m;
}

export interface RealDoorStats {
  doors: string[];
  triangles: number;
  replaced: number;
}

/**
 * Rebuild the library's and the church's front leaves (and lay their thresholds): the kit's leaf meshes go, the new joinery goes into the
 * same leaf groups (so the rig swings it), in each leaf's own frame. Their materials are the lot's own (oak, glass, iron); the library's
 * brass is new. Records what it made in `nodes.own` (the lots' disposal).
 */
export function dressLotDoors(nodes: LotNodes): RealDoorStats {
  const stats: RealDoorStats = { doors: [], triangles: 0, replaced: 0 };
  nodes.root.updateMatrixWorld(true);
  let brass: MeshStandardMaterial | null = null;
  const v = new Vector3();
  for (const rig of nodes.doors) {
    const spec = (REAL_DOORS as Record<string, { style: RealDoorStyle }>)[rig.id];
    if (!spec || rig.leaves.length !== 2) continue;
    const doorNode = nodes.root.getObjectByName(`door__${rig.id}`);
    if (!doorNode) continue;
    // the kit's leaf meshes, their world box, their materials
    const leaves = rig.leaves.map((lf) => {
      const meshes: Mesh[] = [];
      lf.node.traverse((o) => {
        if (isMesh(o)) meshes.push(o);
      });
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const m of meshes) {
        const pos = m.geometry.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          min.min(v);
          max.max(v);
        }
      }
      return { lf, meshes, min, max };
    });
    if (leaves.some((l) => !l.meshes.length)) continue;
    const oakMesh = leaves[0]!.meshes.find((m) => /_oak$/.test(firstMat(m).name));
    if (!oakMesh) continue;
    const oakMat = firstMat(oakMesh);
    // a shade lighter than the kit's slab: the joinery's relief shows in the porch's shade (the old board was near black there)
    const oakTint = vertexTint(oakMesh).map((c) => Math.min(1, c * 1.25)) as V3;
    const glassMat = leaves[0]!.meshes.map(firstMat).find((m) => m.name === "M_glass") ?? null;
    const ironMesh = leaves[0]!.meshes.find((m) => /_iron$/.test(firstMat(m).name));
    let metalMat: Material;
    let metalTint: V3;
    if (spec.style === "church" && ironMesh) {
      metalMat = firstMat(ironMesh);
      metalTint = vertexTint(ironMesh);
    } else {
      brass ??= brassMaterial();
      metalMat = brass;
      metalTint = [1, 1, 1];
    }
    // the door's frame: the leaves are thin in one horizontal axis (out), side by side along the other
    const all = leaves.reduce((b, l) => ({ min: b.min.clone().min(l.min), max: b.max.clone().max(l.max) }), { min: leaves[0]!.min.clone(), max: leaves[0]!.max.clone() });
    const thinX = all.max.x - all.min.x < all.max.z - all.min.z;
    const centre = new Vector3((all.min.x + all.max.x) / 2, 0, (all.min.z + all.max.z) / 2);
    const doorPos = new Vector3().setFromMatrixPosition(doorNode.matrixWorld);
    const box = nodes.boxes.find((b) => b.id === rig.lot)?.box;
    const lotCentre = box ? new Vector3((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2) : doorPos;
    const out = thinX ? new Vector3(Math.sign(centre.x - lotCentre.x) || 1, 0, 0) : new Vector3(0, 0, Math.sign(centre.z - lotCentre.z) || 1);
    const along = new Vector3(0, 1, 0).cross(out).normalize(); // right-handed: s × y = t
    // the oak slab's mid-plane: the oak meshes' own extent along `out` (the fittings stood off it)
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const l of leaves)
      for (const m of l.meshes) {
        if (!/_oak$/.test(firstMat(m).name)) continue;
        const pos = m.geometry.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          const t = v.clone().sub(centre).dot(out);
          tMin = Math.min(tMin, t);
          tMax = Math.max(tMax, t);
        }
      }
    const mid = (tMin + tMax) / 2;
    const ht = Math.max(0.03, (tMax - tMin) / 2);
    const frame: DoorFrame = { origin: centre.clone().addScaledVector(out, mid), along, out };
    const toWorld = doorToWorld(frame);
    const sOf = (p: Vector3) => p.clone().sub(frame.origin).dot(along);
    let yTop = -Infinity;
    let yBot = Infinity;
    for (const l of leaves) {
      yTop = Math.max(yTop, l.max.y);
      yBot = Math.min(yBot, l.min.y);
    }
    for (const l of leaves) {
      // the leaf's own span along the opening (its oak's), hung on the end away from the opening's centre
      const a = sOf(l.min);
      const b = sOf(l.max);
      const s0 = Math.min(a, b);
      const s1 = Math.max(a, b);
      const L: LeafSpec = { s0: s0 + 0.002, s1: s1 - 0.002, hinge: Math.abs(s0) > Math.abs(s1) ? "s0" : "s1", y0: yBot, y1: yTop - 0.02, ht };
      const parts = leafParts(spec.style, L, oakTint, metalTint);
      // into the leaf group's own frame (its pivot and any height fit), so the rig turns it
      const leafGroup = l.meshes[0]!.parent!;
      const inv = new Matrix4().copy(leafGroup.matrixWorld).invert();
      const add = (kit: DoorKit | null, mat: Material | null, name: string, cast: boolean) => {
        if (!kit || !mat || !kit.g.idx.length) return;
        const g = kit.build(toWorld).applyMatrix4(inv);
        g.computeBoundingSphere();
        g.computeBoundingBox();
        const mesh = new Mesh(g, mat);
        mesh.name = name;
        mesh.castShadow = cast;
        mesh.receiveShadow = false;
        leafGroup.add(mesh);
        nodes.own.geometries.push(g);
        stats.triangles += g.index ? g.index.count / 3 : 0;
      };
      for (const m of l.meshes) {
        m.parent?.remove(m);
        stats.replaced++;
      }
      add(parts.oak, oakMat, `${leafGroup.name}__oak`, true);
      add(parts.metal, metalMat, `${leafGroup.name}__metal`, true);
      add(parts.glass, glassMat, `${leafGroup.name}__glass`, false);
    }
    // the threshold: a hardwood oak sill across the opening, from under the leaves' room face out onto the step (the leaves' own oak:
    // the lot's granite is lightmapped through a second UV set these boxes do not have)
    {
      const sMin = Math.min(...leaves.map((l) => Math.min(sOf(l.min), sOf(l.max))));
      const sMax = Math.max(...leaves.map((l) => Math.max(sOf(l.min), sOf(l.max))));
      const k = new DoorKit(oakTint);
      const top = Math.max(0.025, yBot - 0.004);
      k.box(sMin - 0.08, sMax + 0.08, top - 0.07, top, -ht - 0.06, ht + 0.3, "s", ["-y"]);
      const inv = new Matrix4().copy(doorNode.matrixWorld).invert();
      const g = k.build(toWorld).applyMatrix4(inv);
      g.computeBoundingSphere();
      const mesh = new Mesh(g, oakMat);
      mesh.name = `door__${rig.id}__threshold`;
      mesh.castShadow = true;
      doorNode.add(mesh);
      nodes.own.geometries.push(g);
      stats.triangles += g.index ? g.index.count / 3 : 0;
    }
    stats.doors.push(rig.id);
  }
  if (brass) nodes.own.materials.push(brass);
  return stats;
}
