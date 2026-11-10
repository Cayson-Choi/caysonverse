import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshBasicMaterial } from "three";
import type { Group, PerspectiveCamera } from "three";
import { peekClickRing } from "./clickMove";
import { CLICK_PICK_KEY } from "./clickPick";
import {
  RING_INNER,
  RING_OUTER,
  RING_POLYGON_OFFSET,
  RING_RENDER_ORDER,
  RING_SEE_OVER,
  RING_VERTEX_BIAS,
  RING_VERTEX_PARS,
  ringLift,
  ringScreenScale,
} from "./clickRing";
import { useGroundDecal } from "./groundDecal";

/** Ring colour: the brand indigo. */
const RING_COLOR = "#4B4FD8";
const DOT_COLOR = "#ffffff";

/** The click pick passes through the ring (clickPick.ts): a click on it is a click on the ground under it. */
const IGNORED_BY_PICK = { [CLICK_PICK_KEY]: "ignore" };

/** The ring's two materials: the depth that sees over the ground around it (clickRing.ts) and the decals' offset. */
function ringMaterial(color: string, uniforms: Record<string, { value: number }>): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: RING_POLYGON_OFFSET.factor,
    polygonOffsetUnits: RING_POLYGON_OFFSET.units,
    fog: false,
    toneMapped: false,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = RING_VERTEX_PARS + shader.vertexShader.replace("#include <project_vertex>", RING_VERTEX_BIAS);
  };
  m.customProgramCacheKey = () => "click-ring";
  return m;
}

/**
 * The destination ring: a flat ring on the ground where the avatar is walking to (a floor click or a single tap).
 * Visible while a click-move target exists — or, for a tap held back to see whether a second one follows, from the
 * tap on (clickMove.ts `pending`) — gone the moment it clears (arrival, a key press, a blocked path, a menu).
 *
 * It lies on the surface that was clicked (the target's `y`) plus the scene's decal lift, with a polygon offset that
 * beats every ground layer, drawn after the shadow floor, its depth taken a little up its view ray so a curb or a
 * step edge around it never cuts it, and grown on the screen when it is far or seen edge-on (clickRing.ts).
 *
 * Per-frame work touches the groups and the shared uniforms only — no React state, no allocation: the target is read
 * with peekClickRing (the live object, not a copy). The outer group places and sizes it, the inner one breathes.
 */
export function ClickMarker() {
  const placeRef = useRef<Group>(null);
  const pulseRef = useRef<Group>(null);
  const lift = ringLift(useGroundDecal());
  const uniforms = useMemo(
    () => ({ uRingSeeOver: { value: RING_SEE_OVER }, uRingBiasCap: { value: 2 * RING_OUTER }, uRingNear: { value: 0.1 } }),
    [],
  );
  const [ringMat, dotMat] = useMemo(() => [ringMaterial(RING_COLOR, uniforms), ringMaterial(DOT_COLOR, uniforms)], [uniforms]);
  useEffect(
    () => () => {
      ringMat.dispose();
      dotMat.dispose();
    },
    [ringMat, dotMat],
  );

  useFrame(({ clock, camera, size }) => {
    const place = placeRef.current;
    const pulseGroup = pulseRef.current;
    if (!place || !pulseGroup) return;
    const target = peekClickRing();
    if (!target) {
      if (place.visible) place.visible = false;
      return;
    }
    place.visible = true;
    const y = target.y + lift;
    place.position.set(target.x, y, target.z);
    // Grown on the screen when far or edge-on, from the camera's view of the ring's centre.
    const cam = camera as PerspectiveCamera;
    const dx = cam.position.x - target.x;
    const dy = cam.position.y - y;
    const dz = cam.position.z - target.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const scale = cam.isPerspectiveCamera ? ringScreenScale(dist, dy / Math.max(dist, 1e-4), cam.fov, size.height) : 1;
    place.scale.set(scale, 1, scale);
    uniforms.uRingBiasCap.value = 2 * RING_OUTER * scale;
    uniforms.uRingNear.value = cam.near;
    // A slow breathing pulse so the ring reads as "going here", not as a decal.
    const pulse = 1 + 0.1 * Math.sin(clock.elapsedTime * 6);
    pulseGroup.scale.set(pulse, 1, pulse);
  });

  return (
    <group ref={placeRef} visible={false} userData={IGNORED_BY_PICK}>
      <group ref={pulseRef}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={RING_RENDER_ORDER} material={ringMat}>
          <ringGeometry args={[RING_INNER, RING_OUTER, 40]} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={RING_RENDER_ORDER} material={dotMat}>
          <circleGeometry args={[0.08, 20]} />
        </mesh>
      </group>
    </group>
  );
}
