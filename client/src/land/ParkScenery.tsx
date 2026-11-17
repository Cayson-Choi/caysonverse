import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  FileLoader,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  Vector3,
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
} from "three";
import { isTouchDevice } from "../device";
import { coasterTrack } from "@caysonverse/shared/land/coaster";
import { PARK_BOUNDS, PARK_PLAZA, PARK_QUEUE_HALL, PARK_SHOPS } from "@caysonverse/shared/village/parkArea";
import { LIGHTING } from "../game/sceneLighting";
import { dayNight } from "../village/dayNightDriver";
import { MOUNTAINS_GRID_URL, MOUNTAINS_TEXTURE_URL, applyMountains, buildMountainGeometry, createMountainMaterial, parseMountains } from "../village/mountains";
import { FLAT_SKY_MAPPING } from "../village/villageWater";
import { GeoBuilder, cross, type V3 } from "./geoBuilder";
import { featherTexture, parkMaterial, pickSet } from "./pbr";

const rngOf = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];

/** The ground points of the track's circuit every ~4 m, with the horizontal direction across it. */
export function circuitGround(): { x: number; z: number; px: number; pz: number; y: number }[] {
  const t = coasterTrack();
  const out: { x: number; z: number; px: number; pz: number; y: number }[] = [];
  for (let i = 0; i < t.n; i += 8) {
    const tx = t.tan[3 * i]!;
    const tz = t.tan[3 * i + 2]!;
    const h = Math.hypot(tx, tz) || 1;
    // flatten near-vertical stretches (the loop) by keeping the previous direction
    const prev = out[out.length - 1];
    const ok = h > 0.3 || !prev;
    out.push({ x: t.pos[3 * i]!, z: t.pos[3 * i + 2]!, px: ok ? -tz / h : prev!.px, pz: ok ? tx / h : prev!.pz, y: t.pos[3 * i + 1]! });
  }
  return out;
}

/** Whether the lawn at (x, z) is taken: a path, the plaza, a building, the station, the pond, the circuit's own ground. */
export function taken(x: number, z: number, ground: ReturnType<typeof circuitGround>, pond: { x: number; z: number }): boolean {
  if (Math.hypot(x - PARK_PLAZA.x, z - PARK_PLAZA.z) < PARK_PLAZA.radius + 5) return true;
  if (x > 26 && x < 54 && z < -132) return true;
  if (z > -120 && z < -104 && x > -25 && x < 348) return true;
  if (x > -25 && x < -9 && z > -120 && z < -40) return true;
  const q = PARK_QUEUE_HALL;
  if (x > q.minX - 6 && x < q.maxX + 6 && z > q.minZ - 8 && z < q.maxZ + 8) return true;
  if (x > -24 && x < 24 && z > -12 && z < 8) return true;
  if (PARK_SHOPS.some((s) => Math.abs(x - s.x) < s.d / 2 + 5 && Math.abs(z - s.z) < s.w / 2 + 4)) return true;
  if (Math.hypot((x - pond.x) / 20, (z - pond.z) / 13) < 1) return true;
  for (const g of ground) if (Math.hypot(g.x - x, g.z - z) < 7) return true;
  return false;
}

// ───────────────────────────────────────── the circuit's ground: a path, a fence, a hedge, shrubs, a pond ─────────────────────────────────────────

function CircuitGround({ all, pond }: { all: Texture[]; pond: { x: number; z: number } }) {
  const ground = useMemo(circuitGround, []);
  const pathGeo = useMemo(() => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let d = 0;
    ground.forEach((g, i) => {
      if (i > 0) d += Math.hypot(g.x - ground[i - 1]!.x, g.z - ground[i - 1]!.z);
      for (const s of [-1, 1]) {
        pos.push(g.x + g.px * 1.7 * s, 0.045, g.z + g.pz * 1.7 * s);
        uv.push(s > 0 ? 1 : 0, d / 3.4);
      }
    });
    const n = ground.length;
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b = ((i + 1) % n) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // the seam between the last sample and the first spans the closing distance: keep its UV continuous enough
    return g;
  }, [ground]);
  const gravel = useMemo(() => parkMaterial(pickSet(all, "Gravel023"), 1, { color: new Color("#e2d6c0"), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, transparent: true, alphaMap: featherTexture(), depthWrite: false }), [all]);
  // a low picket fence on the path's right edge, and a hedge on its left (instanced posts + merged rails)
  const fence = useMemo(() => {
    const b = new GeoBuilder();
    const rails: V3[][] = [[], []];
    ground.forEach((g, i) => {
      if (g.z < 9 && g.x > -45 && g.x < 35) return; // not through the station
      if (i % 2 === 0) b.box([g.x + g.px * 3.5, 0.55, g.z + g.pz * 3.5], X, Y, 0.06, 0.55, 0.06, [0.92, 0.9, 0.84]);
      void rails;
    });
    // two rails per straight run between posts
    for (let i = 0; i < ground.length - 2; i += 2) {
      const a = ground[i]!;
      const c = ground[i + 2]!;
      if (a.z < 9 && a.x > -45 && a.x < 35) continue;
      for (const y of [0.38, 0.85]) b.cylinder([a.x + a.px * 3.5, y, a.z + a.pz * 3.5], [c.x + c.px * 3.5, y, c.z + c.pz * 3.5], 0.035, 0.035, 5, [0.92, 0.9, 0.84]);
    }
    return b.build();
  }, [ground]);
  const fenceMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), []);
  const hedge = useMemo(() => {
    const b = new GeoBuilder();
    // the boundary hedge along the park's south edge, and a hedge beside the circuit path
    for (let x = PARK_BOUNDS.minX; x < PARK_BOUNDS.maxX; x += 6) {
      if (x > -30 && x < 30) continue; // the station's own frontage
      b.box([x + 3, 0.65, -2.7], X, Y, 3.05, 0.65, 0.55, [0.18, 0.4, 0.2]);
    }
    ground.forEach((g, i) => {
      if (i % 3 !== 0 || (g.z < 9 && g.x > -45 && g.x < 35)) return;
      b.box([g.x - g.px * 3.4, 0.45, g.z - g.pz * 3.4], [g.pz, 0, -g.px], Y, 2.8, 0.45, 0.5, [0.2, 0.44, 0.22]);
    });
    return b.build();
  }, [ground]);
  const hedgeMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), []);
  const waterMat = useMemo(() => new MeshStandardMaterial({ color: "#4d9bb8", roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.88 }), []);
  const rocks = useRef<InstancedMesh>(null);
  const rockGeo = useMemo(() => new IcosahedronGeometry(0.9, 0), []);
  const rockMat = useMemo(() => new MeshStandardMaterial({ color: "#9a968c", roughness: 0.95, flatShading: true }), []);
  useEffect(() => {
    const m = new Matrix4();
    const q = new Quaternion();
    const rnd = rngOf(77);
    const N = 34;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const s = 0.7 + rnd() * 0.9;
      m.compose(new Vector3(pond.x + Math.cos(a) * 20.3, 0.25, pond.z + Math.sin(a) * 13.3), q.setFromAxisAngle(new Vector3(0, 1, 0), rnd() * 6), new Vector3(s, s * 0.6, s));
      rocks.current?.setMatrixAt(i, m);
    }
    if (rocks.current) rocks.current.instanceMatrix.needsUpdate = true;
  }, [pond]);
  return (
    <group>
      <mesh geometry={pathGeo} material={gravel} receiveShadow />
      <mesh geometry={fence} material={fenceMat} castShadow />
      <mesh geometry={hedge} material={hedgeMat} castShadow receiveShadow />
      <mesh position={[pond.x, 0.08, pond.z]} rotation-x={-Math.PI / 2} scale={[20, 13, 1]} material={waterMat}>
        <circleGeometry args={[1, 40]} />
      </mesh>
      <instancedMesh frustumCulled={false} ref={rocks} args={[rockGeo, rockMat, 34]} castShadow receiveShadow />
    </group>
  );
}

// ───────────────────────────────────────── the backdrop: far woods and the treeline (cheap, instanced, never within reach) ─────────────────────────────────────────

/** Far woods behind the circuit and a treeline ring at 330-400 m: one dark blob and one fir per instance. Near trees are the village's (ParkVegetation). */
function Backdrop({ pond }: { pond: { x: number; z: number } }) {
  const ground = useMemo(circuitGround, []);
  const blobs = useRef<InstancedMesh>(null);
  const firs = useRef<InstancedMesh>(null);
  const blobGeo = useMemo(() => new IcosahedronGeometry(2.6, 1), []);
  const firGeo = useMemo(() => new CylinderGeometry(0.01, 2.2, 6.4, 7).translate(0, 3.2, 0).toNonIndexed(), []);
  const mat = useMemo(() => new MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 }), []);
  const list = useMemo(() => {
    const rnd = rngOf(99);
    const out: { x: number; z: number; s: number; fir: boolean }[] = [];
    const want = 0; // no cheap trees among the layout: the near ones are the village's (ParkVegetation)
    let guard = 0;
    while (out.length < want && guard++ < 20000) {
      const x = -170 + rnd() * 560;
      const z = 60 + rnd() * 110; // behind the circuit's far side (the return straight is at z 64)
      if (taken(x, z, ground, pond)) continue;
      if (out.some((t) => Math.hypot(t.x - x, t.z - z) < 9)) continue;
      out.push({ x, z, s: 1.2 + rnd() * 0.8, fir: rnd() < 0.45 });
    }
    const ringN = isTouchDevice ? 36 : 110;
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2 + rnd() * 0.05;
      const r = 330 + rnd() * 60;
      out.push({ x: 105 + Math.cos(a) * r * 1.15, z: -60 + Math.sin(a) * r * 0.75, s: 2.2 + rnd() * 1.6, fir: rnd() < 0.5 });
    }
    return out;
  }, [ground, pond]);
  useEffect(() => {
    const m = new Matrix4();
    const q = new Quaternion();
    const col = new Color();
    let nb = 0;
    let nf = 0;
    for (const t of list) {
      const ref = t.fir ? firs.current : blobs.current;
      const k = t.fir ? nf++ : nb++;
      m.compose(new Vector3(t.x, t.fir ? 0 : 3.6 * t.s, t.z), q.identity(), new Vector3(t.s, t.s, t.s));
      ref?.setMatrixAt(k, m);
      col.setHSL(0.26 + ((t.x * 3 + t.z) % 9) / 150, 0.38, 0.16 + (((t.x + t.z * 2) % 8) / 90));
      ref?.setColorAt(k, col);
    }
    for (const [ref, n] of [[blobs.current, nb], [firs.current, nf]] as const) {
      if (!ref) continue;
      ref.count = n;
      ref.instanceMatrix.needsUpdate = true;
      if (ref.instanceColor) ref.instanceColor.needsUpdate = true;
    }
  }, [list]);
  return (
    <group>
      <instancedMesh frustumCulled={false} ref={blobs} args={[blobGeo, mat, list.length]} />
      <instancedMesh frustumCulled={false} ref={firs} args={[firGeo, mat, list.length]} />
    </group>
  );
}

// ───────────────────────────────────────── the village's distant mountains ─────────────────────────────────────────

/** A pale horizon sky the mountains haze into (a tiny gradient): the village feeds its dome texture here. */
function horizonTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, "#e6eef5");
  g.addColorStop(1, "#bcd3ea");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 32);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The village's own distant ridges (mountains.ts: the same files and look), centred on the park. */
export function ParkMountains({ tier }: { tier: "high" | "low" }) {
  const buffer = useLoader(FileLoader, MOUNTAINS_GRID_URL, (l) => {
    l.setResponseType("arraybuffer");
  }) as ArrayBuffer;
  const atlas = useTexture(MOUNTAINS_TEXTURE_URL) as Texture;
  const gl = useThree((s) => s.gl);
  void gl;
  const built = useMemo(() => {
    atlas.colorSpace = SRGBColorSpace;
    atlas.wrapS = RepeatWrapping;
    atlas.wrapT = ClampToEdgeWrapping;
    atlas.minFilter = LinearMipmapLinearFilter;
    atlas.anisotropy = 4;
    atlas.needsUpdate = true;
    const geometry = buildMountainGeometry(parseMountains(buffer));
    const material = createMountainMaterial(atlas, { map: horizonTexture(), mapping: FLAT_SKY_MAPPING }, tier, LIGHTING.village.toneCurve ?? "neutral");
    const mesh = new Mesh(geometry, material);
    mesh.name = "park_mountains";
    mesh.frustumCulled = false;
    mesh.renderOrder = -50;
    mesh.position.set(105, -6, -60);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return { mesh, material };
  }, [buffer, atlas, tier]);
  useFrame(({ gl: r }) => {
    applyMountains(built.material, dayNight.applied, null, r.toneMappingExposure);
  });
  return <primitive object={built.mesh} dispose={null} />;
}

export function ParkScenery({ all }: { all: Texture[] }) {
  // the pond lies under the loop's side of the circuit
  const pond = useMemo(() => {
    const t = coasterTrack();
    const i = Math.round(((t.marks.loopFrom ?? 0) + (t.marks.loopTo ?? 0)) / 2);
    return { x: t.pos[3 * i]! + 6, z: 20 };
  }, []);
  return (
    <group>
      <CircuitGround all={all} pond={pond} />
      <Backdrop pond={pond} />
    </group>
  );
}

void cross;
