import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { BufferGeometry, CanvasTexture, Color, Euler, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, SRGBColorSpace, Texture, Vector3 } from "three";
import {
  CAROUSEL_CANOPY_Y,
  CAROUSEL_CENTER,
  CAROUSEL_DECK_Y,
  CAROUSEL_RADIUS,
  CAROUSEL_RINGS,
  carouselAt,
  type CarouselState,
  carouselSeatPose,
  type CarouselSeatPose,
} from "@caysonverse/shared/land/carousel";
import { CAROUSEL_PAD } from "@caysonverse/shared/village/parkArea";
import { selfRide } from "./coasterRide";
import { villageClock } from "../village/villageClock";
import { GeoBuilder, type V3 } from "./geoBuilder";
import { parkMaterial, pickSet } from "./pbr";
import { isTouchDevice } from "../device";
import { Booth, type BoothSpec } from "./ParkBooth";

export const CAROUSEL_STATIC_URL = "/models/land/carousel_static.glb";
export const CAROUSEL_HORSE_URL = "/models/land/carousel_horse.glb";
export const CAROUSEL_HORSE_LOD_URL = "/models/land/carousel_horse_lod.glb";
/** Horses farther than this from the camera (m) draw as the low-poly horse (a third of the triangles). */
const HORSE_LOD_M = isTouchDevice ? 12 : 22;
export const CAROUSEL_CARRIAGE_URL = "/models/land/carousel_carriage.glb";

/** The horse coats (multiplied onto the white paint): white, cream, chestnut, dapple grey, powder blue, rose. */
const COATS: [number, number, number][] = [
  [1.0, 1.0, 1.0],
  [1.0, 0.9, 0.74],
  [0.62, 0.36, 0.24],
  [0.62, 0.64, 0.68],
  [0.74, 0.82, 1.0],
  [1.0, 0.74, 0.82],
];

interface Part {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
}

/** A GLB's meshes as geometry + a cloned material each (the join gave one mesh with a primitive per material). */
export function partsOf(scene: Group, env: Texture, intensity = 1): Part[] {
  const out: Part[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const material = (mesh.material as MeshStandardMaterial).clone();
    material.envMap = env;
    material.envMapIntensity = material.name.endsWith("paint") ? 1.2 * intensity : material.name.includes("mirror") ? 1.6 : 0.9 * intensity;
    // full metal reflects only the dim sky and goes black from inside: keep it brass-coloured
    if (material.name.includes("glass")) {
      // cabin glass: nearly clear, with a sheen of the sky
      material.transparent = true;
      material.opacity = 0.18;
      material.depthWrite = false;
      material.roughness = 0.05;
      material.envMapIntensity = 1.4;
    }
    if (material.name.endsWith("lamp")) material.emissiveIntensity = 2.2;
    if (material.name.includes("mirror")) {
      // a mirror must never read black: a silvery-blue glow under the reflection
      material.emissive = new Color("#8fb4d8");
      material.emissiveIntensity = 0.32;
    }
    if (material.metalness > 0.6) {
      material.metalness = 0.6;
      material.envMapIntensity *= 1.5;
    }
    material.needsUpdate = true;
    out.push({ geometry: mesh.geometry, material });
  });
  return out;
}

const tmpPose: CarouselSeatPose = { x: 0, y: 0, z: 0, fx: 0, fz: 1, pitch: 0, theta: 0, ring: 0 };
const tmpPose2: CarouselSeatPose = { x: 0, y: 0, z: 0, fx: 0, fz: 1, pitch: 0, theta: 0, ring: 0 };
const mat4 = new Matrix4();
const quat = new Quaternion();
const eul = new Euler(0, 0, 0, "YXZ");
const pos = new Vector3();
const one = new Vector3(1, 1, 1);
const tmpColor = new Color();
const stScratch: CarouselState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, rideT: 0, departsInMs: 0 };

/** Warm bulbs along the band, the canopy's ribs and the column cap (emissive, instanced): their places in the rotating frame. */
function bulbPlaces(): V3[] {
  const out: V3[] = [];
  const R = CAROUSEL_RADIUS + 0.85;
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    out.push([Math.sin(a) * (R + 0.4), CAROUSEL_CANOPY_Y - 0.02, -Math.cos(a) * (R + 0.4)]);
  }
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    for (let j = 1; j <= 6; j++) {
      const f = j / 7;
      out.push([Math.sin(a) * (R + 0.35) * (1 - f * 0.78), CAROUSEL_CANOPY_Y + 0.28 + f * 3.9, -Math.cos(a) * (R + 0.35) * (1 - f * 0.78)]);
    }
  }
  // rows of bulbs along the rafters of the painted ceiling (its height: see ceil_y in tools/land/make_carousel.py)
  for (const r of [4.4, 7.4, 10.4, 12.5]) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      out.push([Math.sin(a) * r, 12.35 - (r / 13) * (12.35 - 8.62) - 0.16, -Math.cos(a) * r]);
    }
  }
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    out.push([Math.sin(a) * 2.45, CAROUSEL_CANOPY_Y - 0.9, -Math.cos(a) * 2.45]);
  }
  return out;
}

/** The entrance: a gate arch with the ride's name, a low iron fence with gilded finials round the platform (open at the entrance); the ticket booth is ParkBooth. */
function entranceGeometry(): BufferGeometry {
  const b = new GeoBuilder();
  const X: V3 = [1, 0, 0];
  const Y: V3 = [0, 1, 0];
  const cx = CAROUSEL_CENTER.x;
  const cz = CAROUSEL_CENTER.z;
  const R = CAROUSEL_RADIUS + 0.55;
  const gap = 0.28; // radians each side of due south
  for (let k = 0; k < 90; k++) {
    const a = (k / 90) * Math.PI * 2;
    const south = Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI)));
    if (south < gap) continue;
    const x = cx + Math.sin(a) * R;
    const z = cz - Math.cos(a) * R;
    b.cylinder([x, 0.0, z], [x, 1.25, z], 0.04, 0.04, 6, [0.12, 0.12, 0.2]);
    b.cylinder([x, 1.25, z], [x, 1.42, z], 0.055, 0.0, 6, [0.95, 0.7, 0.2]);
  }
  // the rails, as short straight segments
  for (let k = 0; k < 90; k++) {
    const a0 = (k / 90) * Math.PI * 2;
    const a1 = ((k + 1) / 90) * Math.PI * 2;
    const south = Math.abs(Math.atan2(Math.sin(a0 - Math.PI), Math.cos(a0 - Math.PI)));
    if (south < gap) continue;
    for (const y of [0.35, 1.0]) b.cylinder([cx + Math.sin(a0) * R, y, cz - Math.cos(a0) * R], [cx + Math.sin(a1) * R, y, cz - Math.cos(a1) * R], 0.028, 0.028, 5, [0.12, 0.12, 0.2]);
  }
  // the gate: two gilded posts with lanterns and an arch beam carrying the sign, on the entrance's axis
  const gz = cz + R + 0.2;
  for (const sx of [-1, 1]) {
    b.cylinder([cx + sx * 2.6, 0, gz], [cx + sx * 2.6, 4.4, gz], 0.2, 0.17, 10, [0.95, 0.7, 0.2]);
    b.box([cx + sx * 2.6, 0.2, gz], X, Y, 0.38, 0.2, 0.38, [0.6, 0.58, 0.54]);
    b.cylinder([cx + sx * 2.6, 4.4, gz], [cx + sx * 2.6, 4.9, gz], 0.2, 0.0, 10, [0.08, 0.1, 0.48]);
    b.box([cx + sx * 2.6, 3.85, gz - 0.3], X, Y, 0.18, 0.28, 0.18, [1, 0.88, 0.5]);
  }
  b.box([cx, 3.3, gz], X, Y, 2.8, 0.2, 0.2, [0.08, 0.1, 0.48]); // below the sign: the sign board hangs clear above it
  return b.build();
}

function signTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 220;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 220);
  g.addColorStop(0, "#2a2f9a");
  g.addColorStop(1, "#14186a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 220);
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 1004, 200);
  ctx.fillStyle = "#f3efea";
  ctx.font = "bold 120px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("달빛 회전목마", 512, 100);
  ctx.font = "40px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#f2c14e";
  ctx.fillText("MOONLIGHT CAROUSEL", 512, 182);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The carousel: the static GLB turning with the shared clock, 20 horses and 2 carriages on their poles (instanced, bobbing), bulbs, the entrance. */
export function CarouselWorld({ env, all }: { env: Texture; all: Texture[] }) {
  const stat = useGLTF(CAROUSEL_STATIC_URL);
  const horse = useGLTF(CAROUSEL_HORSE_URL);
  const horseLo = useGLTF(CAROUSEL_HORSE_LOD_URL);
  const carriage = useGLTF(CAROUSEL_CARRIAGE_URL);
  const statParts = useMemo(() => partsOf(stat.scene, env), [stat, env]);
  const horseParts = useMemo(() => partsOf(horse.scene, env), [horse, env]);
  const loParts = useMemo(() => partsOf(horseLo.scene, env), [horseLo, env]);
  const loRefs = useRef<(InstancedMesh | null)[]>([]);
  const slotHi = useRef<number[]>([]);
  const slotLo = useRef<number[]>([]);
  const carriageParts = useMemo(() => partsOf(carriage.scene, env), [carriage, env]);
  const turning = useRef<Group>(null);
  const root = useRef<Group>(null);
  const gl = useThree((s) => s.gl);
  const cam = useThree((s) => s.camera);
  const horseRefs = useRef<(InstancedMesh | null)[]>([]);
  const carriageRefs = useRef<(InstancedMesh | null)[]>([]);
  const bulbRef = useRef<InstancedMesh>(null);
  const bulbs = useMemo(bulbPlaces, []);
  const bulbGeo = useMemo(() => new SphereGeometry(0.11, 6, 4), []);
  const bulbMat = useMemo(() => new MeshStandardMaterial({ color: "#fff1c8", emissive: new Color("#ffcf7a"), emissiveIntensity: 2.4, roughness: 0.3 }), []);
  // the platform floor: real planked oak under a varnish (ambientCG WoodFloor051), over the GLB's plain deck
  const floorMat = useMemo(() => {
    const m = parkMaterial(pickSet(all, "WoodFloor051"), [9, 9], { color: new Color("#cfa878"), roughness: 0.42, metalness: 0.0, normalScale: 0.8 });
    m.envMap = env;
    m.envMapIntensity = 0.55;
    return m;
  }, [all, env]);
  const entrance = useMemo(entranceGeometry, []);
  // the ticket booth beside the entrance (the old kiosk's footprint: 3.8 x 3.4 m at 7.5 m east of the centre)
  const ticketBooth = useMemo<BoothSpec>(
    () => ({ x: CAROUSEL_CENTER.x + 7.5, z: CAROUSEL_PAD.z + 1.5, w: 3.4, d: 3.0, kind: "ticket", plaster: "#efe0d8", tile: "#8c93ff", title: "매표소", sub: "TICKETS", stripes: [[0.7, 0.1, 0.16], [0.97, 0.94, 0.88]] }),
    [],
  );
  const entranceMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 }), []);
  const sign = useMemo(signTexture, []);
  const signMat = useMemo(() => new MeshStandardMaterial({ map: sign, emissive: new Color("#ffffff"), emissiveMap: sign, emissiveIntensity: 0.2, roughness: 0.6 }), [sign]);
  const HORSES = CAROUSEL_RINGS[0]!.seats + CAROUSEL_RINGS[1]!.seats;

  useEffect(() => {
    const m = new Matrix4();
    bulbs.forEach((p, i) => {
      m.makeTranslation(p[0], p[1], p[2]);
      bulbRef.current?.setMatrixAt(i, m);
    });
    if (bulbRef.current) bulbRef.current.instanceMatrix.needsUpdate = true;
  }, [bulbs]);

  // compile every horse / carriage program once at arrival (the hi and lo horses, the instance colour on their paint), so the first ride and the
  // first level-of-detail swap never stall a frame on a shader compile
  useEffect(() => {
    for (const [refs, parts] of [[horseRefs.current, horseParts], [loRefs.current, loParts]] as const) {
      parts.forEach((p, i) => {
        const mesh = refs[i];
        if (mesh && p.material.name === "horse_paint" && !mesh.instanceColor) mesh.setColorAt(0, tmpColor.setRGB(1, 1, 1));
      });
    }
    if (root.current) {
      const t = window.setTimeout(() => {
        try {
          if (root.current) gl.compile(root.current, cam);
        } catch {
          /* the compile is an optimisation only */
        }
      }, 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [gl, cam, horseParts, loParts]);

  useFrame(({ camera }) => {
    const now = villageClock.liveMs();
    const st = carouselAt(now, stScratch);
    if (turning.current) turning.current.rotation.y = -st.angle;
    // horses: near ones with the full model, far ones with the low-poly model; the two sets are packed (instance k of a set = the k-th horse
    // assigned to it), so each set's paint instance colour is rewritten when a slot changes hands
    let nHi = 0;
    let nLo = 0;
    const cx = CAROUSEL_CENTER.x;
    const cz = CAROUSEL_CENTER.z;
    void cx;
    void cz;
    for (let s = 0; s < HORSES; s++) {
      carouselSeatPose(s, now, tmpPose);
      pos.set(tmpPose.x, tmpPose.y, tmpPose.z);
      eul.set(-tmpPose.pitch, Math.atan2(tmpPose.fx, tmpPose.fz), 0, "YXZ");
      quat.setFromEuler(eul);
      mat4.compose(pos, quat, one);
      const d = Math.hypot(tmpPose.x - camera.position.x, tmpPose.z - camera.position.z);
      const hi = d < HORSE_LOD_M || (selfRide.slot === s && selfRide.ride === 2);
      const refs = hi ? horseRefs.current : loRefs.current;
      const slot = hi ? nHi++ : nLo++;
      for (const mesh of refs) mesh?.setMatrixAt(slot, mat4);
      const cache = hi ? slotHi.current : slotLo.current;
      if (cache[slot] !== s) {
        cache[slot] = s;
        const k = COATS[(s * 5 + (s >> 2)) % COATS.length]!;
        tmpColor.setRGB(k[0], k[1], k[2]);
        const parts = hi ? horseParts : loParts;
        parts.forEach((p, i) => {
          if (p.material.name !== "horse_paint") return;
          const mesh = refs[i];
          if (mesh) {
            mesh.setColorAt(slot, tmpColor);
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          }
        });
      }
    }
    for (const mesh of horseRefs.current)
      if (mesh) {
        mesh.count = nHi;
        mesh.instanceMatrix.needsUpdate = true;
      }
    for (const mesh of loRefs.current)
      if (mesh) {
        mesh.count = nLo;
        mesh.instanceMatrix.needsUpdate = true;
      }
    for (let c = 0; c < 2; c++) {
      carouselSeatPose(20 + c * 2, now, tmpPose);
      carouselSeatPose(21 + c * 2, now, tmpPose2);
      pos.set((tmpPose.x + tmpPose2.x) / 2, CAROUSEL_DECK_Y + (tmpPose.y - CAROUSEL_DECK_Y - 0.62), (tmpPose.z + tmpPose2.z) / 2);
      eul.set(0, Math.atan2(tmpPose.fx, tmpPose.fz), 0, "YXZ");
      quat.setFromEuler(eul);
      mat4.compose(pos, quat, one);
      for (const mesh of carriageRefs.current) mesh?.setMatrixAt(c, mat4);
    }
    for (const mesh of carriageRefs.current) if (mesh) mesh.instanceMatrix.needsUpdate = true;
  });
  // the platform's own origin is the centre on the ground; its parts are in that frame
  return (
    <group ref={root}>
      <group ref={turning} position={[CAROUSEL_CENTER.x, 0, CAROUSEL_CENTER.z]}>
        {statParts.map((p, i) => (
          <mesh key={i} geometry={p.geometry} material={p.material} castShadow receiveShadow />
        ))}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, CAROUSEL_DECK_Y + 0.004, 0]} material={floorMat} receiveShadow>
          <circleGeometry args={[12.4, 72]} />
        </mesh>
        <instancedMesh frustumCulled={false} ref={bulbRef} args={[bulbGeo, bulbMat, bulbs.length]} />
      </group>
      {horseParts.map((p, i) => (
        <instancedMesh key={`h${i}`} ref={(r) => { horseRefs.current[i] = r; }} args={[p.geometry, p.material, HORSES]} frustumCulled={false} castShadow receiveShadow />
      ))}
      {loParts.map((p, i) => (
        <instancedMesh key={`l${i}`} ref={(r) => { loRefs.current[i] = r; }} args={[p.geometry, p.material, HORSES]} frustumCulled={false} castShadow receiveShadow />
      ))}
      {carriageParts.map((p, i) => (
        <instancedMesh key={`c${i}`} ref={(r) => { carriageRefs.current[i] = r; }} args={[p.geometry, p.material, 2]} frustumCulled={false} castShadow receiveShadow />
      ))}
      <mesh geometry={entrance} material={entranceMat} castShadow receiveShadow />
      <Booth all={all} spec={ticketBooth} />
      <mesh position={[CAROUSEL_CENTER.x, 4.15, CAROUSEL_CENTER.z + CAROUSEL_RADIUS + 0.9]} material={signMat}>
        <planeGeometry args={[5.4, 1.15]} />
      </mesh>
    </group>
  );
}
