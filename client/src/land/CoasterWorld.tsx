import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import {
  BackSide,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  SphereGeometry,
  Vector3,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  type BufferGeometry,
} from "three";
import { COASTER_CARS, carArc, coasterTrack, emptyFrame, frameAt, STATION_Y } from "@caysonverse/shared/land/coaster";
import { isTouchDevice } from "../device";
import { buildCar, buildTrack, type TrackBuild } from "./coasterGeometry";
import { coasterNow } from "./coasterRide";
import { COASTER_SITE } from "./site";

const WOOD_URL = (isTouchDevice ? "/textures/houses/lo/" : "/textures/houses/hi/") + "T_h_wood_pine.webp";
const STONE_URL = (isTouchDevice ? "/textures/houses/lo/" : "/textures/houses/hi/") + "T_h_stone.webp";

/** A mottled grass tile (canvas, tileable): placeholder for a photo grass set (DESIGN.md §8). */
function grassTexture(): CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#7da552";
  ctx.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const l = 40 + rnd() * 30;
    ctx.fillStyle = `hsla(${88 + rnd() * 24}, ${38 + rnd() * 22}%, ${l}%, ${0.18 + rnd() * 0.25})`;
    const w = 2 + rnd() * 5;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) ctx.fillRect(x + ox, y + oy, w, w * (0.6 + rnd()));
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The station's name board: "별똥별 급행" under a gold star, on an indigo board (canvas). */
function signTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const grd = ctx.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#3a3fb8");
  grd.addColorStop(1, "#2a2d86");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, 996, 228);
  // a five-point star
  ctx.fillStyle = "#f2c14e";
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 62 : 26;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(150 + Math.cos(a) * r, 128 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f3efea";
  ctx.font = "bold 110px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("별똥별 급행", 250, 112);
  ctx.font = "44px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#f2c14e";
  ctx.fillText("케이슨랜드  ·  SHOOTING STAR EXPRESS", 252, 205);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function woodMaterial(map: Texture, repeat: number, color = "#ffffff"): MeshStandardMaterial {
  const t = map.clone();
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return new MeshStandardMaterial({ map: t, roughness: 0.78, metalness: 0, color: new Color(color) });
}

const SITE_POS: [number, number, number] = [COASTER_SITE.x, 0, COASTER_SITE.z];

/** The cars: one InstancedMesh, its matrices set from the train's place on the shared clock every frame. */
function Train({ geometry, material }: { geometry: BufferGeometry; material: MeshStandardMaterial }) {
  const ref = useRef<InstancedMesh>(null);
  const m = useMemo(() => new Matrix4(), []);
  const f = useMemo(() => emptyFrame(), []);
  const track = useMemo(() => coasterTrack(), []);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const now = coasterNow();
    for (let i = 0; i < COASTER_CARS; i++) {
      frameAt(track, carArc(now.s, i), f);
      // car space: +x is the car's LEFT (a right-handed basis: left x up = forward), +z forward
      m.set(-f.rx, f.ux, f.tx, f.x, -f.ry, f.uy, f.ty, f.y, -f.rz, f.uz, f.tz, f.z, 0, 0, 0, 1);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geometry, material, COASTER_CARS]} frustumCulled={false} castShadow receiveShadow />;
}

/** The station: a timber platform on the train's right, a canopy, posts, the name board and the entry and exit gates. */
function Station({ wood, stone }: { wood: Texture; stone: Texture }) {
  const deck = useMemo(() => woodMaterial(wood, 1, "#e6d3b5"), [wood]);
  const post = useMemo(() => new MeshStandardMaterial({ color: "#eee7d8", roughness: 0.55, metalness: 0.15 }), []);
  const roof = useMemo(() => new MeshStandardMaterial({ color: "#5b60d4", emissive: new Color("#262a78"), emissiveIntensity: 0.55, roughness: 0.55, metalness: 0.2, side: DoubleSide }), []);
  const base = useMemo(() => woodMaterial(stone, 6, "#d8d2c8"), [stone]);
  const sign = useMemo(() => signTexture(), []);
  const signMat = useMemo(() => new MeshStandardMaterial({ map: sign, roughness: 0.6, emissive: new Color("#ffffff"), emissiveMap: sign, emissiveIntensity: 0.18 }), [sign]);
  const rail = useMemo(() => new MeshStandardMaterial({ color: "#c9ccd6", roughness: 0.4, metalness: 0.1 }), []);
  const cx = 2; // the station's middle along the track
  const deckTop = STATION_Y + 0.2;
  return (
    <group>
      {/* a stone plinth under the track and the timber platform on its right (+z) */}
      <mesh position={[cx, 0.5, 0]} material={base} castShadow receiveShadow>
        <boxGeometry args={[34, 1.0, 2.2]} />
      </mesh>
      <mesh position={[cx, deckTop / 2, 4.1]} material={base} castShadow receiveShadow>
        <boxGeometry args={[34, deckTop, 5.4]} />
      </mesh>
      <mesh position={[cx, deckTop + 0.04, 4.1]} material={deck} castShadow receiveShadow>
        <boxGeometry args={[34.2, 0.08, 5.6]} />
      </mesh>
      {/* the canopy: posts and a shallow gable roof, indigo, with a gold ridge */}
      {[-14, -7, 0, 7, 14, 18].map((x) =>
        [1.6, 6.4].map((z) => (
          <mesh key={`${x}_${z}`} position={[cx + x - 1, deckTop + 2.6, z]} material={post} castShadow>
            <cylinderGeometry args={[0.13, 0.15, 5.2, 8]} />
          </mesh>
        )),
      )}
      <mesh position={[cx, deckTop + 5.4, 2.8]} rotation={[0, 0, 0.0]} material={roof} castShadow>
        <boxGeometry args={[36, 0.18, 8.2]} />
      </mesh>
      <mesh position={[cx, deckTop + 5.62, 2.8]} material={roof} castShadow>
        <boxGeometry args={[36.4, 0.1, 1.0]} />
      </mesh>
      {/* the name board hangs from the canopy's front edge, facing the platform */}
      <mesh position={[cx - 1, deckTop + 4.6, 6.62]} material={signMat}>
        <planeGeometry args={[9, 2.25]} />
      </mesh>
      {/* the platform edge safety rail on the track side, with gaps at the doors (every other 3 m) */}
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh key={i} position={[cx - 14 + i * 4.2 + 1, deckTop + 0.55, 1.55]} material={rail} castShadow>
          <boxGeometry args={[2.6, 0.06, 0.06]} />
        </mesh>
      ))}
    </group>
  );
}

/** A plain daytime sky (a vertex-coloured dome that rides with the camera): the sandbox has no village model to bring one. */
function ParkSky() {
  const ref = useRef<Mesh>(null);
  const geo = useMemo(() => {
    const g = new SphereGeometry(1450, 24, 16);
    const pos = g.attributes.position!;
    const col = new Float32Array(pos.count * 3);
    const hz = new Color("#e4eef6");
    const zen = new Color("#6aa3dc");
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const h = Math.max(0, pos.getY(i) / 1450);
      c.copy(hz).lerp(zen, Math.pow(h, 0.55));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    return g;
  }, []);
  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position).sub(new Vector3(SITE_POS[0], 0, SITE_POS[2]));
  });
  return (
    <mesh ref={ref} geometry={geo} renderOrder={-10} frustumCulled={false}>
      <meshBasicMaterial vertexColors side={BackSide} depthWrite={false} fog={false} toneMapped={false} />
    </mesh>
  );
}

export function CoasterWorld() {
  const [wood, stone] = useTexture([WOOD_URL, STONE_URL]);
  const track = useMemo(() => coasterTrack(), []);
  const built: TrackBuild = useMemo(() => buildTrack(track), [track]);
  const car = useMemo(() => buildCar(), []);
  const steelMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.08 }), []);
  const tieMat = useMemo(() => woodMaterial(wood, 1, "#cdb596"), [wood]);
  const carMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.08 }), []);
  const grass = useMemo(() => {
    const t = grassTexture();
    t.repeat.set(520, 520);
    return t;
  }, []);
  const groundMat = useMemo(() => new MeshStandardMaterial({ map: grass, roughness: 1, metalness: 0, color: new Color("#cfdcb8"), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), [grass]);
  useEffect(
    () => () => {
      for (const ch of built.chunks) {
        ch.steel.dispose();
        ch.wood.dispose();
      }
      car.dispose();
      steelMat.dispose();
      tieMat.dispose();
      carMat.dispose();
      groundMat.dispose();
      grass.dispose();
    },
    [built, car, steelMat, tieMat, carMat, groundMat, grass],
  );
  if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __cvCoasterTris?: number }).__cvCoasterTris = built.triangles;
  return (
    <group position={SITE_POS}>
      {/* the park's lawn under the whole circuit */}
      <mesh rotation-x={-Math.PI / 2} position={[100 - SITE_POS[0], 0.04, 35 - SITE_POS[2]]} material={groundMat} receiveShadow>
        <planeGeometry args={[2600, 2600]} />
      </mesh>
      <ParkSky />
      {built.chunks.map((ch, i) => (
        <group key={i}>
          <mesh geometry={ch.steel} material={steelMat} castShadow receiveShadow />
          <mesh geometry={ch.wood} material={tieMat} castShadow receiveShadow />
        </group>
      ))}
      <Train geometry={car} material={carMat} />
      <Station wood={wood} stone={stone} />
    </group>
  );
}
