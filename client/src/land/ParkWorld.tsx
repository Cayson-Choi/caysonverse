import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  BackSide,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  Scene,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  type BufferGeometry,
} from "three";
import {
  COASTER_QUEUE_PAD,
  PARK_EXIT_PAD,
  PARK_LAMPS,
  PARK_PLATFORM,
  PARK_PLAZA,
  PARK_QUEUE_HALL,
  PARK_TREES,
} from "@caysonverse/shared/village/parkArea";
import { isTouchDevice } from "../device";
import { CoasterWorld } from "./CoasterWorld";
import { Shops } from "./ParkShops";
import { ParkMountains, ParkScenery } from "./ParkScenery";
import { ParkProps } from "./ParkProps";
import { GeoBuilder, type V3 } from "./geoBuilder";
import { gateSignTexture } from "./canvasTextures";
import { ALL_PARK_URLS, parkMaterial, pickSet } from "./pbr";

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
  for (let i = 0; i < 160; i++) {
    const x = rnd() * 512;
    const y = rnd() * 256;
    const r = 14 + rnd() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = rnd() < 0.5 ? 70 : 200;
    g.addColorStop(0, `rgba(${v},${v},${v},0.32)`);
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
    const m = parkMaterial(pickSet(all, "Grass001"), 1, { color: new Color("#d4e2bc"), normalScale: 0.9 });
    setRepeat(m, 700 / 3.5, 620 / 3.5);
    // the CC0 grass albedo is dark: lift it with a little of its own colour as emission
    m.emissiveMap = m.map;
    m.emissive = new Color(0.42, 0.46, 0.36);
    // broad light and dark patches (a mown-and-wild mottle) so the lawn is not one flat green at a distance
    m.lightMap = macroTexture();
    m.lightMapIntensity = 1.6;
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
        parkMaterial(k === "p" ? setsPave : setsGravel, [w / 3, d / 3], { color: new Color(k === "p" ? "#e9dfd2" : "#d9cdb8"), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
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
        <planeGeometry args={[700, 620]} />
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
  const roofGeo = useMemo(() => {
    const b = new GeoBuilder();
    const w = q.maxX - q.minX;
    const d = q.maxZ - q.minZ;
    const alpha = 0.32;
    for (const sgn of [-1, 1]) {
      b.box([cx, 5.4 + 0.5, cz + (sgn * (d / 4 - 0.5)) / 1], X, [0, Math.cos(alpha), -sgn * Math.sin(alpha)], w / 2 + 0.6, 0.12, d / 4 + 1.4, [1, 1, 1], 2.4);
    }
    return b.build();
  }, [q, cx, cz]);
  const wall = useMemo(() => {
    const t = pine.clone();
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    return new MeshStandardMaterial({ map: t, vertexColors: true, roughness: 0.8 });
  }, [pine]);
  const roof = useMemo(() => parkMaterial(pickSet(all, "RoofingTiles013A"), 1, { color: new Color("#8e94f0"), normalScale: 1 }), [all]);
  return (
    <group>
      <mesh geometry={geo} material={wall} castShadow receiveShadow />
      <mesh geometry={roofGeo} material={roof} castShadow receiveShadow />
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

function Trees() {
  const trunk = useRef<InstancedMesh>(null);
  const canopies = [useRef<InstancedMesh>(null), useRef<InstancedMesh>(null), useRef<InstancedMesh>(null)];
  const trunkGeo = useMemo(() => new CylinderGeometry(0.16, 0.3, 3.2, 7), []);
  const geos = useMemo<BufferGeometry[]>(() => {
    const blob = (r: number, x: number, y: number, z: number): BufferGeometry => {
      const g = new IcosahedronGeometry(r, 1);
      g.translate(x, y, z);
      return g;
    };
    if (isTouchDevice) {
      // phones: one blob or one cone a tree
      return [blob(2.1, 0, 0, 0), new CylinderGeometry(0.01, 1.9, 5.2, 7).translate(0, 0.9, 0).toNonIndexed(), blob(1.7, 0, 0, 0)];
    }
    const round = mergeGeometries([blob(1.7, 0, 0, 0), blob(1.3, 1.2, -0.5, 0.4), blob(1.35, -1.1, -0.4, -0.5), blob(1.1, 0.2, 1.1, -0.2), blob(1.0, -0.3, -0.7, 1.2)])!;
    const fir = mergeGeometries([new CylinderGeometry(0.01, 1.9, 2.4, 9).translate(0, 1.9, 0), new CylinderGeometry(0.01, 1.5, 2.2, 9).translate(0, 3.3, 0), new CylinderGeometry(0.01, 1.1, 2.0, 9).translate(0, 4.6, 0)].map((g) => g.toNonIndexed()))!;
    const bushy = mergeGeometries([blob(1.5, 0, 0, 0), blob(1.2, 1.0, 0.2, 0.3), blob(1.2, -0.9, 0.1, -0.4)])!;
    return [round, fir, bushy];
  }, []);
  const trunkMat = useMemo(() => new MeshStandardMaterial({ color: "#5a4030", roughness: 0.95 }), []);
  const leafMat = useMemo(() => new MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 }), []);
  useEffect(() => {
    const m = new Matrix4();
    const q = new Quaternion();
    const counts = [0, 0, 0];
    const col = new Color();
    PARK_TREES.forEach((t, i) => {
      m.compose(new Vector3(t.x, 1.6 * t.s, t.z), q.identity(), new Vector3(t.s, t.s, t.s));
      trunk.current?.setMatrixAt(i, m);
      const k = t.kind;
      const y = k === 1 ? 0.6 * t.s : k === 0 ? 4.4 * t.s : 3.6 * t.s;
      m.compose(new Vector3(t.x, y, t.z), q.identity(), new Vector3(t.s, k === 0 ? t.s * 0.9 : t.s, t.s));
      const ref = canopies[k]!.current;
      if (ref) {
        ref.setMatrixAt(counts[k]!, m);
        col.setHSL(0.24 + ((t.x * 7 + t.z * 3) % 10) / 120, 0.4 + (k === 1 ? 0.1 : 0), 0.3 + (((t.x + t.z) % 7) / 70));
        ref.setColorAt(counts[k]!, col);
        counts[k]!++;
      }
    });
    for (let k = 0; k < 3; k++) {
      const ref = canopies[k]!.current;
      if (ref) {
        ref.count = counts[k]!;
        ref.instanceMatrix.needsUpdate = true;
        if (ref.instanceColor) ref.instanceColor.needsUpdate = true;
      }
    }
    if (trunk.current) trunk.current.instanceMatrix.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <group>
      <instancedMesh frustumCulled={false} ref={trunk} args={[trunkGeo, trunkMat, PARK_TREES.length]} castShadow />
      {geos.map((g, k) => (
        <instancedMesh frustumCulled={false} key={k} ref={canopies[k]} args={[g, leafMat, PARK_TREES.length]} castShadow receiveShadow />
      ))}
    </group>
  );
}

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
  const flowers = useRef<InstancedMesh>(null);
  const geo = useMemo(() => new SphereGeometry(0.13, 6, 4), []);
  const mat = useMemo(() => new MeshStandardMaterial({ color: "#ffffff", roughness: 0.7 }), []);
  const bedGeo = useMemo(() => {
    const b = new GeoBuilder();
    const ring = PARK_PLAZA.radius - 8;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      b.box([PARK_PLAZA.x + nx * ring, 0.25, PARK_PLAZA.z + nz * ring], [-nz, 0, nx], Y, 1.5, 0.25, 0.9, [0.78, 0.76, 0.72]);
      b.box([PARK_PLAZA.x + nx * ring, 0.4, PARK_PLAZA.z + nz * ring], [-nz, 0, nx], Y, 1.35, 0.1, 0.75, [0.3, 0.2, 0.14]);
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
  const N = 600;
  useEffect(() => {
    const m = new Matrix4();
    const col = new Color();
    const palette = ["#ff8fb1", "#ffd45c", "#b99cff", "#ffffff", "#ff9a5c", "#8fd0ff"];
    const ring = PARK_PLAZA.radius - 8;
    let n = 0;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      for (let k = 0; k < 25 && n < N; k++, n++) {
        const lx = -1.2 + (k % 5) * 0.6;
        const lz = -0.6 + Math.floor(k / 5) * 0.3;
        const x = PARK_PLAZA.x + Math.cos(a) * (ring + lz) - Math.sin(a) * lx;
        const z = PARK_PLAZA.z + Math.sin(a) * (ring + lz) + Math.cos(a) * lx;
        m.makeTranslation(x, 0.6, z);
        flowers.current?.setMatrixAt(n, m);
        col.set(palette[(i + k) % palette.length]!);
        flowers.current?.setColorAt(n, col);
      }
    }
    if (flowers.current) {
      flowers.current.count = n;
      flowers.current.instanceMatrix.needsUpdate = true;
      if (flowers.current.instanceColor) flowers.current.instanceColor.needsUpdate = true;
    }
  }, []);
  return (
    <group>
      <mesh geometry={bedGeo} material={benchMat} castShadow receiveShadow />
      <instancedMesh frustumCulled={false} ref={flowers} args={[geo, mat, N]} />
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
export function ParkWorld({ tier = "high" }: { tier?: "high" | "low" }) {
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
      <Trees />
      <Lamps />
      <Beds pine={pine!} />
      <ParkProps all={all} />
      <ParkScenery all={all} />
      <Suspense fallback={null}>
        <ParkMountains tier={tier} />
      </Suspense>
      <CoasterWorld all={all} pine={pine!} env={env} />
    </group>
  );
}
