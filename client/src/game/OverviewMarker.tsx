import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { DoubleSide, type Group, type Material, type Mesh, type PerspectiveCamera } from "three";
import { viewState } from "./viewState";
import { OV_VIS_BLEND } from "./viewMode";
import { blinkOpacity, markerRadiusMetres, ripplePhase } from "./mapMarker";
import type { Pose } from "./types";

/**
 * Overview self-marker: "내 위치" on the map. A big blinking red disc with a bright ring, a white centre and a ripple
 * ring that keeps growing out of it, plus a "내 위치" tag above — visible ONLY in the top-down overview, so "where am I?"
 * reads at a glance from 200 m up. It is drawn in the world but sized in SCREEN pixels (markerRadiusMetres: the
 * same ~30 px ring from any map height, on any screen), unlit (`meshBasicMaterial`, `toneMapped={false}`) and drawn on
 * top of the ground (`depthTest={false}`).
 *
 * Per-frame, ref-driven (never React state): it follows the shared mutable `pose` and toggles visibility off the module
 * `viewState` — so it costs nothing outside the overview. Mounted by PlayShell inside the Canvas.
 */
const RED = "#ff2d46";
const RING = "#ffe14a";

function mat(ref: { current: Material | null }) {
  return (m: Material | null) => {
    ref.current = m;
  };
}

export function OverviewMarker({ pose }: { pose: Pose }) {
  const ref = useRef<Group>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const discMat = useRef<Material | null>(null);
  const ringMat = useRef<Material | null>(null);
  const rippleMesh = useRef<Mesh>(null);
  const rippleMat = useRef<Material | null>(null);

  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    // Gate on the ov blend, not the mode flip: the marker appears once the camera
    // is high enough mid-ascent and STAYS through most of the exit descent (the
    // user keeps their "where am I" anchor while the map is still readable).
    const show = viewState.ovBlend > OV_VIS_BLEND;
    g.visible = show;
    if (tagRef.current) tagRef.current.style.display = show ? "" : "none";
    if (!show) return;
    g.position.set(pose.x, 0, pose.z);
    const cam = state.camera as PerspectiveCamera;
    const fov = cam.isPerspectiveCamera ? (cam.fov * Math.PI) / 180 : 0;
    const height = Math.max(viewState.ovHeight, cam.position.y);
    g.scale.setScalar(markerRadiusMetres(height, fov, state.size.height));
    const t = state.clock.elapsedTime;
    const o = blinkOpacity(t);
    if (discMat.current) discMat.current.opacity = o;
    if (ringMat.current) ringMat.current.opacity = o;
    const p = ripplePhase(t);
    if (rippleMesh.current) rippleMesh.current.scale.setScalar(0.9 + p * 1.5);
    if (rippleMat.current) rippleMat.current.opacity = 0.8 * (1 - p);
  });

  // Unit radius 1 = the ring's outer edge; the group is scaled to the on-screen size.
  return (
    <group ref={ref} name="overview-self-marker" visible={false}>
      {/* The ripple ring that grows out of the marker and fades. */}
      <mesh ref={rippleMesh} position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={997}>
        <ringGeometry args={[0.86, 1, 48]} />
        <meshBasicMaterial ref={mat(rippleMat)} color={RING} transparent opacity={0.6} side={DoubleSide} depthTest={false} toneMapped={false} />
      </mesh>
      {/* The bright outer ring. */}
      <mesh position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={998}>
        <ringGeometry args={[0.72, 1, 48]} />
        <meshBasicMaterial ref={mat(ringMat)} color={RING} transparent opacity={1} side={DoubleSide} depthTest={false} toneMapped={false} />
      </mesh>
      {/* The red disc. */}
      <mesh position={[0, 0.52, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={998}>
        <circleGeometry args={[0.66, 40]} />
        <meshBasicMaterial ref={mat(discMat)} color={RED} transparent opacity={1} side={DoubleSide} depthTest={false} toneMapped={false} />
      </mesh>
      {/* The white centre: stays solid, so the exact spot never blinks away. */}
      <mesh position={[0, 0.54, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={999}>
        <circleGeometry args={[0.22, 24]} />
        <meshBasicMaterial color="#ffffff" side={DoubleSide} depthTest={false} toneMapped={false} />
      </mesh>
      <Html center zIndexRange={[12, 0]} style={{ pointerEvents: "none" }}>
        <div ref={tagRef} className="cv-map-me" style={{ display: "none" }}>
          내 위치
        </div>
      </Html>
    </group>
  );
}
