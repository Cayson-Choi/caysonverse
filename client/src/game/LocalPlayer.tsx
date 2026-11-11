import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useKeyboardControls } from "@react-three/drei";
import { Group, LoopOnce, type Plane } from "three";
import type { Appearance } from "@caysonverse/shared/appearance";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { liftForSeatY } from "@caysonverse/shared/sitPose";
import { resolveCollision } from "@caysonverse/shared/collision";
import { collectObstacles } from "./playerObstacles";
import { activeBounds, activeSeats } from "./activeMap";
import {
  SIT_GLIDE,
  STAND_GLIDE,
  glideAt,
  glideDone,
  sitDownLift,
  standUpLift,
  localGlide,
  type Glide,
} from "./seatMotion";
import { benchClipPlanes, clipAvatar, enableBenchClipping } from "./benchClip";
import { readIntent, worldDirection } from "./input";
import type { Intent, MoveInput } from "./input";
import { gaitClip, gaitFor, moveSpeed } from "./gait";
import type { Gait } from "./gait";
import {
  alongFacing,
  createLoopDriver,
  handoverTime,
  lookStride,
  loopFade,
  loopSpeed,
  loopTimeScale,
  stepFacing,
  stepLoop,
} from "./stride";
import {
  stepClickMove,
  dirToIntent,
  clearClickTarget,
  getClickTarget,
  resetClickMove,
} from "./clickMove";
import { guardMoveInput, guardMoveKeys, isUiCaptured } from "./uiCapture";
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
import { beginSeatCamera, endSeatCamera, fpBodyYaw, viewState } from "./viewState";
import { HIDE_BLEND, OV_VIS_BLEND } from "./viewMode";
import { clipFor, lookFromAppearance } from "./characterLook";
import { reportAvatarClip, useAvatar } from "./useAvatar";
import { BlobShadow } from "./BlobShadow";
import { PICK_AS_SELF } from "./clickPick";
import { createSelfFade, endSelfFade, registerSelfBody, selfBody, stepSelfFade } from "./selfBody";
import { createNametag } from "./nametag";
import { registerLabel } from "./labelRegistry";
import { bubbleRestHeight, nametagRestHeight } from "./nametagLayout";
import { isLocalTeacher } from "./ownNametag";
import { useSpeechBubble } from "./useSpeechBubble";
import { useEmoji } from "./useEmoji";
import { stepYaw } from "./yaw";
import { createMoveSender } from "./moveSender";
import { installDebugHook } from "./debug";
import { ANIM_FADE, CLIP, MODEL_FACING_OFFSET, TURN_SPEED } from "./constants";
import type { MoveControl } from "./constants";
import type { Orbit, Pose, SeatState } from "./types";
import { getRoom, sendJump, sendMove, sendStand } from "../net/connection";
import { useTransitState } from "../net/transitSync";
import { isInputSuspended } from "../net/resilience";
import { useAppStore } from "../stores/appStore";
import { useSettingsStore } from "../stores/settingsStore";

/** Fallback seconds for a sit/stand clip if its duration can't be read yet. */
const SIT_CLIP_FALLBACK_SEC = 0.8;

/** Every base clip this avatar plays (each resolved through clipFor before it reaches the mixer). */
const LOOK_CLIPS: readonly string[] = [
  CLIP.idle,
  CLIP.walk,
  CLIP.run,
  CLIP.sitDown,
  CLIP.sitIdle,
  CLIP.sitStand,
  CLIP.jump,
];

interface LocalPlayerProps {
  /** Own session id — keys this player's speech bubble in the broadcast. */
  sessionId: string;
  /** Own nickname — what the optional own name tag ("내 이름표 보기") says. */
  nickname: string;
  /**
   * The 15 appearance fields this player joined with. Immutable for the mount: the
   * WorldScene remounts per connection epoch, so a different look is a new LocalPlayer.
   */
  appearance: Appearance;
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
  appearance,
  pose,
  orbit,
  seat,
  moveInput,
  blobShadow,
}: LocalPlayerProps) {
  const { boarded: busBoarded } = useTransitState();
  const [, getKeys] = useKeyboardControls<MoveControl>();
  const groupRef = useRef<Group>(null);
  // The gait the player's input last asked for while in loco (idle / walk / run) — the E2E probe's getGait().
  const gaitRef = useRef<Gait>("idle");
  // The locomotion loop on the body (stride.ts): Idle, the walk or the run cycle, picked by the speed the body goes at
  // (not the key) and played at the rate that keeps the foot on the ground still. Null while a one-shot (sit / stand /
  // jump) owns the body; the loco step below puts a loop back on.
  const loopRef = useRef<Gait | null>("idle");
  const driveRef = useRef(createLoopDriver());
  // The walk / run loop fading out after a walk <-> run switch, and how long (s) it still shows: it keeps following
  // the ground speed while it does (a stop freezes it instead, and a one-shot leaves it be).
  const fadingRef = useRef<{ loop: Gait; left: number } | null>(null);
  // Seating anim state machine (v2 Task 1). `loco` = normal walk/idle; `sitDown`
  // and `standUp` are one-shot transient clips; `sitIdle` is the held seated pose.
  const animStateRef = useRef<"loco" | "sitDown" | "sitIdle" | "standUp">("loco");
  const animTimerRef = useRef(0); // seconds left in the current transient clip
  const prevSeatRef = useRef(-1); // previous confirmed seatIndex (transition edge)
  const standRequestedRef = useRef(false); // debounce: one Stand per seated episode
  // A seat the sitter rests ON (a village bench, `seatY`): the lift of the seat in use, the seconds spent in the
  // current sit / stand clip and its length, and the glide onto the seat or off it (seatMotion.ts). A legacy chair
  // leaves all of it at rest (lift 0, no glide): it keeps its snap.
  // `clip`: the planes that hide what hangs inside the bench (benchClip.ts), applied once the avatar is on the seat.
  const seatMotionRef = useRef<{
    bench: boolean;
    lift: number;
    elapsed: number;
    duration: number;
    glide: Glide | null;
    clip: Plane[] | null;
    clipped: boolean;
  }>({ bench: false, lift: 0, elapsed: 0, duration: 0, glide: null, clip: null, clipped: false });
  // Jump (Task 11): seq of the registry hop currently animating (-1 = none), and the
  // wrapper that keeps the blob shadow on the floor while the avatar is in the air.
  const jumpSeqRef = useRef(-1);
  const shadowRef = useRef<Group>(null);

  // Assemble the toy figure from the appearance — ONCE per look via the SAME useAvatar
  // path remotes, the AI 조교 and the builder preview use, not per frame. The hook owns
  // the materials and the shared geometry (released on unmount); this component owns
  // only the animation. The look is fixed for the mount (see the prop), so the clip
  // names resolved from it below never go stale.
  const look = useMemo(() => lookFromAppearance(appearance), [appearance]);
  const stride = useMemo(() => lookStride(look), [look]);
  const { avatar, animations } = useAvatar(look, { probeId: sessionId });
  const model = avatar.root;

  // The own tag and bubble are anchored to THIS avatar's top (hair, hat, ...), measured once at assembly.
  const tagHeight = nametagRestHeight(avatar.topY);
  const bubbleRest = bubbleRestHeight(avatar.topY);

  // Own speech bubble: driven by the server broadcast (not a local echo), so
  // self and remotes share one path. Attached above this avatar's group. It rests on
  // `bubbleAnchor`: the NametagSystem raises that to just above the own name tag while
  // "내 이름표 보기" is on (like a remote's bubble), and it stays at `bubbleRest`
  // (just above where the tag would be) otherwise, when no tag exists.
  const bubbleAnchor = useRef({ y: bubbleRest }).current;
  const bubbleTop = useSpeechBubble(sessionId, groupRef, bubbleAnchor);

  // Own name tag — on by default; the player can still turn it off in the menu. Same create /
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
    const tag = createNametag(nickname, isLocalTeacher(role, isAdmin) ? "teacher" : "none", tagHeight);
    tag.setOpacity(0); // fades in under the NametagSystem instead of flashing at full opacity
    group.add(tag.sprite);
    const unregister = registerLabel({
      id: sessionId,
      anchor: group,
      tag,
      pinned: true,
      bubbleAnchor,
      heightM: tagHeight,
    });
    return () => {
      unregister();
      group.remove(tag.sprite);
      tag.dispose();
      bubbleAnchor.y = bubbleRest; // no tag any more: the bubble drops back to its rest height
    };
  }, [showOwnNametag, sessionId, nickname, isAdmin, bubbleAnchor, tagHeight, bubbleRest]);
  // Own emoji reaction: same broadcast-driven, self-included discipline; it starts above the own bubble.
  useEmoji(sessionId, groupRef, avatar.topY, bubbleTop);
  // The own body, for the destination ring it may hide (ClickMarker): while it does, the body fades (stepSelfFade below).
  const selfFadeRef = useRef(createSelfFade());
  useEffect(() => {
    const group = groupRef.current;
    const unregister = group ? registerSelfBody(group, avatar.topY) : undefined;
    const fade = selfFadeRef.current;
    return () => {
      unregister?.();
      endSelfFade(fade, avatar); // a cached avatar is never handed on faded
    };
  }, [avatar]);

  const { actions } = useAnimations(animations, model);

  // The clip the mixer is on right now, as last reported to the DEV avatar probe
  // (`__cvAvatars()[sid].clip`): reported once per change, never per frame.
  const reportedClipRef = useRef<string | null>(null);
  /**
   * Note that `name` (a clipFor-resolved clip) now owns the body. Only on a change —
   * the gait / jump / seat transitions below are edge-triggered already.
   */
  function reportClip(name: string): void {
    if (!import.meta.env.DEV || reportedClipRef.current === name) return;
    reportedClipRef.current = name;
    reportAvatarClip(sessionId, name);
  }

  // Start idle; expose the E2E pose hook (with live seatIndex) for this lifetime.
  // Declared after useAvatar, so the avatar probe entry exists when idle is reported.
  useEffect(() => {
    const idleName = clipFor(CLIP.idle, look);
    actions[idleName]?.reset().fadeIn(0).play();
    loopRef.current = "idle";
    // Unconditional: a (StrictMode) effect replay re-creates the probe entry with no clip.
    reportedClipRef.current = idleName;
    reportAvatarClip(sessionId, idleName);
    const removeHook = installDebugHook(
      () => pose,
      () => orbit,
      () => seat.index,
      () => groupRef.current?.visible ?? true,
      () => gaitRef.current,
      () => sessionId,
    );
    return () => {
      removeHook();
      // Stop the clips this look actually plays (the resolved names, e.g. *_LongSkirt).
      for (const base of LOOK_CLIPS) actions[clipFor(base, look)]?.stop();
    };
    // actions identity changes when the (memoized) model does — safe to depend on.
  }, [actions, look, pose, orbit, seat, sessionId]);

  const sender = useRef(createMoveSender(sendMove)).current;

  // 클릭 자동 이동 리셋 (design 29 (e)): 이 컴포넌트는 접속 세대(epoch)마다
  // 리마운트되므로, 마운트/언마운트 양쪽에서 target을 비워 재접속·월드 교체
  // 후에 이전 세계의 목표 지점으로 걸어가는 일이 없게 한다.
  useEffect(() => {
    resetClickMove();
    return () => {
      resetClickMove();
      localGlide.current = null;
    };
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

  /**
   * The action that plays `base` (a `CLIP.*` name) for this look. Every clip the mixer
   * gets goes through here, so a long-skirt look walks / runs / jumps with the
   * `*_LongSkirt` variants (Review Focus 7). State decisions and `gaitRef` stay on the
   * base names; only the name handed to the mixer is resolved. Allocation-free.
   */
  function action(base: string) {
    return actions[clipFor(base, look)];
  }

  /**
   * Hand the body from the loop on it (fading out; none while a one-shot had it) to loop `to` (fading in) at ground
   * speed `speed` (m/s; negative backing up — stride.ts loopSpeed), and report the clip. A walk / run loop starts on
   * the step the outgoing one was on (or, from standing, with its left foot planted) at the rate that keeps that foot
   * still (stride.ts). Stopping freezes the outgoing loop: the body stands still from this frame on, so its feet do too
   * while they fade out; an outgoing walk / run loop keeps following the speed while it fades (the loco step).
   */
  function switchLoop(to: Gait, speed: number): void {
    const from = loopRef.current;
    const fade = loopFade(from, to);
    const out = from === null ? undefined : action(gaitClip(from));
    if (out) {
      out.fadeOut(fade);
      if (to === "idle") out.timeScale = 0;
    }
    fadingRef.current = out && from !== "idle" && to !== "idle" ? { loop: from as Gait, left: fade } : null;
    loopRef.current = to;
    const loop = action(gaitClip(to));
    if (!loop) return;
    loop.reset();
    if (to === "idle") {
      loop.timeScale = 1;
    } else {
      const handFrom = out && (from === "walk" || from === "run") ? stride[from] : null;
      const outDuration = out?.getClip().duration ?? 0;
      loop.time = handoverTime(handFrom, out?.time ?? 0, outDuration, stride[to], loop.getClip().duration);
      loop.timeScale = loopTimeScale(to, speed, stride, loop.time, loop.getClip().duration);
    }
    loop.fadeIn(fade).play();
    reportClip(loop.getClip().name);
  }

  /** Fade out the loop on the body (a one-shot takes it over) — it is off the body from now on. */
  function releaseLoop(fade: number): void {
    if (loopRef.current !== null) action(gaitClip(loopRef.current))?.fadeOut(fade);
    loopRef.current = null;
    fadingRef.current = null;
  }

  /** Play the one-shot clip `base` (clamped on its last frame); returns its duration (s). */
  function playOnce(base: string): number {
    const once = action(base);
    if (!once) return SIT_CLIP_FALLBACK_SEC;
    once.reset();
    once.setLoop(LoopOnce, 1);
    once.clampWhenFinished = true;
    once.fadeIn(ANIM_FADE).play();
    reportClip(once.getClip().name);
    return once.getClip().duration || SIT_CLIP_FALLBACK_SEC;
  }

  /**
   * One frame of the hop (Task 11): detect a new jump in the registry (take-off:
   * fade the gait loop out, play Jump_Full_Short once at the speed that fits
   * JUMP_DURATION_MS) or its end (landing: the loco step puts a loop back on), and
   * return the display-only lift in metres. `canJump` is false while seated or in
   * the stand-up clip: a hop pressed then is dropped, never replayed late, and a
   * hop still in the air when the seat is confirmed just fades out. Reads the
   * registry without allocating (per-frame path).
   */
  function stepJump(now: number, canJump: boolean): number {
    const jump = action(CLIP.jump);
    const entry = currentJump(sessionId, canJump, now);
    const phase = jumpPhase(entry, canJump, jumpSeqRef.current);

    if (phase === "takeoff" || phase === "air") {
      const hop = entry!; // takeoff / air only happen with a live entry
      if (phase === "takeoff") {
        jumpSeqRef.current = hop.seq;
        if (jump) {
          releaseLoop(JUMP_FADE_IN_S);
          jump.timeScale = jumpTimeScale(jump.getClip().duration);
          jump.reset();
          jump.setLoop(LoopOnce, 1);
          jump.clampWhenFinished = true;
          jump.fadeIn(JUMP_FADE_IN_S).play();
          reportClip(jump.getClip().name);
        }
      }
      return jumpOffsetY(now - hop.startedAt);
    }

    if (phase === "landed" || phase === "dropped") {
      jumpSeqRef.current = -1;
      // The take-off took the loop off the body: on landing the loco step (this same frame) puts on the one for what
      // the player is doing right now, at the speed it is going.
      jump?.fadeOut(ANIM_FADE);
    }
    return 0;
  }

  /**
   * Put the avatar group on the pose (x, z) lifted by the hop (the blob shadow stays on
   * the floor) and publish, allocation-free, what the rest of the app reads about it:
   * the lift (the first-person eye rises with it) and the "a press may not jump now"
   * flag shared by Space and the touch button (seated, sit / stand-up clip, reconnecting).
   */
  function placeGroup(group: Group, canJump: boolean, suspended: boolean, seatLift = 0): void {
    const lift = stepJump(performance.now(), canJump);
    // `seatLift` raises the sitter onto a bench's surface (0 everywhere else); the shadow stays on the floor.
    group.position.set(pose.x, lift + seatLift, pose.z);
    if (shadowRef.current) shadowRef.current.position.y = -(lift + seatLift);
    publishLocalJump(lift, !canJump || suspended);
  }

  /** The bench lift for this frame: eased in while sitting down, held while seated, eased out while getting up. */
  function currentSeatLift(): number {
    const m = seatMotionRef.current;
    if (m.lift === 0) return 0;
    switch (animStateRef.current) {
      case "sitDown":
        return sitDownLift(m.lift, m.elapsed, m.duration);
      case "sitIdle":
        return m.lift;
      case "standUp":
        return standUpLift(m.lift, m.elapsed, m.duration);
      default:
        return 0;
    }
  }

  /**
   * Advance the glide onto or off a bench (if any) and write the pose from it. Returns whether it is still going —
   * while it is, the body is carried by the clip, so input waits (getting up) and nothing is sent.
   */
  function stepGlide(): boolean {
    const m = seatMotionRef.current;
    const g = m.glide;
    if (!g) return false;
    if (glideDone(g, m.elapsed, m.duration)) {
      pose.x = g.toX;
      pose.z = g.toZ;
      pose.yaw = g.toYaw;
      m.glide = null;
      return false;
    }
    glideAt(g, m.elapsed, m.duration, pose);
    return true;
  }

  // A remount may get the same assembled avatar back (useAvatar's cache): never hand it on clipped.
  useEffect(
    () => () => {
      clipAvatar(avatar, null);
      seatMotionRef.current.clipped = false;
    },
    [avatar],
  );

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // Own-avatar hiding (design 19): in first-person the LOCAL avatar GROUP is
    // hidden past the mid-blend point — body AND blob shadow together
    // (all children of this group), plus the own speech-bubble / emoji sprites
    // (also parented here), which is correct: you don't see your own bubble in FP.
    // Set on EVERY path (incl. seated below) and restored automatically on exit /
    // reconnect remount (resetViewMode zeroes the blend). Remote avatars, seats,
    // and the maze are untouched — they live in other groups. Overview is a
    // third-person top-down: the own avatar is shown there (design 20) even if it
    // was hidden in the FP it was opened from — gated on the ov BLEND, not the
    // instant mode flip, so neither transition direction flashes near the eye.
    group.visible = viewState.ovBlend > OV_VIS_BLEND ? true : viewState.blend < HIDE_BLEND;
    // The destination ring straight ahead, behind the body (a click on the body itself, a walk away from the camera):
    // the body fades and is drawn after the ring, so the ring shows through it (round 6 review: only its dashes showed,
    // on the body, all the way there).
    stepSelfFade(selfFadeRef.current, avatar, group.visible && selfBody.hidingRing, delta);

    // Focus guard: while the chat input owns keyboard input — OR while the
    // resilience driver is reconnecting (world frozen behind the overlay) —
    // movement keys are zeroed so nothing walks the avatar. We don't touch drei's
    // key listeners, so nothing can get stuck on blur (see uiCapture.ts).
    const suspended = isInputSuspended();
    const captured = isUiCaptured() || suspended || busBoarded;
    const keys = guardMoveKeys(getKeys(), captured);
    // The joystick obeys the same freeze (a held stick must not steer behind a close-up / the menu).
    const stick = guardMoveInput(moveInput, captured);
    const keyIntent = readIntent(keys);
    // Combine keyboard + joystick into ONE camera-relative intent. worldDirection
    // normalizes, so a blended push still moves at the constant gait speed. While
    // suspended, the joystick contribution is dropped too (full input freeze).
    const intent: Intent = suspended
      ? { forward: 0, right: 0 }
      : {
          forward: keyIntent.forward + stick.forward,
          right: keyIntent.right + stick.right,
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
    // Getting up from a bench: the stand-up clip carries the body to the dismount spot (stepGlide below); a click
    // target set meanwhile is steered toward once it is there.
    const gliding = seatMotionRef.current.glide !== null;
    if (manual) {
      clearClickTarget();
    } else if (!suspended && !busBoarded && !seated && !gliding && !isUiCaptured()) {
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
    const run = !suspended && (keys.run || stick.run);
    const gait = gaitFor(moving, run);

    const motion = seatMotionRef.current;
    if (seated && !wasSeated) {
      // Sit confirmed: onto the seat, stop locomotion, play Down → hold Idle. A chair: snap onto it. A bench
      // (`seatY`): walk onto its spot while the clip starts, and rise to its surface as the body sits (seatMotion).
      // 진행 중이던 클릭 자동 이동도 여기서 해제된다 (design 29 (e) 착석 완료).
      clearClickTarget();
      const s = activeSeats()[seatIndex];
      motion.bench = s !== undefined && s.seatY !== undefined;
      motion.lift = liftForSeatY(s?.seatY);
      motion.clip = benchClipPlanes(s);
      motion.glide = null;
      if (s && motion.bench) {
        motion.glide = { fromX: pose.x, fromZ: pose.z, fromYaw: pose.yaw, toX: s.x, toZ: s.z, toYaw: s.yaw, window: SIT_GLIDE };
      } else if (s) {
        pose.x = s.x;
        pose.z = s.z;
        pose.yaw = s.yaw;
      }
      releaseLoop(ANIM_FADE);
      gaitRef.current = "idle";
      standRequestedRef.current = false;
      animTimerRef.current = playOnce(CLIP.sitDown);
      motion.elapsed = 0;
      motion.duration = animTimerRef.current;
      animStateRef.current = "sitDown";
      // The camera swings behind the chair toward the screen (FP: the look snaps to it).
      if (s) beginSeatCamera(orbit, s.yaw);
    } else if (!seated && wasSeated) {
      // Stand confirmed: to the server's dismount pose, play StandUp → loco. A chair: snap there. A bench: the
      // clip carries the body from the seat to it (the dismount spot is just in front of the bench).
      const me = getRoom()?.state?.players?.get?.(sessionId);
      motion.glide = null;
      if (me && motion.bench) {
        motion.glide = { fromX: pose.x, fromZ: pose.z, fromYaw: pose.yaw, toX: me.x, toZ: me.z, toYaw: pose.yaw, window: STAND_GLIDE };
      } else if (me) {
        pose.x = me.x;
        pose.z = me.z;
        pose.yaw = me.yaw;
      }
      action(CLIP.sitIdle)?.fadeOut(ANIM_FADE);
      action(CLIP.sitDown)?.fadeOut(ANIM_FADE);
      animTimerRef.current = playOnce(CLIP.sitStand);
      motion.elapsed = 0;
      motion.duration = animTimerRef.current;
      animStateRef.current = "standUp";
      // ...and back to the view the player had before sitting down.
      endSeatCamera(orbit);
    }
    prevSeatRef.current = seatIndex;

    // The sit / stand clip's own clock (the lift and the glides follow it).
    if (animStateRef.current === "sitDown" || animStateRef.current === "standUp") motion.elapsed += delta;
    const stillGliding = stepGlide();
    localGlide.current = motion.glide; // where a click's walk starts while it lasts (CameraRig, clickPlan.ts walkStart)

    // Advance the one-shot sit/stand clips off a timer (the mixer is auto-ticked
    // by drei's useAnimations, so the clips play regardless of this branch).
    if (animStateRef.current === "sitDown") {
      animTimerRef.current -= delta;
      if (animTimerRef.current <= 0) {
        action(CLIP.sitDown)?.fadeOut(ANIM_FADE);
        const hold = action(CLIP.sitIdle);
        if (hold) {
          hold.reset().fadeIn(ANIM_FADE).play();
          reportClip(hold.getClip().name);
        }
        animStateRef.current = "sitIdle";
      }
    } else if (animStateRef.current === "standUp") {
      animTimerRef.current -= delta;
      if (animTimerRef.current <= 0) {
        action(CLIP.sitStand)?.fadeOut(ANIM_FADE);
        animStateRef.current = "loco";
        loopRef.current = null; // no loop on the body: the loco crossfade below puts one on
        motion.bench = false;
        motion.lift = 0;
        motion.clip = null;
      }
    }

    // Hide what hangs inside the bench while on it: from the moment the avatar stands on the seat's spot (the
    // walk onto it is over) until the stand-up clip has carried it off (benchClip.ts).
    const onBench =
      motion.clip !== null &&
      (animStateRef.current === "sitIdle" ||
        animStateRef.current === "standUp" ||
        (animStateRef.current === "sitDown" && motion.elapsed >= motion.duration * SIT_GLIDE.to));
    if (onBench !== motion.clipped) {
      if (onBench) enableBenchClipping(state.gl);
      clipAvatar(avatar, onBench ? motion.clip : null);
      motion.clipped = onBench;
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
      placeGroup(group, false, suspended, currentSeatLift());
      group.rotation.y = pose.yaw + MODEL_FACING_OFFSET;
      return;
    }

    // Getting up from a bench: the stand-up clip carries the body from the seat to the dismount spot the server
    // already put us on. Nothing moves the avatar meanwhile and nothing is sent (the pose ends exactly there); held
    // keys and a click target take over once it is there.
    if (stillGliding) {
      placeGroup(group, false, suspended, currentSeatLift());
      group.rotation.y = pose.yaw + MODEL_FACING_OFFSET;
      return;
    }

    // The ground speed (m/s) the body actually goes at this frame — after the walls slid it, so pushing into one reads
    // slower (or 0). The loop on the body and its rate follow it (stride.ts). A server correction moves the pose
    // elsewhere in the frame, never in this step, so it is no step of the feet.
    let groundSpeed = 0;
    let movedX = 0;
    let movedZ = 0;
    if (moving) {
      const dir = worldDirection(intent, activeYaw);
      const speed = moveSpeed(run);
      const fromX = pose.x;
      const fromZ = pose.z;
      // Slide the body (circle-vs-AABB) along walls/furniture from the SAME
      // static OBSTACLES the server validates against — plus a dynamic box per
      // connected remote player (design 33: characters are solid) — then keep
      // the centre a radius inside the ACTIVE map's bounds as a backstop.
      const next = resolveCollision(
        pose.x,
        pose.z,
        dir.x * speed * delta,
        dir.z * speed * delta,
        PLAYER_RADIUS,
        collectObstacles(pose.x, pose.z),
      );
      const bounds = activeBounds(); // the area the player is in (케이슨 마을: not the rectangle spanning both areas)
      pose.x = clamp(next.x, bounds.minX + PLAYER_RADIUS, bounds.maxX - PLAYER_RADIUS);
      pose.z = clamp(next.z, bounds.minZ + PLAYER_RADIUS, bounds.maxZ - PLAYER_RADIUS);
      movedX = pose.x - fromX;
      movedZ = pose.z - fromZ;
      if (delta > 0) groundSpeed = Math.hypot(movedX, movedZ) / delta;
      if (!inFp) {
        // TP + overview: the (visible) body turns smoothly toward the movement dir.
        // FP never turns the view for movement — A/D strafe, S backs up, and the
        // look changes only by drag / Z·C (general 3D game feel).
        const targetYaw = Math.atan2(dir.x, dir.z);
        pose.yaw = stepYaw(pose.yaw, targetYaw, TURN_SPEED * delta);
      }
    }
    // FP: the body faces the look direction DIRECTLY (no TURN_SPEED lag), moving
    // or standing — fpBodyYaw (the look yaw is the camera's azimuth, half a turn
    // from the facing: it used to be copied as is, and other players saw a
    // first-person walker going backward). Network semantics are unchanged —
    // yaw still reaches others only via move messages (moveSender fires on
    // movement); there is NO idle-yaw streaming, so rotating the view while
    // standing sends nothing.
    if (inFp) pose.yaw = fpBodyYaw(viewState.fpYaw);

    placeGroup(group, animStateRef.current === "loco", suspended, currentSeatLift());
    group.rotation.y = pose.yaw + MODEL_FACING_OFFSET;

    // The loop on the body follows the ground speed: Idle / walk / run crossfades when the speed calls for another
    // loop, and every frame the loop plays at the rate that keeps the foot on the ground still (stride.ts) — backward
    // while the body backs up (first person: S), and a walk / run loop still fading out after a switch too — but only
    // in pure loco; the StandUp one-shot and an airborne hop own the body until they finish (and leave no loop on it,
    // so this puts one on).
    if (animStateRef.current === "loco" && jumpSeqRef.current === -1) {
      gaitRef.current = gait;
      const drive = driveRef.current;
      const loop = stepLoop(drive, loopRef.current ?? "idle", gait !== "idle", groundSpeed, delta);
      stepFacing(drive, alongFacing(movedX, movedZ, pose.yaw), delta);
      const speed = loopSpeed(drive);
      if (loop !== loopRef.current) switchLoop(loop, speed);
      else if (loop !== "idle") {
        const playing = action(gaitClip(loop));
        if (playing) playing.timeScale = loopTimeScale(loop, speed, stride, playing.time, playing.getClip().duration);
      }
      const fading = fadingRef.current;
      if (fading) {
        const out = action(gaitClip(fading.loop));
        if (out) out.timeScale = loopTimeScale(fading.loop, speed, stride, out.time, out.getClip().duration);
        fading.left -= delta;
        if (fading.left <= 0) fadingRef.current = null;
      }
    }

    // Throttled network send (idle: nothing; moving: <=1 per PATCH_RATE_MS;
    // exactly one final message on stop).
    sender.update(performance.now(), moving, { x: pose.x, z: pose.z, yaw: pose.yaw });
  });

  return (
    <group ref={groupRef} userData={PICK_AS_SELF}>
      <primitive object={model} />
      {blobShadow && (
        <group ref={shadowRef}>
          <BlobShadow />
        </group>
      )}
    </group>
  );
}
