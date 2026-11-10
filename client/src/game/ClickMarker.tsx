import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { GreaterDepth, LessEqualDepth, MeshBasicMaterial } from "three";
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

/**
 * The ring's opacity where something stands in front of it (its see-through pass, below): fainter than the ring
 * itself (0.9), so it reads as behind, yet plain (round 4 review: walking to a ring 2.6 m ahead, the avatar's own back
 * hid it the whole way — 1-20 % of it drawn; and the last metres of every walk away from the camera).
 */
export const RING_GHOST_OPACITY = 0.6;

/** Marks the see-through pass's meshes (`userData`): the E2E's ring probe tells them from the ring itself. */
export const RING_GHOST_KEY = "ringGhost";
const GHOST = { [RING_GHOST_KEY]: true };

/**
 * The ring's materials: the depth that sees over the ground around it (clickRing.ts) and the decals' offset. `ghost`:
 * the see-through pass — the same ring drawn only where its depth test FAILS (GreaterDepth: something nearer covers
 * it there — the avatar's own body, another avatar, a bench, leaves), at RING_GHOST_OPACITY. Every pixel of the ring is
 * drawn by exactly one of the two passes (the same fragment depth, complementary tests): plain where it is in view,
 * fainter where it is covered, never cut.
 */
function ringMaterial(color: string, uniforms: Record<string, { value: number }>, ghost = false): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: ghost ? RING_GHOST_OPACITY : 0.9,
    depthWrite: false,
    depthFunc: ghost ? GreaterDepth : LessEqualDepth,
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
 * step edge around it never cuts it, and grown on the screen when it is far or seen edge-on (clickRing.ts). What still
 * stands in front of it (the avatar walking toward it, another body, a bench) does not hide it: a second, fainter pass
 * draws the ring exactly where the first one's depth test fails (ringMaterial `ghost`).
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
  const mats = useMemo(
    () => ({
      ring: ringMaterial(RING_COLOR, uniforms),
      dot: ringMaterial(DOT_COLOR, uniforms),
      ringGhost: ringMaterial(RING_COLOR, uniforms, true),
      dotGhost: ringMaterial(DOT_COLOR, uniforms, true),
    }),
    [uniforms],
  );
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) m.dispose();
    },
    [mats],
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
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={RING_RENDER_ORDER} material={mats.ring}>
          <ringGeometry args={[RING_INNER, RING_OUTER, 40]} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={RING_RENDER_ORDER} material={mats.dot}>
          <circleGeometry args={[0.08, 20]} />
        </mesh>
        {/* the see-through pass: where something nearer covers the ring (ringMaterial `ghost`) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={RING_RENDER_ORDER} material={mats.ringGhost} userData={GHOST}>
          <ringGeometry args={[RING_INNER, RING_OUTER, 40]} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={RING_RENDER_ORDER} material={mats.dotGhost} userData={GHOST}>
          <circleGeometry args={[0.08, 20]} />
        </mesh>
      </group>
    </group>
  );
}
