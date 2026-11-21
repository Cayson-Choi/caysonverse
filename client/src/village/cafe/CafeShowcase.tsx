import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Uint32BufferAttribute,
  Vector3,
  type BufferAttribute,
  type Material,
  type Object3D,
} from "three";
import { CAFE_CENTRE_XZ, CAFE_STOREY } from "@caysonverse/shared/village/cafeRoom";
import { lotRoomOf } from "@caysonverse/shared/village/villageLots";
import { useQualityTier } from "../../game/QualityEffects";
import { dayNight } from "../dayNightDriver";
import { trimMesh } from "../street/streetTrim";
import { driveRoomLights, holdLotRoom, lotRoomLoaded, showcaseMaterial, type LoadedRoom } from "../lots/LotRoom";

/**
 * 케이슨 카페 from the village (owner 2026-11-21: "유리창이 뭔가 사실적이지 않아 … 불꺼진 창문도 불이 켜져있는 걸로", "모든 유리창을 투명하게
 * 만들어 건물 밖에서도 유리창을 통해서 안이 보이게"): the shop windows, the door and every upper window show the café's REAL rooms — the very
 * walk-in rooms' GLBs (lots/LotRoom.tsx, their phone files: light, and the same cache the rooms use, so walking in reads nothing again),
 * placed in the building at the café's own frame, ground floor and upstairs salon — behind real glass.
 *
 *  1. village.glb's café interior is taken out of the village clone (its baked front room, the kitchen and the upper floor's two plaster boxes,
 *     the flat lit / dark cards behind the upper windows, the milky shop-glass sheets with their painted streaks, the sashes): every triangle
 *     with all three corners inside the building's inner volume or inside one of the openings' depth (the outer reveals, sills and casings stay).
 *  2. The rooms are drawn there (≤ CAFE_SHOW_M from the camera): the room's own baked light by day and night and its lamps, the village's live
 *     sun and sky turned down to a share (they would light the counter through the walls). Their window glass (the rooms' village panorama)
 *     is left out: from outside the glass is…
 *  3. …one mesh of real glass panes (`facadeGlass`): nearly clear (4 %) seen straight on, a Fresnel reflection of the sky and the street at a
 *     slant (Schlick), a faint frame line; farther than the rooms are drawn, the same panes turn into a dark reflective sheet with the warm
 *     glow of a lit room at night (no window is ever dark: every one has the room behind it).
 *  4. The kitchen behind the partition (not modelled) is a closed plaster box, so no window looks through the building.
 * The module is the café's alone; the glass shader (`facadeGlassMaterial`) is reusable for any building with an interior behind its panes.
 */

declare global {
  interface Window {
    /** DEV: whether the café's room is loaded (e2e/cafe-enter.mjs waits on it before going in). */
    __cvCafeReady?: () => boolean;
    /** DEV: the facade's numbers (what was taken out of the village, the rooms drawn behind the glass). */
    __cvCafeFacade?: () => unknown;
  }
}

/** The rooms behind the glass are read and drawn within this distance (m) of the camera; beyond, the glass alone. */
export const CAFE_SHOW_M = { pc: 75, phone: 55 } as const;
/** How much of the village's live sun and sky reaches the rooms seen from outside (the bake carries their light). */
export const CAFE_SHOW_DIRECT = 0.18;

const CX = CAFE_CENTRE_XZ.x;
const CZ = CAFE_CENTRE_XZ.z;
/** The café's local frame (cafeRoom.ts, parts_cafe.py) -> the village: x = cx - lz, z = cz + lx (door side west). */
const toWorld = (lx: number, lz: number) => ({ x: CX - lz, z: CZ + lx });
const toLocal = (x: number, z: number) => ({ lx: z - CZ, lz: CX - x });

/** The building's inner faces (local): x +-6.8, z -9.3 .. 3.7; the walls 0.3 m thick. */
const IN = { x: 6.8, zf: 3.7, zb: -9.3, t: 0.3 } as const;

type Wall = "front" | "back" | "left" | "right";
/** An opening (local): the wall, its extent along the wall (x on front/back, z on the sides) and in height, and its glass's depth into the wall. */
interface Opening {
  wall: Wall;
  a: number;
  b: number;
  y0: number;
  y1: number;
  /** The pane's depth from the inner face outward (m). */
  d: number;
}
const S = CAFE_STOREY;
const up = (c: number) => [c - 0.8, c + 0.8] as const;
/** Every pane of the café that shows a room: the shop windows, the door's two leaves, the side windows below, and the upper windows all round. */
export const CAFE_OPENINGS: readonly Opening[] = Object.freeze([
  { wall: "front", a: -5.25, b: -1.85, y0: 0.45, y1: 3.35, d: 0.15 },
  { wall: "front", a: 1.85, b: 5.25, y0: 0.45, y1: 3.35, d: 0.15 },
  { wall: "front", a: -1.08, b: -0.11, y0: 0.3, y1: 2.75, d: 0.045 },
  { wall: "front", a: 0.11, b: 1.08, y0: 0.3, y1: 2.75, d: 0.045 },
  ...(["left", "right"] as const).flatMap((wall) => [
    { wall, a: -4.0, b: -1.6, y0: 0.9, y1: 2.7, d: 0.15 },
    { wall, a: 0.2, b: 2.6, y0: 0.9, y1: 2.7, d: 0.15 },
    ...[-7.9, -4.5, -1.1, 2.3].map((c) => ({ wall, a: up(c)[0], b: up(c)[1], y0: S + 0.9, y1: S + 2.9, d: 0.15 })),
  ]),
  ...(["front", "back"] as const).flatMap((wall) => [-5.4, -1.8, 1.8, 5.4].map((c) => ({ wall, a: up(c)[0], b: up(c)[1], y0: S + 0.9, y1: S + 2.9, d: 0.15 }))),
]);
/** The openings of the walls that village.glb glazes (the door's whole opening: its leaves are rebuilt by the room). */
const STRIP_OPENINGS: readonly Opening[] = [
  ...CAFE_OPENINGS.filter((o) => !(o.wall === "front" && o.d < 0.1)),
  { wall: "front", a: -1.2, b: 1.2, y0: 0.0, y1: 3.0, d: 0.15 },
];

/** A point (local) on a wall's pane: along `u`, at height `y`, `d` out from the inner face. */
function wallPoint(w: Wall, u: number, y: number, d: number): Vector3 {
  const p =
    w === "front" ? toWorld(u, IN.zf + d) : w === "back" ? toWorld(u, IN.zb - d) : w === "left" ? toWorld(-IN.x - d, u) : toWorld(IN.x + d, u);
  return new Vector3(p.x, y, p.z);
}
/** A wall's outward normal (world). */
function wallOut(w: Wall): Vector3 {
  const o = wallPoint(w, 0, 0, 0);
  return wallPoint(w, 0, 0, 1).sub(o).normalize();
}

// ─────────────────────────────── the village clone's café interior, taken out ───────────────────────────────

type Inside = (x: number, y: number, z: number) => boolean;
interface Foot {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
  minTop?: number;
  inside: Inside;
}
const E = 0.012;
/** The footprints (village frame) of what the café's facade takes out of village.glb's clone. */
export function cafeStripFeet(): Foot[] {
  const box = { minX: CX - 4.1, maxX: CX + 9.7, minZ: CZ - 7.2, maxZ: CZ + 7.2 };
  const feet: Foot[] = [];
  // the inner volume: both floors, the kitchen, the inner faces themselves (the rooms bring their own)
  feet.push({
    ...box,
    maxY: 8.7,
    minTop: -1,
    inside: (x, y, z) => {
      const { lx, lz } = toLocal(x, z);
      return Math.abs(lx) <= IN.x + E && lz <= IN.zf + E && lz >= IN.zb - E && y > -0.05 && y < 8.62;
    },
  });
  // the openings: glass, sashes and frames inside the wall's depth (not its outer face: reveals, sills and casings stay)
  for (const o of STRIP_OPENINGS) {
    feet.push({
      ...box,
      maxY: o.y1 + 0.1,
      minTop: -1,
      inside: (x, y, z) => {
        const { lx, lz } = toLocal(x, z);
        const u = o.wall === "front" || o.wall === "back" ? lx : lz;
        const d = o.wall === "front" ? lz - IN.zf : o.wall === "back" ? IN.zb - lz : o.wall === "left" ? -IN.x - lx : lx - IN.x;
        return u >= o.a - 0.03 && u <= o.b + 0.03 && y >= o.y0 - 0.06 && y <= o.y1 + 0.06 && d >= -E && d <= IN.t - 0.03;
      },
    });
  }
  return feet;
}

/** Takes the café's interior out of the village clone; returns the undo. */
export function stripCafeFromVillage(root: Object3D): { undo: () => void; removed: number } {
  const feet = cafeStripFeet();
  // the glass itself (the milky sheets, the lit / dark cards, the door's panes) goes through the wall's whole depth
  const glassFeet: Foot[] = [
    ...feet,
    {
      minX: CX - 4.1,
      maxX: CX + 9.7,
      minZ: CZ - 7.2,
      maxZ: CZ + 7.2,
      maxY: 8.7,
      minTop: -1,
      inside: (x, y, z) => {
        const { lx, lz } = toLocal(x, z);
        return Math.abs(lx) <= 1.25 && lz >= IN.zf - E && lz <= IN.zf + IN.t + 0.02 && y > -0.05 && y < 3.06;
      },
    },
  ];
  const undo: Array<() => void> = [];
  let removed = 0;
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || (o as { isInstancedMesh?: boolean }).isInstancedMesh || /^(village_sky|village_water|col__|light__|seat__)/.test(mesh.name)) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material | undefined;
    const isGlass = !!mat && /^M_(glass|window|shop)$/.test(mat.name);
    const t = trimMesh(mesh, (isGlass ? glassFeet : feet) as never);
    if (!t) return;
    const original = mesh.geometry;
    mesh.geometry = t.geometry;
    removed += t.removed;
    undo.push(() => {
      if (mesh.geometry !== t.geometry) return;
      mesh.geometry = original;
      t.geometry.dispose();
    });
  });
  return { undo: () => undo.reverse().forEach((u) => u()), removed };
}

// ─────────────────────────────── the glass ───────────────────────────────

const GLASS_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vUv;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const GLASS_FRAG = /* glsl */ `
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uGround;
uniform vec3 uGlow;
uniform float uOpaque;
uniform float uNight;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vUv;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  if (dot(N, V) < 0.0) N = -N;
  float c = clamp(dot(N, V), 0.0, 1.0);
  // Schlick, F0 = 0.04 (float glass)
  float F = 0.04 + 0.96 * pow(1.0 - c, 5.0);
  vec3 R = reflect(-V, N);
  // what the pane reflects: the sky above the horizon, the street and the houses opposite a little below it, the ground under them
  float h = R.y;
  vec3 sky = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.6, h));
  float band = smoothstep(-0.02, 0.06, h) * (1.0 - smoothstep(0.06, 0.22, h));
  vec3 street = mix(uGround, uSkyHorizon * 0.55, 0.35 + 0.3 * sin(atan(R.z, R.x) * 9.0));
  vec3 env = h > 0.0 ? mix(sky, street, band * 0.8) : mix(street, uGround, smoothstep(0.0, -0.3, h));
  // a hair-thin darker line round each pane (the glazing bead) and a faint vertical sheen
  float edge = 1.0 - smoothstep(0.0, 0.012, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
  // near: clear glass over the real room (alpha = its reflectance); far: a dark sheet with a lit room's warm glow at night
  vec3 inside = mix(vec3(0.05, 0.05, 0.05), uGlow, uNight);
  float a = mix(F, mix(0.92, 1.0, F), uOpaque);
  vec3 col = env * F + inside * uOpaque * (1.0 - F);
  // near, at night: the warm haze of the lit room on the pane itself (a lamp's bloom in the glass)
  col += uGlow * 0.05 * uNight * (1.0 - uOpaque);
  a = max(a, 0.05 * uNight * (1.0 - uOpaque));
  col = mix(col, vec3(0.08), edge * 0.6);
  a = max(a, edge * 0.5);
  gl_FragColor = vec4(col / max(a, 1e-3), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Real window glass (reusable: any building with its interior behind the panes). `uOpaque` 0: clear over the room; 1: a far sheet. */
export function facadeGlassMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: "facade_glass",
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    uniforms: {
      uSkyTop: { value: new Vector3(0.35, 0.55, 0.85) },
      uSkyHorizon: { value: new Vector3(0.8, 0.85, 0.9) },
      uGround: { value: new Vector3(0.22, 0.24, 0.2) },
      uGlow: { value: new Vector3(1.0, 0.72, 0.42) },
      uOpaque: { value: 1 },
      uNight: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** The café's panes as one mesh (village frame), each quad's UV 0..1 across it. */
export function facadeGlassGeometry(openings: readonly Opening[] = CAFE_OPENINGS): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const o of openings) {
    const n = wallOut(o.wall);
    const p = [wallPoint(o.wall, o.a, o.y0, o.d), wallPoint(o.wall, o.b, o.y0, o.d), wallPoint(o.wall, o.b, o.y1, o.d), wallPoint(o.wall, o.a, o.y1, o.d)];
    const k = pos.length / 3;
    p.forEach((q, i) => {
      pos.push(q.x, q.y, q.z);
      nor.push(n.x, n.y, n.z);
      uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
    });
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** The kitchen behind the café's partition (not modelled): a closed plaster box seen through no window but keeping the building shut. */
function kitchenBox(): BufferGeometry {
  const a = toWorld(-IN.x, IN.zb);
  const b = toWorld(IN.x, -4.1);
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  const g = new BufferGeometry();
  const p: number[] = [];
  const quad = (q: number[][]) => {
    p.push(...q[0]!, ...q[1]!, ...q[2]!, ...q[0]!, ...q[2]!, ...q[3]!);
  };
  const H = 4.3; // (the ground floor's kitchen only: the salon upstairs covers the whole upper floor)
  // inward-facing walls, floor and ceiling (double-sided material)
  quad([[x0, 0, z0], [x1, 0, z0], [x1, H, z0], [x0, H, z0]]);
  quad([[x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1]]);
  quad([[x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0]]);
  quad([[x1, 0, z0], [x1, 0, z1], [x1, H, z1], [x1, H, z0]]);
  quad([[x0, 0.01, z0], [x1, 0.01, z0], [x1, 0.01, z1], [x0, 0.01, z1]]);
  quad([[x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1]]);
  g.setAttribute("position", new Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

// ─────────────────────────────── the rooms behind the glass ───────────────────────────────

/** Room frame (the GLB's world: interior origin + room x, z) -> the village, at floor height `y`. */
function roomToVillage(origin: { x: number; z: number }, y: number): Matrix4 {
  // room (rx, rz) -> local (6.8 - rx, 3.7 - rz) -> village (cx - 3.7 + rz, cz + 6.8 - rx)
  return new Matrix4().set(0, 0, 1, CX - IN.zf - origin.z, 0, 1, 0, y, -1, 0, 0, CZ + IN.x + origin.x, 0, 0, 0, 1);
}

/** A copy of a room mesh's geometry without the triangles outside the room's floor rectangle (its window reveals: village.glb keeps its own). */
function insideRoom(geo: BufferGeometry, rect: { minX: number; maxX: number; minZ: number; maxZ: number }): BufferGeometry | null {
  const pos = geo.getAttribute("position") as BufferAttribute | undefined;
  if (!pos) return null;
  const index = geo.index;
  const n = index ? index.count : pos.count;
  const kept: number[] = [];
  let dropped = 0;
  const out = (i: number) => {
    const x = pos.getX(i), z = pos.getZ(i);
    return x < rect.minX - 0.005 || x > rect.maxX + 0.005 || z < rect.minZ - 0.005 || z > rect.maxZ + 0.005;
  };
  for (let t = 0; t < n; t += 3) {
    const a = index ? index.getX(t) : t, b = index ? index.getX(t + 1) : t + 1, c = index ? index.getX(t + 2) : t + 2;
    if (out(a) && out(b) && out(c)) {
      dropped++;
      continue;
    }
    kept.push(a, b, c);
  }
  if (!dropped) return null;
  const g = new BufferGeometry();
  for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.getAttribute(k));
  g.setIndex(new Uint32BufferAttribute(kept, 1));
  g.boundingSphere = geo.boundingSphere?.clone() ?? null;
  g.boundingBox = geo.boundingBox?.clone() ?? null;
  return g;
}

interface Shown {
  group: Group;
  loaded: LoadedRoom;
  dispose(): void;
}

/** One room as seen from outside: a clone of the loaded room (shared geometry and maps), its own-light materials, placed in the building. */
function showRoom(loaded: LoadedRoom, area: string, y: number, direct: { value: number }, night: { value: number }): Shown {
  const room = lotRoomOf(area)!;
  const scene = loaded.root.clone(true);
  const made = new Map<Material, Material>();
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  const b = room.bounds;
  const rect = { minX: room.unit.interior.origin.x, maxX: room.unit.interior.origin.x + (b.maxX - b.minX), minZ: room.unit.interior.origin.z, maxZ: room.unit.interior.origin.z + (b.maxZ - b.minZ) };
  const drop: Object3D[] = [];
  scene.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as Material;
    if (mat.name === "M_garden" || mat.name === "M_screen") {
      drop.push(m); // the panorama glass: the facade's own glass stands there
      return;
    }
    m.raycast = () => {};
    if (/^LM_cafe_(plaster|paper)$/.test(mat.name)) {
      const g = insideRoom(m.geometry, rect);
      if (g) {
        m.geometry = g;
        geos.push(g);
      }
    }
    let v = made.get(mat);
    if (!v) {
      v = showcaseMaterial(mat, loaded, direct, night);
      made.set(mat, v);
      if (v !== mat) mats.push(v);
    }
    m.material = v;
  });
  for (const o of drop) o.parent?.remove(o);
  scene.position.set(0, 0, 0); // (the café's rooms are not shifted: their GLB world is the interior origin's)
  const group = new Group();
  group.name = `cafe_showcase_${room.unit.id}`;
  group.matrixAutoUpdate = false;
  group.matrix.copy(roomToVillage(room.unit.interior.origin, y));
  group.add(scene);
  group.updateMatrixWorld(true);
  return {
    group,
    loaded,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

const AREAS = [{ area: "lot:lot_cafe_room", y: 0 }, { area: "lot:lot_cafe_upstairs", y: S }] as const;
const CENTRE = new Vector3(CX, 3, CZ);

/** The café's facade in the village (mounted with the village model: `root` is its clone). */
export function CafeShowcase({ root }: { root: Object3D }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const tier = useQualityTier();
  const phone = tier !== "high";
  const direct = useMemo(() => ({ value: CAFE_SHOW_DIRECT }), []);
  const night = useMemo(() => ({ value: 0 }), []);
  const glass = useMemo(() => {
    const mat = facadeGlassMaterial();
    const mesh = new Mesh(facadeGlassGeometry(), mat);
    mesh.name = "cafe_facade_glass";
    mesh.renderOrder = 4;
    mesh.raycast = () => {};
    return { mesh, mat };
  }, []);
  const kitchen = useMemo(() => {
    const m = new Mesh(kitchenBox(), new ShaderMaterial({ vertexShader: "void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}", fragmentShader: "void main(){gl_FragColor=vec4(0.32,0.28,0.24,1.0);\n#include <colorspace_fragment>\n}", side: DoubleSide }));
    m.name = "cafe_kitchen_box";
    m.raycast = () => {};
    return m;
  }, []);
  useEffect(() => () => {
    glass.mesh.geometry.dispose();
    glass.mat.dispose();
    kitchen.geometry.dispose();
    (kitchen.material as Material).dispose();
  }, [glass, kitchen]);

  // 1. village.glb's café interior out of the clone
  const [strip, setStrip] = useState(0);
  useEffect(() => {
    const s = stripCafeFromVillage(root);
    setStrip(s.removed);
    return () => s.undo();
  }, [root]);

  // 2. the rooms, read while the camera is near (held: the same cache the rooms use)
  const [near, setNear] = useState(false);
  const nearRef = useRef(false);
  const [shown, setShown] = useState<Shown[]>([]);
  useEffect(() => {
    if (!near) return;
    let live = true;
    const holds = AREAS.map(({ area }) => holdLotRoom(area, gl, true)!);
    // a PC walks into the PC files: start them too (the door's prefetch of the rooms' own)
    const pcHolds = phone ? [] : AREAS.map(({ area }) => holdLotRoom(area, gl, false)!);
    const made: Shown[] = [];
    void Promise.all(holds.map((h) => h.promise)).then((rooms) => {
      if (!live) return;
      rooms.forEach((r, i) => made.push(showRoom(r, AREAS[i]!.area, AREAS[i]!.y, direct, night)));
      setShown([...made]);
    }).catch((err: unknown) => console.error("[cafe] facade rooms", err));
    return () => {
      live = false;
      setShown([]);
      for (const s of made) s.dispose();
      for (const h of [...holds, ...pcHolds]) h.release();
    };
  }, [near, gl, phone, direct, night]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvCafeReady = () => lotRoomLoaded("lot:lot_cafe_room");
    window.__cvCafeFacade = () => ({ stripped: strip, near, rooms: shown.map((s) => s.group.name), panes: CAFE_OPENINGS.length, opaque: glass.mat.uniforms.uOpaque!.value });
    return () => {
      delete window.__cvCafeFacade;
    };
  }, [strip, near, shown, glass]);

  useFrame(({ clock }) => {
    const d = camera.position.distanceTo(CENTRE);
    const lim = phone ? CAFE_SHOW_M.phone : CAFE_SHOW_M.pc;
    const want = nearRef.current ? d < lim + 8 : d < lim;
    if (want !== nearRef.current) {
      nearRef.current = want;
      setNear(want);
    }
    const o = dayNight.outdoor;
    const u = glass.mat.uniforms;
    const day = Math.max(0, Math.min(1, 1 - o.night));
    u.uOpaque!.value = shown.length === AREAS.length ? 0 : 1;
    u.uNight!.value = Math.max(o.lights, o.night);
    (u.uSkyTop!.value as Vector3).set(0.3 * day + 0.02, 0.5 * day + 0.03, 0.85 * day + 0.06);
    (u.uSkyHorizon!.value as Vector3).set(0.85 * day + 0.04 + 0.3 * o.golden, 0.85 * day + 0.04 + 0.12 * o.golden, 0.9 * day + 0.07);
    (u.uGround!.value as Vector3).set(0.2 * day + 0.02, 0.22 * day + 0.02, 0.18 * day + 0.02);
    direct.value = CAFE_SHOW_DIRECT * day;
    night.value = Math.max(o.night, o.lights * 0.8);
    for (const s of shown) driveRoomLights(s.loaded, clock.elapsedTime);
  });

  return (
    <>
      <primitive object={kitchen} dispose={null} />
      {shown.map((s) => (
        <primitive key={s.group.name} object={s.group} dispose={null} />
      ))}
      <primitive object={glass.mesh} dispose={null} />
    </>
  );
}
