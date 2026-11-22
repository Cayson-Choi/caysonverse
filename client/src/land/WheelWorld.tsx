import { compileSafely } from "../game/compileSafely";
import { BulbHalos } from "./nightGlow";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { CanvasTexture, Color, FrontSide, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, SphereGeometry, SRGBColorSpace, Texture, Vector3 } from "three";
import { WHEEL_HUB_Y, WHEEL_N, WHEEL_R, WHEEL_SITE, WHEEL_STEP, wheelAt, wheelPivot, type WheelState } from "@caysonverse/shared/land/wheel";
import { rideMs } from "./rideClock";
import { partsOf } from "./CarouselWorld";
import { parkMaterial, pickSet } from "./pbr";
import { projectMetreUV } from "./parkShapes";

export const WHEEL_ROTOR_URL = "/models/land/wheel_rotor.glb";
export const WHEEL_FRAME_URL = "/models/land/wheel_frame.glb";
export const WHEEL_GONDOLA_URL = "/models/land/wheel_gondola.glb";
const RIM_Z = 1.9;

function signTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#2a2f9a");
  g.addColorStop(1, "#14186a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 1004, 236);
  ctx.fillStyle = "#f3efea";
  ctx.font = "bold 120px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("하늘 등불 바퀴", 512, 112);
  ctx.font = "44px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#f2c14e";
  ctx.fillText("SKY LANTERN WHEEL", 512, 206);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const mat4 = new Matrix4();
const quat = new Quaternion();
const pos = new Vector3();
const one = new Vector3(1, 1, 1);
const piv = { x: 0, y: 0, z: 0 };
const st: WheelState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, alpha: 0, departsInMs: 0 };

/** Warm bulbs along both rims (rotor frame, instanced). */
function rimBulbs(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const z of [-RIM_Z, RIM_Z]) {
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      out.push([Math.sin(a) * (WHEEL_R + 0.34), Math.cos(a) * (WHEEL_R + 0.34), z * 1.04]);
    }
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      out.push([Math.sin(a) * (WHEEL_R - 2.7), Math.cos(a) * (WHEEL_R - 2.7), z * 1.04]);
    }
  }
  return out;
}

/** The 하늘 등불 바퀴: the fixed frame and boarding platform, the rotor turning with the shared clock, ten glass lantern gondolas hanging and swinging, bulbs. */
export function WheelWorld({ env, all }: { env: Texture; all: Texture[] }) {
  const rotor = useGLTF(WHEEL_ROTOR_URL);
  const frame = useGLTF(WHEEL_FRAME_URL);
  const gondola = useGLTF(WHEEL_GONDOLA_URL);
  const rotorParts = useMemo(() => partsOf(rotor.scene, env), [rotor, env]);
  const frameParts = useMemo(() => {
    // the plain-colour stone base, its stairs and the boarding deck get real surfaces: the concrete's grain and the planks' grain, UVs in
    // metres from each face's own plane (the GLB has none), so nothing stretches
    const parts = partsOf(frame.scene, env);
    return parts.map((p) => {
      if (p.material.name === "ws_stone") {
        const geometry = projectMetreUV(p.geometry, 2);
        const material = parkMaterial(pickSet(all, "Concrete034"), 1, { color: new Color("#f0e8da"), normalScale: 0.8 });
        return { geometry, material };
      }
      if (p.material.name === "ws_wood") {
        const geometry = projectMetreUV(p.geometry, 1.2);
        const material = parkMaterial(pickSet(all, "WoodFloor051"), 1, { color: new Color("#d6b48a"), normalScale: 0.8 });
        return { geometry, material };
      }
      return p;
    });
  }, [frame, env, all]);
  const gondolaParts = useMemo(() => {
    // the cabin glass: CLEAR (owner 2026-11-19: it looked milky). One pane per side (no double layers), a faint blue-green tint, almost no opacity, no
    // roughness blur and only a trace of sky in it (a weak environment reflection), so the park shows crisp and undimmed through it and the riders show from outside
    return partsOf(gondola.scene, env).map((p) => {
      if (!p.material.name.includes("glass")) return p;
      const m = p.material;
      m.color = new Color("#cdeee6");
      m.opacity = 0.1;
      m.transparent = true;
      m.depthWrite = false;
      m.roughness = 0.02;
      m.metalness = 0;
      m.envMapIntensity = 0.28;
      m.emissive = new Color("#000000");
      m.emissiveIntensity = 0;
      m.map = null;
      m.alphaMap = null;
      m.side = FrontSide;
      m.needsUpdate = true;
      return p;
    });
  }, [gondola, env]);
  const rotorRef = useRef<Group>(null);
  const root = useRef<Group>(null);
  const gl = useThree((s) => s.gl);
  const cam = useThree((s) => s.camera);
  const gondolaRefs = useRef<(InstancedMesh | null)[]>([]);
  const bulbRef = useRef<InstancedMesh>(null);
  const bulbs = useMemo(rimBulbs, []);
  const bulbGeo = useMemo(() => new SphereGeometry(0.13, 6, 4), []);
  const bulbMat = useMemo(() => new MeshStandardMaterial({ color: "#fff1c8", emissive: new Color("#ffcf7a"), emissiveIntensity: 2.4, roughness: 0.3 }), []);
  const sign = useMemo(signTexture, []);
  const signMat = useMemo(() => new MeshStandardMaterial({ map: sign, emissive: new Color("#ffffff"), emissiveMap: sign, emissiveIntensity: 0.2, roughness: 0.6 }), [sign]);
  const postMat = useMemo(() => new MeshStandardMaterial({ color: "#f2c14e", metalness: 0.6, roughness: 0.4 }), []);

  useEffect(() => {
    const m = new Matrix4();
    bulbs.forEach((p, i) => {
      m.makeTranslation(p[0], p[1], p[2]);
      bulbRef.current?.setMatrixAt(i, m);
    });
    if (bulbRef.current) bulbRef.current.instanceMatrix.needsUpdate = true;
  }, [bulbs]);

  // compile the wheel's programs once at arrival (glass, lamps, instanced gondolas), not on the first ride
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        if (root.current) void compileSafely(gl, root.current, cam);
      } catch {
        /* an optimisation only */
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [gl, cam, gondolaParts]);

  useFrame(() => {
    const now = rideMs();
    wheelAt(now, st);
    // the rotor turns clockwise seen from the south: a negative turn about +z
    if (rotorRef.current) rotorRef.current.rotation.z = -st.angle;
    // the gondolas hang from their pivots (upright, swinging with the acceleration)
    for (let g = 0; g < WHEEL_N; g++) {
      wheelPivot(g, st.angle, piv);
      pos.set(piv.x, piv.y, piv.z);
      // the gondolas hang level, always: no swing, no tilt
      quat.identity();
      mat4.compose(pos, quat, one);
      for (const mesh of gondolaRefs.current) mesh?.setMatrixAt(g, mat4);
    }
    for (const mesh of gondolaRefs.current) if (mesh) mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={root}>
      <group position={[WHEEL_SITE.x, 0, WHEEL_SITE.z]}>
        {frameParts.map((p, i) => (
          <mesh key={i} geometry={p.geometry} material={p.material} castShadow receiveShadow dispose={null} />
        ))}
      </group>
      <group ref={rotorRef} position={[WHEEL_SITE.x, WHEEL_HUB_Y, WHEEL_SITE.z]}>
        {rotorParts.map((p, i) => (
          <mesh key={i} geometry={p.geometry} material={p.material} dispose={null} />
        ))}
        <instancedMesh frustumCulled={false} ref={bulbRef} args={[bulbGeo, bulbMat, bulbs.length]} dispose={null} />
        <BulbHalos places={bulbs} size={1.0} strength={0.8} />
      </group>
      {gondolaParts.map((p, i) => (
        <instancedMesh key={`g${i}`} name={i === 0 ? "ride-wheel-gondola" : undefined} ref={(r) => { gondolaRefs.current[i] = r; }} args={[p.geometry, p.material, WHEEL_N]} frustumCulled={false} dispose={null} castShadow={!p.material.transparent} renderOrder={p.material.transparent ? 2 : 0} />
      ))}
      <mesh position={[WHEEL_SITE.x + 7.5, 2.1, WHEEL_SITE.z + 9.6]} material={signMat}>
        <planeGeometry args={[4.2, 1.05]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[WHEEL_SITE.x + 7.5 + s * 2.0, 0.95, WHEEL_SITE.z + 9.55]} material={postMat}>
          <cylinderGeometry args={[0.07, 0.07, 1.9, 8]} />
        </mesh>
      ))}
    </group>
  );
}

void WHEEL_STEP;
