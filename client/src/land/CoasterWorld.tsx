import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, DoubleSide, Group, InstancedMesh, Matrix4, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { COASTER_CARS, carArc, coasterTrack, emptyFrame, frameAt, STATION_Y } from "@caysonverse/shared/land/coaster";
import { isTouchDevice } from "../device";
import { buildCar, buildTrack, type TrackBuild, type TrackDetail } from "./coasterGeometry";
import { coasterNow } from "./coasterRide";
import { parkMaterial, pickSet } from "./pbr";
import { signTexture } from "./canvasTextures";

const DETAIL: TrackDetail = isTouchDevice ? "light" : "full";

/** The cars: one InstancedMesh, its matrices set from the train's place on the shared clock every frame. */
function Train({ geometry, material }: { geometry: ReturnType<typeof buildCar>; material: MeshPhysicalMaterial }) {
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

/** The station: a timber platform on the train's LEFT (-z, the queue's side), a canopy, posts, the name board and the boarding gates. */
function Station({ concrete, pine }: { concrete: ReturnType<typeof pickSet>; pine: Texture }) {
  const deck = useMemo(() => {
    const t = pine.clone();
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return new MeshStandardMaterial({ map: t, roughness: 0.78, color: new Color("#e6d3b5") });
  }, [pine]);
  const base = useMemo(() => parkMaterial(concrete, 8, { color: new Color("#d8d2c8") }), [concrete]);
  const post = useMemo(() => new MeshPhysicalMaterial({ color: "#eee7d8", roughness: 0.45, metalness: 0.15, clearcoat: 0.4 }), []);
  const roof = useMemo(() => new MeshPhysicalMaterial({ color: "#5b60d4", emissive: new Color("#262a78"), emissiveIntensity: 0.4, roughness: 0.5, metalness: 0.2, clearcoat: 0.5, side: DoubleSide }), []);
  const sign = useMemo(() => signTexture(), []);
  const signMat = useMemo(() => new MeshPhysicalMaterial({ map: sign, roughness: 0.6, emissive: new Color("#ffffff"), emissiveMap: sign, emissiveIntensity: 0.18 }), [sign]);
  const cx = 2;
  const deckTop = STATION_Y + 0.2;
  return (
    <group>
      <mesh position={[cx, 0.5, 0]} material={base} castShadow receiveShadow>
        <boxGeometry args={[34, 1.0, 2.2]} />
      </mesh>
      <mesh position={[cx, deckTop / 2, -4.1]} material={base} castShadow receiveShadow>
        <boxGeometry args={[34, deckTop, 5.4]} />
      </mesh>
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

export function CoasterWorld({ all, pine }: { all: Texture[]; pine: Texture }) {
  const track = useMemo(() => coasterTrack(), []);
  const built: TrackBuild = useMemo(() => buildTrack(track, DETAIL), [track]);
  const car = useMemo(() => buildCar(DETAIL), []);
  const maps = useMemo(() => ({ metal: pickSet(all, "PaintedMetal013"), concrete: pickSet(all, "Concrete034") }), [all]);
  // painted steel: the vertex colours are the paint; the set gives the surface (orange-peel bump, the gloss that varies)
  const steelMat = useMemo(() => parkMaterial(maps.metal, 0.5, { useColor: false, vertexColors: true, metalness: 0.25, normalScale: 0.35 }), [maps]);
  const carMat = useMemo(() => new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }), []);
  // (no dispose on cleanup: React's dev double-mount would delete the programs the memoised materials still use)
  if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __cvCoasterTris?: number }).__cvCoasterTris = built.triangles;
  return (
    <group>
      {built.chunks.map((ch, i) => (
        <mesh key={i} geometry={ch.steel} material={steelMat} castShadow receiveShadow />
      ))}
      <Train geometry={car} material={carMat} />
      <Station concrete={maps.concrete} pine={pine} />
    </group>
  );
}
