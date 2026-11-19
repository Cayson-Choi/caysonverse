import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  CanvasTexture,
  Color,
  Euler,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
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
  Vector2,
  Vector3,
} from "three";
import { compileSafely } from "../game/compileSafely";
import { BulbHalos } from "./nightGlow";
import { parkMaterial, pickSet } from "./pbr";
import { Parts, type V3 } from "./artParts";
import { villageClock } from "../village/villageClock";
import { DROP_CAR, DROP_DECK_Y, DROP_PLATFORM_INNER, DROP_PLATFORM_R, DROP_SEATS_PER_FACE, DROP_SITE, DROP_STATION_Y, DROP_TOWER_H, dropAt, type DropState } from "@caysonverse/shared/land/dropTower";
import { DROP_CROWN_Y } from "@caysonverse/shared/land/dropTowerGeometry";

type K = "plaster" | "concrete" | "deck" | "indigo" | "violet" | "gold" | "cloud" | "glass" | "leather" | "pad" | "white" | "ink" | "steel";

/** Metres per texture tile of each PBR set (the sets' real-world scale: parquet strips, trowelled plaster, poured concrete). */
const TILES: Partial<Record<K, number>> = { plaster: 1.5, concrete: 2.0, deck: 1.0 };

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
  ctx.font = "bold 128px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("☁️ 구름 낙하탑", 512, 140);
  ctx.font = "46px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#f2c14e";
  ctx.fillText("CLOUD DROP TOWER", 512, 242);
  ctx.font = "34px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#d8d4f5";
  ctx.fillText("천천히 올라가서 잠깐 멈춰요 · 어깨 안전바를 꼭 잡아요", 512, 316);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A five-point star, extruded (the gold finial). */
function starGeometry(r: number, depth: number) {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A crescent moon, extruded (the finial's moon). */
function crescentGeometry(r: number, depth: number) {
  const s = new Shape();
  s.absarc(0, 0, r, Math.PI * 0.2, Math.PI * 1.8, false);
  s.absarc(r * 0.42, 0, r * 0.8, Math.PI * 1.72, Math.PI * 0.28, true);
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 3, curveSegments: 24 });
  g.translate(0, 0, -depth / 2);
  return g;
}

interface Build {
  tower: Mesh[];
  car: Mesh[];
  towerBulbs: V3[];
  carBulbs: V3[];
}

function build(mats: Record<K, Material>): Build {
  const t = new Parts<K>();
  const c = new Parts<K>();
  const towerBulbs: V3[] = [];
  const carBulbs: V3[] = [];
  const th = DROP_CAR.towerHalf;

  // ── the tower: a white plaster column on a concrete plinth, indigo bands, gold corner rails with collars, lit arched windows, moon medallions ──
  t.soft("concrete", 3.6, 1.0, 3.6, 0, 0.5, 0, 0.08);
  t.box("gold", 3.72, 0.1, 3.72, 0, 1.0, 0);
  t.box("plaster", th * 2, DROP_TOWER_H - 5 - 1.0, th * 2, 0, 1.0 + (DROP_TOWER_H - 5 - 1.0) / 2, 0);
  for (let y = 5; y < DROP_CROWN_Y - 1; y += 6) {
    t.box("indigo", th * 2 + 0.2, 0.55, th * 2 + 0.2, 0, y, 0);
    t.box("gold", th * 2 + 0.26, 0.07, th * 2 + 0.26, 0, y + 0.31, 0);
    t.box("gold", th * 2 + 0.26, 0.07, th * 2 + 0.26, 0, y - 0.31, 0);
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const cx = sx * (th + 0.1);
      const cz = sz * (th + 0.1);
      t.rod("gold", [cx, 1.1, cz], [cx, DROP_CROWN_Y - 0.4, cz], 0.12, 0.12, 14);
      for (let y = 3.0; y < DROP_CROWN_Y - 1; y += 3) {
        t.rod("steel", [cx, y - 0.05, cz], [cx, y + 0.05, cz], 0.2, 0.2, 14);
        towerBulbs.push([cx + sx * 0.2, y + 1.5, cz + sz * 0.2]);
      }
    }
  // lit arched windows (a rounded box with a dome) on every face, and a gold moon medallion at 41 m
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    const ry = -a;
    for (let y = 8; y < DROP_CROWN_Y - 3; y += 6) {
      if (y > 38.5 && y < 43.5) continue;
      t.box("glass", 0.1, 1.1, 0.5, nx * (th + 0.02), y, nz * (th + 0.02), 0, ry, 0);
      t.ball("glass", 0.25, nx * (th + 0.02), y + 0.55, nz * (th + 0.02), 0.2, 1, 1, 12);
      t.box("gold", 0.06, 1.3, 0.64, nx * (th + 0.0), y + 0.05, nz * (th + 0.0), 0, ry, 0);
    }
    t.rod("gold", [nx * (th + 0.04), 41, nz * (th + 0.04)], [nx * (th + 0.1), 41, nz * (th + 0.1)], 0.55, 0.55, 28);
    t.rod("violet", [nx * (th + 0.1), 41, nz * (th + 0.1)], [nx * (th + 0.14), 41, nz * (th + 0.14)], 0.42, 0.42, 28);
  }

  // ── the cloud crown: sculpted puffs (smooth, lumpy), a golden crescent and star above ──
  const ring = 2.9;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const r = 1.75 + 0.5 * Math.sin(i * 2.3);
    t.puff("cloud", r, Math.cos(a) * ring, DROP_CROWN_Y + 2.0 + 0.4 * Math.cos(i * 1.9), Math.sin(a) * ring, i * 1.37, 0.78);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.6;
    t.puff("cloud", 1.7 + 0.25 * Math.sin(i), Math.cos(a) * 1.8, DROP_CROWN_Y + 4.1 + 0.3 * Math.sin(i * 2), Math.sin(a) * 1.8, 11 + i * 1.9, 0.82);
  }
  t.puff("cloud", 2.9, 0, DROP_CROWN_Y + 4.3, 0, 3.3, 0.85);
  t.puff("cloud", 1.9, 0.3, DROP_CROWN_Y + 6.4, -0.2, 6.1, 0.85);
  // the finial: a gold crescent with a star in its mouth, on a gold stem
  t.rod("gold", [0, DROP_CROWN_Y + 7.4, 0], [0, DROP_CROWN_Y + 8.4, 0], 0.09, 0.07, 10);
  t.add("gold", crescentGeometry(0.9, 0.22), new Matrix4().makeTranslation(0, DROP_CROWN_Y + 9.3, 0));
  t.add("gold", starGeometry(0.3, 0.16), new Matrix4().makeTranslation(0.18, DROP_CROWN_Y + 9.3, 0));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    towerBulbs.push([Math.cos(a) * (th + 1.0), DROP_CROWN_Y - 0.1, Math.sin(a) * (th + 1.0)]);
  }

  // ── the platform: a concrete podium with a plank deck (tile 1 m), baluster rails, an east gate with a crescent arch, steps, the queue fence, lamps ──
  const R = DROP_PLATFORM_R;
  const I = DROP_PLATFORM_INNER;
  const slab = (x0: number, x1: number, z0: number, z1: number): void => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    t.box("concrete", x1 - x0, DROP_DECK_Y - 0.1, z1 - z0, cx, (DROP_DECK_Y - 0.1) / 2, cz);
    t.box("deck", x1 - x0 + 0.1, 0.1, z1 - z0 + 0.1, cx, DROP_DECK_Y - 0.05, cz);
  };
  slab(-R, R, -R, -I);
  slab(-R, R, I, R);
  slab(-R, -I, -I, I);
  slab(I, R, -I, I);
  t.box("gold", 2 * R + 0.14, 0.05, 2 * R + 0.14, 0, DROP_DECK_Y - 0.17, 0);
  // the inner edge: a gold curb round the car's opening
  t.box("gold", 2 * I, 0.08, 0.08, 0, DROP_DECK_Y + 0.02, -I);
  t.box("gold", 2 * I, 0.08, 0.08, 0, DROP_DECK_Y + 0.02, I);
  t.box("gold", 0.08, 0.08, 2 * I, -I, DROP_DECK_Y + 0.02, 0);
  t.box("gold", 0.08, 0.08, 2 * I, I, DROP_DECK_Y + 0.02, 0);
  const railY = DROP_DECK_Y + 1.0;
  const post = (x: number, z: number): void => {
    t.rod("indigo", [x, DROP_DECK_Y, z], [x, railY + 0.16, z], 0.07, 0.07, 10);
    t.ball("gold", 0.1, x, railY + 0.24, z, 1, 1, 1, 12);
  };
  const side = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 0.4));
    const ry = Math.atan2(-(z1 - z0), x1 - x0);
    t.box("gold", len, 0.07, 0.09, (x0 + x1) / 2, railY + 0.04, (z0 + z1) / 2, 0, ry, 0);
    t.box("white", len, 0.05, 0.05, (x0 + x1) / 2, DROP_DECK_Y + 0.22, (z0 + z1) / 2, 0, ry, 0);
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      t.rod("white", [x0 + (x1 - x0) * u, DROP_DECK_Y, z0 + (z1 - z0) * u], [x0 + (x1 - x0) * u, railY, z0 + (z1 - z0) * u], 0.028, 0.028, 8);
    }
  };
  const e = R - 0.08;
  side(-e, -e, e, -e);
  side(-e, e, e, e);
  side(-e, -e, -e, e);
  side(e, -e, e, -1.6);
  side(e, 1.6, e, e);
  for (const [x, z] of [[-e, -e], [e, -e], [-e, e], [e, e], [e, -1.6], [e, 1.6], [0, -e], [0, e], [-e, 0]] as [number, number][]) post(x, z);
  // the gate: two posts and a crescent arch across the opening, lanterns on top
  for (const z of [-1.6, 1.6]) {
    t.rod("indigo", [R, DROP_DECK_Y, z], [R, DROP_DECK_Y + 2.5, z], 0.1, 0.1, 12);
    t.ball("gold", 0.16, R, DROP_DECK_Y + 2.62, z, 1, 1, 1, 14);
    t.ball("white", 0.2, R, DROP_DECK_Y + 2.95, z, 1, 1.15, 1, 14);
    towerBulbs.push([R, DROP_DECK_Y + 2.95, z]);
  }
  t.add("gold", new TorusGeometry(1.6, 0.07, 10, 36, Math.PI), new Matrix4().compose(new Vector3(R, DROP_DECK_Y + 2.5, 0), new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)), new Vector3(1, 1, 1)));
  // steps down to the lawn (east), the queue fence along both sides of the path to the pad
  const nSteps = 5;
  const run = 0.42;
  for (let i = 0; i < nSteps; i++) {
    const h = DROP_DECK_Y * ((nSteps - i) / (nSteps + 1)) + 0.05;
    const x = R + run * (i + 0.5);
    t.box("concrete", run, h, 3.2, x, h / 2, 0);
    t.box("deck", 0.06, 0.05, 3.3, x + run / 2 - 0.03, h, 0);
  }
  const stepEnd = R + run * nSteps;
  for (const z of [-1.9, 1.9]) {
    let k = 0;
    for (let x = R + 0.4; x <= stepEnd + 4.6; x += 1.4, k++) {
      const base = Math.max(0, DROP_DECK_Y * (1 - (x - R) / (stepEnd - R)) * 0.9);
      t.rod("indigo", [x, base, z], [x, base + 1.0, z], 0.05, 0.05, 8);
      t.ball("gold", 0.07, x, base + 1.05, z, 1, 1, 1, 10);
      if (k % 3 === 1) {
        t.ball("white", 0.14, x, base + 1.3, z, 1, 1.2, 1, 12);
        towerBulbs.push([x, base + 1.3, z]);
      }
    }
    const xa = R + 0.4;
    const xb = stepEnd + 4.6;
    for (const dy of [0.45, 0.85]) t.rod("gold", [xa, Math.max(0, DROP_DECK_Y * (1 - (xa - R) / (stepEnd - R)) * 0.9) + dy, z], [xb, dy, z], 0.028, 0.028, 6);
  }

  // ── the ring car (its frame: hips at y = 0, the tower's axis at the origin) ──
  const floorProfile = [new Vector2(DROP_CAR.floorInner, -0.62), new Vector2(DROP_CAR.floorOuter - 0.06, -0.62), new Vector2(DROP_CAR.floorOuter, -0.56), new Vector2(DROP_CAR.floorOuter, -0.5), new Vector2(DROP_CAR.floorInner, -0.5), new Vector2(DROP_CAR.floorInner, -0.62)];
  c.add("indigo", new LatheGeometry(floorProfile, 72));
  const rimProfile = [new Vector2(DROP_CAR.floorOuter - 0.02, -0.64), new Vector2(DROP_CAR.floorOuter + 0.08, -0.6), new Vector2(DROP_CAR.floorOuter + 0.08, -0.48), new Vector2(DROP_CAR.floorOuter - 0.02, -0.46)];
  c.add("gold", new LatheGeometry(rimProfile, 72));
  // radial beams and the collar hugging the column
  for (let b = 0; b < 8; b++) {
    const a = (b / 8) * Math.PI * 2;
    c.box("steel", 1.2, 0.16, 0.24, Math.cos(a) * 1.55, -0.7, Math.sin(a) * 1.55, 0, -a, 0);
  }
  c.soft("steel", 2.3, 0.8, 2.3, 0, -0.3, 0, 0.08);
  c.box("gold", 2.36, 0.06, 2.36, 0, 0.12, 0);
  c.box("gold", 2.36, 0.06, 2.36, 0, -0.72, 0);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    carBulbs.push([Math.cos(a) * (DROP_CAR.floorOuter + 0.02), -0.66, Math.sin(a) * (DROP_CAR.floorOuter + 0.02)]);
  }
  // the four faces: a back panel, four bucket seats with headrests and over-the-shoulder harnesses, a footrail
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    const ry = -a;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // face-local (lx outward, ly up, lz tangent) -> car frame
    const P = (lx: number, ly: number, lz: number): V3 => [ca * lx - sa * lz, ly, sa * lx + ca * lz];
    const hip = DROP_CAR.hipR;
    const width = DROP_SEATS_PER_FACE * DROP_CAR.dx + 0.3;
    const pb = P(hip - 0.5, 0.55, 0);
    c.box("indigo", 0.1, 1.3, width, pb[0], pb[1], pb[2], 0, ry, 0);
    const pt = P(hip - 0.5, 1.2, 0);
    c.box("gold", 0.14, 0.06, width + 0.04, pt[0], pt[1], pt[2], 0, ry, 0);
    const pr = P(hip + 0.62, -0.42, 0);
    c.rod("gold", P(hip + 0.62, -0.42, -width / 2 + 0.1), P(hip + 0.62, -0.42, width / 2 - 0.1), 0.035, 0.035, 8);
    void pr;
    for (let k = 0; k < DROP_SEATS_PER_FACE; k++) {
      const z = (k - (DROP_SEATS_PER_FACE - 1) / 2) * DROP_CAR.dx;
      const sb = P(hip - 0.02, -0.33, z);
      c.box("indigo", 0.6, 0.3, 0.7, sb[0], sb[1], sb[2], 0, ry, 0);
      const cu = P(hip + 0.02, -0.1, z);
      c.soft("leather", 0.56, 0.16, 0.68, cu[0], cu[1], cu[2], 0.07, 0, ry, 0);
      const bk = P(hip - 0.33, 0.42, z);
      c.soft("leather", 0.14, 0.92, 0.68, bk[0], bk[1], bk[2], 0.07, 0, ry, -0.0);
      const hd = P(hip - 0.36, 1.12, z);
      c.soft("leather", 0.13, 0.3, 0.4, hd[0], hd[1], hd[2], 0.05, 0, ry, 0);
      // the over-the-shoulder harness: two padded arms from the back top, over the shoulders, down the chest to the lap, a gold hinge up top and a buckle
      for (const s of [-1, 1]) {
        const zz = z + s * 0.3;
        const path = [P(hip - 0.3, 1.2, zz), P(hip - 0.18, 1.4, zz), P(hip + 0.1, 1.42, zz), P(hip + 0.3, 1.12, zz), P(hip + 0.38, 0.62, zz), P(hip + 0.4, 0.22, zz)];
        c.tube("indigo", path.map((p) => new Vector3(...p)), 0.042, 10);
        const h = P(hip - 0.3, 1.2, zz);
        c.ball("gold", 0.07, h[0], h[1], h[2], 1, 1, 1, 10);
        const q = P(hip + 0.4, 0.5, zz);
        c.ball("pad", 0.07, q[0], q[1], q[2], 0.8, 1.5, 0.8, 12);
      }
      const buckle = P(hip + 0.4, 0.22, z);
      c.rod("gold", P(hip + 0.4, 0.22, z - 0.2), P(hip + 0.4, 0.22, z + 0.2), 0.03, 0.03, 8);
      c.ball("gold", 0.045, buckle[0], buckle[1], buckle[2], 1, 1, 1, 10);
      // a gold stud line on the back and a small star badge
      const sp = P(hip - 0.4, 0.42, z);
      c.ball("gold", 0.04, sp[0], sp[1], sp[2], 1, 1, 1, 8);
    }
  }
  return { tower: t.meshes(mats, TILES), car: c.meshes(mats, TILES), towerBulbs, carBulbs };
}

const ST: DropState = { cycle: 0, phase: 0, status: "boarding", stage: "idle", y: DROP_STATION_Y, v: 0, a: 0, rideT: 0, departsInMs: 0 };

/** The 구름 낙하탑: a plaster tower with a sculpted cloud crown, a ring car riding its four faces with the shared clock, a platform to board from, night bulbs. */
export function DropTowerWorld({ all }: { all: Texture[] }) {
  const gl = useThree((s) => s.gl);
  const cam = useThree((s) => s.camera);
  const root = useRef<Group>(null);
  const carRef = useRef<Group>(null);
  const mats = useMemo<Record<K, Material>>(() => {
    const paint = (color: string, extra: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial => Object.assign(new MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.15 }), extra);
    const flat = (color: string, extra: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial => Object.assign(new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 }), extra);
    const wood = pickSet(all, "WoodFloor051");
    const conc = pickSet(all, "Concrete034");
    const plas = pickSet(all, "Plaster003");
    return {
      plaster: parkMaterial(plas, 1, { color: new Color(1.95, 1.85, 1.62), normalScale: 0.7 }),
      concrete: parkMaterial(conc, 1, { color: new Color("#e6dfd2"), normalScale: 0.8 }),
      deck: parkMaterial(wood, 1, { color: new Color(1.5, 1.32, 1.12), normalScale: 0.8 }),
      indigo: paint("#3338a8", { emissive: new Color("#1a1e70"), emissiveIntensity: 0.4 }),
      violet: paint("#7d55e8"),
      gold: flat("#f2c14e", { roughness: 0.3, metalness: 0.85 }),
      cloud: flat("#ffffff", { roughness: 0.92, emissive: new Color("#c8d6ff"), emissiveIntensity: 0.55 }),
      glass: flat("#ffe2a8", { roughness: 0.2, emissive: new Color("#ffb85a"), emissiveIntensity: 0.55 }),
      leather: flat("#6a45b8", { roughness: 0.55 }),
      pad: flat("#f6d36b", { roughness: 0.5 }),
      white: flat("#fbf4e6", { roughness: 0.8, emissive: new Color("#7a6e56"), emissiveIntensity: 0.25 }),
      ink: flat("#2c2440", { roughness: 0.8 }),
      steel: flat("#aeb4cc", { roughness: 0.35, metalness: 0.7 }),
    };
  }, [all]);
  const built = useMemo(() => build(mats), [mats]);
  const bulbGeo = useMemo(() => new SphereGeometry(0.035, 8, 6), []);
  const bulbMat = useMemo(() => new MeshStandardMaterial({ color: "#fff1c8", emissive: new Color("#ffcf7a"), emissiveIntensity: 1.8, roughness: 0.3 }), []);
  const towerBulbRef = useRef<InstancedMesh>(null);
  const carBulbRef = useRef<InstancedMesh>(null);
  const sign = useMemo(signTexture, []);
  const signMat = useMemo(() => new MeshStandardMaterial({ map: sign, emissive: new Color("#ffffff"), emissiveMap: sign, emissiveIntensity: 0.2, roughness: 0.6 }), [sign]);
  const goldMat = mats.gold;

  useEffect(() => {
    const m = new Matrix4();
    built.towerBulbs.forEach((p, i) => {
      m.makeTranslation(p[0], p[1], p[2]);
      towerBulbRef.current?.setMatrixAt(i, m);
    });
    built.carBulbs.forEach((p, i) => {
      m.makeTranslation(p[0], p[1], p[2]);
      carBulbRef.current?.setMatrixAt(i, m);
    });
    if (towerBulbRef.current) towerBulbRef.current.instanceMatrix.needsUpdate = true;
    if (carBulbRef.current) carBulbRef.current.instanceMatrix.needsUpdate = true;
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
    const st = dropAt(villageClock.liveMs(), ST);
    if (carRef.current) carRef.current.position.y = st.y;
  });

  return (
    <group ref={root}>
      <group position={[DROP_SITE.x, 0, DROP_SITE.z]}>
        {built.tower.map((m, i) => (
          <primitive key={i} object={m} />
        ))}
        <instancedMesh ref={towerBulbRef} args={[bulbGeo, bulbMat, built.towerBulbs.length]} frustumCulled={false} dispose={null} />
        <BulbHalos places={built.towerBulbs} size={0.7} strength={0.7} />
        <group ref={carRef} position={[0, DROP_STATION_Y, 0]}>
          {built.car.map((m, i) => (
            <primitive key={i} object={m} />
          ))}
          <instancedMesh ref={carBulbRef} args={[bulbGeo, bulbMat, built.carBulbs.length]} frustumCulled={false} dispose={null} />
          <BulbHalos places={built.carBulbs} size={0.4} strength={0.5} />
        </group>
        <mesh position={[DROP_PLATFORM_R + 3.6, 2.1, -4.2]} rotation={[0, Math.PI / 2, 0]} material={signMat}>
          <planeGeometry args={[4.2, 1.575]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[DROP_PLATFORM_R + 3.56, 1.05, -4.2 + s * 1.95]} material={goldMat}>
            <cylinderGeometry args={[0.07, 0.07, 2.1, 10]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

