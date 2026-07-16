import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF, useKeyboardControls } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { Color, Group, Mesh, Material, LoopOnce } from "three";
import { MOVE_SPEED, WORLD_BOUNDS, TINT_COLORS } from "@caysonverse/shared/constants";
import { OBSTACLES, PLAYER_RADIUS, SEATS } from "@caysonverse/shared/worldMap";
import { resolveCollision } from "@caysonverse/shared/collision";
import { readIntent, worldDirection } from "./input";
import type { Intent } from "./input";
import { guardMoveKeys, isUiCaptured } from "./uiCapture";
import { BlobShadow } from "./BlobShadow";
import { useSpeechBubble } from "./useSpeechBubble";
import { useEmoji } from "./useEmoji";
import { stepYaw } from "./yaw";
import { createMoveSender } from "./moveSender";
import { installDebugHook } from "./debug";
import { ANIM_FADE, CHARACTERS, CLIP, MODEL_FACING_OFFSET, TURN_SPEED } from "./constants";
import type { MoveControl } from "./constants";
import type { Orbit, Pose, SeatState } from "./types";
import { getRoom, sendMove, sendStand } from "../net/connection";
import { isInputSuspended } from "../net/resilience";

/** Fallback seconds for a sit/stand clip if its duration can't be read yet. */
const SIT_CLIP_FALLBACK_SEC = 0.8;

interface LocalPlayerProps {
  /** Own session id — keys this player's speech bubble in the broadcast. */
  sessionId: string;
  character: number;
  tint: number;
  /** Shared mutable pose (mutated per frame — never React state). */
  pose: Pose;
  /** Shared mutable camera orbit (read for camera-relative movement). */
  orbit: Orbit;
  /** The local player's server-confirmed seat (schema-driven; never optimistic). */
  seat: SeatState;
  /**
   * Shared mutable joystick intent (touch). Written by the virtual joystick,
   * read here each frame and ADDED to the keyboard intent so both input paths
   * drive ONE camera-relative movement (no forked path). Zeroed when idle/in the
   * dead-zone; on desktop it stays {0,0} and this is a no-op.
   */
  moveInput: Intent;
  /** Draw a cheap blob shadow under this avatar (low-spec/touch profile). */
  blobShadow: boolean;
}

/** Clone a material so tinting never mutates the shared cached asset material. */
function tintMaterial(material: Material, color: Color): Material {
  const cloned = material.clone();
  // KayKit materials expose `.color`; multiply-tint darkens toward the hue.
  const withColor = cloned as Material & { color?: Color };
  if (withColor.color) withColor.color.copy(color);
  return cloned;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function LocalPlayer({
  sessionId,
  character,
  tint,
  pose,
  orbit,
  seat,
  moveInput,
  blobShadow,
}: LocalPlayerProps) {
  const preset = CHARACTERS[character];
  const { scene, animations } = useGLTF(preset.model);
  const [, getKeys] = useKeyboardControls<MoveControl>();
  const groupRef = useRef<Group>(null);
  const movingRef = useRef(false);
  // Seating anim state machine (v2 Task 1). `loco` = normal walk/idle; `sitDown`
  // and `standUp` are one-shot transient clips; `sitIdle` is the held seated pose.
  const animStateRef = useRef<"loco" | "sitDown" | "sitIdle" | "standUp">("loco");
  const animTimerRef = useRef(0); // seconds left in the current transient clip
  const prevSeatRef = useRef(-1); // previous confirmed seatIndex (transition edge)
  const standRequestedRef = useRef(false); // debounce: one Stand per seated episode

  // Own speech bubble: driven by the server broadcast (not a local echo), so
  // self and remotes share one path. Attached above this avatar's group.
  useSpeechBubble(sessionId, groupRef);
  // Own emoji reaction: same broadcast-driven, self-included discipline.
  useEmoji(sessionId, groupRef);

  // Clone the skinned hierarchy (independent skeleton) and tint cloned materials
  // ONCE per character/tint — not per frame.
  const model = useMemo(() => {
    const cloned = SkeletonUtils.clone(scene);
    const color = new Color(TINT_COLORS[tint]);
    cloned.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => tintMaterial(m, color))
        : tintMaterial(mesh.material, color);
    });
    return cloned;
  }, [scene, tint]);

  const { actions } = useAnimations(animations, model);

  // Start idle; expose the E2E pose hook (with live seatIndex) for this lifetime.
  useEffect(() => {
    const idle = actions[CLIP.idle];
    idle?.reset().fadeIn(0).play();
    const removeHook = installDebugHook(() => pose, () => orbit, () => seat.index);
    return () => {
      removeHook();
      actions[CLIP.idle]?.stop();
      actions[CLIP.walk]?.stop();
      actions[CLIP.sitDown]?.stop();
      actions[CLIP.sitIdle]?.stop();
      actions[CLIP.sitStand]?.stop();
    };
    // actions identity changes when the (memoized) model does — safe to depend on.
  }, [actions, pose, orbit, seat]);

  const sender = useRef(createMoveSender(sendMove)).current;

  /** Play a one-shot clip (clamped on its last frame); returns its duration (s). */
  function playOnce(name: string): number {
    const action = actions[name];
    if (!action) return SIT_CLIP_FALLBACK_SEC;
    action.reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.fadeIn(ANIM_FADE).play();
    return action.getClip().duration || SIT_CLIP_FALLBACK_SEC;
  }

  useFrame((_state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // Focus guard: while the chat input owns keyboard input — OR while the
    // resilience driver is reconnecting (world frozen behind the overlay) —
    // movement keys are zeroed so nothing walks the avatar. We don't touch drei's
    // key listeners, so nothing can get stuck on blur (see uiCapture.ts).
    const suspended = isInputSuspended();
    const keys = guardMoveKeys(getKeys(), isUiCaptured() || suspended);
    const keyIntent = readIntent(keys);
    // Combine keyboard + joystick into ONE camera-relative intent. worldDirection
    // normalizes, so a blended push still moves at the constant MOVE_SPEED. While
    // suspended, the joystick contribution is dropped too (full input freeze).
    const intent: Intent = suspended
      ? { forward: 0, right: 0 }
      : {
          forward: keyIntent.forward + moveInput.forward,
          right: keyIntent.right + moveInput.right,
        };
    const moving = intent.forward !== 0 || intent.right !== 0;

    // Seat state is server-authoritative (schema). LocalPlayer only CONFIRMS the
    // transition here — it never self-declares seated.
    const seatIndex = seat.index;
    const seated = seatIndex >= 0;
    const wasSeated = prevSeatRef.current >= 0;

    if (seated && !wasSeated) {
      // Sit confirmed: snap onto the seat, stop locomotion, play Down → hold Idle.
      const s = SEATS[seatIndex];
      pose.x = s.x;
      pose.z = s.z;
      pose.yaw = s.yaw;
      (movingRef.current ? actions[CLIP.walk] : actions[CLIP.idle])?.fadeOut(ANIM_FADE);
      movingRef.current = false;
      standRequestedRef.current = false;
      animTimerRef.current = playOnce(CLIP.sitDown);
      animStateRef.current = "sitDown";
    } else if (!seated && wasSeated) {
      // Stand confirmed: snap to the server's dismount pose, play StandUp → loco.
      const me = getRoom()?.state?.players?.get?.(sessionId);
      if (me) {
        pose.x = me.x;
        pose.z = me.z;
        pose.yaw = me.yaw;
      }
      actions[CLIP.sitIdle]?.fadeOut(ANIM_FADE);
      actions[CLIP.sitDown]?.fadeOut(ANIM_FADE);
      animTimerRef.current = playOnce(CLIP.sitStand);
      animStateRef.current = "standUp";
    }
    prevSeatRef.current = seatIndex;

    // Advance the one-shot sit/stand clips off a timer (the mixer is auto-ticked
    // by drei's useAnimations, so the clips play regardless of this branch).
    if (animStateRef.current === "sitDown") {
      animTimerRef.current -= delta;
      if (animTimerRef.current <= 0) {
        actions[CLIP.sitDown]?.fadeOut(ANIM_FADE);
        actions[CLIP.sitIdle]?.reset().fadeIn(ANIM_FADE).play();
        animStateRef.current = "sitIdle";
      }
    } else if (animStateRef.current === "standUp") {
      animTimerRef.current -= delta;
      if (animTimerRef.current <= 0) {
        actions[CLIP.sitStand]?.fadeOut(ANIM_FADE);
        animStateRef.current = "loco";
        movingRef.current = !moving; // force the loco crossfade to re-sync next frame
      }
    }

    // Seated → fully server-positioned: no integration, no moveSender. Standing up
    // is explicit — any movement intent (keys or joystick) sends ONE Stand.
    if (seated) {
      if (moving && !standRequestedRef.current) {
        sendStand();
        standRequestedRef.current = true;
      }
      group.position.set(pose.x, 0, pose.z);
      group.rotation.y = pose.yaw + MODEL_FACING_OFFSET;
      return;
    }

    if (moving) {
      const dir = worldDirection(intent, orbit.yaw);
      // Slide the body (circle-vs-AABB) along walls/furniture from the SAME
      // OBSTACLES the server validates against, then keep the centre a radius
      // inside WORLD_BOUNDS as a backstop.
      const next = resolveCollision(
        pose.x,
        pose.z,
        dir.x * MOVE_SPEED * delta,
        dir.z * MOVE_SPEED * delta,
        PLAYER_RADIUS,
        OBSTACLES,
      );
      pose.x = clamp(next.x, WORLD_BOUNDS.minX + PLAYER_RADIUS, WORLD_BOUNDS.maxX - PLAYER_RADIUS);
      pose.z = clamp(next.z, WORLD_BOUNDS.minZ + PLAYER_RADIUS, WORLD_BOUNDS.maxZ - PLAYER_RADIUS);
      const targetYaw = Math.atan2(dir.x, dir.z);
      pose.yaw = stepYaw(pose.yaw, targetYaw, TURN_SPEED * delta);
    }

    group.position.set(pose.x, 0, pose.z);
    group.rotation.y = pose.yaw + MODEL_FACING_OFFSET;

    // Crossfade idle <-> walk on movement-state changes — but only in pure loco;
    // the StandUp one-shot owns the body until it finishes.
    if (animStateRef.current === "loco" && moving !== movingRef.current) {
      const from = movingRef.current ? actions[CLIP.walk] : actions[CLIP.idle];
      const to = moving ? actions[CLIP.walk] : actions[CLIP.idle];
      from?.fadeOut(ANIM_FADE);
      to?.reset().fadeIn(ANIM_FADE).play();
      movingRef.current = moving;
    }

    // Throttled network send (idle: nothing; moving: <=1 per PATCH_RATE_MS;
    // exactly one final message on stop).
    sender.update(performance.now(), moving, { x: pose.x, z: pose.z, yaw: pose.yaw });
  });

  return (
    <group ref={groupRef}>
      <primitive object={model} />
      {blobShadow && <BlobShadow />}
    </group>
  );
}
