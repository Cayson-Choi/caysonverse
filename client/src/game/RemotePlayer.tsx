import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { AnimationMixer, Group, type AnimationAction, type Material } from "three";
import { cloneTinted } from "./avatar";
import { BlobShadow } from "./BlobShadow";
import { createNametag } from "./nametag";
import { useSpeechBubble } from "./useSpeechBubble";
import { useEmoji } from "./useEmoji";
import { getRemoteRecord } from "./remoteStore";
import { sample, exceedsSnapDistance } from "./interpolation";
import { nextWalking } from "./locomotion";
import { decideMixerTick } from "./mixerThrottle";
import {
  ANIM_FADE,
  CHARACTERS,
  CLIP,
  MODEL_FACING_OFFSET,
  NAMETAG_MAX_DIST,
  RENDER_DELAY_MS,
} from "./constants";

/** Set opacity across an avatar's cloned materials (only when it changes). */
function applyOpacity(materials: Material[], opacity: number): void {
  const translucent = opacity < 1;
  for (const material of materials) {
    material.transparent = translucent;
    material.opacity = opacity;
    material.depthWrite = !translucent;
    material.needsUpdate = true;
  }
}

/**
 * One remote avatar. Identity (character/tint/nickname) is fixed for the mount;
 * position/yaw/locomotion are read from the store's snapshot buffer every frame
 * and written straight to the Object3D — never through React state. Mounted and
 * unmounted by the roster in RemotePlayers.
 */
export function RemotePlayer({
  sessionId,
  blobShadow,
}: {
  sessionId: string;
  /** Draw a cheap blob shadow under this avatar (low-spec/touch profile). */
  blobShadow: boolean;
}) {
  // Identity is captured once at mount (the record exists — the roster derives
  // from the same map). Snapshots are read live in useFrame, not here.
  const record = getRemoteRecord(sessionId);
  const character = record?.character ?? 0;
  const tint = record?.tint ?? 0;
  const nickname = record?.nickname ?? "";

  const preset = CHARACTERS[character];
  const { scene, animations } = useGLTF(preset.model);

  const groupRef = useRef<Group>(null);

  // Speech bubble above this avatar, driven by the chat broadcast. Cleaned up
  // with the avatar when it unmounts (leaving player) — no leaked sprites.
  useSpeechBubble(sessionId, groupRef);
  // Emoji reaction above this avatar, driven by the emoji broadcast. Same
  // cleanup-with-avatar discipline as the speech bubble.
  useEmoji(sessionId, groupRef);

  // Build heavy resources ONCE. Disposed on unmount (see the cleanup effect).
  const avatar = useMemo(() => cloneTinted(scene, tint), [scene, tint]);
  const nametag = useMemo(() => createNametag(nickname), [nickname]);
  const mixer = useMemo(() => new AnimationMixer(avatar.root), [avatar]);

  // Per-frame mutable state — refs, never React state.
  const idleAction = useRef<AnimationAction | null>(null);
  const walkAction = useRef<AnimationAction | null>(null);
  const walkingRef = useRef(false);
  const fadeRef = useRef(0); // remaining crossfade time (s); mixer ticks while > 0
  const framesSinceRef = useRef(0); // frames since last mixer.update
  const accDeltaRef = useRef(0); // accumulated delta (s) since last mixer.update
  const prevConnectedRef = useRef(true);

  // Bind the idle/walk actions and settle the idle pose (mixer stays paused
  // afterward — an idle avatar is a frozen idle pose, per the v1 mixer rules).
  useEffect(() => {
    const idleClip = animations.find((clip) => clip.name === CLIP.idle);
    const walkClip = animations.find((clip) => clip.name === CLIP.walk);
    const idle = idleClip ? mixer.clipAction(idleClip) : null;
    const walk = walkClip ? mixer.clipAction(walkClip) : null;
    idle?.reset().fadeIn(0).play();
    idleAction.current = idle;
    walkAction.current = walk;
    mixer.update(0); // apply idle frame 0 so we don't render the bind/T-pose
    return () => {
      mixer.stopAllAction();
    };
  }, [mixer, animations]);

  // Dispose per-avatar GPU resources on unmount. Cloned geometry/textures stay
  // shared with the cached GLTF and are intentionally NOT disposed here.
  useEffect(() => {
    const root = avatar.root;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      for (const material of avatar.materials) material.dispose();
      nametag.dispose();
    };
  }, [avatar, mixer, nametag]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    const rec = getRemoteRecord(sessionId);
    if (!group || !rec) return;

    // 1) Sample the snapshot buffer RENDER_DELAY_MS in the past and write pose.
    const renderT = performance.now() - RENDER_DELAY_MS;
    const target = sample(rec.snapshots, renderT);
    if (target) {
      const snapped = exceedsSnapDistance(group.position.x, group.position.z, target.x, target.z);
      group.position.set(target.x, 0, target.z);
      group.rotation.y = target.yaw + MODEL_FACING_OFFSET;

      // 2) Locomotion from interpolated speed (a teleport frame isn't walking).
      const speed = snapped ? 0 : target.speed;
      const walking = nextWalking(walkingRef.current, speed);
      if (walking !== walkingRef.current) {
        const from = walkingRef.current ? walkAction.current : idleAction.current;
        const to = walking ? walkAction.current : idleAction.current;
        from?.fadeOut(ANIM_FADE);
        to?.reset().fadeIn(ANIM_FADE).play();
        walkingRef.current = walking;
        fadeRef.current = ANIM_FADE;
      }
    }

    // 3) Connected → opacity, applied only on transition (not every frame).
    if (rec.connected !== prevConnectedRef.current) {
      applyOpacity(avatar.materials, rec.connected ? 1 : 0.5);
      prevConnectedRef.current = rec.connected;
    }

    // 4) Nametag culling by camera distance (reused for the mixer throttle).
    const camDist = state.camera.position.distanceTo(group.position);
    nametag.sprite.visible = camDist <= NAMETAG_MAX_DIST;

    // 5) Mixer discipline: paused while idle; every-frame during a crossfade;
    //    distance-throttled while walking.
    const active = walkingRef.current || fadeRef.current > 0;
    if (active) {
      accDeltaRef.current += delta;
      framesSinceRef.current += 1;
      if (fadeRef.current > 0) {
        mixer.update(accDeltaRef.current);
        accDeltaRef.current = 0;
        framesSinceRef.current = 0;
        fadeRef.current = Math.max(0, fadeRef.current - delta);
      } else {
        const tick = decideMixerTick(camDist, framesSinceRef.current, accDeltaRef.current);
        if (tick.update) {
          mixer.update(tick.delta);
          accDeltaRef.current = 0;
          framesSinceRef.current = 0;
        }
      }
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={avatar.root} />
      <primitive object={nametag.sprite} />
      {blobShadow && <BlobShadow />}
    </group>
  );
}
