import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF, useKeyboardControls } from "@react-three/drei";
import { Group, LoopOnce } from "three";
import { WORLD_BOUNDS } from "@caysonverse/shared/constants";
import { PLAYER_RADIUS, SEATS } from "@caysonverse/shared/worldMap";
import { resolveCollision } from "@caysonverse/shared/collision";
import { collectObstacles } from "./playerObstacles";
import { readIntent, worldDirection } from "./input";
import type { Intent, MoveInput } from "./input";
import { gaitClip, gaitFor, moveSpeed } from "./gait";
import type { Gait } from "./gait";
import {
  stepClickMove,
  dirToIntent,
  clearClickTarget,
  getClickTarget,
  resetClickMove,
} from "./clickMove";
import { guardMoveKeys, isUiCaptured } from "./uiCapture";
import { onHotkey } from "./hotkeys";
import {
  JUMP_FADE_IN_S,
  currentJump,
  jumpOffsetY,
  jumpPhase,
  jumpRegistry,
  jumpTimeScale,
  pressJump,
  publishLocalJump,
  resetLocalJump,
} from "./jump";
import { beginSeatCamera, endSeatCamera, viewState } from "./viewState";
import { HIDE_BLEND, OV_VIS_BLEND } from "./viewMode";
import { cloneTinted } from "./avatar";
import { BlobShadow } from "./BlobShadow";
import { createNametag } from "./nametag";
import { registerLabel } from "./labelRegistry";
import { isLocalTeacher } from "./ownNametag";
import { useSpeechBubble } from "./useSpeechBubble";
import { useEmoji } from "./useEmoji";
import { normalizeAngle, stepYaw } from "./yaw";
import { createMoveSender } from "./moveSender";
import { installDebugHook } from "./debug";
import {
  ANIM_FADE,
  BUBBLE_BASE_HEIGHT,
  CHARACTERS,
  CLIP,
  CROWN_MODEL,
  MODEL_FACING_OFFSET,
  TURN_SPEED,
} from "./constants";
import type { MoveControl } from "./constants";
import type { Orbit, Pose, SeatState } from "./types";
import { getRoom, sendJump, sendMove, sendStand } from "../net/connection";
import { isInputSuspended } from "../net/resilience";
import { useAppStore } from "../stores/appStore";
import { useSettingsStore } from "../stores/settingsStore";

/** Fallback seconds for a sit/stand clip if its duration can't be read yet. */
const SIT_CLIP_FALLBACK_SEC = 0.8;

interface LocalPlayerProps {
  /** Own session id — keys this player's speech bubble in the broadcast. */
  sessionId: string;
  /** Own nickname — what the optional own name tag ("내 이름표 보기") says. */
  nickname: string;
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
   * dead-zone; on desktop it stays {0,0} and this is a no-op. `run` is the touch
   * run flag, OR-ed with the Shift key into the single run intent.
   */
  moveInput: MoveInput;
  /** Draw a cheap blob shadow under this avatar (low-spec/touch profile). */
  blobShadow: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function LocalPlayer({
  sessionId,
  nickname,
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
  // The gait the idle/walk/run crossfade last settled on (loco state only).
  const gaitRef = useRef<Gait>("idle");
  // Seating anim state machine (v2 Task 1). `loco` = normal walk/idle; `sitDown`
  // and `standUp` are one-shot transient clips; `sitIdle` is the held seated pose.
  const animStateRef = useRef<"loco" | "sitDown" | "sitIdle" | "standUp">("loco");
  const animTimerRef = useRef(0); // seconds left in the current transient clip
  const prevSeatRef = useRef(-1); // previous confirmed seatIndex (transition edge)
  const standRequestedRef = useRef(false); // debounce: one Stand per seated episode
  // Jump (Task 11): seq of the registry hop currently animating (-1 = none), and the
  // wrapper that keeps the blob shadow on the floor while the avatar is in the air.
  const jumpSeqRef = useRef(-1);
  const shadowRef = useRef<Group>(null);

  // Own speech bubble: driven by the server broadcast (not a local echo), so
  // self and remotes share one path. Attached above this avatar's group. It rests on
  // `bubbleAnchor`: the NametagSystem raises that to just above the own name tag while
  // "내 이름표 보기" is on (like a remote's bubble), and it stays at BUBBLE_BASE_HEIGHT
  // (2.5 m) otherwise, when no tag exists.
  const bubbleAnchor = useRef({ y: BUBBLE_BASE_HEIGHT }).current;
  const bubbleTop = useSpeechBubble(sessionId, groupRef, bubbleAnchor);

  // Own name tag — off by default; the player turns it on in the menu. Same create /
  // register / release pair as a remote avatar's (RemotePlayer), so the NametagSystem
  // sizes, fades and stacks it with the rest. Pinned: your own tag is never dropped for
  // being outside the nearest 15. The teacher badge follows the synced role (the admin
  // flag only stands in until the room state can be read).
  const showOwnNametag = useSettingsStore((s) => s.settings.showOwnNametag);
  const isAdmin = useAppStore((s) => s.isAdmin);
  useEffect(() => {
    const group = groupRef.current;
    if (!showOwnNametag || !group) return;
    const role = getRoom()?.state?.players?.get?.(sessionId)?.role;
    const tag = createNametag(nickname, isLocalTeacher(role, isAdmin) ? "teacher" : "none");
    tag.setOpacity(0); // fades in under the NametagSystem instead of flashing at full opacity
    group.add(tag.sprite);
    const unregister = registerLabel({
      id: sessionId,
      anchor: group,
      tag,
      pinned: true,
      bubbleAnchor,
    });
    return () => {
      unregister();
      group.remove(tag.sprite);
      tag.dispose();
      bubbleAnchor.y = BUBBLE_BASE_HEIGHT; // no tag any more: the bubble drops back to its default height
    };
  }, [showOwnNametag, sessionId, nickname, isAdmin, bubbleAnchor]);
  // Own emoji reaction: same broadcast-driven, self-included discipline; it starts above the own bubble.
  useEmoji(sessionId, groupRef, bubbleAnchor, bubbleTop);

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
      () => gaitRef.current,
    );
    return () => {
      removeHook();
      actions[CLIP.idle]?.stop();
      actions[CLIP.walk]?.stop();
      actions[CLIP.run]?.stop();
      actions[CLIP.sitDown]?.stop();
      actions[CLIP.sitIdle]?.stop();
      actions[CLIP.sitStand]?.stop();
      actions[CLIP.jump]?.stop();
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

  // 점프 (Task 11): Space는 공용 단축키 표가 입력 중·자동반복을 이미 걸러 준다.
  // 앉아 있거나, 앉기/일어서기 동작 중이거나, 재접속 중이면 누르기만 버린다 — 그
  // 판정은 아래 useFrame이 매 프레임 publishLocalJump로 올리는 "막힘" 깃발 하나이고,
  // 터치 점프 버튼도 같은 pressJump를 지나므로 두 경로가 어긋날 수 없다(서버도
  // 앉은 사람의 점프는 버린다). 컴포넌트 수명 동안 쿨다운·깃발·내 점프 기록을 비워
  // 새 세계에 이어지지 않게 한다.
  useEffect(() => {
    resetLocalJump();
    const off = onHotkey((action) => {
      if (action.type === "jump") pressJump(sessionId, performance.now(), sendJump);
    });
    return () => {
      off();
      resetLocalJump();
      jumpRegistry.remove(sessionId);
    };
  }, [sessionId]);

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

  /**
   * One frame of the hop (Task 11): detect a new jump in the registry (take-off:
   * fade the gait loop out, play Jump_Full_Short once at the speed that fits
   * JUMP_DURATION_MS) or its end (landing: back to the current gait loop), and
   * return the display-only lift in metres. `canJump` is false while seated or in
   * the stand-up clip: a hop pressed then is dropped, never replayed late, and a
   * hop still in the air when the seat is confirmed just fades out. Reads the
   * registry without allocating (per-frame path).
   */
  function stepJump(now: number, canJump: boolean, gait: Gait): number {
    const jump = actions[CLIP.jump];
    const entry = currentJump(sessionId, canJump, now);
    const phase = jumpPhase(entry, canJump, jumpSeqRef.current);

    if (phase === "takeoff" || phase === "air") {
      const hop = entry!; // takeoff / air only happen with a live entry
      if (phase === "takeoff") {
        jumpSeqRef.current = hop.seq;
        if (jump) {
          actions[gaitClip(gaitRef.current)]?.fadeOut(JUMP_FADE_IN_S);
          jump.timeScale = jumpTimeScale(jump.getClip().duration);
          jump.reset();
          jump.setLoop(LoopOnce, 1);
          jump.clampWhenFinished = true;
          jump.fadeIn(JUMP_FADE_IN_S).play();
        }
      }
      return jumpOffsetY(now - hop.startedAt);
    }

    if (phase === "landed" || phase === "dropped") {
      jumpSeqRef.current = -1;
      if (jump) {
        jump.fadeOut(ANIM_FADE);
        if (phase === "landed") {
          // Landed: resume the loop for whatever the player is doing right now.
          actions[gaitClip(gait)]?.reset().fadeIn(ANIM_FADE).play();
          gaitRef.current = gait;
        }
      }
    }
    return 0;
  }

  /**
   * Put the avatar group on the pose (x, z) lifted by the hop (the blob shadow stays on
   * the floor) and publish, allocation-free, what the rest of the app reads about it:
   * the lift (the first-person eye rises with it) and the "a press may not jump now"
   * flag shared by Space and the touch button (seated, sit / stand-up clip, reconnecting).
   */
  function placeGroup(group: Group, canJump: boolean, gait: Gait, suspended: boolean): void {
    const lift = stepJump(performance.now(), canJump, gait);
    group.position.set(pose.x, lift, pose.z);
    if (shadowRef.current) shadowRef.current.position.y = -lift;
    publishLocalJump(lift, !canJump || suspended);
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
    // normalizes, so a blended push still moves at the constant gait speed. While
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

    // 클릭 자동 이동 (design 29): 수동 이동 입력(키/조이스틱)이 하나라도
    // 있으면 target을 즉시 버리고(자동 이동은 수동 입력에 항상 양보), 없으면
    // target 방향 단위벡터를 카메라 기준 intent로 되투영(dirToIntent)해 합성한다
    // — 아래의 기존 worldDirection → 충돌 슬라이드 → moveSender 경로를 그대로
    // 통과하므로 이동 코드 포크가 없다(일반 이동과 동일 속도·검증). 도착·진행
    // 불가(벽) 해제는 stepClickMove가 스스로 판정하고, 착석 중에는 조향하지
    // 않는다(착석 분기가 "이동 입력=기립"으로 위임 — 아래).
    const manual = intent.forward !== 0 || intent.right !== 0;
    if (manual) {
      clearClickTarget();
    } else if (!suspended && !seated && !isUiCaptured()) {
      // ui-capture gate (review v2-14 M1): while the chat input owns the keyboard
      // the KEYS are frozen above — a pre-set click target must freeze too, or the
      // avatar keeps walking while the user types (asymmetric input freeze).
      const autoDir = stepClickMove(pose.x, pose.z, delta);
      if (autoDir) {
        const auto = dirToIntent(autoDir, activeYaw);
        intent.forward = auto.forward;
        intent.right = auto.right;
      }
    }
    const moving = intent.forward !== 0 || intent.right !== 0;
    // Run intent: Shift (zeroed by the guard while a field owns the keyboard) or the
    // touch run flag, dropped while suspended. It also applies to click-move: the
    // auto-move target is walked at whichever speed the player is holding right now.
    const run = !suspended && (keys.run || moveInput.run);
    const gait = gaitFor(moving, run);

    if (seated && !wasSeated) {
      // Sit confirmed: snap onto the seat, stop locomotion, play Down → hold Idle.
      // 진행 중이던 클릭 자동 이동도 여기서 해제된다 (design 29 (e) 착석 완료).
      clearClickTarget();
      const s = SEATS[seatIndex];
      pose.x = s.x;
      pose.z = s.z;
      pose.yaw = s.yaw;
      actions[gaitClip(gaitRef.current)]?.fadeOut(ANIM_FADE);
      gaitRef.current = "idle";
      standRequestedRef.current = false;
      animTimerRef.current = playOnce(CLIP.sitDown);
      animStateRef.current = "sitDown";
      // The camera swings behind the chair toward the screen (FP: the look snaps to it).
      beginSeatCamera(orbit, s.yaw);
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
      // ...and back to the view the player had before sitting down.
      endSeatCamera(orbit);
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
        gaitRef.current = gait === "idle" ? "walk" : "idle"; // force the loco crossfade to re-sync next frame
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
      placeGroup(group, false, gait, suspended);
      group.rotation.y = pose.yaw + MODEL_FACING_OFFSET;
      return;
    }

    if (moving) {
      const dir = worldDirection(intent, activeYaw);
      const speed = moveSpeed(run);
      // Slide the body (circle-vs-AABB) along walls/furniture from the SAME
      // static OBSTACLES the server validates against — plus a dynamic box per
      // connected remote player (design 33: characters are solid) — then keep
      // the centre a radius inside WORLD_BOUNDS as a backstop.
      const next = resolveCollision(
        pose.x,
        pose.z,
        dir.x * speed * delta,
        dir.z * speed * delta,
        PLAYER_RADIUS,
        collectObstacles(pose.x, pose.z),
      );
      pose.x = clamp(next.x, WORLD_BOUNDS.minX + PLAYER_RADIUS, WORLD_BOUNDS.maxX - PLAYER_RADIUS);
      pose.z = clamp(next.z, WORLD_BOUNDS.minZ + PLAYER_RADIUS, WORLD_BOUNDS.maxZ - PLAYER_RADIUS);
      if (!inFp) {
        // TP + overview: the (visible) body turns smoothly toward the movement dir.
        // FP never turns the view for movement — A/D strafe, S backs up, and the
        // look changes only by drag / Z·C (general 3D game feel).
        const targetYaw = Math.atan2(dir.x, dir.z);
        pose.yaw = stepYaw(pose.yaw, targetYaw, TURN_SPEED * delta);
      }
    }
    // FP: the body yaw follows the look direction DIRECTLY (no TURN_SPEED lag),
    // moving or standing — it is simply fpYaw. Network semantics are unchanged —
    // yaw still reaches others only via move messages (moveSender fires on
    // movement); there is NO idle-yaw streaming, so rotating the view while
    // standing sends nothing.
    if (inFp) pose.yaw = normalizeAngle(viewState.fpYaw);

    placeGroup(group, animStateRef.current === "loco", gait, suspended);
    group.rotation.y = pose.yaw + MODEL_FACING_OFFSET;

    // Crossfade idle <-> walk <-> run on gait changes — but only in pure loco; the
    // StandUp one-shot and an airborne hop own the body until they finish (a landing
    // resumes the gait loop itself).
    if (animStateRef.current === "loco" && jumpSeqRef.current === -1 && gait !== gaitRef.current) {
      actions[gaitClip(gaitRef.current)]?.fadeOut(ANIM_FADE);
      actions[gaitClip(gait)]?.reset().fadeIn(ANIM_FADE).play();
      gaitRef.current = gait;
    }

    // Throttled network send (idle: nothing; moving: <=1 per PATCH_RATE_MS;
    // exactly one final message on stop).
    sender.update(performance.now(), moving, { x: pose.x, z: pose.z, yaw: pose.yaw });
  });

  return (
    <group ref={groupRef}>
      <primitive object={model} />
      {blobShadow && (
        <group ref={shadowRef}>
          <BlobShadow />
        </group>
      )}
    </group>
  );
}
