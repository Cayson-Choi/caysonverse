import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { AnimationMixer, Group, LoopOnce, type AnimationAction, type Material } from "three";
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
  CROWN_MODEL,
  MODEL_FACING_OFFSET,
  NAMETAG_MAX_DIST,
  RENDER_DELAY_MS,
} from "./constants";

/** Fallback seconds for a sit/stand clip if its duration can't be read yet. */
const SIT_CLIP_FALLBACK_SEC = 0.8;

/** Play a one-shot clip clamped on its last frame; returns its duration (s). */
function playOnce(action: AnimationAction | null): number {
  if (!action) return SIT_CLIP_FALLBACK_SEC;
  action.reset();
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.fadeIn(ANIM_FADE).play();
  return action.getClip().duration || SIT_CLIP_FALLBACK_SEC;
}

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
  // Crown GLB is loaded (once, cached by drei) for every avatar so the hook order
  // is stable; it is only attached when this preset is a royal (preset.crown).
  const { scene: crownScene } = useGLTF(CROWN_MODEL);

  const groupRef = useRef<Group>(null);

  // Speech bubble above this avatar, driven by the chat broadcast. Cleaned up
  // with the avatar when it unmounts (leaving player) — no leaked sprites.
  useSpeechBubble(sessionId, groupRef);
  // Emoji reaction above this avatar, driven by the emoji broadcast. Same
  // cleanup-with-avatar discipline as the speech bubble.
  useEmoji(sessionId, groupRef);

  // Build heavy resources ONCE. Disposed on unmount (see the cleanup effect). The
  // crown's cloned materials ride along in avatar.materials, so the existing
  // opacity + disposal paths cover them; its shared geometry is never disposed.
  const avatar = useMemo(
    () =>
      cloneTinted(scene, tint, {
        hideNodes: preset.hideNodes,
        crown: preset.crown,
        crownScene,
      }),
    [scene, tint, preset, crownScene],
  );
  const nametag = useMemo(() => createNametag(nickname), [nickname]);
  const mixer = useMemo(() => new AnimationMixer(avatar.root), [avatar]);

  // Per-frame mutable state — refs, never React state.
  const idleAction = useRef<AnimationAction | null>(null);
  const walkAction = useRef<AnimationAction | null>(null);
  const sitDownAction = useRef<AnimationAction | null>(null);
  const sitIdleAction = useRef<AnimationAction | null>(null);
  const sitStandAction = useRef<AnimationAction | null>(null);
  const walkingRef = useRef(false);
  const fadeRef = useRef(0); // remaining crossfade time (s); mixer ticks while > 0
  // Seating anim state machine: `up` = normal loco; `sitting`/`standing` are the
  // one-shot transient clips; `seated` is the held Sit_Chair_Idle pose.
  const seatModeRef = useRef<"up" | "sitting" | "seated" | "standing">("up");
  const seatTimerRef = useRef(0); // seconds left in the current transient clip
  const framesSinceRef = useRef(0); // frames since last mixer.update
  const accDeltaRef = useRef(0); // accumulated delta (s) since last mixer.update
  const prevConnectedRef = useRef(true);

  // Bind idle/walk/sit actions and settle the resting pose (mixer stays paused
  // afterward — an idle/seated avatar is a frozen pose, per the v1 mixer rules).
  // A remote that is ALREADY seated when we join settles straight into the held
  // seated pose (no replayed sit-down animation).
  useEffect(() => {
    const bind = (name: string): AnimationAction | null => {
      const clip = animations.find((c) => c.name === name);
      return clip ? mixer.clipAction(clip) : null;
    };
    idleAction.current = bind(CLIP.idle);
    walkAction.current = bind(CLIP.walk);
    sitDownAction.current = bind(CLIP.sitDown);
    sitIdleAction.current = bind(CLIP.sitIdle);
    sitStandAction.current = bind(CLIP.sitStand);

    const startedSeated = (getRemoteRecord(sessionId)?.seatIndex ?? -1) >= 0;
    if (startedSeated) {
      sitIdleAction.current?.reset().fadeIn(0).play();
      seatModeRef.current = "seated";
    } else {
      idleAction.current?.reset().fadeIn(0).play();
      seatModeRef.current = "up";
    }
    mixer.update(0); // apply frame 0 so we don't render the bind/T-pose
    return () => {
      mixer.stopAllAction();
    };
  }, [mixer, animations, sessionId]);

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
    //    Seated players emit no moves, so their buffer converges on the seat
    //    position/yaw — interpolation naturally settles them onto the chair.
    const renderT = performance.now() - RENDER_DELAY_MS;
    const target = sample(rec.snapshots, renderT);
    let snapped = false;
    if (target) {
      snapped = exceedsSnapDistance(group.position.x, group.position.z, target.x, target.z);
      group.position.set(target.x, 0, target.z);
      group.rotation.y = target.yaw + MODEL_FACING_OFFSET;
    }

    // 2) Seat transitions (server-authoritative seatIndex). Sitting/standing are
    //    one-shot clips; the walk/idle machine is frozen while not `up`.
    const seated = rec.seatIndex >= 0;
    if (seated && seatModeRef.current === "up") {
      (walkingRef.current ? walkAction.current : idleAction.current)?.fadeOut(ANIM_FADE);
      walkingRef.current = false;
      seatTimerRef.current = playOnce(sitDownAction.current);
      seatModeRef.current = "sitting";
    } else if (!seated && (seatModeRef.current === "seated" || seatModeRef.current === "sitting")) {
      sitIdleAction.current?.fadeOut(ANIM_FADE);
      sitDownAction.current?.fadeOut(ANIM_FADE);
      seatTimerRef.current = playOnce(sitStandAction.current);
      seatModeRef.current = "standing";
    }

    // 3) Advance the transient sit/stand clips off a timer, then hand off.
    if (seatModeRef.current === "sitting") {
      seatTimerRef.current -= delta;
      if (seatTimerRef.current <= 0) {
        sitDownAction.current?.fadeOut(ANIM_FADE);
        sitIdleAction.current?.reset().fadeIn(ANIM_FADE).play();
        seatModeRef.current = "seated";
        fadeRef.current = ANIM_FADE;
      }
    } else if (seatModeRef.current === "standing") {
      seatTimerRef.current -= delta;
      if (seatTimerRef.current <= 0) {
        sitStandAction.current?.fadeOut(ANIM_FADE);
        idleAction.current?.reset().fadeIn(ANIM_FADE).play();
        walkingRef.current = false;
        seatModeRef.current = "up";
        fadeRef.current = ANIM_FADE;
      }
    }

    // 4) Locomotion from interpolated speed — ONLY while standing (a seated avatar
    //    must never show the walk cycle, even if a stray snapshot implies speed).
    if (target && seatModeRef.current === "up") {
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

    // 5) Connected → opacity, applied only on transition (not every frame).
    if (rec.connected !== prevConnectedRef.current) {
      applyOpacity(avatar.materials, rec.connected ? 1 : 0.5);
      prevConnectedRef.current = rec.connected;
    }

    // 6) Nametag culling by camera distance (reused for the mixer throttle).
    const camDist = state.camera.position.distanceTo(group.position);
    nametag.sprite.visible = camDist <= NAMETAG_MAX_DIST;

    // 7) Mixer discipline: paused while idle/seated-settled; every-frame during a
    //    crossfade OR a one-shot sit/stand clip; distance-throttled while walking.
    const transient = seatModeRef.current === "sitting" || seatModeRef.current === "standing";
    const active = walkingRef.current || fadeRef.current > 0 || transient;
    if (active) {
      accDeltaRef.current += delta;
      framesSinceRef.current += 1;
      if (fadeRef.current > 0 || transient) {
        mixer.update(accDeltaRef.current);
        accDeltaRef.current = 0;
        framesSinceRef.current = 0;
        if (fadeRef.current > 0) fadeRef.current = Math.max(0, fadeRef.current - delta);
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
