import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import { BufferGeometry, Color, DoubleSide, Mesh, Group, InstancedMesh, Matrix4, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector2, type Texture } from "three";
import { COASTER_CARS, carArc, coasterTrack, emptyFrame, frameAt, STATION_Y } from "@caysonverse/shared/land/coaster";
import { isTouchDevice } from "../device";
import { buildTrack, type TrackBuild, type TrackDetail } from "./coasterGeometry";
import { coasterNow } from "./coasterRide";
import { parkMaterial, pickSet } from "./pbr";
import { applyFarSteel, farSteelUniform } from "./farSteel";
import { signTexture } from "./canvasTextures";
import { GeoBuilder, type V3 } from "./geoBuilder";

const DETAIL: TrackDetail = isTouchDevice ? "light" : "full";

/** The car parts a phone drops for far cars (by material name in the car GLB), and how near (m) a car must be to keep them. */
const CAR_SMALL_PARTS: ReadonlySet<string> = new Set(["car_rubber", "car_dark", "car_chrome", "car_pad"]);
const CAR_DETAIL_M = 70;

export const CAR_URL = "/models/land/coaster_car.glb";
export const CAR_AO_URL = "/models/land/coaster_car_ao.webp";

/**
 * The cars: the Blender model (tools/land/make_coaster_car.py), one InstancedMesh per material (paint, gold, white, chrome, pad, dark, rubber),
 * the matrices set from the train's place on the shared clock every frame. The baked AO and the sky's environment map go on every material.
 */
function Train({ env, ao }: { env: Texture; ao: Texture }) {
  const gltf = useGLTF(CAR_URL);
  const parts = useMemo(() => {
    const out: { geometry: BufferGeometry; material: MeshStandardMaterial }[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const material = (mesh.material as MeshStandardMaterial).clone();
      material.aoMap = ao;
      material.aoMapIntensity = 0.4;
      material.envMap = env;
      material.envMapIntensity = material.name === "car_paint" ? 1.3 : material.name === "car_pad" ? 0.35 : 0.9;
      material.needsUpdate = true;
      out.push({ geometry: mesh.geometry, material });
    });
    return out;
  }, [gltf, env, ao]);
  const refs = useRef<(InstancedMesh | null)[]>([]);
  const m = useMemo(() => new Matrix4(), []);
  const f = useMemo(() => emptyFrame(), []);
  const track = useMemo(() => coasterTrack(), []);
  // a phone draws a car's small parts (wheels, undercarriage, chrome, pads: ~45 of its ~60 k triangles for the train) only for the cars within
  // CAR_DETAIL_M of the camera: the wheel's top sees the whole park, where they are specks. The first nNear instances of those meshes are drawn.
  const small = useMemo(() => parts.map((p) => CAR_SMALL_PARTS.has(p.material.name)), [parts]);
  useFrame(({ camera }) => {
    const now = coasterNow();
    let nNear = 0;
    for (let i = 0; i < COASTER_CARS; i++) {
      frameAt(track, carArc(now.s, i), f);
      // car space: +x is the car's LEFT (a right-handed basis: left x up = forward), +z forward
      m.set(-f.rx, f.ux, f.tx, f.x, -f.ry, f.uy, f.ty, f.y, -f.rz, f.uz, f.tz, f.z, 0, 0, 0, 1);
      const near = !isTouchDevice || Math.hypot(f.x - camera.position.x, f.y - camera.position.y, f.z - camera.position.z) < CAR_DETAIL_M;
      refs.current.forEach((mesh, k) => {
        if (!mesh) return;
        if (!small[k]) mesh.setMatrixAt(i, m);
        else if (near) mesh.setMatrixAt(nNear, m);
      });
      if (near) nNear++;
    }
    refs.current.forEach((mesh, k) => {
      if (!mesh) return;
      if (small[k]) mesh.count = nNear;
      mesh.instanceMatrix.needsUpdate = true;
    });
  });
  return (
    <group>
      {parts.map((p, i) => (
        <instancedMesh key={i} ref={(r) => { refs.current[i] = r; }} args={[p.geometry, p.material, COASTER_CARS]} frustumCulled={false} castShadow receiveShadow />
      ))}
    </group>
  );
}

/** The boarding gates along the platform edge: panels that swing open while the train stands at the station and shut for the ride. */
function BoardingGates({ cx, z, y }: { cx: number; z: number; y: number }) {
  const refs = useRef<(Group | null)[]>([]);
  const mat = useMemo(() => new MeshPhysicalMaterial({ color: "#f3efea", roughness: 0.35, metalness: 0.2, clearcoat: 0.6 }), []);
  const bar = useMemo(() => new MeshPhysicalMaterial({ color: "#4b4fd8", roughness: 0.4, metalness: 0.2, clearcoat: 0.6 }), []);
  const open = useRef(0);
  useFrame((_, dt) => {
    const st = coasterNow().status;
    const want = st === "unloading" || st === "boarding" ? 1 : 0;
    open.current += (want - open.current) * (1 - Math.exp(-dt * 3));
    for (const g of refs.current) if (g) g.rotation.y = open.current * (Math.PI * 0.5);
  });
  const xs = Array.from({ length: 8 }, (_, i) => cx - 14 + i * 4.2 + 0.4);
  return (
    <group>
      {xs.map((x, i) => (
        <group key={i} ref={(g) => { refs.current[i] = g; }} position={[x, y, z]}>
          {/* the panel hangs from a hinge at its west edge: a top rail, a mid rail, a kick plate and a post */}
          <mesh position={[1.4, 0.95, 0]} material={mat} castShadow><boxGeometry args={[2.8, 0.07, 0.07]} /></mesh>
          <mesh position={[1.4, 0.55, 0]} material={mat} castShadow><boxGeometry args={[2.8, 0.05, 0.05]} /></mesh>
          <mesh position={[1.4, 0.18, 0]} material={bar} castShadow><boxGeometry args={[2.8, 0.3, 0.03]} /></mesh>
          <mesh position={[0, 0.5, 0]} material={mat} castShadow><cylinderGeometry args={[0.06, 0.06, 1.0, 8]} /></mesh>
          <mesh position={[2.8, 0.5, 0]} material={mat} castShadow><cylinderGeometry args={[0.05, 0.05, 1.0, 8]} /></mesh>
        </group>
      ))}
    </group>
  );
}

/** The station: a timber platform on the train's LEFT (-z, the steps' side), a canopy, posts, the name board and the boarding gates. */
function Station({ concrete, paving, pine }: { concrete: ReturnType<typeof pickSet>; paving: ReturnType<typeof pickSet>; pine: Texture }) {
  const deck = useMemo(() => {
    const t = pine.clone();
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return new MeshStandardMaterial({ map: t, roughness: 0.78, color: new Color("#e6d3b5") });
  }, [pine]);
  const base = useMemo(() => parkMaterial(concrete, 1, { vertexColors: true, color: new Color(1.4, 1.35, 1.25), normalScale: 0.7 }), [concrete]);
  // the platform's two stone-faced walls (the track side and the steps' side), built with metre UVs so the concrete keeps its grain
  // at every size (a stretched unit-box UV smeared it), with a plinth, a cap course and a yellow edge strip
  const baseGeo = useMemo(() => {
    const b = new GeoBuilder();
    const X: V3 = [1, 0, 0];
    const Y: V3 = [0, 1, 0];
    const top = STATION_Y + 0.2;
    b.box([2, 0.5, 0], X, Y, 17, 0.5, 1.1, [0.86, 0.83, 0.78], 2);
    b.box([2, 0.06, 0], X, Y, 17.08, 0.06, 1.18, [0.62, 0.6, 0.56], 2);
    b.box([2, 1.02, 0], X, Y, 17.08, 0.04, 1.16, [0.96, 0.94, 0.9], 2);
    b.box([2, top / 2, -4.1], X, Y, 17, top / 2, 2.7, [0.86, 0.83, 0.78], 2);
    b.box([2, 0.08, -4.1], X, Y, 17.08, 0.08, 2.78, [0.62, 0.6, 0.56], 2);
    b.box([2, top - 0.04, -4.1], X, Y, 17.08, 0.04, 2.76, [0.96, 0.94, 0.9], 2);
    b.box([2, top + 0.005, -1.45], X, Y, 17, 0.012, 0.12, [0.95, 0.78, 0.2], 1);
    // the north steps (the way up from the boarding pad at z -12): a wide staircase of eight treads (a light tread slab with a nosing over a darker riser),
    // cheek walls on both sides stepping up with it and capped, and a yellow edge strip at the top
    const N = 8;
    const run = 0.5;
    const half = 2.9;
    for (let i = 0; i < N; i++) {
      const h = (top * (N - i)) / N;
      const zc = -6.95 - run * (i + 0.5);
      b.box([2, h / 2, zc], X, Y, half, h / 2, run / 2, [0.74, 0.71, 0.66], 2); // the riser block
      b.box([2, h - 0.035, zc - 0.03], X, Y, half + 0.02, 0.035, run / 2 + 0.03, [0.97, 0.95, 0.9], 2); // the tread with its nosing
      for (const sx of [-1, 1]) {
        b.box([2 + sx * (half + 0.3), (h + 0.5) / 2, zc], X, Y, 0.3, (h + 0.5) / 2, run / 2, [0.84, 0.81, 0.76], 2); // a cheek wall
        b.box([2 + sx * (half + 0.3), h + 0.5 + 0.04, zc], X, Y, 0.36, 0.04, run / 2 + 0.01, [0.97, 0.95, 0.9], 2); // its cap
      }
    }
    b.box([2, top + 0.005, -6.95], X, Y, half, 0.012, 0.1, [0.95, 0.78, 0.2], 1);
    return b.build();
  }, []);
  // the north face in stone: a cobbled-block plate with a pilaster every 4 m, a plinth under it and a coping over it (metre UVs: a stone is ~0.25 m)
  const faceGeo = useMemo(() => {
    const b = new GeoBuilder();
    const X: V3 = [1, 0, 0];
    const Y: V3 = [0, 1, 0];
    const top = STATION_Y + 0.2;
    b.box([2, (top - 0.1 + 0.3) / 2, -6.86], X, Y, 16.9, (top - 0.1 - 0.3) / 2, 0.04, [0.96, 0.94, 0.9], 2.2);
    for (let k = -4; k <= 4; k++) b.box([2 + k * 4, (top - 0.1 + 0.3) / 2, -6.9], X, Y, 0.32, (top - 0.1 - 0.3) / 2, 0.07, [0.9, 0.87, 0.82], 2.2);
    return b.build();
  }, []);
  const trimGeo = useMemo(() => {
    const b = new GeoBuilder();
    const X: V3 = [1, 0, 0];
    const Y: V3 = [0, 1, 0];
    const top = STATION_Y + 0.2;
    b.box([2, 0.15, -6.9], X, Y, 17.05, 0.15, 0.1, [0.62, 0.6, 0.56], 2); // the plinth
    b.box([2, top - 0.05, -6.92], X, Y, 17.1, 0.05, 0.13, [0.97, 0.95, 0.9], 2); // the coping
    b.box([2, top - 0.13, -6.88], X, Y, 17, 0.03, 0.08, [0.8, 0.77, 0.72], 2); // its shadow line
    return b.build();
  }, []);
  const stone = useMemo(() => parkMaterial(paving, 1, { vertexColors: true, color: new Color(1.7, 1.6, 1.45), normalScale: 1.0 }), [paving]);
  const post = useMemo(() => new MeshPhysicalMaterial({ color: "#eee7d8", roughness: 0.45, metalness: 0.15, clearcoat: 0.4 }), []);
  const roof = useMemo(() => new MeshPhysicalMaterial({ color: "#5b60d4", emissive: new Color("#262a78"), emissiveIntensity: 0.4, roughness: 0.5, metalness: 0.2, clearcoat: 0.5, side: DoubleSide }), []);
  const sign = useMemo(() => signTexture(), []);
  const signMat = useMemo(() => new MeshPhysicalMaterial({ map: sign, roughness: 0.6, emissive: new Color("#ffffff"), emissiveMap: sign, emissiveIntensity: 0.18 }), [sign]);
  const cx = 2;
  const deckTop = STATION_Y + 0.2;
  return (
    <group>
      <mesh geometry={baseGeo} material={base} castShadow receiveShadow />
      <mesh geometry={faceGeo} material={stone} castShadow receiveShadow />
      <mesh geometry={trimGeo} material={base} castShadow receiveShadow />
      <mesh position={[cx, deckTop + 0.04, -4.1]} material={deck} castShadow receiveShadow>
        <boxGeometry args={[34.2, 0.08, 5.6]} />
      </mesh>
      {[-14, -7, 0, 7, 14, 18].map((x) =>
        [-1.6, -6.4].map((z) => (
          <mesh key={`${x}_${z}`} position={[cx + x - 1, deckTop + 2.6, z]} material={post} castShadow>
            <cylinderGeometry args={[0.13, 0.15, 5.2, 10]} />
          </mesh>
        )),
      )}
      <mesh position={[cx, deckTop + 5.4, -2.8]} material={roof} castShadow>
        <boxGeometry args={[36, 0.18, 8.2]} />
      </mesh>
      <mesh position={[cx, deckTop + 5.62, -2.8]} material={roof} castShadow>
        <boxGeometry args={[36.4, 0.1, 1.0]} />
      </mesh>
      <mesh position={[cx - 1, deckTop + 4.6, -6.62]} rotation={[0, Math.PI, 0]} material={signMat}>
        <planeGeometry args={[9, 2.25]} />
      </mesh>
      <BoardingGates cx={cx} z={-1.6} y={deckTop} />
    </group>
  );
}

export function CoasterWorld({ all, pine, env }: { all: Texture[]; pine: Texture; env: Texture }) {
  const ao = useTexture(CAR_AO_URL) as Texture;
  const track = useMemo(() => coasterTrack(), []);
  const built: TrackBuild = useMemo(() => buildTrack(track, DETAIL), [track]);
  const maps = useMemo(() => ({ metal: pickSet(all, "PaintedMetal013"), concrete: pickSet(all, "Concrete034"), paving: pickSet(all, "PavingStones070") }), [all]);
  // painted steel: the vertex colours are the paint; the set gives the surface (orange-peel bump, the gloss that varies)
  const steelMat = useMemo(() => parkMaterial(maps.metal, 0.5, { useColor: false, vertexColors: true, metalness: 0.25, normalScale: 0.35, envMap: env, envMapIntensity: 0.45 }), [maps, env]);
  // the far rails stay a steady dark line instead of crawling light dashes (farSteel.ts)
  useMemo(() => applyFarSteel(steelMat), [steelMat]);
  const gl = useThree((st) => st.gl);
  const buf = useMemo(() => new Vector2(), []);
  useFrame(() => {
    const h = gl.getDrawingBufferSize(buf).y;
    if (h > 0) farSteelUniform.value = 2 / h;
  });
  // (no dispose on cleanup: React's dev double-mount would delete the programs the memoised materials still use)
  if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __cvCoasterTris?: number }).__cvCoasterTris = built.triangles;
  return (
    <group>
      {built.chunks.map((ch, i) => (
        <mesh key={i} geometry={ch.steel} material={steelMat} receiveShadow />
      ))}
      <Train env={env} ao={ao} />
      <Station concrete={maps.concrete} paving={maps.paving} pine={pine} />
    </group>
  );
}
