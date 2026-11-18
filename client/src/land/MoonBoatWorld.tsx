import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Euler,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  BoxGeometry,
  TubeGeometry,
  CatmullRomCurve3,
  InstancedMesh,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { compileSafely } from "../game/compileSafely";
import { BulbHalos } from "./nightGlow";
import { villageClock } from "../village/villageClock";
import {
  MOON_ARM_L,
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
type MatKey = "cream" | "indigo" | "violet" | "gold" | "wood" | "stone" | "pink" | "white" | "earpink" | "ink";

/** Geometry pieces by material: collected as non-indexed geometry with its matrix applied, merged once per material (a handful of draws per group, phone-friendly). */
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
  /** A cylinder (or cone) from a to b. */
  rod(key: MatKey, a: V3, b: V3, r0: number, r1 = r0, seg = 8): void {
    const A = new Vector3(...a);
    const B = new Vector3(...b);
    const dir = B.clone().sub(A);
    const len = dir.length();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    const m = new Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new Vector3(1, 1, 1));
    this.add(key, new CylinderGeometry(r1, r0, len, seg, 1), m);
  }
  ball(key: MatKey, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 10): void {
    this.add(key, new SphereGeometry(r, seg, Math.max(4, seg - 3)), new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(sx, sy, sz)));
  }
  meshes(mats: Record<MatKey, Material>): Mesh[] {
    const out: Mesh[] = [];
    for (const [key, list] of this.by) {
      const geo = mergeGeometries(list, false);
      if (!geo) continue;
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
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#4b4fd8");
  g.addColorStop(1, "#2a2d93");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 1004, 236);
  ctx.fillStyle = "#f3efea";
  ctx.font = "bold 130px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🌙 달배", 512, 120);
  ctx.font = "44px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#f2c14e";
  ctx.fillText("MOON BOAT", 512, 208);
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

/** The hull: a crescent slab (keel curve under, bowl curve over, the horns meeting at points), halfX each side of the middle. */
function hullGeometry(): BufferGeometry {
  const hz = MOON_HULL.halfZ;
  const shape = new Shape();
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const z = -hz + (2 * hz * i) / N;
    if (i === 0) shape.moveTo(z, moonKeelY(z));
    else shape.lineTo(z, moonKeelY(z));
  }
  for (let i = N; i >= 0; i--) {
    const z = -hz + (2 * hz * i) / N;
    shape.lineTo(z, moonFloorY(z));
  }
  const depth = MOON_HULL.halfX * 2;
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2); // the shape's x becomes the boat's z (toward the bow), its extrusion the boat's x
  return g;
}

const GUNWALE_H = 0.9;
const nightColor = new Color("#ffcf7a");

interface BoatBuild {
  boat: Mesh[];
  frame: Mesh[];
  boatBulbs: [number, number, number][];
  frameBulbs: [number, number, number][];
  starsBoat: V3[];
}

function build(mats: Record<MatKey, Material>): BoatBuild & { gunwale: Mesh[]; stars: Mesh[] } {
  const boat = new Parts();
  const frame = new Parts();
  const hz = MOON_HULL.halfZ;
  const hx = MOON_HULL.halfX;
  const boatBulbs: V3[] = [];
  const frameBulbs: V3[] = [];

  // ── the boat (frame: axle at the origin, y up, z toward the bow) ──
  boat.add("cream", hullGeometry());
  // an indigo band along the keel's underside and violet trim along both bowls' rims
  for (const sx of [-1, 1]) {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const z = -hz + (2 * hz * i) / 24;
      pts.push(new Vector3(sx * (hx + 0.14), moonFloorY(z) + 0.02, z));
    }
    boat.add("violet", new TubeGeometry(new CatmullRomCurve3(pts), 48, 0.13, 6, false));
    // the gunwale: a gold rail 0.9 m over the bowl on posts
    const rail: Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const z = -hz + 0.7 + ((2 * hz - 1.4) * i) / 20;
      rail.push(new Vector3(sx * (hx - 0.1), moonFloorY(z) + GUNWALE_H, z));
    }
    boat.add("gold", new TubeGeometry(new CatmullRomCurve3(rail), 40, 0.06, 6, false));
    for (let i = 0; i <= 20; i += 2) {
      const p = rail[i]!;
      boat.rod("gold", [p.x, moonFloorY(p.z), p.z], [p.x, p.y, p.z], 0.035, 0.035, 5);
    }
    for (let i = 0; i <= 20; i += 1) boatBulbs.push([rail[i]!.x + sx * 0.02, rail[i]!.y + 0.12, rail[i]!.z]);
  }
  // the terraces, benches and lap bars
  for (let row = 0; row < MOON_BOAT_ROWS; row++) {
    const z = MOON_SEAT.z0 - row * MOON_SEAT.dz;
    const fy = moonFloorY(z);
    boat.box("cream", hx * 2 - 0.15, 0.6, MOON_SEAT.dz - 0.05, 0, fy - 0.3, z);
    boat.box("wood", hx * 2 - 0.15, 0.04, MOON_SEAT.dz - 0.05, 0, fy + 0.02, z);
    for (let col = 0; col < MOON_BOAT_COLS; col++) {
      const x = (col - (MOON_BOAT_COLS - 1) / 2) * MOON_SEAT.dx;
      boat.box("pink", 0.76, 0.5, 0.55, x, fy + 0.25, z - 0.05); // the cushion (top 0.5: the hips settle onto it)
      boat.box("pink", 0.76, 0.6, 0.12, x, fy + 0.8, z - 0.4); // the back
      boat.box("violet", 0.8, 0.05, 0.16, x, fy + 1.12, z - 0.4);
    }
    // the lap bar: a padded indigo bar over the thighs, posts at the ends
    boat.rod("indigo", [-hx + 0.3, fy + 0.85, z + 0.42], [hx - 0.3, fy + 0.85, z + 0.42], 0.045, 0.045, 6);
    for (const sx of [-1, 1]) boat.rod("indigo", [sx * (hx - 0.3), fy + 0.1, z + 0.42], [sx * (hx - 0.3), fy + 0.85, z + 0.42], 0.04, 0.04, 6);
  }
  // the arms: gold rods from the axle down to the gunwale, a collar at the top
  for (const sx of [-1, 1]) {
    const x = sx * MOON_FRAME.armX;
    boat.rod("gold", [x, -MOON_ARM_L + 1.4, 0], [x, 0, 0], 0.1, 0.1, 8);
    boat.rod("indigo", [x, -0.5, 0], [x, 0.0, 0], 0.17, 0.17, 10);
  }
  boat.rod("gold", [-MOON_FRAME.armX, -MOON_ARM_L + 1.45, 0], [MOON_FRAME.armX, -MOON_ARM_L + 1.45, 0], 0.07, 0.07, 6);
  // the bow horn: a gold finial, a cloud pillow, the sleeping moon-rabbit; the stern horn: a lantern
  const tipY = moonKeelY(hz);
  boat.ball("gold", 0.3, 0, tipY + 0.08, hz - 0.1);
  boat.ball("white", 0.5, 0, tipY + 0.55, hz - 0.6, 1.25, 0.55, 1.2);
  boat.ball("white", 0.4, 0.45, tipY + 0.5, hz - 0.95, 1, 0.6, 1);
  boat.ball("white", 0.4, -0.45, tipY + 0.5, hz - 0.35, 1, 0.6, 1);
  // the rabbit: curled body, head tucked on its paws toward the bow, long ears folded back along the back, a puff tail
  const ry = tipY + 1.0;
  const rz = hz - 0.7;
  boat.ball("white", 0.46, 0, ry, rz, 1.0, 0.8, 1.2, 12); // body
  boat.ball("white", 0.34, 0, ry - 0.05, rz + 0.62, 1, 0.95, 1, 12); // head
  boat.ball("white", 0.14, 0, ry - 0.22, rz + 0.88, 1.2, 0.8, 1, 8); // muzzle
  boat.ball("earpink", 0.05, 0, ry - 0.14, rz + 1.0, 1, 1, 1, 6); // nose
  for (const sx of [-1, 1]) {
    boat.rod("white", [sx * 0.13, ry + 0.2, rz + 0.5], [sx * 0.19, ry + 0.45, rz - 0.55], 0.1, 0.07, 8); // an ear folded back
    boat.rod("earpink", [sx * 0.13, ry + 0.3, rz + 0.4], [sx * 0.18, ry + 0.5, rz - 0.4], 0.05, 0.04, 6);
    boat.ball("white", 0.11, sx * 0.23, ry - 0.34, rz + 0.78, 1.1, 0.7, 1.6, 6); // a paw
    boat.ball("ink", 0.03, sx * 0.13, ry + 0.02, rz + 0.84, 1.8, 0.4, 0.6, 6); // a closed eye
  }
  boat.ball("white", 0.17, 0, ry - 0.02, rz - 0.55, 1, 1, 1, 8); // the tail
  boat.ball("gold", 0.3, 0, moonKeelY(-hz) + 0.05, -hz + 0.1);
  boat.rod("gold", [0, moonKeelY(-hz) + 0.1, -hz + 0.2], [0, moonKeelY(-hz) + 1.05, -hz + 0.2], 0.05, 0.05, 6);
  boat.ball("cream", 0.28, 0, moonKeelY(-hz) + 1.3, -hz + 0.2, 1, 1.15, 1, 10); // the lantern
  boatBulbs.push([0, moonKeelY(-hz) + 1.3, -hz + 0.2]);
  boatBulbs.push([0, ry + 0.9, rz + 0.1]);

  // ── the fixed frame (park frame relative to the site: x east, y up, z south) ──
  for (const sx of [-1, 1]) {
    const lx = sx * MOON_FRAME.legX;
    for (const sz of [-1, 1]) {
      frame.rod("indigo", [lx, 0.2, sz * MOON_FRAME.footZ], [lx, MOON_PIVOT_Y + 0.5, sz * 0.5], 0.4, 0.32, 10);
      frame.box("stone", 2.4, 0.5, 2.4, lx, 0.25, sz * MOON_FRAME.footZ);
      frame.rod("gold", [lx, 0.5, sz * MOON_FRAME.footZ], [lx, 0.8, sz * MOON_FRAME.footZ], 0.55, 0.55, 12);
      // gold bands up the leg
      for (const f of [0.28, 0.55, 0.82]) {
        const y = 0.2 + (MOON_PIVOT_Y + 0.3) * f;
        const z = sz * (MOON_FRAME.footZ + (0.5 - MOON_FRAME.footZ) * ((y - 0.2) / (MOON_PIVOT_Y + 0.3)));
        frame.rod("gold", [lx, y - 0.1, z], [lx, y + 0.1, z], 0.45, 0.45, 12);
      }
    }
    // a cross brace and the bearing housing
    const yb = 4.6;
    const tb = (yb - 0.2) / (MOON_PIVOT_Y + 0.3);
    const zb = MOON_FRAME.footZ + (0.5 - MOON_FRAME.footZ) * tb;
    frame.rod("indigo", [lx, yb, -zb], [lx, yb, zb], 0.16, 0.16, 8);
    frame.rod("gold", [lx - 0.3, MOON_PIVOT_Y, 0], [lx + 0.3, MOON_PIVOT_Y, 0], 0.62, 0.62, 14);
    frame.ball("violet", 0.4, lx, MOON_PIVOT_Y + 1.1, 0, 1, 1, 1, 10);
    for (let k = 0; k < 7; k++) frameBulbs.push([lx + sx * 0.46, 1.6 + k * 1.55, -(MOON_FRAME.footZ - (MOON_FRAME.footZ - 0.5) * ((1.6 + k * 1.55) / (MOON_PIVOT_Y + 0.3)))]);
    for (let k = 0; k < 7; k++) frameBulbs.push([lx + sx * 0.46, 1.6 + k * 1.55, MOON_FRAME.footZ - (MOON_FRAME.footZ - 0.5) * ((1.6 + k * 1.55) / (MOON_PIVOT_Y + 0.3))]);
  }
  frame.rod("gold", [-MOON_FRAME.legX - 0.5, MOON_PIVOT_Y, 0], [MOON_FRAME.legX + 0.5, MOON_PIVOT_Y, 0], 0.28, 0.28, 12);

  // ── the boarding platform: a stone podium with a wooden top flush with the hull's floor, rails, and nine steps down to the lawn ──
  const dx = (MOON_DECK.x0 + MOON_DECK.x1) / 2;
  const dw = MOON_DECK.x1 - MOON_DECK.x0;
  const dd = MOON_DECK.z1 - MOON_DECK.z0;
  frame.box("stone", dw, MOON_DECK_Y - 0.12, dd, dx, (MOON_DECK_Y - 0.12) / 2, 0);
  frame.box("wood", dw + 0.15, 0.12, dd + 0.15, dx, MOON_DECK_Y - 0.06, 0);
  const stepsW = MOON_STEPS.z1 - MOON_STEPS.z0;
  const nSteps = 9;
  const run = (MOON_STEPS.x1 - MOON_STEPS.x0) / nSteps;
  for (let i = 0; i < nSteps; i++) {
    const h = MOON_DECK_Y * ((nSteps - i) / (nSteps + 1)) + 0.05;
    frame.box("stone", run, h, stepsW, MOON_STEPS.x0 + run * (i + 0.5), h / 2, 0);
  }
  const railY = MOON_DECK_Y + 1.05;
  for (const z of [MOON_DECK.z0 + 0.05, MOON_DECK.z1 - 0.05]) {
    frame.box("gold", dw, 0.07, 0.07, dx, railY, z);
    for (let x = MOON_DECK.x0 + 0.1; x <= MOON_DECK.x1 + 0.01; x += 1.15) frame.rod("gold", [x, MOON_DECK_Y, z], [x, railY, z], 0.035, 0.035, 5);
  }
  for (const [z0, z1] of [[MOON_DECK.z0, -2.4], [2.4, MOON_DECK.z1]] as const) {
    frame.box("gold", 0.07, 0.07, z1 - z0, MOON_DECK.x0 + 0.05, railY, (z0 + z1) / 2);
    for (let z = z0 + 0.1; z <= z1 + 0.01; z += 1.1) frame.rod("gold", [MOON_DECK.x0 + 0.05, MOON_DECK_Y, z], [MOON_DECK.x0 + 0.05, railY, z], 0.035, 0.035, 5);
  }
  for (const z of [-2.4, 2.4]) frame.ball("gold", 0.1, MOON_DECK.x0 + 0.05, railY + 0.1, z);
  // two lamp posts at the foot of the steps
  for (const z of [-2.4, 2.4]) {
    frame.rod("indigo", [MOON_STEPS.x1 + 0.4, 0, z], [MOON_STEPS.x1 + 0.4, 2.7, z], 0.07, 0.07, 6);
    frame.ball("cream", 0.24, MOON_STEPS.x1 + 0.4, 2.85, z);
    frameBulbs.push([MOON_STEPS.x1 + 0.4, 2.85, z]);
  }

  const starsBoat: V3[] = [];
  for (let i = 0; i < 7; i++) {
    const z = -hz * 0.8 + (i * 1.6 * hz) / 6;
    starsBoat.push([hx + 0.2, (moonKeelY(z) + moonFloorY(z)) / 2, z]);
  }
  return {
    boat: boat.meshes(mats),
    frame: frame.meshes(mats),
    boatBulbs,
    frameBulbs,
    starsBoat,
    gunwale: [],
    stars: [],
  };
}

const ST: MoonBoatState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, alpha: 0, rideT: 0, departsInMs: 0 };

/** The 달배: a crescent boat swinging on a tall A-frame with the shared clock, a platform to board from, night bulbs and stars. */
export function MoonBoatWorld() {
  const gl = useThree((s) => s.gl);
  const cam = useThree((s) => s.camera);
  const root = useRef<Group>(null);
  const boatRef = useRef<Group>(null);
  const mats = useMemo<Record<MatKey, Material>>(() => {
    const m = (color: string, extra: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial => Object.assign(new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 }), extra);
    return {
      cream: m("#f3e9cf", { roughness: 0.5 }),
      indigo: m("#3a3ea8", { roughness: 0.45, metalness: 0.15 }),
      violet: m("#8b5cf6", { roughness: 0.5 }),
      gold: m("#f2c14e", { roughness: 0.35, metalness: 0.7 }),
      wood: m("#b98a5a", { roughness: 0.85 }),
      stone: m("#d9d1c3", { roughness: 0.9 }),
      pink: m("#e98fae", { roughness: 0.7 }),
      white: m("#fbf7ef", { roughness: 0.8 }),
      earpink: m("#f4a9c0", { roughness: 0.8 }),
      ink: m("#2c2440", { roughness: 0.8 }),
    };
  }, []);
  const built = useMemo(() => build(mats), [mats]);
  const bulbGeo = useMemo(() => new SphereGeometry(0.08, 6, 4), []);
  const bulbMat = useMemo(() => new MeshStandardMaterial({ color: "#fff1c8", emissive: nightColor, emissiveIntensity: 2.2, roughness: 0.3 }), []);
  const boatBulbRef = useRef<InstancedMesh>(null);
  const frameBulbRef = useRef<InstancedMesh>(null);
  const starRef = useRef<InstancedMesh>(null);
  const starGeo = useMemo(() => {
    const g = new ExtrudeGeometry(starShape(0.34), { depth: 0.04, bevelEnabled: false });
    g.translate(0, 0, -0.02);
    g.rotateY(Math.PI / 2);
    return g;
  }, []);
  const starMat = useMemo(() => new MeshStandardMaterial({ color: "#f2c14e", emissive: new Color("#f2c14e"), emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.35 }), []);
  const sign = useMemo(signTexture, []);
  const signMat = useMemo(() => new MeshStandardMaterial({ map: sign, emissive: new Color("#ffffff"), emissiveMap: sign, emissiveIntensity: 0.2, roughness: 0.6 }), [sign]);

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
    // gold stars on both flanks of the hull: the +x ones face east, the -x ones west
    let n = 0;
    for (const sx of [1, -1])
      for (const p of built.starsBoat) {
        m.makeRotationY(sx > 0 ? 0 : Math.PI);
        m.setPosition(sx * p[0], p[1], p[2]);
        starRef.current?.setMatrixAt(n++, m);
      }
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
        <BulbHalos places={built.frameBulbs} size={0.9} strength={0.8} />
        <group ref={boatRef} position={[0, MOON_PIVOT_Y, 0]}>
          {built.boat.map((m, i) => (
            <primitive key={i} object={m} />
          ))}
          <instancedMesh ref={boatBulbRef} args={[bulbGeo, bulbMat, built.boatBulbs.length]} frustumCulled={false} dispose={null} />
          <instancedMesh ref={starRef} args={[starGeo, starMat, built.starsBoat.length * 2]} frustumCulled={false} dispose={null} />
          <BulbHalos places={built.boatBulbs} size={0.6} strength={0.7} />
        </group>
        <mesh position={[MOON_STEPS.x1 + 1.4, 2.0, -4.6]} rotation={[0, Math.PI / 2, 0]} material={signMat}>
          <planeGeometry args={[4.2, 1.05]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[MOON_STEPS.x1 + 1.38, 1.0, -4.6 + s * 1.9]} material={mats.gold}>
            <cylinderGeometry args={[0.07, 0.07, 2.0, 8]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
