import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import {
  BackSide,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  Scene,
  RepeatWrapping,
  RingGeometry,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
} from "three";
import {
  COASTER_QUEUE_PAD,
  PARK_EXIT_PAD,
  PARK_LAMPS,
  PARK_PLATFORM,
  PARK_PLAZA,
  PARK_QUEUE_HALL,
  PARK_TROUGHS,
} from "@caysonverse/shared/village/parkArea";
import { isTouchDevice } from "../device";
import { CoasterWorld } from "./CoasterWorld";
import { CarouselWorld } from "./CarouselWorld";
import { WheelWorld } from "./WheelWorld";
import { Shops } from "./ParkShops";
import { ParkMountains, ParkScenery } from "./ParkScenery";
import { ParkProps } from "./ParkProps";
import { ParkVegetation } from "./ParkVegetation";
import type { VillageTier } from "../village/villageModelPrep";
import { GeoBuilder, type V3 } from "./geoBuilder";
import { gateSignTexture } from "./canvasTextures";
import { ALL_PARK_URLS, featherTexture, parkMaterial, pickSet } from "./pbr";

const PINE_URL = (isTouchDevice ? "/textures/houses/lo/" : "/textures/houses/hi/") + "T_h_wood_pine.webp";
const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];

/** A soft mottle (canvas, 512x256) laid once over the whole lawn as a light map: brighter mown stripes and darker rough patches. */
function macroTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 512, 256);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 420; i++) {
    const x = rnd() * 512;
    const y = rnd() * 256;
    const r = 5 + rnd() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = rnd() < 0.5 ? 70 : 200;
    g.addColorStop(0, `rgba(${v},${v},${v},0.42)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const setRepeat = (m: MeshStandardMaterial, rx: number, ry: number): void => {
  for (const t of [m.map, m.normalMap, m.roughnessMap]) t?.repeat.set(rx, ry);
};

/** A plain daytime sky dome that rides with the camera (the park has no village model to bring one). */
function ParkSky() {
  const ref = useRef<Mesh>(null);
  const geo = useMemo(() => {
    const g = new SphereGeometry(1450, 24, 16);
    const pos = g.attributes.position!;
    const col = new Float32Array(pos.count * 3);
    const hz = new Color("#e8f0f7");
    const zen = new Color("#5f9be0");
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const h = Math.max(0, pos.getY(i) / 1450);
      c.copy(hz).lerp(zen, Math.pow(h, 0.5));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    return g;
  }, []);
  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={ref} geometry={geo} renderOrder={-10} frustumCulled={false}>
      <meshBasicMaterial vertexColors side={BackSide} depthWrite={false} fog={false} toneMapped={false} />
    </mesh>
  );
}

// ───────────────────────────────────────── ground ─────────────────────────────────────────

function Ground({ all }: { all: Texture[] }) {
  const grass = useMemo(() => {
    // the village lawn's own set (Poly Haven leafy_grass), graded green-gold like the village lawn (GROUND_GRADE LM_grass: sunny, lime; the raw albedo is dry straw)
    const m = parkMaterial(pickSet(all, "LeafyGrass"), 1, { color: new Color(0.4, 1.2, 0.26), normalScale: 0.9 });
    setRepeat(m, 1700 / 5, 1500 / 5);
    // broad light and dark patches (a mown-and-wild mottle) so the lawn is not one flat green at a distance
    m.lightMap = macroTexture();
    m.lightMapIntensity = 0.9;
    return m;
  }, [all]);
  const plazaGeo = useMemo(() => new CircleGeometry(PARK_PLAZA.radius, 64), []);
  const ring = useMemo(() => new RingGeometry(PARK_PLAZA.radius - 0.4, PARK_PLAZA.radius, 64), []);
  const inlay = useMemo(() => new RingGeometry(9.2, 10.2, 64), []);
  const gold = useMemo(() => new MeshStandardMaterial({ color: "#d9a93a", roughness: 0.35, metalness: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }), []);
  const padRing = useMemo(() => new RingGeometry(COASTER_QUEUE_PAD.radius - 0.35, COASTER_QUEUE_PAD.radius, 48), []);
  const pads = useMemo(() => {
    // paths as rectangles on the ground: [cx, cz, w, d, material key]
    return [
      [40, -161, 18, 54, "p"], // the promenade
      [161, -112, 368, 12, "p"], // the east-west avenue
      [-17, -81, 12, 74, "g"], // the queue approach (gravel)
      [-17, -44, 18, 14, "p"], // the queue apron
    ] as const;
  }, []);
  const setsPave = useMemo(() => pickSet(all, "PavingStones070"), [all]);
  const setsGravel = useMemo(() => pickSet(all, "Gravel023"), [all]);
  const rectMats = useMemo(
    () =>
      pads.map(([, , w, d, k]) =>
        parkMaterial(k === "p" ? setsPave : setsGravel, [w / 3, d / 3], {
          color: new Color(k === "p" ? "#e9dfd2" : "#d9cdb8"),
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -4,
          ...(k === "p" ? {} : { transparent: true, alphaMap: featherTexture(), depthWrite: false }),
        }),
      ),
    [pads, setsPave, setsGravel],
  );
  const rects = pads.map(([cx, cz, w, d], i) => (
    <mesh key={i} rotation-x={-Math.PI / 2} position={[cx, 0.03, cz]} material={rectMats[i]} receiveShadow>
      <planeGeometry args={[w, d]} />
    </mesh>
  ));
  const plazaMat = useMemo(() => parkMaterial(setsPave, (PARK_PLAZA.radius * 2) / 3, { color: new Color("#e9dfd2"), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), [setsPave]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[105, 0, 14]} material={grass} receiveShadow>
        <planeGeometry args={[1700, 1500]} />
      </mesh>
      {rects}
      <mesh rotation-x={-Math.PI / 2} position={[PARK_PLAZA.x, 0.04, PARK_PLAZA.z]} geometry={plazaGeo} material={plazaMat} receiveShadow />
      <mesh rotation-x={-Math.PI / 2} position={[PARK_PLAZA.x, 0.06, PARK_PLAZA.z]} geometry={ring} material={gold} />
      <mesh rotation-x={-Math.PI / 2} position={[PARK_PLAZA.x, 0.06, PARK_PLAZA.z]} geometry={inlay} material={gold} />
      <mesh rotation-x={-Math.PI / 2} position={[COASTER_QUEUE_PAD.x, 0.07, COASTER_QUEUE_PAD.z]} geometry={padRing} material={gold} />
    </group>
  );
}

// ───────────────────────────────────────── the gate arch, the queue hall, the fountain ─────────────────────────────────────────

function GateArch({ all }: { all: Texture[] }) {
  const sign = useMemo(() => gateSignTexture(), []);
  const signMat = useMemo(() => new MeshStandardMaterial({ map: sign, roughness: 0.55, emissive: new Color("#ffffff"), emissiveMap: sign, emissiveIntensity: 0.15 }), [sign]);
  const stone = useMemo(() => parkMaterial(pickSet(all, "Concrete034"), 1, { color: new Color("#efe6d6"), normalScale: 0.6 }), [all]);
  const roof = useMemo(() => parkMaterial(pickSet(all, "RoofingTiles013A"), 1, { color: new Color("#8e94f0"), normalScale: 1.0 }), [all]);
  const starGeo = useMemo(() => {
    const sh = new Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 1.7 : 0.72;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      if (i === 0) sh.moveTo(Math.cos(a) * r, -Math.sin(a) * r);
      else sh.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
    }
    return new ExtrudeGeometry(sh, { depth: 0.4, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
  }, []);
  const gold = useMemo(() => new MeshStandardMaterial({ color: "#f2c14e", emissive: new Color("#6b4a08"), emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.6 }), []);
  const geoStone = useMemo(() => {
    const b = new GeoBuilder();
    for (const tx of [31.25, 48.75]) {
      b.box([tx, 5, -186.5], X, Y, 1.75, 5, 3.5, [1, 1, 1], 3);
      b.box([tx, 10.3, -186.5], X, Y, 2.1, 0.3, 3.8, [0.85, 0.82, 0.78]);
      b.box([tx, 0.25, -186.5], X, Y, 2.0, 0.25, 3.75, [0.7, 0.68, 0.64]);
    }
    b.box([40, 8.6, -186.5], X, Y, 9.5, 1.0, 1.6, [1, 1, 1], 3); // the lintel carrying the sign
    return b.build();
  }, []);
  const roofGeo = useMemo(() => {
    const b = new GeoBuilder();
    for (const tx of [31.25, 48.75]) {
      // a pointed roof on each tower: four stepped boxes
      for (let k = 0; k < 6; k++) b.box([tx, 10.6 + k * 0.7, -186.5], X, Y, 2.0 - k * 0.32, 0.36, 3.6 - k * 0.55, [1, 1, 1], 2);
    }
    return b.build();
  }, []);
  return (
    <group>
      <mesh geometry={geoStone} material={stone} castShadow receiveShadow />
      <mesh geometry={roofGeo} material={roof} castShadow />
      <mesh position={[40, 8.6, -184.85]} rotation={[0, Math.PI, 0]} material={signMat}>
        <planeGeometry args={[14, 3.5]} />
      </mesh>
      <mesh position={[40, 8.6, -188.15]} material={signMat}>
        <planeGeometry args={[14, 3.5]} />
      </mesh>
      <mesh geometry={starGeo} material={gold} position={[40, 11.4, -186.7]} scale={1.2} />
      <mesh position={[PARK_EXIT_PAD.x, 0.05, PARK_EXIT_PAD.z]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[PARK_EXIT_PAD.radius - 0.3, PARK_EXIT_PAD.radius, 40]} />
        <meshStandardMaterial color="#d9a93a" roughness={0.4} metalness={0.5} />
      </mesh>
    </group>
  );
}

function QueueHall({ all, pine }: { all: Texture[]; pine: Texture }) {
  const q = PARK_QUEUE_HALL;
  const cx = (q.minX + q.maxX) / 2;
  const cz = (q.minZ + q.maxZ) / 2;
  const geo = useMemo(() => {
    const b = new GeoBuilder();
    const w = q.maxX - q.minX;
    const d = q.maxZ - q.minZ;
    // the floor slab and the back (south) and side walls, the front open
    b.box([cx, 0.1, cz], X, Y, w / 2, 0.1, d / 2, [0.8, 0.78, 0.74], 3);
    b.box([cx, 2.2, q.maxZ - 0.2], X, Y, w / 2, 2.2, 0.2, [0.95, 0.9, 0.8], 3);
    for (const sx of [-1, 1]) b.box([cx + sx * (w / 2 - 0.2), 2.2, cz + 3], X, Y, 0.2, 2.2, d / 2 - 3, [0.95, 0.9, 0.8], 3);
    // timber posts along the open front and a beam
    for (let x = q.minX + 1; x <= q.maxX - 0.5; x += 4.6) b.cylinder([x, 0.2, q.minZ + 3.2], [x, 4.4, q.minZ + 3.2], 0.2, 0.2, 10, [0.42, 0.28, 0.17]);
    b.box([cx, 4.4, q.minZ + 3.2], X, Y, w / 2, 0.22, 0.26, [0.42, 0.28, 0.17]);
    // the queue's switchback rails: five lanes, 1.1 m high, with posts
    for (let k = 0; k < 5; k++) {
      const z = q.minZ + 7 + k * 4.4;
      const x0 = q.minX + (k % 2 === 0 ? 2 : 6);
      const x1 = q.maxX - (k % 2 === 0 ? 6 : 2);
      b.box([(x0 + x1) / 2, 1.05, z], X, Y, (x1 - x0) / 2, 0.04, 0.04, [0.9, 0.9, 0.94]);
      b.box([(x0 + x1) / 2, 0.55, z], X, Y, (x1 - x0) / 2, 0.03, 0.03, [0.9, 0.9, 0.94]);
      for (let x = x0; x <= x1; x += 3) b.cylinder([x, 0.1, z], [x, 1.1, z], 0.04, 0.04, 6, [0.9, 0.9, 0.94]);
    }
    // a name board over the entrance
    b.box([cx, 4.0, q.minZ + 3.0], X, Y, 5, 0.6, 0.08, [0.16, 0.18, 0.62]);
    return b.build();
  }, [q, cx, cz]);
  const { roofGeo, trimGeo } = useMemo(() => {
    const roof = new GeoBuilder();
    const trim = new GeoBuilder();
    const w = q.maxX - q.minX;
    const d = q.maxZ - q.minZ;
    // a hip-less gable: the ridge runs along x; each side slopes down to eaves that overhang the posts by 1.4 m (shingle slabs, a ridge cap,
    // timber fascia boards, visible rafters under the eaves)
    const alpha = 0.34;
    const ca = Math.cos(alpha);
    const sa = Math.sin(alpha);
    const eaveY = 4.75;
    const half = d / 2 + 1.5;
    const rise = half * Math.tan(alpha);
    const L = half / ca / 2 + 0.1;
    for (const sgn of [-1, 1]) {
      // the slab's middle is half way from the ridge to the eave; its normal tilts away from the ridge
      roof.box([cx, eaveY + rise / 2 + 0.05, cz + (sgn * half) / 2], X, [0, ca, sgn * sa], w / 2 + 1.5, 0.12, L, [1, 1, 1], 2.4);
      // the fascia board along the eave and a drip edge
      trim.box([cx, eaveY - 0.02, cz + sgn * half], X, Y, w / 2 + 1.5, 0.17, 0.05, [0.4, 0.26, 0.16]);
      // rafters: a rafter every 2.3 m, running up the slope under the slab
      for (let x = q.minX - 1; x <= q.maxX + 1.01; x += 2.3) trim.box([x, eaveY + rise / 2 - 0.14, cz + (sgn * half) / 2], [1, 0, 0], [0, ca, sgn * sa], 0.07, 0.1, L - 0.1, [0.42, 0.28, 0.17]);
    }
    trim.box([cx, eaveY + rise + 0.2, cz], X, Y, w / 2 + 1.5, 0.14, 0.45, [0.55, 0.27, 0.22]);
    // gable end boards
    for (const e of [-1, 1]) {
      for (let k = 0; k < 6; k++) trim.box([cx + e * (w / 2 + 1.4), eaveY + (k * rise) / 6 + rise / 12, cz], X, Y, 0.06, rise / 12, half * (1 - (k + 0.5) / 6), [0.4, 0.26, 0.16]);
    }
    return { roofGeo: roof.build(), trimGeo: trim.build() };
  }, [q, cx, cz]);
  const wall = useMemo(() => {
    const t = pine.clone();
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    return new MeshStandardMaterial({ map: t, vertexColors: true, roughness: 0.8 });
  }, [pine]);
  const roof = useMemo(() => parkMaterial(pickSet(all, "RoofingTiles013A"), 1, { color: new Color(1.9, 1.35, 1.1), normalScale: 1.2 }), [all]);
  const trimMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), []);
  return (
    <group>
      <mesh geometry={geo} material={wall} castShadow receiveShadow />
      <mesh geometry={roofGeo} material={roof} castShadow receiveShadow />
      <mesh geometry={trimGeo} material={trimMat} castShadow />
      <mesh position={[PARK_PLATFORM.minX, 0, 0]} visible={false} />
    </group>
  );
}

function Fountain({ all }: { all: Texture[] }) {
  const stone = useMemo(() => parkMaterial(pickSet(all, "Concrete034"), 1, { color: new Color("#eee6d8"), normalScale: 0.5 }), [all]);
  const water = useMemo(() => new MeshStandardMaterial({ color: "#6ab4d8", roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.82 }), []);
  const gold = useMemo(() => new MeshStandardMaterial({ color: "#f2c14e", emissive: new Color("#6b4a08"), emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.6 }), []);
  const starGeo = useMemo(() => {
    const sh = new Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 1.3 : 0.55;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      if (i === 0) sh.moveTo(Math.cos(a) * r, -Math.sin(a) * r);
      else sh.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
    }
    return new ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
  }, []);
  const jets = useMemo(() => Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2), []);
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 0.4;
  });
  const { x, z } = PARK_PLAZA;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.45, 0]} material={stone} castShadow receiveShadow><cylinderGeometry args={[4.4, 4.6, 0.9, 40]} /></mesh>
      <mesh position={[0, 0.92, 0]} material={water}><cylinderGeometry args={[4.0, 4.0, 0.08, 40]} /></mesh>
      <mesh position={[0, 1.6, 0]} material={stone} castShadow><cylinderGeometry args={[0.55, 0.8, 1.4, 20]} /></mesh>
      <mesh position={[0, 2.5, 0]} material={stone} castShadow><cylinderGeometry args={[1.6, 0.6, 0.35, 28]} /></mesh>
      <mesh position={[0, 2.75, 0]} material={water}><cylinderGeometry args={[1.45, 1.45, 0.06, 28]} /></mesh>
      <mesh position={[0, 3.6, 0]} material={stone} castShadow><cylinderGeometry args={[0.22, 0.4, 1.8, 14]} /></mesh>
      <mesh ref={ref} position={[0, 5.1, 0]} geometry={starGeo} material={gold} />
      {jets.map((a, i) => (
        <mesh key={i} position={[Math.cos(a) * 2.2, 1.7, Math.sin(a) * 2.2]} rotation={[Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]} material={water}>
          <cylinderGeometry args={[0.03, 0.06, 1.4, 6]} />
        </mesh>
      ))}
    </group>
  );
}

// ───────────────────────────────────────── trees, lamps, flowers, benches ─────────────────────────────────────────

function Lamps() {
  const post = useRef<InstancedMesh>(null);
  const bulb = useRef<InstancedMesh>(null);
  const postGeo = useMemo(() => new CylinderGeometry(0.07, 0.11, 4.2, 8), []);
  const bulbGeo = useMemo(() => new SphereGeometry(0.28, 10, 8), []);
  const postMat = useMemo(() => new MeshStandardMaterial({ color: "#2a2d4a", roughness: 0.4, metalness: 0.4 }), []);
  const bulbMat = useMemo(() => new MeshStandardMaterial({ color: "#fff2c6", emissive: new Color("#ffd98a"), emissiveIntensity: 1.2, roughness: 0.3 }), []);
  useEffect(() => {
    const m = new Matrix4();
    PARK_LAMPS.forEach((l, i) => {
      m.makeTranslation(l.x, 2.1, l.z);
      post.current?.setMatrixAt(i, m);
      m.makeTranslation(l.x, 4.45, l.z);
      bulb.current?.setMatrixAt(i, m);
    });
    if (post.current) post.current.instanceMatrix.needsUpdate = true;
    if (bulb.current) bulb.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <group>
      <instancedMesh frustumCulled={false} ref={post} args={[postGeo, postMat, PARK_LAMPS.length]} castShadow />
      <instancedMesh frustumCulled={false} ref={bulb} args={[bulbGeo, bulbMat, PARK_LAMPS.length]} />
    </group>
  );
}

/** Flower beds ring the fountain and line the promenade; park benches stand along the paths (decor: no seat ids yet). */
function Beds({ pine }: { pine: Texture }) {
  const bedGeo = useMemo(() => {
    const b = new GeoBuilder();
    // the flower troughs round the fountain (stone, with a cap course; the flowers and soil are the village flower system's)
    for (const t of PARK_TROUGHS) {
      const cx = (t.x0 + t.x1) / 2;
      const cz = (t.z0 + t.z1) / 2;
      b.box([cx, 0.4, cz], X, Y, (t.x1 - t.x0) / 2, 0.4, (t.z1 - t.z0) / 2, [0.78, 0.76, 0.72], 2);
      b.box([cx, 0.82, cz], X, Y, (t.x1 - t.x0) / 2 + 0.07, 0.04, (t.z1 - t.z0) / 2 + 0.07, [0.86, 0.84, 0.8]);
    }
    // hedges lining the promenade's two sides
    for (const hx of [28.6, 51.4]) b.box([hx, 0.55, -150], X, Y, 0.6, 0.55, 28, [0.2, 0.42, 0.22]);
    // benches (a seat plank, a back, two legs) along the avenue and the promenade
    const bench = (x: number, z: number, face: number) => {
      b.box([x, 0.5, z], X, Y, 0.35, 0.05, 1.0, [0.72, 0.5, 0.3]);
      b.box([x + face * 0.3, 0.85, z], X, Y, 0.05, 0.3, 1.0, [0.72, 0.5, 0.3]);
      for (const dz of [-0.8, 0.8]) b.box([x, 0.25, z + dz], X, Y, 0.3, 0.25, 0.05, [0.15, 0.16, 0.22]);
    };
    for (let z = -170; z <= -140; z += 10) {
      bench(34, z, -1);
      bench(46, z, 1);
    }
    for (let x = 90; x <= 330; x += 30) bench(x, -108.2, 1);
    return b.build();
  }, []);
  const benchMat = useMemo(() => {
    const t = pine.clone();
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    return new MeshStandardMaterial({ map: t, vertexColors: true, roughness: 0.75 });
  }, [pine]);
  return (
    <group>
      <mesh geometry={bedGeo} material={benchMat} castShadow receiveShadow />
    </group>
  );
}

// ───────────────────────────────────────── the park ─────────────────────────────────────────

/** A PMREM of a bright sky (with a sun) for the clear-coat and the painted steel: the park has no environment map of its own. */
function useSkyEnv(): Texture {
  const gl = useThree((st) => st.gl);
  return useMemo(() => {
    const sc = new Scene();
    const sky = new Mesh(new SphereGeometry(100, 32, 16), new MeshBasicMaterial({ vertexColors: true, side: BackSide, toneMapped: false }));
    const g = sky.geometry;
    const pos = g.attributes.position!;
    const col = new Float32Array(pos.count * 3);
    const hz = new Color("#f2f6fa");
    const zen = new Color("#5d98de");
    const gnd = new Color("#5a7a45");
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / 100;
      if (h >= 0) c.copy(hz).lerp(zen, Math.pow(h, 0.5));
      else c.copy(hz).lerp(gnd, Math.min(1, -h * 3));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    sc.add(sky);
    const sun = new Mesh(new SphereGeometry(9, 12, 8), new MeshBasicMaterial({ color: new Color(14, 12, 9), toneMapped: false }));
    sun.position.set(45, 70, 35);
    sc.add(sun);
    const pm = new PMREMGenerator(gl);
    const rt = pm.fromScene(sc, 0.03);
    pm.dispose();
    return rt.texture;
  }, [gl]);
}

/** Everything of 케이슨랜드 that stands in the park area (park-local metres). */
export function ParkWorld({ tier }: { tier: VillageTier }) {
  const all = useTexture(ALL_PARK_URLS) as Texture[];
  const [pine] = useTexture([PINE_URL]) as Texture[];
  const env = useSkyEnv();
  return (
    <group>
      <ParkSky />
      <Ground all={all} />
      <Shops all={all} />
      <GateArch all={all} />
      <QueueHall all={all} pine={pine!} />
      <Fountain all={all} />
      <ParkVegetation />
      <Lamps />
      <Beds pine={pine!} />
      <ParkProps all={all} />
      <ParkScenery all={all} />
      <Suspense fallback={null}>
        <ParkMountains tier={tier === "high" ? "high" : "low"} />
      </Suspense>
      <CoasterWorld all={all} pine={pine!} env={env} />
      <CarouselWorld env={env} all={all} />
      <WheelWorld env={env} />
    </group>
  );
}
