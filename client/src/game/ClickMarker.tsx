import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { GreaterDepth, LessEqualDepth, MeshBasicMaterial, Vector3 } from "three";
import type { Group, PerspectiveCamera } from "three";
import { peekClickRing } from "./clickMove";
import { CLICK_PICK_KEY } from "./clickPick";
import {
  RING_GHOST_FRAGMENT,
  RING_GHOST_FRAGMENT_PARS,
  RING_GHOST_OPACITY,
  RING_GHOST_VERTEX,
  RING_GHOST_VERTEX_PARS,
  RING_INNER,
  RING_OUTER,
  RING_POLYGON_OFFSET,
  RING_RENDER_ORDER,
  RING_SEE_OVER,
  RING_VERTEX_BIAS,
  RING_VERTEX_PARS,
  SELF_HALF_WIDTH,
  SELF_LEGS_HALF_WIDTH,
  ringBehindSelf,
  ringLift,
  ringScreenScale,
  type SelfOutline,
} from "./clickRing";
import { useGroundDecal } from "./groundDecal";
import { selfBody } from "./selfBody";

const scratchA = new Vector3();
const scratchB = new Vector3();
const outline: SelfOutline = { x: 0, feetY: 0, topY: 0, half: 0, legsHalf: 0 };

/**
 * Whether the player's own body hides the ring at (x, y, z), `scale` times its size, from `cam` on a canvas `h` px tall
 * (clickRing.ts ringBehindSelf): the body's outline (selfBody: its group, its height) against the ring's centre and size
 * on the screen. Only while the body is drawn (not in first person).
 */
function hiddenBySelf(cam: PerspectiveCamera, h: number, x: number, y: number, z: number, dist: number, sinElev: number, scale: number): boolean {
  const body = selfBody.object;
  if (!body || !body.visible || !(selfBody.height > 0) || !cam.isPerspectiveCamera) return false;
  const e = body.matrixWorld.elements;
  const bx = e[12];
  const by = e[13];
  const bz = e[14];
  const tan = Math.tan((cam.fov * Math.PI) / 360);
  const bodyDist = Math.hypot(cam.position.x - bx, cam.position.y - (by + selfBody.height / 2), cam.position.z - bz);
  const toPx = (v: Vector3) => {
    v.project(cam);
    return v;
  };
  const w = h * cam.aspect;
  const ring = toPx(scratchA.set(x, y, z));
  const cx = ((ring.x + 1) / 2) * w;
  const cy = ((1 - ring.y) / 2) * h;
  if (ring.z > 1) return false;
  const feet = toPx(scratchB.set(bx, by, bz));
  outline.x = ((feet.x + 1) / 2) * w;
  outline.feetY = ((1 - feet.y) / 2) * h;
  const top = toPx(scratchB.set(bx, by + selfBody.height, bz));
  outline.topY = ((1 - top.y) / 2) * h;
  const pxPerM = h / (2 * Math.max(bodyDist, 1e-3) * tan);
  outline.half = SELF_HALF_WIDTH * selfBody.height * pxPerM;
  outline.legsHalf = SELF_LEGS_HALF_WIDTH * selfBody.height * pxPerM;
  const ringHalfPx = (RING_OUTER * scale * h) / (2 * Math.max(dist, 1e-3) * tan);
  return ringBehindSelf(cx, cy, ringHalfPx, sinElev, outline, dist > bodyDist);
}

/** Ring colour: the brand indigo. */
const RING_COLOR = "#4B4FD8";
/**
 * The see-through outline's colour: the ring's indigo lightened, so the dashes read over what covers the ring — the
 * avatars' blue shirts, dark hair, a bench's wood — where the ring's own indigo at RING_GHOST_OPACITY all but vanished.
 */
const RING_GHOST_COLOR = "#B3B6FF";
const DOT_COLOR = "#ffffff";

/** The click pick passes through the ring (clickPick.ts): a click on it is a click on the ground under it. */
const IGNORED_BY_PICK = { [CLICK_PICK_KEY]: "ignore" };

/**
 * Where something stands in front of the ring, its see-through pass (below) draws it — dashed, thinner and fainter than
 * the ring itself (0.9), clickRing.ts RING_GHOST_*, so it reads as a ring on the ground behind what covers it (round 4
 * review: walking to a ring 2.6 m ahead, the avatar's own back hid it the whole way — 1-20 % of it drawn; round 5: drawn
 * whole at 0.7 it sat on the player's own head like a hair ornament).
 */
export { RING_GHOST_OPACITY };

/** Marks the see-through pass's meshes (`userData`): the E2E's ring probe tells them from the ring itself. */
export const RING_GHOST_KEY = "ringGhost";
const GHOST = { [RING_GHOST_KEY]: true };

/**
 * The ring's materials: the depth that sees over the ground around it (clickRing.ts) and the decals' offset. `ghost`:
 * the see-through pass — the same ring drawn only where its depth test FAILS (GreaterDepth: something nearer covers
 * it there — the avatar's own body, another avatar, a bench, leaves), dashed and thinner at RING_GHOST_OPACITY. Every
 * pixel of the ring is tested by exactly one of the two passes (the same fragment depth, complementary tests): plain
 * where it is in view, a dashed outline where it is covered, never simply gone.
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
    if (ghost) {
      shader.vertexShader = RING_GHOST_VERTEX_PARS + shader.vertexShader.replace("#include <begin_vertex>", RING_GHOST_VERTEX);
      shader.fragmentShader = RING_GHOST_FRAGMENT_PARS + shader.fragmentShader.replace("#include <alphamap_fragment>", RING_GHOST_FRAGMENT);
    }
  };
  m.customProgramCacheKey = () => (ghost ? "click-ring-ghost" : "click-ring");
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
 * draws the ring exactly where the first one's depth test fails (ringMaterial `ghost`). Behind the player's own body —
 * straight ahead of a walk away from the camera, the whole way — the body fades and the ring shows through it
 * (hiddenBySelf, selfBody.hidingRing, LocalPlayer; round 6 review: only its dashes showed, on the body, like a hair
 * ornament).
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
      ringGhost: ringMaterial(RING_GHOST_COLOR, uniforms, true),
    }),
    [uniforms],
  );
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) m.dispose();
    },
    [mats],
  );
  // no ring any more: the own body comes back in full
  useEffect(
    () => () => {
      selfBody.hidingRing = false;
    },
    [],
  );

  useFrame(({ clock, camera, size }) => {
    const place = placeRef.current;
    const pulseGroup = pulseRef.current;
    if (!place || !pulseGroup) return;
    const target = peekClickRing();
    if (!target) {
      if (place.visible) place.visible = false;
      selfBody.hidingRing = false;
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
    const sinElev = dy / Math.max(dist, 1e-4);
    const scale = cam.isPerspectiveCamera ? ringScreenScale(dist, sinElev, cam.fov, size.height) : 1;
    place.scale.set(scale, 1, scale);
    // the player's own body in front of it: LocalPlayer fades the body so the ring shows through it
    selfBody.hidingRing = hiddenBySelf(cam, size.height, target.x, y, target.z, dist, sinElev, scale);
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
        {/* the see-through pass: where something nearer covers the ring, a dashed outline of it (ringMaterial `ghost`) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={RING_RENDER_ORDER} material={mats.ringGhost} userData={GHOST}>
          <ringGeometry args={[RING_INNER, RING_OUTER, 64]} />
        </mesh>
      </group>
    </group>
  );
}
