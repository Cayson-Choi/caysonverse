import { Box3, Matrix4, Vector3, type BufferGeometry, type InstancedMesh, type Mesh, type Object3D } from "three";
import { VILLAGE_LOTS, lotDoorPoint } from "@caysonverse/shared/village/villageLots";
import { setLotDoor, type LotNodes } from "./lotsPrep";

/**
 * The swing doors' clearance check (owner 2026-11-17: "자동문이 주위의 물체와 겹치잖아 제발 좀 꼼꼼하게 확인해"), DEV only: every rigged
 * leaf is swept from shut to fully open in 5% steps, and at each step every edge of the leaf's mesh is tested against every triangle of
 * the rest of its lot (shells, detail, goods; the instanced ones per instance) within 3 m of the door. A touch along the hinge line (3 cm)
 * and on the floor (y < 3 cm) is the leaf's own fitting and does not count; anything else is listed with the step it first happens at.
 * The leaves are put back where they were.
 */
export interface DoorHit {
  door: string;
  leaf: string;
  amount: number;
  against: string;
  at: [number, number, number];
  /** How far (m, on the ground) from the hinge's axis the touch is. */
  fromHinge: number;
  /** The triangle it touched and the leaf's edge (DEV, for the report). */
  tri: number[];
  edge: number[];
  /** The touched face looks toward the door's pad (the street): the overlap can be seen. False: a back face, culled from outside. */
  seen: boolean;
}

const EPS = 1e-7;
/** The hinge's knuckle (m round its axis): the leaf's stile and the frame's rebate meet there by design. */
export const HINGE_KNUCKLE = 0.03;
const e1 = new Vector3();
const e2 = new Vector3();
const h = new Vector3();
const s = new Vector3();
const q = new Vector3();

/** Segment p0→p1 against triangle (a, b, c): the hit point, or null (Möller–Trumbore, both faces). */
function segTri(p0: Vector3, p1: Vector3, a: Vector3, b: Vector3, c: Vector3, out: Vector3): boolean {
  const dir = q.subVectors(p1, p0);
  e1.subVectors(b, a);
  e2.subVectors(c, a);
  h.crossVectors(dir, e2);
  const det = e1.dot(h);
  if (Math.abs(det) < EPS) return false;
  const inv = 1 / det;
  s.subVectors(p0, a);
  const u = s.dot(h) * inv;
  if (u < 0 || u > 1) return false;
  const qq = s.clone().cross(e1);
  const v = dir.dot(qq) * inv;
  if (v < 0 || u + v > 1) return false;
  const t = e2.dot(qq) * inv;
  if (t < 0 || t > 1) return false;
  out.copy(dir).multiplyScalar(t).add(p0);
  return true;
}

function worldTriangles(o: Mesh, near: Box3, into: { tris: Float32Array[]; names: string[] }): void {
  const g = o.geometry as BufferGeometry;
  const pos = g.getAttribute("position");
  if (!pos) return;
  const idx = g.index;
  const inst = (o as InstancedMesh).isInstancedMesh ? (o as InstancedMesh) : null;
  const mats: Matrix4[] = [];
  if (inst) {
    const m = new Matrix4();
    for (let i = 0; i < inst.count; i++) {
      inst.getMatrixAt(i, m);
      mats.push(m.clone().premultiply(o.matrixWorld));
    }
  } else mats.push(o.matrixWorld);
  const n = idx ? idx.count : pos.count;
  const va = new Vector3();
  const vb = new Vector3();
  const vc = new Vector3();
  const tb = new Box3();
  for (const mw of mats) {
    const out: number[] = [];
    for (let i = 0; i < n; i += 3) {
      const ia = idx ? idx.getX(i) : i;
      const ib = idx ? idx.getX(i + 1) : i + 1;
      const ic = idx ? idx.getX(i + 2) : i + 2;
      va.fromBufferAttribute(pos, ia).applyMatrix4(mw);
      vb.fromBufferAttribute(pos, ib).applyMatrix4(mw);
      vc.fromBufferAttribute(pos, ic).applyMatrix4(mw);
      tb.makeEmpty().expandByPoint(va).expandByPoint(vb).expandByPoint(vc);
      if (!tb.intersectsBox(near)) continue;
      out.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
    }
    if (out.length) {
      into.tris.push(new Float32Array(out));
      into.names.push(o.name || o.parent?.name || "?");
    }
  }
}

function leafEdges(leaf: Object3D): Array<[Vector3, Vector3]> {
  const edges: Array<[Vector3, Vector3]> = [];
  leaf.updateWorldMatrix(true, true);
  leaf.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute("position");
    const idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    const v = [new Vector3(), new Vector3(), new Vector3()];
    for (let i = 0; i < n; i += 3) {
      for (let k = 0; k < 3; k++) v[k]!.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(m.matrixWorld);
      edges.push([v[0]!.clone(), v[1]!.clone()], [v[1]!.clone(), v[2]!.clone()], [v[2]!.clone(), v[0]!.clone()]);
    }
  });
  return edges;
}

export function doorSwingClearance(nodes: LotNodes): { checked: number; steps: number; hits: DoorHit[]; perDoor: Record<string, number> } {
  const hits: DoorHit[] = [];
  const perDoor: Record<string, number> = {};
  let checked = 0;
  const STEPS = 20;
  nodes.root.updateMatrixWorld(true);
  for (const rig of nodes.doors) {
    if (rig.leaves.every((l) => !l.swing)) continue;
    const lot = VILLAGE_LOTS.find((l) => l.id === rig.lot)!;
    const d = lot.doors.find((x) => x.id === rig.id)!;
    const dp = lotDoorPoint(lot, d);
    const c = dp.centre;
    const pad = dp.pad;
    const near = new Box3(new Vector3(c.x - 3, -0.1, c.z - 3), new Vector3(c.x + 3, 4.5, c.z + 3));
    // everything of the lot but the leaves (the same lot: its detail group, the merged shells that cross the box)
    const leafSet = new Set<Object3D>();
    for (const l of rig.leaves) l.node.traverse((o) => leafSet.add(o));
    const env = { tris: [] as Float32Array[], names: [] as string[] };
    nodes.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || leafSet.has(o) || o.renderOrder === 3) return;
      worldTriangles(m, near, env);
    });
    perDoor[rig.id] = 0;
    for (const leaf of rig.leaves) {
      if (!leaf.swing) continue;
      checked++;
      // the hinge: the leaf node's own origin (its pivot), vertical
      const hinge = new Vector3().setFromMatrixPosition(leaf.node.matrixWorld);
      for (let k = 1; k <= STEPS; k++) {
        const amount = k / STEPS;
        setLotDoor({ ...rig, leaves: [leaf] }, amount);
        leaf.node.updateMatrixWorld(true);
        const edges = leafEdges(leaf.node);
        const at = new Vector3();
        let found: DoorHit | null = null;
        outer: for (const [p0, p1] of edges) {
          for (let t = 0; t < env.tris.length; t++) {
            const arr = env.tris[t]!;
            for (let i = 0; i < arr.length; i += 9) {
              const a = new Vector3(arr[i], arr[i + 1], arr[i + 2]);
              const b = new Vector3(arr[i + 3], arr[i + 4], arr[i + 5]);
              const cc = new Vector3(arr[i + 6], arr[i + 7], arr[i + 8]);
              if (!segTri(p0, p1, a, b, cc, at)) continue;
              if (at.y < 0.03) continue; // the floor and the threshold under the leaf
              const fromHinge = Math.hypot(at.x - hinge.x, at.z - hinge.z);
              const nrm = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(cc, a));
              const seen = nrm.dot(new Vector3(pad.x - at.x, 1.4 - at.y, pad.z - at.z)) > 0;
              if (fromHinge < HINGE_KNUCKLE) continue; // the hinge's own knuckle
              found = { door: rig.id, leaf: leaf.node.name, amount, against: env.names[t]!, at: [+at.x.toFixed(3), +at.y.toFixed(3), +at.z.toFixed(3)], fromHinge: +fromHinge.toFixed(3), tri: Array.from(arr.slice(i, i + 9), (v) => +v.toFixed(3)), edge: [...p0.toArray(), ...p1.toArray()].map((v) => +v.toFixed(3)), seen };
              break outer;
            }
          }
        }
        if (found) {
          hits.push(found);
          perDoor[rig.id]!++;
        }
      }
      setLotDoor({ ...rig, leaves: [leaf] }, 0);
    }
  }
  return { checked, steps: STEPS, hits, perDoor };
}
