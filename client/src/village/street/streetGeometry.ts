// The new lamp post, banner hardware and banner fabric, built in code (one geometry each, drawn instanced: streetFurniture.ts).
//
// The post follows the Korean park / plaza pedestrian light (보행등·공원등; research 2026-11-16, Aside: catalogues and
// municipal photos): a round steel shaft tapering from Ø136 to Ø100 mm on a cast decorative base cover (Ø320 mm, fluted, with
// moulded rings and a bolted access door, 점검구) that sits on an anchor flange with its nuts showing, collar rings where
// the base meets the shaft and under the head, and a post-top lantern: a flared opal glass on a cast tray, six slim frame
// bars, a drip-edged roof and a finial. Dark grey powder coat (the material: streetMaterials.ts).
//
// Every vertex carries `liftW` (0 or 1): the instance's `aLift` raises what has 1 (everything above the base), so one model
// serves the 4.23 m plaza posts, the 3.83 m lane posts and the 5.03 m banner poles (the lower shaft stretches).

import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4, Quaternion, SphereGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BANNER, LAMP_MODEL_LIGHT_Y } from "./streetLayout";

/** Above this height (m, model space) a vertex rides the instance's lift. */
export const LIFT_FROM_Y = 1.0;
/** How long one texture repeat is on the metal (m). */
const UV_METRE = 0.5;

/** A profile point: radius and height (m); `hard` breaks the shading there (a crisp edge). */
export type ProfilePoint = readonly [r: number, y: number, hard?: boolean];

interface LatheOpts {
  segs: number;
  /** Fluting: `count` shallow grooves of relative `depth` between y0 and y1. */
  flute?: { count: number; depth: number; y0: number; y1: number };
}

/** Attributes every street geometry carries, in this order (mergeGeometries needs the same set). */
function finish(g: BufferGeometry, lift: (y: number) => number): BufferGeometry {
  const pos = g.getAttribute("position");
  const w = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) w[i] = lift(pos.getY(i));
  g.setAttribute("liftW", new Float32BufferAttribute(w, 1));
  for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv", "liftW"].includes(name)) g.deleteAttribute(name);
  return g.index ? g.toNonIndexed() : g;
}

const liftAbove = (y: number): number => (y >= LIFT_FROM_Y ? 1 : 0);

/**
 * A surface of revolution with smooth normals along each run of the profile and crisp edges at `hard` points (the point is
 * doubled). UV: u around in whole repeats of ~UV_METRE, v along the profile's length.
 */
export function lathe(profile: readonly ProfilePoint[], opts: LatheOpts): BufferGeometry {
  const runs: ProfilePoint[][] = [[]];
  profile.forEach((p, i) => {
    runs[runs.length - 1]!.push(p);
    if (p[2] && i > 0 && i < profile.length - 1) runs.push([p]);
  });
  const parts: BufferGeometry[] = [];
  let vAcc = 0;
  for (const run of runs) {
    if (run.length < 2) continue;
    const n = run.length;
    // 2D outward normals per point: the average of the neighbouring segments in this run
    const segN = (a: ProfilePoint, b: ProfilePoint): [number, number] => {
      const dr = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l];
    };
    const pn: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? segN(run[i - 1]!, run[i]!) : null;
      const b = i < n - 1 ? segN(run[i]!, run[i + 1]!) : null;
      const x = (a?.[0] ?? 0) + (b?.[0] ?? 0);
      const y = (a?.[1] ?? 0) + (b?.[1] ?? 0);
      const l = Math.hypot(x, y) || 1;
      pn.push([x / l, y / l]);
    }
    const rAvg = run.reduce((s, p) => s + p[0], 0) / n;
    const uRep = Math.max(1, Math.round((2 * Math.PI * rAvg) / UV_METRE));
    const segs = opts.segs;
    const position: number[] = [];
    const normal: number[] = [];
    const uv: number[] = [];
    const vs: number[] = [];
    let v = vAcc;
    for (let i = 0; i < n; i++) {
      if (i > 0) v += Math.hypot(run[i]![0] - run[i - 1]![0], run[i]![1] - run[i - 1]![1]) / UV_METRE;
      vs.push(v);
    }
    vAcc = v;
    for (let i = 0; i < n; i++) {
      const [r, y] = run[i]!;
      const fl = opts.flute && y >= opts.flute.y0 - 1e-6 && y <= opts.flute.y1 + 1e-6 ? opts.flute : null;
      for (let j = 0; j <= segs; j++) {
        const th = (j / segs) * Math.PI * 2;
        const groove = fl ? 1 - fl.depth * Math.pow(Math.max(0, Math.cos(th * fl.count)), 6) : 1;
        const rr = r * groove;
        position.push(Math.sin(th) * rr, y, Math.cos(th) * rr);
        normal.push(Math.sin(th) * pn[i]![0], pn[i]![1], Math.cos(th) * pn[i]![0]);
        uv.push((j / segs) * uRep, vs[i]!);
      }
    }
    const index: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * (segs + 1) + j;
        const b = a + segs + 1;
        index.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(position, 3));
    g.setAttribute("normal", new Float32BufferAttribute(normal, 3));
    g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    // a fluted run's grooves need their own normals (seam doubles keep their shading continuous enough at this size)
    if (opts.flute && run.some((p) => p[1] > opts.flute!.y0 && p[1] < opts.flute!.y1)) g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

const m4 = new Matrix4();
const q = new Quaternion();
const up = new Vector3(0, 1, 0);

/** A primitive placed: `g` moved to `at`, turned so its +y runs along `dir` (default up), then yawed. */
function place(g: BufferGeometry, at: [number, number, number], dir?: Vector3, yaw = 0): BufferGeometry {
  if (dir) q.setFromUnitVectors(up, dir.clone().normalize());
  else q.identity();
  m4.makeRotationFromQuaternion(q);
  g.applyMatrix4(m4);
  g.applyMatrix4(new Matrix4().makeRotationY(yaw));
  g.applyMatrix4(new Matrix4().makeTranslation(at[0], at[1], at[2]));
  return g;
}

/** The shaft's radius at height y (model space, before lift). */
export function shaftRadius(y: number, lift = 0): number {
  const y0 = SHAFT.y0;
  const y1 = SHAFT.y1 + lift;
  const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
  return SHAFT.r0 + (SHAFT.r1 - SHAFT.r0) * t;
}

/** The shaft: from the base cover's top to the head's fitter (model space for the 4.23 m post). */
export const SHAFT = { y0: 0.74, y1: LAMP_MODEL_LIGHT_Y - 0.6, r0: 0.068, r1: 0.05 } as const;

/** The lamp post's painted metal (everything but the glass), for the 4.23 m post; local +z is the access door's side. */
export function lampPostGeometry(): BufferGeometry {
  const L = LAMP_MODEL_LIGHT_Y;
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry): void => {
    parts.push(finish(g, liftAbove));
  };
  // anchor flange (cast ring on the footing) with six nuts on studs
  add(lathe([[0.2, 0.0, true], [0.2, 0.035, true], [0.0, 0.035]], { segs: 40 }));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const nut = new CylinderGeometry(0.017, 0.017, 0.022, 6);
    add(place(nut, [Math.sin(a) * 0.178, 0.046, Math.cos(a) * 0.178]));
    const stud = new CylinderGeometry(0.008, 0.008, 0.02, 8);
    add(place(stud, [Math.sin(a) * 0.178, 0.064, Math.cos(a) * 0.178]));
  }
  // the cast base cover: plinth, ogee, a bead, the fluted body, a ring and the cone up to the shaft
  add(
    lathe(
      [
        [0.0, 0.035, true],
        [0.165, 0.035, true],
        [0.165, 0.075, true],
        [0.158, 0.09],
        [0.142, 0.11],
        [0.138, 0.13, true],
        [0.15, 0.145],
        [0.152, 0.16],
        [0.148, 0.175],
        [0.134, 0.19, true],
        [0.128, 0.2, true],
        [0.118, 0.42],
        [0.106, 0.6, true],
        [0.122, 0.612, true],
        [0.124, 0.63],
        [0.12, 0.645, true],
        [0.1, 0.66],
        [0.078, 0.7],
        [0.07, 0.74, true],
      ],
      { segs: 40, flute: { count: 12, depth: 0.07, y0: 0.2, y1: 0.6 } },
    ),
  );
  // the access door (점검구): a raised cast panel with a rim and two screws, on the +z side of the body
  const door = new BoxGeometry(0.1, 0.18, 0.016, 1, 1, 1);
  add(place(door, [0, 0.39, 0.118]));
  const doorRim = new BoxGeometry(0.084, 0.164, 0.006);
  add(place(doorRim, [0, 0.39, 0.128]));
  for (const y of [0.32, 0.46]) {
    const screw = new CylinderGeometry(0.008, 0.008, 0.008, 10);
    add(place(screw, [0, y, 0.132], new Vector3(0, 0, 1)));
  }
  // the shaft, in two pieces so the lower one stretches with the lift; a double collar ring where they meet
  const COLLAR_Y = 2.2;
  const rC = shaftRadius(COLLAR_Y);
  add(lathe([[SHAFT.r0, SHAFT.y0], [rC, COLLAR_Y - 0.0]], { segs: 32 }));
  add(lathe([[rC, COLLAR_Y], [SHAFT.r1, SHAFT.y1]], { segs: 32 }));
  // (the collar rides the lift: liftAbove(2.2) = 1, so its lower edge's stretch is the shaft's)
  add(
    lathe(
      [
        [rC, COLLAR_Y - 0.06, true],
        [rC + 0.012, COLLAR_Y - 0.05],
        [rC + 0.014, COLLAR_Y - 0.035],
        [rC + 0.006, COLLAR_Y - 0.02, true],
        [rC + 0.006, COLLAR_Y + 0.02, true],
        [rC + 0.014, COLLAR_Y + 0.035],
        [rC + 0.012, COLLAR_Y + 0.05],
        [rC, COLLAR_Y + 0.06, true],
      ],
      { segs: 32 },
    ),
  );
  // a collar at the shaft's foot (over the cone)
  add(lathe([[0.07, 0.735, true], [0.084, 0.75], [0.084, 0.775], [0.068, 0.79, true]], { segs: 32 }));
  // the head: fitter, a collar, the cast tray under the glass
  add(
    lathe(
      [
        [SHAFT.r1, L - 0.6, true],
        [0.062, L - 0.585],
        [0.062, L - 0.545, true],
        [0.05, L - 0.53],
        [0.048, L - 0.47],
        [0.058, L - 0.455],
        [0.058, L - 0.44, true],
        [0.07, L - 0.4],
        [0.12, L - 0.32],
        [0.168, L - 0.272],
        [0.178, L - 0.262, true],
        [0.178, L - 0.236, true],
        [0.152, L - 0.236, true],
        [0.15, L - 0.226],
      ],
      { segs: 32 },
    ),
  );
  // six frame bars following the flared glass (r 0.155 at the bottom, 0.195 at the top)
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const b0 = new Vector3(Math.sin(a) * 0.158, L - 0.226, Math.cos(a) * 0.158);
    const b1 = new Vector3(Math.sin(a) * 0.198, L + 0.178, Math.cos(a) * 0.198);
    const len = b0.distanceTo(b1);
    const bar = new BoxGeometry(0.014, len, 0.012);
    const mid = b0.clone().add(b1).multiplyScalar(0.5);
    add(place(bar, [mid.x, mid.y, mid.z], b1.clone().sub(b0), 0));
  }
  // the roof: a band over the glass, a drip edge, the cone, a cap and the finial
  add(
    lathe(
      [
        [0.192, L + 0.172, true],
        [0.206, L + 0.172, true],
        [0.206, L + 0.2, true],
        [0.25, L + 0.214],
        [0.252, L + 0.226, true],
        [0.236, L + 0.236],
        [0.17, L + 0.29],
        [0.1, L + 0.34],
        [0.07, L + 0.36, true],
        [0.074, L + 0.37],
        [0.06, L + 0.385, true],
        [0.03, L + 0.4],
        [0.0, L + 0.405],
      ],
      { segs: 32 },
    ),
  );
  // the roof's underside (seen from below) and the finial ball and spike
  add(lathe([[0.0, L + 0.2, true], [0.192, L + 0.2, true], [0.192, L + 0.21]], { segs: 32 }));
  const ball = new SphereGeometry(0.032, 16, 10);
  add(place(ball, [0, L + 0.43, 0]));
  add(lathe([[0.012, L + 0.455, true], [0.004, L + 0.51], [0.0, L + 0.515]], { segs: 12 }));
  return mergeGeometries(parts)!;
}

/** The lantern's opal glass (its own material: it glows at night). */
export function lanternGlassGeometry(): BufferGeometry {
  const L = LAMP_MODEL_LIGHT_Y;
  const g = lathe(
    [
      [0.0, L - 0.226, true],
      [0.152, L - 0.226, true],
      [0.17, L - 0.1],
      [0.184, L + 0.04],
      [0.194, L + 0.176, true],
      [0.0, L + 0.176],
    ],
    { segs: 32 },
  );
  return finish(g, () => 1);
}

/**
 * The banner pole's hardware in the pole's frame (local x along the arms, local +z toward the plaza): two-way arms at the
 * top and bottom rods (Ø27 mm tube, 0.78 m each way, end knobs), each pair clamped to the shaft with a band clamp and a
 * cast bracket. Model space of the 4.23 m post: the pole's lift is added by the caller's matrix (heights are absolute).
 */
export function bannerHardwareGeometry(poleLift: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry): void => {
    parts.push(finish(g, () => 0));
  };
  for (const y of [BANNER.topY, BANNER.bottomY]) {
    const r = shaftRadius(y, poleLift);
    // band clamp: a ring around the shaft and its tightening lugs
    add(lathe([[r + 0.002, y - 0.035, true], [r + 0.008, y - 0.03], [r + 0.008, y + 0.03], [r + 0.002, y + 0.035, true]], { segs: 24 }));
    const lug = new BoxGeometry(0.03, 0.05, 0.028);
    add(place(lug, [0, y, -(r + 0.018)]));
    const bolt = new CylinderGeometry(0.006, 0.006, 0.07, 8);
    add(place(bolt, [0, y, -(r + 0.02)], new Vector3(1, 0, 0)));
    // the bracket block the arms screw into
    const block = new BoxGeometry(0.11, 0.05, 0.05);
    add(place(block, [0, y, 0]));
    for (const side of [-1, 1]) {
      const arm = new CylinderGeometry(0.0135, 0.0135, BANNER.armReach - r, 14, 1);
      add(place(arm, [side * (r + (BANNER.armReach - r) / 2), y, 0], new Vector3(1, 0, 0)));
      const knob = new SphereGeometry(0.02, 14, 8);
      add(place(knob, [side * BANNER.armReach, y, 0]));
      // a collar holding the fabric's pocket in at the inner end
      add(place(new CylinderGeometry(0.02, 0.02, 0.025, 14), [side * (BANNER.inner - 0.018), y, 0], new Vector3(1, 0, 0)));
    }
  }
  return mergeGeometries(parts)!;
}

/**
 * One banner (60 x 180 cm) hanging on the +x side of the pole: the printed fabric's two faces (6 mm apart, each with the
 * print the right way round) on a grid fine enough to billow, and the rod pockets wrapped around the rods. Attributes:
 *  - uv: the print (0..1 across the banner, v up; the material maps it into the atlas cell);
 *  - fab: (across 0..1 from the pole side, up 0..1, sway weight): the wind's frame, the same on both faces.
 */
export function bannerFabricGeometry(): BufferGeometry {
  const NX = 8;
  const NY = 26;
  const W = BANNER.width;
  const H = BANNER.topY - BANNER.bottomY;
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const fab: number[] = [];
  const index: number[] = [];
  const face = (side: 1 | -1): void => {
    const base = position.length / 3;
    for (let j = 0; j <= NY; j++) {
      for (let i = 0; i <= NX; i++) {
        const u = i / NX;
        const v = j / NY;
        position.push(BANNER.inner + u * W, BANNER.bottomY + v * H, side * 0.003);
        normal.push(0, 0, side);
        uv.push(side === 1 ? u : 1 - u, v);
        fab.push(u, v, 1);
      }
    }
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const a = base + j * (NX + 1) + i;
        const b = a + NX + 1;
        if (side === 1) index.push(a, a + 1, b, b, a + 1, b + 1);
        else index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  };
  face(1);
  face(-1);
  // rod pockets: the fabric folded round each rod (r 22 mm), printed with the pocket's band of the print
  const pocket = (y: number, v0: number, v1: number, fv: number): void => {
    const base = position.length / 3;
    const SEG = 12;
    for (let s = 0; s <= SEG; s++) {
      const th = (s / SEG) * Math.PI * 2;
      for (let i = 0; i <= NX; i++) {
        const u = i / NX;
        position.push(BANNER.inner + u * W, y + Math.sin(th) * 0.022, Math.cos(th) * 0.022);
        normal.push(0, Math.sin(th), Math.cos(th));
        uv.push(u, v0 + (v1 - v0) * (0.5 + 0.5 * Math.sin(th)));
        fab.push(u, fv, 0);
      }
    }
    for (let s = 0; s < SEG; s++) {
      for (let i = 0; i < NX; i++) {
        const a = base + s * (NX + 1) + i;
        const b = a + NX + 1;
        index.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  };
  pocket(BANNER.topY, 0.968, 1, 1);
  pocket(BANNER.bottomY, 0, 0.022, 0);
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("fab", new Float32BufferAttribute(fab, 3));
  g.setIndex(index);
  return g;
}
