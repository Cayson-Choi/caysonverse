import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF, useKeyboardControls } from "@react-three/drei";
import { Group, LoopOnce } from "three";
import { MOVE_SPEED, WORLD_BOUNDS } from "@caysonverse/shared/constants";
import { OBSTACLES, PLAYER_RADIUS, SEATS } from "@caysonverse/shared/worldMap";
import { resolveCollision } from "@caysonverse/shared/collision";
import { readIntent, worldDirection } from "./input";
import type { Intent } from "./input";
import {
  stepClickMove,
  dirToIntent,
  clearClickTarget,
  getClickTarget,
  resetClickMove,
} from "./clickMove";
import { guardMoveKeys, isUiCaptured } from "./uiCapture";
import { viewState } from "./viewState";
import { HIDE_BLEND, OV_VIS_BLEND, stepFollowYaw } from "./viewMode";
import { cloneTinted } from "./avatar";
import { BlobShadow } from "./BlobShadow";
import { useSpeechBubble } from "./useSpeechBubble";
import { useEmoji } from "./useEmoji";
import { normalizeAngle, stepYaw } from "./yaw";
import { createMoveSender } from "./moveSender";
import { installDebugHook } from "./debug";
import { ANIM_FADE, CHARACTERS, CLIP, CROWN_MODEL, MODEL_FACING_OFFSET, TURN_SPEED } from "./constants";
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
  // Crown GLB is loaded (once, cached) for every character to keep hook order
  // stable; attached only when this preset is a royal (preset.crown).
  const { scene: crownScene } = useGLTF(CROWN_MODEL);
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

  // Clone the skinned hierarchy (independent skeleton), tint cloned materials, and
  // (for royals) hide accessories + attach the crown — ONCE per character/tint via
  // the SAME assembly path remotes use, not per frame.
  const avatar = useMemo(
    () => cloneTinted(scene, tint, { hideNodes: preset.hideNodes, crown: preset.crown, crownScene }),
    [scene, tint, preset, crownScene],
  );
  const model = avatar.root;

  // Dispose this avatar's cloned materials (body + crown) on unmount; shared
  // geometry/textures stay with the cache and are intentionally not disposed.
  useEffect(() => {
    return () => {
      for (const material of avatar.materials) material.dispose();
    };
  }, [avatar]);

  const { actions } = useAnimations(animations, model);

  // Start idle; expose the E2E pose hook (with live seatIndex) for this lifetime.
  useEffect(() => {
    const idle = actions[CLIP.idle];
    idle?.reset().fadeIn(0).play();
    const removeHook = installDebugHook(
      () => pose,
      () => orbit,
      () => seat.index,
      () => groupRef.current?.visible ?? true,
    );
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

  // 클릭 자동 이동 리셋 (design 29 (e)): 이 컴포넌트는 접속 세대(epoch)마다
  // 리마운트되므로, 마운트/언마운트 양쪽에서 target을 비워 재접속·월드 교체
  // 후에 이전 세계의 목표 지점으로 걸어가는 일이 없게 한다.
  useEffect(() => {
    resetClickMove();
    return () => resetClickMove();
  }, []);

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

    // Own-avatar hiding (design 19): in first-person the LOCAL avatar GROUP is
    // hidden past the mid-blend point — body, crown, AND blob shadow together
    // (all children of this group), plus the own speech-bubble / emoji sprites
    // (also parented here), which is correct: you don't see your own bubble in FP.
    // Set on EVERY path (incl. seated below) and restored automatically on exit /
    // reconnect remount (resetViewMode zeroes the blend). Remote avatars, seats,
    // and the maze are untouched — they live in other groups. Overview is a
    // third-person top-down: the own avatar is shown there (design 20) even if it
    // was hidden in the FP it was opened from — gated on the ov BLEND, not the
    // instant mode flip, so neither transition direction flashes near the eye.
    group.visible = viewState.ovBlend > OV_VIS_BLEND ? true : viewState.blend < HIDE_BLEND;

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

    // Movement stays camera-relative off the ACTIVE view yaw: the TP orbit yaw in
    // third-person, the FP look yaw in first-person (design 19), or a FIXED yaw 0
    // in overview — so W = -Z (north) on the screen regardless of the free pan
    // (design 20). The overview camera itself never follows the player.
    const inFp = viewState.mode === "fp";
    const inOv = viewState.mode === "ov";
    const activeYaw = inFp ? viewState.fpYaw : inOv ? 0 : orbit.yaw;

    // Seat state is server-authoritative (schema). LocalPlayer only CONFIRMS the
    // transition here — it never self-declares seated.
    const seatIndex = seat.index;
    const seated = seatIndex >= 0;
    const wasSeated = prevSeatRef.current >= 0;

    // 클릭 자동 이동 (design 29): 수동 이동 입력(키/조이스틱/D-패드)이 하나라도
    // 있으면 target을 즉시 버리고(자동 이동은 수동 입력에 항상 양보), 없으면
    // target 방향 단위벡터를 카메라 기준 intent로 되투영(dirToIntent)해 합성한다
    // — 아래의 기존 worldDirection → 충돌 슬라이드 → moveSender 경로를 그대로
    // 통과하므로 이동 코드 포크가 없다(일반 이동과 동일 속도·검증). 도착·진행
    // 불가(벽) 해제는 stepClickMove가 스스로 판정하고, 착석 중에는 조향하지
    // 않는다(착석 분기가 "이동 입력=기립"으로 위임 — 아래).
    const manual = intent.forward !== 0 || intent.right !== 0;
    if (manual) {
      clearClickTarget();
    } else if (!suspended && !seated) {
      const autoDir = stepClickMove(pose.x, pose.z, delta);
      if (autoDir) {
        const auto = dirToIntent(autoDir, activeYaw);
        intent.forward = auto.forward;
        intent.right = auto.right;
      }
    }
    const moving = intent.forward !== 0 || intent.right !== 0;

    if (seated && !wasSeated) {
      // Sit confirmed: snap onto the seat, stop locomotion, play Down → hold Idle.
      // 진행 중이던 클릭 자동 이동도 여기서 해제된다 (design 29 (e) 착석 완료).
      clearClickTarget();
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
    // is explicit — any movement intent (keys or joystick) sends ONE Stand. 착석
    // 중 바닥 클릭도 같은 규칙에 위임한다(design 29 착석 상호작용): target이
    // 잡히면 Stand 한 번을 보내고 target은 남겨 두어, 기립이 확정되면 자동
    // 이동이 그 지점으로 이어진다 — "자동 기립 후 이동" 채택.
    if (seated) {
      if ((moving || getClickTarget() !== null) && !standRequestedRef.current) {
        sendStand();
        standRequestedRef.current = true;
      }
      group.position.set(pose.x, 0, pose.z);
      group.rotation.y = pose.yaw + MODEL_FACING_OFFSET;
      return;
    }

    if (moving) {
      const dir = worldDirection(intent, activeYaw);
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
      if (inFp) {
        // FP look-follows-movement (design 20): rotate the look toward the walk
        // direction at a gentle rate. `dir` came from the CURRENT look, so W keeps
        // the look still and a strafe curves it. Paused while a look-drag is active
        // (viewState.dragging) so drag look-control always takes priority.
        viewState.fpYaw = stepFollowYaw(viewState.fpYaw, dir, delta, viewState.dragging);
      } else {
        // TP + overview: the (visible) body turns smoothly toward the movement dir.
        const targetYaw = Math.atan2(dir.x, dir.z);
        pose.yaw = stepYaw(pose.yaw, targetYaw, TURN_SPEED * delta);
      }
    }
    // FP: the body yaw follows the look direction DIRECTLY (no TURN_SPEED lag),
    // moving or standing. Network semantics are unchanged — yaw still reaches
    // others only via move messages (moveSender fires on movement); there is NO
    // idle-yaw streaming, so rotating the view while standing sends nothing.
    if (inFp) pose.yaw = normalizeAngle(viewState.fpYaw);

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
