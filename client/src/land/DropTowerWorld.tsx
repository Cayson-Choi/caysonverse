import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
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
import { rideMs } from "./rideClock";
import { DROP_CAR, DROP_DECK_Y, DROP_PLATFORM_INNER, DROP_PLATFORM_R, DROP_SEATS_PER_FACE, DROP_SITE, DROP_STATION_Y, DROP_TOWER_H, dropAt, type DropState } from "@caysonverse/shared/land/dropTower";
import { DROP_BEAM_YS, DROP_CROWN_Y, DROP_FRAME, dropFrameD } from "@caysonverse/shared/land/dropTowerGeometry";

type K = "plaster" | "concrete" | "deck" | "indigo" | "violet" | "gold" | "cloud" | "glass" | "leather" | "pad" | "white" | "ink" | "steel" | "panel" | "moon";

/** Metres per texture tile of each PBR set (the sets' real-world scale: WoodFloor051 has ~24 plank rows to a tile, so 3 m makes a plank ~13 cm; trowelled plaster; poured concrete). */
const TILES: Partial<Record<K, number>> = { plaster: 1.5, concrete: 2.0, deck: 3.0 };

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
function starGeometry(r: number, depth: number, bevelSegments = 2) {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A crescent moon, extruded (the finial's moon). */
function crescentGeometry(r: number, depth: number, curveSegments = 24) {
  const s = new Shape();
  s.absarc(0, 0, r, Math.PI * 0.2, Math.PI * 1.8, false);
  s.absarc(r * 0.42, 0, r * 0.8, Math.PI * 1.72, Math.PI * 0.28, true);
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 3, curveSegments });
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

  // ── the tower: a white plaster column on a concrete plinth with sculpted indigo-and-gold bands, lit arched windows and moon medallions; round it a taper-legged frame
  // (four leaning legs with indigo knuckles, ring beams, glowing arched panels and braces) that stays outside the car's swept cylinder (dropFrameReach, unit-tested) ──
  const CY = DROP_CROWN_Y;
  const BEAMS = DROP_BEAM_YS;
  t.soft("concrete", 3.6, 1.0, 3.6, 0, 0.5, 0, 0.08);
  t.box("gold", 3.72, 0.1, 3.72, 0, 1.0, 0);
  t.box("plaster", th * 2, DROP_TOWER_H - 5 - 1.0, th * 2, 0, 1.0 + (DROP_TOWER_H - 5 - 1.0) / 2, 0);
  // wide indigo bands at the beams' levels (a gold stud row on every face), thin bands between
  for (const y of BEAMS.slice(1)) {
    t.box("indigo", th * 2 + 0.24, 1.0, th * 2 + 0.24, 0, y, 0);
    t.box("gold", th * 2 + 0.32, 0.08, th * 2 + 0.32, 0, y + 0.54, 0);
    t.box("gold", th * 2 + 0.32, 0.08, th * 2 + 0.32, 0, y - 0.54, 0);
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2;
      for (let k = -4; k <= 4; k++) t.box("gold", 0.08, 0.1, 0.1, Math.cos(a) * (th + 0.15) - Math.sin(a) * k * 0.22, y, Math.sin(a) * (th + 0.15) + Math.cos(a) * k * 0.22, 0, -a, 0);
    }
  }
  for (const y of BEAMS.slice(1).map((v) => v - 5)) {
    t.box("indigo", th * 2 + 0.2, 0.4, th * 2 + 0.2, 0, y, 0);
    t.box("gold", th * 2 + 0.26, 0.06, th * 2 + 0.26, 0, y + 0.23, 0);
    t.box("gold", th * 2 + 0.26, 0.06, th * 2 + 0.26, 0, y - 0.23, 0);
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const cx = sx * (th + 0.1);
      const cz = sz * (th + 0.1);
      t.rod("gold", [cx, 1.1, cz], [cx, DROP_CROWN_Y - 0.4, cz], 0.12, 0.12, 14);
      for (let y = 3.0; y < DROP_CROWN_Y - 1; y += 3) {
        t.rod("steel", [cx, y - 0.05, cz], [cx, y + 0.05, cz], 0.2, 0.2, 14);
        if (y % 6 === 0) towerBulbs.push([cx + sx * 0.2, y + 1.5, cz + sz * 0.2]);
      }
    }
  // lit arched windows between the bands, and a gold moon medallion above the top band
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    const ry = -a;
    for (let y = 7.5; y < 82; y += 5) {
      t.box("glass", 0.1, 1.1, 0.5, nx * (th + 0.02), y, nz * (th + 0.02), 0, ry, 0);
      t.ball("glass", 0.25, nx * (th + 0.02), y + 0.55, nz * (th + 0.02), 0.2, 1, 1, 12);
      t.box("gold", 0.06, 1.3, 0.64, nx * (th + 0.0), y + 0.05, nz * (th + 0.0), 0, ry, 0);
    }
    t.rod("gold", [nx * (th + 0.04), 86.9, nz * (th + 0.04)], [nx * (th + 0.1), 86.9, nz * (th + 0.1)], 0.55, 0.55, 28);
    t.rod("violet", [nx * (th + 0.1), 86.9, nz * (th + 0.1)], [nx * (th + 0.14), 86.9, nz * (th + 0.14)], 0.42, 0.42, 28);
  }
  // the capital: the column flares in stepped courses above the highest rider (the car stops at 85 m; its riders heads reach 86.5 m)
  t.box("indigo", 3.0, 0.5, 3.0, 0, CY - 1.3, 0);
  t.box("gold", 3.1, 0.07, 3.1, 0, CY - 1.02, 0);
  t.box("plaster", 4.2, 0.55, 4.2, 0, CY - 0.72, 0);
  t.box("gold", 4.34, 0.08, 4.34, 0, CY - 0.4, 0);
  t.box("indigo", 5.0, 0.4, 5.0, 0, CY - 0.16, 0);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    towerBulbs.push([Math.cos(a) * 3.2, CY - 0.1, Math.sin(a) * 3.2]);
  }

  // the frame: four leaning legs (taper, indigo knuckles with gold rings) at the beams' levels
  const frameD = dropFrameD;
  const legR = (y: number): number => 0.8 - 0.42 * (y / CY);
  const knuckles = [DROP_DECK_Y, ...BEAMS.slice(1), CY + 0.4];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as [number, number][]) {
    for (let i = 0; i + 1 < knuckles.length; i++) {
      const y0 = knuckles[i]!;
      const y1 = knuckles[i + 1]!;
      t.rod("plaster", [sx * frameD(y0), y0, sz * frameD(y0)], [sx * frameD(y1), y1, sz * frameD(y1)], legR(y0), legR(y1), 14);
    }
    for (const y of knuckles.slice(1, -1)) {
      const x = sx * frameD(y);
      const z = sz * frameD(y);
      const r = legR(y) * 1.32;
      t.rod("indigo", [x, y - 0.5, z], [x, y + 0.5, z], r, r, 14);
      t.rod("gold", [x, y - 0.56, z], [x, y - 0.46, z], r * 1.1, r * 1.1, 14);
      t.rod("gold", [x, y + 0.46, z], [x, y + 0.56, z], r * 1.1, r * 1.1, 14);
      t.ball("white", 0.2, x + sx * r * 0.95, y, z + sz * r * 0.95, 1, 1.15, 1, 12);
      towerBulbs.push([x + sx * r * 0.95, y, z + sz * r * 0.95]);
    }
    // the foot: a stepped pedestal on the deck
    const fx = sx * frameD(DROP_DECK_Y);
    const fz = sz * frameD(DROP_DECK_Y);
    t.soft("concrete", 1.9, 0.9, 1.9, fx, DROP_DECK_Y + 0.45, fz, 0.06);
    t.box("gold", 2.0, 0.07, 2.0, fx, DROP_DECK_Y + 0.92, fz);
    t.soft("indigo", 1.5, 0.5, 1.5, fx, DROP_DECK_Y + 1.2, fz, 0.05);
    t.box("gold", 1.58, 0.06, 1.58, fx, DROP_DECK_Y + 1.48, fz);
  }
  // beams, arches with glowing panels, braces: on every face
  const starG = starGeometry(0.24, 0.05, 1);
  const moonG = crescentGeometry(0.62, 0.06, 8);
  const bayTop = [...BEAMS.slice(1), CY - 0.3];
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    const ry = -a;
    // a frame whose z is the face's outward normal and whose x runs along the face (right-handed), at distance d from the axis and height y
    const basis = (d: number, y: number): Matrix4 => new Matrix4().makeBasis(new Vector3(nz, 0, -nx), new Vector3(0, 1, 0), new Vector3(nx, 0, nz)).setPosition(nx * d, y, nz * d);
    for (let b = 0; b < BEAMS.length + 1; b++) {
      const y = b < BEAMS.length ? BEAMS[b]! : CY - 0.3;
      const d = frameD(y);
      const len = 2 * d - 0.5;
      t.box("indigo", DROP_FRAME.beamHalf * 2, 0.5, len, nx * d, y, nz * d, 0, ry, 0);
      t.box("gold", DROP_FRAME.beamHalf * 2 + 0.06, 0.06, len + 0.06, nx * d, y + 0.28, nz * d, 0, ry, 0);
      t.box("gold", DROP_FRAME.beamHalf * 2 + 0.06, 0.06, len + 0.06, nx * d, y - 0.28, nz * d, 0, ry, 0);
      for (let k = -1; k <= 1; k++) if (b % 2 === 0 || k !== 0) towerBulbs.push([nx * (d + 0.3) - nz * k * (len / 3), y + 0.2, nz * (d + 0.3) + nx * k * (len / 3)]);
    }
    for (let b = 0; b < BEAMS.length; b++) {
      const y = BEAMS[b]!;
      const d = frameD(y);
      const rho = d - 0.8;
      const cy = y + 0.3;
      // the glowing panel (a half disc just inside the arch), a gold arch and a white inner moulding
      t.add("panel", new CircleGeometry(rho - 0.05, 32, 0, Math.PI), basis(d - 0.06, cy));
      t.add("gold", new TorusGeometry(rho, 0.11, 6, 28, Math.PI), basis(d, cy));
      t.add("white", new TorusGeometry(rho - 0.3, 0.05, 5, 24, Math.PI), basis(d - 0.03, cy));
      // a crescent and stars on the panel
      t.add("moon", moonG, new Matrix4().multiplyMatrices(basis(d - 0.02, cy + rho * 0.38), new Matrix4().makeRotationZ(0.35)));
      for (const [u, v] of [[-0.55, 0.3], [0.55, 0.3], [-0.3, 0.72], [0.38, 0.66]] as [number, number][]) t.add("moon", starG, new Matrix4().multiplyMatrices(basis(d - 0.02, cy + rho * v), new Matrix4().makeTranslation(u * rho, 0, 0)));
      // bulbs along the arch
      for (let k = 0; k <= 6; k++) {
        const ang = (k / 6) * Math.PI;
        towerBulbs.push([nx * (d + 0.2) - nz * Math.cos(ang) * (rho + 0.05), cy + Math.sin(ang) * (rho + 0.05), nz * (d + 0.2) + nx * Math.cos(ang) * (rho + 0.05)]);
      }
      // braces over the arch up to the next beam
      const yA = cy + rho + 0.5;
      const yB = bayTop[b]! - 0.35;
      if (yB - yA > 1.6 && y < 79) {  // the top bay stays open: the riders at the 85 m hold look out over it
        const w = d - 0.7;
        const p = (u: number, yy: number): V3 => [nx * d - nz * u, yy, nz * d + nx * u];
        t.rod("gold", p(-w, yA), p(w, yA), 0.045, 0.045, 6);
        t.rod("gold", p(-w, yA), p(w, yB), 0.065, 0.065, 6);
        t.rod("gold", p(w, yA), p(-w, yB), 0.065, 0.065, 6);
        t.ball("gold", 0.13, nx * d, (yA + yB) / 2, nz * d, 1, 1, 1, 10);
      }
    }
  }

  // ── the cloud crown: a wide cloud bank over the frame's heads (a flat lens with sculpted puffs round it, tiers rising to the centre), the gold moon and a wheel of stars on its finial; scaled 1.3 for the tall tower ──
  const S = 1.3;
  const cloud = (r: number, x: number, dy: number, z: number, seed: number, squash: number, detail: number): void => t.puff("cloud", r * S, x * S, CY + dy * S, z * S, seed, squash, detail);
  cloud(6.2, 0, 0.7, 0, 2.2, 0.26, 4);
  for (let i = 0; i < 4; i++) {
    const sx = i < 2 ? 1 : -1;
    const sz = i % 2 === 0 ? 1 : -1;
    const dd = frameD(CY);
    t.puff("cloud", 2.6, sx * dd, CY + 1.3, sz * dd, 4 + i * 1.7, 0.78, 4);
    cloud(1.5, sx * (dd + 0.9) / S, 0.3, sz * (dd - 0.8) / S, 9 + i, 0.8, 3);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 10;
    const rr = 5.3 + 0.4 * Math.sin(i * 2.1);
    cloud(1.6 + 0.35 * Math.cos(i * 1.7), Math.cos(a) * rr, 0.9 + 0.35 * Math.sin(i * 1.3), Math.sin(a) * rr, 20 + i * 1.3, 0.78, 3);
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    cloud(1.8 + 0.3 * Math.sin(i * 2.3), Math.cos(a) * 3.2, 2.3 + 0.4 * Math.cos(i * 1.9), Math.sin(a) * 3.2, i * 1.37, 0.78, 3);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.6;
    cloud(1.5 + 0.25 * Math.sin(i), Math.cos(a) * 1.7, 4.2 + 0.3 * Math.sin(i * 2), Math.sin(a) * 1.7, 11 + i * 1.9, 0.82, 3);
  }
  cloud(2.5, 0, 4.6, 0, 3.3, 0.85, 4);
  cloud(1.5, 0.2, 6.5, -0.2, 6.1, 0.85, 3);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.9;
    cloud(0.7 + 0.1 * (i % 3), Math.cos(a) * 6.4, 0.4 + 0.3 * (i % 2), Math.sin(a) * 6.4, 40 + i, 0.8, 2);
  }
  // the finial: a gold stem under a glowing moon orb ringed by a tilted gold orbit with three stars, and a wheel of six stars on gold spokes
  const FY = (dy: number): number => CY + dy * S;
  t.rod("gold", [0, FY(7.4), 0], [0, FY(10.2), 0], 0.14, 0.09, 10);
  t.ball("moon", 1.25 * S, 0, FY(11.5), 0, 1, 1, 1, 28);
  const orbitQ = new Quaternion().setFromEuler(new Euler(1.15, 0.5, 0));
  t.add("gold", new TorusGeometry(2.1 * S, 0.1, 8, 48), new Matrix4().compose(new Vector3(0, FY(11.5), 0), orbitQ, new Vector3(1, 1, 1)));
  for (let i = 0; i < 3; i++) {
    const th3 = (i / 3) * Math.PI * 2 + 0.5;
    const p = new Vector3(Math.cos(th3) * 2.1 * S, Math.sin(th3) * 2.1 * S, 0).applyQuaternion(orbitQ).add(new Vector3(0, FY(11.5), 0));
    t.add("moon", starGeometry(0.5 * S, 0.2), new Matrix4().compose(p, orbitQ, new Vector3(1, 1, 1)));
    towerBulbs.push([p.x, p.y, p.z]);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const rr = 3.1 * S;
    const ye = FY(8.6 + (i % 2) * 0.9);
    t.rod("gold", [0, FY(7.6), 0], [Math.cos(a) * rr, ye, Math.sin(a) * rr], 0.06, 0.04, 6);
    t.add("moon", starGeometry((0.46 + (i % 2) * 0.12) * S, 0.18), new Matrix4().compose(new Vector3(Math.cos(a) * rr, ye + 0.35 * S, Math.sin(a) * rr), new Quaternion().setFromEuler(new Euler(0, -a + Math.PI / 2, 0)), new Vector3(1, 1, 1)));
    towerBulbs.push([Math.cos(a) * rr, ye + 0.35 * S, Math.sin(a) * rr]);
  }
  towerBulbs.push([0, FY(11.5), 0], [0, FY(12.9), 0]);

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

  // the podium's fascia: inset indigo panels in gold frames round the concrete sides (the east side leaves the steps free)
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    const n = 6;
    for (let k = 0; k < n; k++) {
      const u = (k - (n - 1) / 2) * ((2 * R - 1.6) / n);
      if (f === 0 && Math.abs(u) < 2.3) continue;
      const cx = nx * (R + 0.02) - nz * u;
      const cz = nz * (R + 0.02) + nx * u;
      t.box("gold", 0.04, 0.5, 1.7, cx, 0.42, cz, 0, -a, 0);
      t.box("indigo", 0.06, 0.4, 1.58, cx + nx * 0.02, 0.42, cz + nz * 0.02, 0, -a, 0);
      t.ball("gold", 0.07, cx + nx * 0.06, 0.42, cz + nz * 0.06, 1, 1, 1, 8);
    }
  }
  // lamp standards at the deck's four corners: a gold post, a crescent bracket and a glowing lantern
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
    const x = sx * (R - 0.25);
    const z = sz * (R - 0.25);
    t.rod("gold", [x, DROP_DECK_Y, z], [x, DROP_DECK_Y + 3.4, z], 0.09, 0.06, 10);
    t.ball("gold", 0.16, x, DROP_DECK_Y + 0.5, z, 1, 1, 1, 10);
    t.add("gold", new TorusGeometry(0.34, 0.035, 6, 20, Math.PI * 1.2), new Matrix4().compose(new Vector3(x, DROP_DECK_Y + 3.45, z), new Quaternion().setFromEuler(new Euler(0, Math.atan2(-sz, sx), Math.PI * 0.4)), new Vector3(1, 1, 1)));
    t.ball("white", 0.26, x, DROP_DECK_Y + 3.75, z, 1, 1.2, 1, 14);
    t.rod("gold", [x, DROP_DECK_Y + 4.02, z], [x, DROP_DECK_Y + 4.2, z], 0.06, 0.02, 8);
    towerBulbs.push([x, DROP_DECK_Y + 3.75, z]);
  }
  // star inlays in the deck (indigo disc, gold star) on the three closed sides
  for (const [x, z] of [[0, -(R + I) / 2], [0, (R + I) / 2], [-(R + I) / 2, 0]] as [number, number][]) {
    t.rod("indigo", [x, DROP_DECK_Y + 0.011, z], [x, DROP_DECK_Y + 0.02, z], 1.15, 1.15, 28);
    t.add("gold", starGeometry(0.95, 0.012), new Matrix4().compose(new Vector3(x, DROP_DECK_Y + 0.035, z), new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)), new Vector3(1, 1, 1)));
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
      // the restraint: a slim low lap bar (owner 2026-11-21: nothing in front of the eyes). Two posts rise from the cushion's sides to a thin bar across the lap,
      // well below the eye (0.8 m over the hips) and lower than any look-ahead view; no shoulder harness, no chest bar
      for (const s of [-1, 1]) {
        const zz = z + s * 0.3;
        c.rod("gold", P(hip + 0.05, -0.12, zz), P(hip + 0.4, 0.1, zz), 0.022, 0.022, 8);
      }
      c.rod("indigo", P(hip + 0.4, 0.1, z - 0.3), P(hip + 0.4, 0.1, z + 0.3), 0.03, 0.03, 10);
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
      gold: flat("#f4c752", { roughness: 0.3, metalness: 0.3, emissive: new Color("#8a6410"), emissiveIntensity: 0.8 }),
      cloud: flat("#ffffff", { roughness: 0.92, emissive: new Color("#eef0ff"), emissiveIntensity: 0.8 }),
      glass: flat("#ffe2a8", { roughness: 0.2, emissive: new Color("#ffb85a"), emissiveIntensity: 0.55 }),
      leather: flat("#6a45b8", { roughness: 0.55 }),
      pad: flat("#f6d36b", { roughness: 0.5 }),
      white: flat("#fbf4e6", { roughness: 0.8, emissive: new Color("#7a6e56"), emissiveIntensity: 0.25 }),
      ink: flat("#2c2440", { roughness: 0.8 }),
      steel: flat("#aeb4cc", { roughness: 0.35, metalness: 0.7 }),
      panel: flat("#2a2f8f", { roughness: 0.5, emissive: new Color("#3a3fd0"), emissiveIntensity: 0.6, side: DoubleSide }),
      moon: flat("#ffe9a0", { roughness: 0.3, metalness: 0.1, emissive: new Color("#ffcf55"), emissiveIntensity: 0.95, side: DoubleSide }),
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
    const st = dropAt(rideMs(), ST);
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
        <group ref={carRef} name="ride-droptower-car" position={[0, DROP_STATION_Y, 0]}>
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

