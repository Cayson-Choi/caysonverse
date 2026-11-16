import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Vector3,
} from "three";
import { FALLS, MAT, NODE, plungeAt, plungeFallSeconds } from "./fallsConfig";

/**
 * A stand-in `waterfall.glb`, made in code with the agreed node and material names (design §7.4), so the runtime can
 * be built, looked at and tested before the art (W1 rock, W2 water, W3 bake) delivers the real file. DEV only (the
 * production build never draws it: without the file the falls draw nothing). Crude on purpose: a leaning cliff with
 * steps, a channel, a pool, a foam heap, and the water ribbons carrying the vertex colours the shaders read:
 *
 *  - plunge ribbons (`W_falls_plunge_n`): R air, G speed, B edge; UV u across, v = metres fallen / 4.
 *  - cascade (`W_falls_cascade`): RG flow direction in UV space (0.5 = none), B ledge; v = metres along / 4.
 *  - pool (`W_falls_pool`): R depth 0 (rim) .. 1 (middle).
 *  - foam (`W_falls_foam`): R looseness.
 */

const CHANNEL_Z = -79;
/** The stand-in cliff stands this far in front of the old one baked into village.glb (it cannot be hidden before the rebuild). */
const STUB_FORWARD = 1.6;

function noise(a: number, b: number): number {
  return 0.5 + 0.5 * Math.sin(a * 12.9898 + b * 78.233 + Math.sin(a * 3.1 + b * 1.7) * 4.3);
}

/** The stand-in cliff face's x at (z, y): leaning back with height, flanks coming forward, a channel above the ledge. */
export function stubFaceX(z: number, y: number): number {
  const dz = z - FALLS.centre.z;
  const lean = -116.1 - 11.2 * Math.pow(Math.max(y, 0) / 36, 1.25);
  const forward = Math.min(8, Math.pow(Math.abs(dz) / 18, 2) * 6.5);
  const wavy = 0.55 * Math.sin(dz * 0.9 + y * 0.35) + 0.4 * Math.sin(dz * 2.1 - y * 0.8) + 0.25 * Math.sin(dz * 4.3 + y * 1.9);
  const sheet = 0.45 * ((y / 3.7) % 1);
  const notch = y > 17 ? -2.1 * Math.exp(-Math.pow((z - CHANNEL_Z) / 2.6, 2)) * Math.min(1, (y - 17) / 2) : 0;
  const alcove = y < 17 && y > 0 ? -2.6 * Math.exp(-Math.pow(dz / 4, 2)) * Math.sin((Math.PI * y) / 17) : 0;
  return lean + forward + wavy + sheet + notch + alcove;
}

function cliffGeometry(): BufferGeometry {
  const zs: number[] = [];
  for (let z = -98; z <= -58.001; z += 0.8) zs.push(z);
  const ys: number[] = [];
  for (let y = -2.6; y <= 41.001; y += 0.5) ys.push(y);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j < ys.length; j++) {
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i]!;
      const y = ys[j]!;
      pos.push(stubFaceX(z, y) + STUB_FORWARD, y, z);
      const n = noise(z, y);
      const dz = z - FALLS.centre.z;
      const wet = Math.exp(-Math.pow(dz / 4.2, 2)) * (y < 20 ? 0.8 : 0.35);
      const moss = ((y / 3.7) % 1 < 0.18 ? 0.5 : 0) * noise(y, z * 2);
      const g = 0.42 + 0.14 * n;
      col.push(g * (1 - 0.5 * wet) * (1 - 0.35 * moss), g * (1 - 0.5 * wet) * (1 + 0.1 * moss), g * 1.02 * (1 - 0.5 * wet) * (1 - 0.5 * moss));
    }
  }
  const w = zs.length;
  for (let j = 0; j < ys.length - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = j * w + i;
      // wound so the face looks east (+x)
      idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A ribbon along `path` (x, y), `width(t)` wide across z around `z0(t)`, with the colours and UVs the shaders read. */
function ribbon(
  path: ReadonlyArray<{ x: number; y: number }>,
  width: (f: number) => number,
  z0: number,
  colour: (f: number, y: number) => [number, number, number],
  vOf: (i: number, f: number) => number,
  lift = 0,
): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const f = i / (path.length - 1);
    const p = path[i]!;
    const q = path[Math.min(i + 1, path.length - 1)]!;
    const r = path[Math.max(i - 1, 0)]!;
    const tx = q.x - r.x;
    const ty = q.y - r.y;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const half = width(f) / 2;
    for (const side of [-1, 1]) {
      pos.push(p.x + nx * lift, p.y + ny * lift, z0 + side * half);
      uv.push(side < 0 ? 0 : 1, vOf(i, f));
      col.push(...colour(f, p.y));
    }
  }
  for (let i = 0; i < path.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // facing east: a ribbon's normal comes out as (nx, ny, 0)
  const nrm: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const q = path[Math.min(i + 1, path.length - 1)]!;
    const r = path[Math.max(i - 1, 0)]!;
    const len = Math.hypot(q.x - r.x, q.y - r.y) || 1;
    for (let s = 0; s < 2; s++) nrm.push(-(q.y - r.y) / len, (q.x - r.x) / len, 0);
  }
  g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  return g;
}

function plunge(z0: number, speed: number, widths: [number, number], edge: number): BufferGeometry {
  const fall = plungeFallSeconds();
  const path: Array<{ x: number; y: number }> = [];
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const p = plungeAt((fall * i) / n);
    // a slower strand drifts less far out
    path.push({ x: FALLS.lip.x + STUB_FORWARD + (p.x - FALLS.lip.x) * (speed / FALLS.plungeSpeed), y: p.y });
  }
  return ribbon(
    path,
    (f) => widths[0] + (widths[1] - widths[0]) * f,
    z0,
    (f) => [Math.pow(f, 1.6), f, edge],
    (_i, _f) => 0,
  );
}

function withFallDistanceV(g: BufferGeometry): BufferGeometry {
  const p = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < p.count; i++) uv.setY(i, (FALLS.lip.y - p.getY(i)) / 4);
  return g;
}

function cascadeGeometry(): BufferGeometry {
  const path: Array<{ x: number; y: number }> = [];
  for (let y = 36; y >= FALLS.lip.y - 0.001; y -= 0.5) path.push({ x: stubFaceX(CHANNEL_Z, y) + 1.2 + STUB_FORWARD, y });
  let along = 0;
  const arc: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    along += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
    arc.push(along);
  }
  const ledges = [20.6, 24.4, 28, 31.8];
  return ribbon(
    path,
    (f) => 4.2 + 0.8 * f,
    CHANNEL_Z + 0.5,
    (_f, y) => [0.5, 1, Math.max(...ledges.map((l) => Math.exp(-Math.pow((y - l) / 0.4, 2))))],
    (i) => arc[i]! / 4,
    0.12,
  );
}

function poolGeometry(lift: number): BufferGeometry {
  const { centre, radiusX, radiusZ, waterY } = FALLS.pool;
  const segs = 48;
  const rings = 8;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const rho = r / rings;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(centre.x + Math.cos(a) * radiusX * rho, waterY + lift, centre.z + Math.sin(a) * radiusZ * rho);
      const d = Math.min(1, Math.max(0, (1 - rho) / 0.35));
      col.push(d * d * (3 - 2 * d), 0, 0);
      uv.push(0.25 + 0.24 * Math.cos(a) * rho, 0.5 + 0.48 * Math.sin(a) * rho);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * (segs + 1) + s;
      idx.push(a, a + segs + 1, a + 1, a + 1, a + segs + 1, a + segs + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // computeVertexNormals follows the winding: make them point up
  const n = g.getAttribute("normal");
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function outletGeometry(lift: number): BufferGeometry {
  const pts = FALLS.outlet.points;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const half = FALLS.outlet.width / 2;
  let along = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[Math.min(i + 1, pts.length - 1)]!;
    const r = pts[Math.max(i - 1, 0)]!;
    const dx = q.x - r.x;
    const dz = q.z - r.z;
    const len = Math.hypot(dx, dz) || 1;
    if (i > 0) along += Math.hypot(p.x - pts[i - 1]!.x, p.z - pts[i - 1]!.z);
    const y = FALLS.outlet.waterY[0] + (FALLS.outlet.waterY[1] - FALLS.outlet.waterY[0]) * (i / (pts.length - 1)) + lift;
    for (const side of [-1, 1]) {
      pos.push(p.x + (-dz / len) * half * side, y, p.z + (dx / len) * half * side);
      uv.push(side < 0 ? 0 : 1, along / 4);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const nrm: number[] = [];
  for (let i = 0; i < pts.length * 2; i++) nrm.push(0, 1, 0);
  g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  return g;
}

function foamGeometry(): BufferGeometry {
  const segs = 40;
  const rings = 8;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const rad = (r / rings) * 3.4;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const bump = 0.4 * Math.exp(-Math.pow(rad / 1.8, 2)) * (0.7 + 0.3 * noise(a * 3, r));
      pos.push(FALLS.impact.x + Math.cos(a) * rad * 0.85, FALLS.pool.waterY + 0.03 + bump, FALLS.impact.z + Math.sin(a) * rad * 1.2);
      col.push(0.4 + 0.5 * noise(a, r), 0, 0);
      uv.push(a / (Math.PI * 2), rad / 3.4);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * (segs + 1) + s;
      idx.push(a, a + segs + 1, a + 1, a + 1, a + segs + 1, a + segs + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.getAttribute("normal");
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/** The placeholder, with the nodes and materials of the contract. `poolLift`: see `OLD_POOL_LIFT`. */
export function createFallsStub(poolLift = 0): Group {
  const root = new Group();
  root.name = "falls_stub";
  const named = (name: string, geo: BufferGeometry, mat: MeshBasicMaterial | MeshLambertMaterial): Mesh => {
    const m = new Mesh(geo, mat);
    m.name = name;
    root.add(m);
    return m;
  };
  const rockMat = new MeshLambertMaterial({ name: "M_falls_rock_stub", vertexColors: true });
  named(NODE.rockLod0, cliffGeometry(), rockMat);

  // shore boulders and the slabs
  const stone = new MeshLambertMaterial({ name: "M_falls_ground_stub", color: 0x8b8c8a });
  const boulder = new IcosahedronGeometry(1, 1);
  const { centre, radiusX, radiusZ } = FALLS.pool;
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + noise(i, 1) * 0.2;
    if (Math.cos(a) > 0.55) continue; // east side stays open (the rest area)
    const k = 1.06 + 0.12 * noise(i, 4);
    const m = new Mesh(boulder, stone);
    m.name = `falls_boulder_${i}`;
    m.position.set(centre.x + Math.cos(a) * radiusX * k, -0.2, centre.z + Math.sin(a) * radiusZ * k);
    const s = 0.6 + 1.4 * noise(i, 9);
    m.scale.set(s * 1.2, s * 0.7, s);
    m.rotation.y = noise(i, 3) * 6;
    root.add(m);
  }
  for (const slab of FALLS.slabs) {
    const m = new Mesh(new CylinderGeometry(1, 1, 0.3, 20), stone);
    m.name = slab.id;
    m.scale.set(slab.radiusX, 1, slab.radiusZ);
    m.position.set(slab.centre.x, slab.top - 0.15, slab.centre.z);
    m.rotation.y = slab.yaw;
    root.add(m);
  }

  const water = (name: string): MeshBasicMaterial => new MeshBasicMaterial({ name });
  const sides: Array<[number, number, [number, number], number]> = [
    [FALLS.lip.z, FALLS.plungeSpeed, [3.4, 5.2], 0.3],
    [FALLS.lip.z - 2.6, 1.5, [0.9, 1.8], 0.7],
    [FALLS.lip.z + 2.6, 1.5, [0.9, 1.8], 0.7],
  ];
  sides.forEach(([z, speed, widths, edge], i) => {
    const g = withFallDistanceV(plunge(z, speed, widths, edge));
    named(`${NODE.plunge}${i}`, g, water(MAT.water)).renderOrder = 4 + i;
  });
  named(NODE.cascade, cascadeGeometry(), water(MAT.cascade)).renderOrder = 3;
  named(NODE.pool, poolGeometry(poolLift), water(MAT.pool)).renderOrder = 2;
  named(NODE.outlet, outletGeometry(poolLift), water(MAT.pool)).renderOrder = 2;
  named(NODE.foam, foamGeometry(), water(MAT.foam)).renderOrder = 7;

  const impact = new Object3D();
  impact.name = NODE.impact;
  impact.position.set(FALLS.impact.x, FALLS.impact.y, FALLS.impact.z);
  root.add(impact);
  const lip = new Object3D();
  lip.name = NODE.lip;
  lip.position.copy(new Vector3(FALLS.lip.x, FALLS.lip.y, FALLS.lip.z));
  root.add(lip);
  root.updateMatrixWorld(true);
  return root;
}
