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
import { sample, exceedsSnapDistance, remoteGaitSpeed } from "./interpolation";
import { nextGait } from "./locomotion";
import { remoteGaitProbe } from "./gait";
import type { Gait } from "./gait";
import { decideMixerTick } from "./mixerThrottle";
import { typingRegistry } from "./typing";
import {
  JUMP_FADE_IN_S,
  currentJump,
  jumpOffsetY,
  jumpPhase,
  jumpRegistry,
  jumpTimeScale,
} from "./jump";
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
  const runAction = useRef<AnimationAction | null>(null);
  const sitDownAction = useRef<AnimationAction | null>(null);
  const sitIdleAction = useRef<AnimationAction | null>(null);
  const sitStandAction = useRef<AnimationAction | null>(null);
  const jumpAction = useRef<AnimationAction | null>(null);
  // Jump (Task 11): seq of the registry hop currently animating (-1 = none), and the
  // wrapper that keeps the blob shadow on the floor while the avatar is in the air.
  const jumpSeqRef = useRef(-1);
  const shadowRef = useRef<Group>(null);
  // Current gait (idle / walk / run), derived from interpolated speed only.
  const gaitRef = useRef<Gait>("idle");
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
    runAction.current = bind(CLIP.run);
    sitDownAction.current = bind(CLIP.sitDown);
    sitIdleAction.current = bind(CLIP.sitIdle);
    sitStandAction.current = bind(CLIP.sitStand);
    jumpAction.current = bind(CLIP.jump);

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

  // DEV-only E2E probe (window.__cv.getRemoteGaits): publish this avatar's gait,
  // and drop the entry when it leaves. Dead code in production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    remoteGaitProbe.set(sessionId, "idle");
    return () => {
      remoteGaitProbe.delete(sessionId);
    };
  }, [sessionId]);

  /** The looping action that belongs to a gait (null if the clip is missing). */
  const gaitAction = (g: Gait): AnimationAction | null =>
    g === "run" ? runAction.current : g === "walk" ? walkAction.current : idleAction.current;

  /** Settle on a gait (the caller owns the crossfade) and mirror it to the DEV probe. */
  const setGait = (g: Gait): void => {
    gaitRef.current = g;
    if (import.meta.env.DEV) remoteGaitProbe.set(sessionId, g);
  };

  // A leaving avatar takes its pending hop and its typing "…" with it, so a reused sid
  // can't inherit either.
  useEffect(() => {
    return () => {
      jumpRegistry.remove(sessionId);
      typingRegistry.remove(sessionId);
    };
  }, [sessionId]);

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
    const nowMs = performance.now();
    const renderT = nowMs - RENDER_DELAY_MS;
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
      gaitAction(gaitRef.current)?.fadeOut(ANIM_FADE);
      setGait("idle");
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
        setGait("idle");
        seatModeRef.current = "up";
        fadeRef.current = ANIM_FADE;
      }
    }

    // 3b) Jump (Task 11): a broadcast hop lifts the group (display only — the server
    //    y never changes) and plays Jump_Full_Short once, squeezed into
    //    JUMP_DURATION_MS. Only a standing avatar hops: a seated or sitting/standing
    //    one drops the hop (no late replay), and a hop in the air when the seat is
    //    confirmed just fades out. Registry reads allocate nothing.
    let lift = 0;
    let landed = false;
    {
      const canJump = seatModeRef.current === "up";
      const entry = currentJump(sessionId, canJump, nowMs);
      const phase = jumpPhase(entry, canJump, jumpSeqRef.current);
      const jump = jumpAction.current;
      if (phase === "takeoff" || phase === "air") {
        const hop = entry!; // takeoff / air only happen with a live entry
        if (phase === "takeoff") {
          jumpSeqRef.current = hop.seq;
          if (jump) {
            gaitAction(gaitRef.current)?.fadeOut(JUMP_FADE_IN_S);
            jump.timeScale = jumpTimeScale(jump.getClip().duration);
            jump.reset();
            jump.setLoop(LoopOnce, 1);
            jump.clampWhenFinished = true;
            jump.fadeIn(JUMP_FADE_IN_S).play();
          }
        }
        lift = jumpOffsetY(nowMs - hop.startedAt);
      } else if (phase === "landed" || phase === "dropped") {
        jumpSeqRef.current = -1;
        if (jump) {
          jump.fadeOut(ANIM_FADE);
          if (phase === "landed") {
            // Landed: resume the gait loop; step 4 re-syncs it next frame if the
            // avatar started or stopped moving meanwhile.
            gaitAction(gaitRef.current)?.reset().fadeIn(ANIM_FADE).play();
            landed = true;
          }
          fadeRef.current = ANIM_FADE; // keep the mixer ticking through the crossfade
        }
      }
      group.position.y = lift;
      if (shadowRef.current) shadowRef.current.position.y = -lift;
    }

    // 4) Locomotion from interpolated speed — ONLY while standing (a seated avatar
    //    must never show the walk or run cycle, even if a stray snapshot implies speed)
    //    and not mid-hop (the hop owns the body; landing resumes the loop above).
    if (target && seatModeRef.current === "up" && jumpSeqRef.current === -1 && !landed) {
      // Gait speed is a windowed path length (not the noisy per-segment speed), so
      // receive-time bursts and jitter cannot flip walk <-> run; see remoteGaitSpeed.
      const speed = snapped ? 0 : remoteGaitSpeed(rec.snapshots, renderT);
      const gait = nextGait(gaitRef.current, speed);
      if (gait !== gaitRef.current) {
        gaitAction(gaitRef.current)?.fadeOut(ANIM_FADE);
        gaitAction(gait)?.reset().fadeIn(ANIM_FADE).play();
        setGait(gait);
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
    //    crossfade OR a one-shot sit/stand/jump clip; distance-throttled while walking/running.
    const transient =
      seatModeRef.current === "sitting" ||
      seatModeRef.current === "standing" ||
      jumpSeqRef.current !== -1;
    const active = gaitRef.current !== "idle" || fadeRef.current > 0 || transient;
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
      {blobShadow && (
        <group ref={shadowRef}>
          <BlobShadow />
        </group>
      )}
    </group>
  );
}
