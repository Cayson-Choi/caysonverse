import { useEffect, useMemo, useRef } from "react";
import { extend, useFrame } from "@react-three/fiber";
import { AnimationMixer, LoopOnce, Quaternion, Vector3, type AnimationAction, type Camera, type Group, type Object3D, type Plane } from "three";
import { busCamState } from "./busRide";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { reuseRestingBoneTexture, setAvatarOpacity } from "./characterAvatar";
import { clipFor, lookFromAppearance } from "./characterLook";
import { reportAvatarClip, useAvatar } from "./useAvatar";
import { BlobShadow } from "./BlobShadow";
import { PICK_AS_BODY } from "./clickPick";
import { createNametag } from "./nametag";
import { registerLabel } from "./labelRegistry";
import { bubbleRestHeight, nametagRestHeight } from "./nametagLayout";
import { useSpeechBubble } from "./useSpeechBubble";
import { useEmoji } from "./useEmoji";
import { getRemoteRecord, noteRemoteDrawn, remoteDrawnProbe, remoteViewProbe } from "./remoteStore";
import { pushOutOfMovingBus } from "./playerObstacles";
import { sample, exceedsSnapDistance } from "./interpolation";
import { advancePlayout, playoutGaitSpeed } from "./playout";
import { nextGait } from "./locomotion";
import { remoteGaitProbe } from "./gait";
import type { Gait } from "./gait";
import {
  REMOTE_SPEED_SMOOTH_S,
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
import { decideMixerTick } from "./mixerThrottle";
import { AVATAR_LOD, RemoteAvatarGroup, avatarTreeCadence, behindCamera, crowdForce, crowdLodOff } from "./avatarLod";
import { useCrowd } from "./crowdLayer";
import { setFadeCut } from "./avatarFade";
import { IMPOSTOR_FADE_PER_S, impostorColors, wantsImpostor } from "./crowdImpostor";

/**
 * The far stand-ins (crowdImpostor.ts) are OFF (owner 2026-11-19: "여려명 들어온다고 캐릭터 모양을 이상한걸로 바꾸지마 이상해").
 * Every avatar is always drawn as itself; the crowd budget is kept by the slower refresh of far / still avatars instead.
 */
const CROWD_STAND_INS = false;
import { typingRegistry } from "./typing";
import {
  JUMP_FADE_IN_S,
  currentJump,
  jumpOffsetY,
  jumpPhase,
  jumpRegistry,
  jumpTimeScale,
} from "./jump";
import { jumpHeadroom } from "@caysonverse/shared/village/overhead";
import { localArea } from "../village/villageArea";
import { ANIM_FADE, CLIP, FLOOR_CLIP, MODEL_FACING_OFFSET } from "./constants";
import { isFloorSeat } from "./seatClips";
import { activeSeats } from "./activeMap";
import {
  createSeatLine,
  createSeatMotion,
  onBenchNow,
  seatLift,
  stepSeatMotion,
  type GroundPose,
  type SeatMotion,
  type SeatTransition,
} from "./remoteSeat";
import { benchClipPlanes, clipAvatar, enableBenchClipping } from "./benchClip";
import {
  BUS_SEATS,
  busLocalToWorld,
  seatBodyPoint,
  busPlaceOf,
  busSeatBackFace,
  busRiderWorldPose,
  normalizeYaw,
  type BusPlaceKind,
  type BusRiderPoseFull,
} from "@caysonverse/shared/village/busCabin";
import { getTransitRenderPose } from "../net/transitSync";
import { rideSeatPose } from "../land/rideSeats";
import { stepLean } from "./leanBack";
import { stepBackSquash } from "./backSquash";
import { CHAIR_BACK_BAND, backBandOf, seatBackFace } from "@caysonverse/shared/village/seatBack";
import { CARRY_STRIPPED_CLIPS, stripArm } from "../lake/fishingRig";
import { useFishingRig, useHasRod } from "../lake/useFishingRig";
import { easeLift, stepLiftAt, withSeatLift } from "../village/houses/houseLift";

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

/**
 * One remote avatar. Identity (appearance/nickname/role) is fixed for the mount —
 * the server writes it once at join, and the WorldScene remounts per connection
 * epoch; position/yaw/locomotion are read from the store's snapshot buffer every
 * frame and written straight to the Object3D — never through React state. Mounted
 * and unmounted by the roster in RemotePlayers.
 */
/**
 * Another rider drawn in the way of MY view of the bus (review r1: a rider a step in front filled the whole first-person screen
 * with a head; so did a neighbour on the next seat): while my own bus camera is active, a rider whose head is within 1.5 m of the
 * lens (first person) or 0.9 m (the third-person arm) and in front of it is not drawn. A little hysteresis, no flicker.
 * First person since 2026-11-20 (owner: "1인칭뷰에서 바로 옆에 있는 상대방도 잘 보이도록 해"): a neighbour on the next seat or a step in
 * front is drawn; only a head the lens would be inside (its centre within 0.55 m: the chibi head is about 0.5 m round) is not.
 */
const wayV = new Vector3();
const wayD = new Vector3();
export const RIDER_WAY_REACH_FP = 0.55;
function riderInTheWay(camera: Camera, x: number, y: number, z: number, wasHidden: boolean): boolean {
  if (!busCamState.active) return false;
  const reach = busCamState.firstPerson ? RIDER_WAY_REACH_FP : 0.9;
  const hidden = !wasHidden;
  wayV.set(x - camera.position.x, y + 1.6 - camera.position.y, z - camera.position.z);
  const dist = wayV.length();
  if (dist > reach + (hidden ? 0.2 : 0)) return false;
  camera.getWorldDirection(wayD);
  return dist < 0.05 || wayV.dot(wayD) / dist > (hidden ? 0.35 : 0.5);
}

const AvatarGroup = extend(RemoteAvatarGroup);

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
  const appearance = record?.appearance ?? DEFAULT_APPEARANCE;
  const nickname = record?.nickname ?? "";

  const groupRef = useRef<RemoteAvatarGroup>(null);
  const lodFramesRef = useRef(0); // frames since the node tree was last refreshed (step 8)
  // Far stand-in (crowdImpostor.ts): the slot this avatar holds in the scene's crowd (-1: it is drawn as the full avatar), the
  // stride phase of its walk, and whether a pose was applied (mixer tick) since the last tree refresh, and where the group was then.
  const crowd = useCrowd();
  const slotRef = useRef(-1);
  const wantImpRef = useRef(false); // the last decision (the hysteresis reads it)
  const impARef = useRef(0); // the stand-in's share of the dissolve: 0 = the full avatar only, 1 = the stand-in only
  const phaseRef = useRef(0);
  const treeDirtyRef = useRef(true);
  const refreshedAtRef = useRef({ x: 0, y: 0, z: 0, yaw: 0 });
  const castsRef = useRef(true); // whether the avatar casts a shadow now (step 8)
  const castersRef = useRef<Object3D[] | null>(null);

  // Assemble the toy figure from the synced appearance ONCE (the same useAvatar path as
  // the local player). The hook owns its materials and the shared merged geometry and
  // releases them on unmount; this component owns only its mixer (cleanup below).
  const look = useMemo(() => lookFromAppearance(appearance), [appearance]);
  const stride = useMemo(() => lookStride(look), [look]);
  const crowdColors = useMemo(() => impostorColors(look), [look]);
  const { avatar, animations } = useAvatar(look, { probeId: sessionId });
  useEffect(() => reuseRestingBoneTexture(avatar, () => groupRef.current?.restingBody === avatar.root), [avatar]);
  const mixer = useMemo(() => new AnimationMixer(avatar.root), [avatar]);
  // Fishing lake (A10): the rod in this avatar's hand, the fishing clips and the landed fish (lake/fishingRig.ts). A carrier's
  // walk / run / idle have no right arm (Carry_Rod owns it): the base clips are bound again when the rod comes or goes.
  const hasRod = useHasRod(sessionId);
  const fishRig = useFishingRig(sessionId, avatar, mixer);

  // The tag and the bubble are anchored to THIS avatar's top (hair, hat, ...), measured once at assembly.
  const tagHeight = nametagRestHeight(avatar.topY);

  // Where the bottom edge of this avatar's speech bubble sits (m above the group): the
  // NametagSystem rewrites it every frame so the bubble rests just above the nametag,
  // wherever that is (stacked, lifted by a jump, grown at distance). Before its first write it
  // rests just above where this avatar's tag is.
  const bubbleAnchor = useRef({ y: bubbleRestHeight(avatar.topY) }).current;

  // Speech bubble above this avatar, driven by the chat broadcast. Cleaned up
  // with the avatar when it unmounts (leaving player) — no leaked sprites.
  const bubbleTop = useSpeechBubble(sessionId, groupRef, bubbleAnchor);
  // Emoji reaction above this avatar, driven by the emoji broadcast. Same
  // cleanup-with-avatar discipline as the speech bubble; it starts above the bubble.
  useEmoji(sessionId, groupRef, avatar.topY, bubbleTop);

  // Per-frame mutable state — refs, never React state.
  const idleAction = useRef<AnimationAction | null>(null);
  const walkAction = useRef<AnimationAction | null>(null);
  const runAction = useRef<AnimationAction | null>(null);
  const sitDownAction = useRef<AnimationAction | null>(null);
  const sitIdleAction = useRef<AnimationAction | null>(null);
  const sitStandAction = useRef<AnimationAction | null>(null);
  // The cross-legged floor-seat versions of the three sit clips (Seat.pose === "floor"): they take the roles of the three refs above
  // while the avatar is on such a seat, so the state machine below never looks at which seat kind it is.
  const floorSitDownAction = useRef<AnimationAction | null>(null);
  const floorSitIdleAction = useRef<AnimationAction | null>(null);
  const floorSitStandAction = useRef<AnimationAction | null>(null);
  const chairSitActions = useRef<(AnimationAction | null)[]>([null, null, null]);
  const jumpAction = useRef<AnimationAction | null>(null);
  // Jump (Task 11): seq of the registry hop currently animating (-1 = none), and the
  // wrapper that keeps the blob shadow on the floor while the avatar is in the air.
  const jumpSeqRef = useRef(-1);
  // The raised porches' picture lift (집 외관 A8, houses/houseLift.ts), eased per frame.
  const stepLiftRef = useRef(0);
  const shadowRef = useRef<Group>(null);
  // Current gait (idle / walk / run), derived from interpolated speed only.
  const gaitRef = useRef<Gait>("idle");
  // The locomotion loop on the body (stride.ts): picked by the speed the avatar is DRAWN at while it moves (the gait
  // above, or any drawn motion) and played at the rate that keeps the foot on the ground still. Null while a one-shot
  // (sit / stand / jump) owns the body; the locomotion step puts a loop back on.
  const loopRef = useRef<Gait | null>("idle");
  const driveRef = useRef(createLoopDriver());
  // The walk / run loop fading out after a walk <-> run switch, and how long (s) it still shows: it keeps following
  // the drawn speed while it does (a stop freezes it instead, and a one-shot leaves it be).
  const fadingRef = useRef<{ loop: Gait; left: number } | null>(null);
  // False until the first frame after the bind: that frame moves the drawn pose from where the bind seeded it (the
  // newest snapshot) to the render time's, behind it — a jump, not a step (it read 12-24 m/s and started the run cycle).
  const primedRef = useRef(false);
  const fadeRef = useRef(0); // remaining crossfade time (s); mixer ticks while > 0
  // Seating (remoteSeat.ts): `up` = normal loco; `sitting`/`standing` are the one-shot transient clips; `seated` is
  // the held Sit_Chair_Idle pose. The avatar sits down / gets up when its render time reaches the seat change (not
  // when the patch arrives), gliding onto / off a bench from where it is drawn, snapping onto / off a legacy chair.
  // Created at bind time (below) from the seat the avatar is drawn on.
  const seatRef = useRef<SeatMotion | null>(null);
  // The ground pose drawn on the latest frame (x, z, facing): the glides start from it.
  const drawnRef = useRef<GroundPose>({ x: 0, z: 0, yaw: 0 });
  // `clip`: the planes that hide what hangs inside the bench (benchClip.ts); `clipped`: applied right now.
  const benchClipRef = useRef({ clip: null as Plane[] | null, clipped: false });
  const framesSinceRef = useRef(0); // frames since last mixer.update
  const accDeltaRef = useRef(0); // accumulated delta (s) since last mixer.update
  const prevConnectedRef = useRef(true);
  // The place in the village bus this avatar is drawn in (-1: not riding), and the pose there (reused).
  const ridingRef = useRef<BusPlaceKind | "none">("none");
  /** On the 별똥별 급행 (Player.rideSeat): drawn in the car, seated, tilting with it (land/coasterRide.ts carSeatPose). */
  const coasterRidingRef = useRef(false);
  const coasterPose = useRef({ pos: new Vector3(), quat: new Quaternion() });
  const riderPoseRef = useRef<BusRiderPoseFull>({ x: 0, z: 0, yaw: 0, y: 0, seated: false });
  // The rider's point in the bus's own frame as DRAWN: it eases to the server's (the patches come ten a second) and moves
  // with the bus, so the avatar walks the aisle smoothly whatever the bus does.
  const busDrawnRef = useRef({ ahead: 0, right: 0, yaw: 0, y: 0, init: false });

  // Bind idle/walk/sit actions and settle the resting pose (mixer stays paused
  // afterward — an idle/seated avatar is a frozen pose, per the v1 mixer rules).
  // A remote that is ALREADY seated when we join settles straight into the held
  // seated pose (no replayed sit-down animation). Every clip is bound by the name
  // clipFor resolves for this look, so a long-skirt remote walks, runs and jumps
  // with the `*_LongSkirt` variants (Review Focus 7); the state machine below keeps
  // working on these refs, never on clip names. Declared after useAvatar, so the
  // avatar probe entry exists when the resting clip is reported.
  useEffect(() => {
    const bind = (base: string): AnimationAction | null => {
      const name = clipFor(base, look);
      const clip = animations.find((c) => c.name === name);
      return clip ? mixer.clipAction(hasRod && CARRY_STRIPPED_CLIPS.test(clip.name) ? stripArm(clip) : clip) : null;
    };
    idleAction.current = bind(CLIP.idle);
    walkAction.current = bind(CLIP.walk);
    runAction.current = bind(CLIP.run);
    chairSitActions.current = [bind(CLIP.sitDown), bind(CLIP.sitIdle), bind(CLIP.sitStand)];
    floorSitDownAction.current = bind(FLOOR_CLIP.sitDown);
    floorSitIdleAction.current = bind(FLOOR_CLIP.sitIdle);
    floorSitStandAction.current = bind(FLOOR_CLIP.sitStand);
    jumpAction.current = bind(CLIP.jump);

    // The seat the avatar is DRAWN on (a change still on its way is replayed when the render time gets there).
    const rec = getRemoteRecord(sessionId);
    const startedIndex = rec ? (rec.seatLine ?? createSeatLine(rec.seatIndex)).drawn : -1;
    const startedSeated = startedIndex >= 0;
    setSitClips(isFloorSeat(activeSeats()[startedIndex]));
    const rest = startedSeated ? sitIdleAction.current : idleAction.current;
    rest?.reset().fadeIn(0).play();
    loopRef.current = startedSeated ? null : "idle";
    fadingRef.current = null;
    primedRef.current = false;
    const newest = rec?.snapshots[rec.snapshots.length - 1];
    if (newest) {
      drawnRef.current.x = newest.x;
      drawnRef.current.z = newest.z;
      drawnRef.current.yaw = newest.yaw;
    }
    // Already on a bench: on its surface from the first frame.
    seatRef.current = createSeatMotion(startedIndex, activeSeats(), drawnRef.current);
    benchClipRef.current.clip = startedSeated ? benchClipPlanes(activeSeats()[startedIndex]) : null;
    if (import.meta.env.DEV && rest) reportAvatarClip(sessionId, rest.getClip().name);
    mixer.update(0); // apply frame 0 so we don't render the bind/T-pose
    return () => {
      mixer.stopAllAction();
    };
  }, [mixer, animations, look, sessionId, hasRod]);

  /** Which three actions play the sit roles: the cross-legged floor ones on a floor seat, the chair ones otherwise. */
  const setSitClips = (floor: boolean): void => {
    const chair = chairSitActions.current;
    sitDownAction.current = floor ? floorSitDownAction.current : chair[0];
    sitIdleAction.current = floor ? floorSitIdleAction.current : chair[1];
    sitStandAction.current = floor ? floorSitStandAction.current : chair[2];
  };

  // DEV-only E2E probe (window.__cv.getRemoteGaits): publish this avatar's gait,
  // and drop the entry when it leaves. Dead code in production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    remoteGaitProbe.set(sessionId, "idle");
    return () => {
      remoteGaitProbe.delete(sessionId);
      remoteDrawnProbe.delete(sessionId);
    };
  }, [sessionId]);

  // DEV-only E2E probe (window.__cv.getRemoteView): where this avatar's body really is on screen right now.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    remoteViewProbe.set(sessionId, () => {
      const slot = slotRef.current;
      if (slot >= 0 && impARef.current >= 1 && crowd) {
        const m = crowd.mesh.instanceMatrix.array as Float32Array;
        return { kind: "imp", x: m[slot * 16 + 12]!, y: m[slot * 16 + 13]!, z: m[slot * 16 + 14]!, visible: true };
      }
      const e = avatar.root.matrixWorld.elements;
      const inScene = avatar.root.parent !== null;
      return { kind: inScene ? "full" : "none", x: e[12]!, y: e[13]!, z: e[14]!, visible: groupRef.current?.visible ?? false };
    });
    return () => {
      remoteViewProbe.delete(sessionId);
    };
  }, [sessionId, crowd, avatar]);

  /** The looping action of a loop (null if the clip is missing). */
  const loopAction = (l: Gait): AnimationAction | null =>
    l === "run" ? runAction.current : l === "walk" ? walkAction.current : idleAction.current;

  /**
   * Hand the body from the loop on it (fading out; none while a one-shot had it) to loop `to` (fading in) at drawn
   * speed `speed` (m/s), and keep the mixer ticking through the crossfade. As for the local player (LocalPlayer
   * switchLoop): a walk / run loop starts on the outgoing loop's step (or, from standing, with its left foot planted)
   * at the rate that keeps that foot still, and stopping freezes the outgoing loop's feet while they fade out.
   */
  const switchLoop = (to: Gait, speed: number): void => {
    const from = loopRef.current;
    const fade = loopFade(from, to);
    const out = from === null ? null : loopAction(from);
    if (out) {
      out.fadeOut(fade);
      if (to === "idle") out.timeScale = 0;
    }
    fadingRef.current = out && from !== "idle" && to !== "idle" ? { loop: from as Gait, left: fade } : null;
    loopRef.current = to;
    fadeRef.current = Math.max(fadeRef.current, fade);
    const loop = loopAction(to);
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
    reportClip(loop);
  };

  /** Fade out the loop on the body (a one-shot takes it over) — it is off the body from now on. */
  const releaseLoop = (fade: number): void => {
    if (loopRef.current !== null) loopAction(loopRef.current)?.fadeOut(fade);
    loopRef.current = null;
    fadingRef.current = null;
  };

  /** Settle on a gait (the caller owns the crossfade) and mirror it to the DEV probe. */
  const setGait = (g: Gait): void => {
    gaitRef.current = g;
    if (import.meta.env.DEV) remoteGaitProbe.set(sessionId, g);
  };

  /**
   * DEV avatar probe (`__cvAvatars()[sid].clip`): the clip `action` (already resolved
   * through clipFor at bind time) now owns the body. Called on each transition only —
   * never per frame.
   */
  const reportClip = (action: AnimationAction | null): void => {
    if (import.meta.env.DEV && action) reportAvatarClip(sessionId, action.getClip().name);
  };

  // A leaving avatar takes its pending hop and its typing "…" with it, so a reused sid
  // can't inherit either.
  useEffect(() => {
    return () => {
      jumpRegistry.remove(sessionId);
      typingRegistry.remove(sessionId);
    };
  }, [sessionId]);

  // The nametag lives exactly as long as this effect (a create/release pair, so React's
  // dev double-run of effects and renders cannot leak a texture reference): the sprite is
  // parented to the avatar group — it rides the jump lift — and starts invisible so it
  // fades in rather than flashing at full opacity. The NametagSystem owns it from the
  // registration on: whether it is shown (nearest 15 / speaking),
  // its fade, size, stacking, typing "…" and the bubble anchor.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const tag = createNametag(nickname, "none", tagHeight);
    tag.setOpacity(0);
    group.add(tag.sprite);
    const unregister = registerLabel({
      id: sessionId,
      anchor: group,
      tag,
      pinned: false,
      bubbleAnchor,
      heightM: tagHeight,
    });
    return () => {
      unregister();
      group.remove(tag.sprite);
      tag.dispose();
    };
  }, [sessionId, nickname, bubbleAnchor, tagHeight]);

  // Release this avatar's mixer on unmount. Its materials and the shared merged
  // geometry belong to useAvatar, which releases them itself (never disposed here).
  useEffect(() => {
    const root = avatar.root;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      // A remount may get the same assembled avatar back (useAvatar's cache): never hand it on clipped.
      clipAvatar(avatar, null);
      benchClipRef.current.clipped = false;
    };
  }, [avatar, mixer]);

  /**
   * The clips of the seat motion (remoteSeat.ts calls this as a change starts or a clip ends): sitting down / getting
   * up play their one-shot clip and return its length (s); the end of one hands over to the held seated pose or to
   * idle. Never per frame.
   */
  const seatTransition = (what: SeatTransition): number => {
    // The seat's kind decides which clips play the sit roles (set before the first clip of a sit starts; held until it is over).
    if (what === "sit" || what === "seated") setSitClips(isFloorSeat(activeSeats()[seatRef.current?.seat ?? -1]));
    switch (what) {
      case "sit": {
        releaseLoop(ANIM_FADE);
        setGait("idle");
        sitIdleAction.current?.fadeOut(ANIM_FADE);
        sitStandAction.current?.fadeOut(ANIM_FADE);
        const seat = seatRef.current;
        benchClipRef.current.clip = seat ? benchClipPlanes(activeSeats()[seat.seat]) : null;
        reportClip(sitDownAction.current);
        return playOnce(sitDownAction.current);
      }
      case "stand":
        sitIdleAction.current?.fadeOut(ANIM_FADE);
        sitDownAction.current?.fadeOut(ANIM_FADE);
        reportClip(sitStandAction.current);
        return playOnce(sitStandAction.current);
      case "seated":
        sitDownAction.current?.fadeOut(ANIM_FADE);
        sitIdleAction.current?.reset().fadeIn(ANIM_FADE).play();
        reportClip(sitIdleAction.current);
        fadeRef.current = ANIM_FADE;
        return 0;
      case "up":
        sitStandAction.current?.fadeOut(ANIM_FADE);
        idleAction.current?.reset().fadeIn(ANIM_FADE).play();
        loopRef.current = "idle";
        reportClip(idleAction.current);
        setGait("idle");
        fadeRef.current = ANIM_FADE;
        benchClipRef.current.clip = null;
        return 0;
    }
  };

  /**
   * On the bus (owner 2026-11-15): the body leaves whatever it was doing for the held seated pose (or Idle on a standing
   * place in the aisle); off it, Idle on the ground where the server put it down at the door.
   */
  const startRide = (kind: BusPlaceKind): void => {
    releaseLoop(ANIM_FADE);
    setGait("idle");
    jumpAction.current?.fadeOut(ANIM_FADE);
    jumpSeqRef.current = -1;
    sitDownAction.current?.fadeOut(ANIM_FADE);
    sitStandAction.current?.fadeOut(ANIM_FADE);
    if (kind === "seat") {
      sitIdleAction.current?.reset().fadeIn(ANIM_FADE).play();
      reportClip(sitIdleAction.current);
    } else {
      sitIdleAction.current?.fadeOut(ANIM_FADE);
      loopRef.current = null; // the ride's loop step puts Idle / the walk on
    }
    fadeRef.current = ANIM_FADE;
    if (benchClipRef.current.clipped) clipAvatar(avatar, null);
    benchClipRef.current.clip = null;
    benchClipRef.current.clipped = false;
    if (shadowRef.current) shadowRef.current.visible = false;
  };
  const endRide = (rec: NonNullable<ReturnType<typeof getRemoteRecord>>): void => {
    sitIdleAction.current?.fadeOut(ANIM_FADE);
    idleAction.current?.reset().fadeIn(ANIM_FADE).play();
    reportClip(idleAction.current);
    loopRef.current = "idle";
    setGait("idle");
    fadeRef.current = ANIM_FADE;
    if (shadowRef.current) shadowRef.current.visible = true;
    // Down at the door: drawn from the server's spot at once (the poses from before the ride, on the pad, are dropped,
    // so the avatar does not slide there first), and the seat motion starts afresh from it.
    if (rec.snapshots.length > 1) rec.snapshots.splice(0, rec.snapshots.length - 1);
    const newest = rec.snapshots[rec.snapshots.length - 1];
    const drawn = drawnRef.current;
    if (newest) {
      drawn.x = newest.x;
      drawn.z = newest.z;
      drawn.yaw = newest.yaw;
    }
    const line = (rec.seatLine ??= createSeatLine(rec.seatIndex));
    line.pending.length = 0;
    line.drawn = rec.seatIndex;
    seatRef.current = createSeatMotion(rec.seatIndex, activeSeats(), drawn);
    primedRef.current = false;
    // The avatar's node tree was posed by hand at the car / in the bus until now (and a ride puts the rider back on the very spot it
    // boarded from): the far "still" rule of step 8 (nothing moved, nothing touched since the last refresh) must not keep that pose.
    treeDirtyRef.current = true;
    refreshedAtRef.current.x = Number.NaN;
  };

  /**
   * The viewer came close (or the avatar sat down, boarded, was disconnected...): the full avatar is back in the scene, posed
   * as the mixer last left it, and the stand-in's slot is free.
   */
  const leaveImpostor = (group: RemoteAvatarGroup | null): void => {
    if (slotRef.current < 0) return;
    crowd?.release(slotRef.current);
    slotRef.current = -1;
    wantImpRef.current = false;
    impARef.current = 0;
    setFadeCut(avatar.materials, 0);
    if (group) {
      if (avatar.root.parent !== group) group.add(avatar.root);
      if (shadowRef.current) shadowRef.current.visible = true;
      mixer.update(0);
      group.refreshTransform();
      treeDirtyRef.current = false;
    }
    lodFramesRef.current = 0;
  };
  // The stand-in's slot goes back when the avatar leaves, and when the scene rebuilds its crowd (then the full avatar shows
  // again at once; the next frame decides afresh). The avatar itself is fixed for the mount: on its way out nothing is re-added.
  useEffect(() => {
    return () => {
      if (slotRef.current < 0) return;
      crowd?.release(slotRef.current);
      slotRef.current = -1;
      wantImpRef.current = false;
      impARef.current = 0;
      setFadeCut(avatar.materials, 0);
      lodFramesRef.current = 0;
      const group = groupRef.current;
      if (group && avatar.root.parent === null) {
        group.add(avatar.root);
        if (shadowRef.current) shadowRef.current.visible = true;
      }
    };
  }, [crowd, avatar]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (group) group.restingBody = null;
    const rec = getRemoteRecord(sessionId);
    if (!group || !rec || !seatRef.current) return;

    // 0a) The 별똥별 급행: a rider is seated in the car, on the shared clock's train (the same for every viewer).
    const rideSlot = rec.rideSeat ?? -1;
    if (rideSlot >= 0 || coasterRidingRef.current) {
      if (rideSlot >= 0) {
        leaveImpostor(group);
        if (!coasterRidingRef.current) {
          coasterRidingRef.current = true;
          startRide("seat");
        }
        const cp = coasterPose.current;
        rideSeatPose(rec.rideId ?? 0, rideSlot, cp.pos, cp.quat);
        group.position.copy(cp.pos);
        group.quaternion.copy(cp.quat);
        group.visible = true;
        const dr = drawnRef.current;
        dr.x = cp.pos.x;
        dr.z = cp.pos.z;
        noteRemoteDrawn(rec, cp.pos.x, cp.pos.z);
        advancePlayout(rec.playout, rec.snapshots, performance.now());
        // a rider whose connection dropped (the server keeps the seat for the reconnection window) is drawn as the ghost it is
        if (rec.connected !== prevConnectedRef.current) {
          setAvatarOpacity(avatar, rec.connected ? 1 : 0.5);
          prevConnectedRef.current = rec.connected;
        }
        if (fadeRef.current > 0) {
          mixer.update(delta);
          fadeRef.current = Math.max(0, fadeRef.current - delta);
        }
        // the avatar's node tree is refreshed by hand: the walking path switches the automatic update off (step 8 below), and a group
        // with matrixWorldAutoUpdate off keeps the matrixWorld it is given
        group.refreshTransform();
        return;
      }
      // got off: upright again, on the ground where the server has them
      coasterRidingRef.current = false;
      group.quaternion.identity();
      group.rotation.set(0, 0, 0);
      group.visible = true;
      endRide(rec);
    }

    // 0) The village bus: a rider is a person in the bus's own frame (busCabin.ts): free in the aisle they walk (eased from
    //    the server's point, ten patches a second), on a seat they sit, at a pole they hold on; they move with the bus,
    //    the same synced pose for every viewer.
    const busSlot = rec.busSeat ?? -1;
    const placeNow = busSlot < 0 ? null : busPlaceOf(busSlot);
    const kindNow: BusPlaceKind | "none" = placeNow ? placeNow.kind : "none";
    const bd = busDrawnRef.current;
    if (kindNow !== ridingRef.current) {
      const was = ridingRef.current;
      ridingRef.current = kindNow;
      if (kindNow === "none") {
        bd.init = false;
        group.visible = true;
        endRide(rec);
      } else {
        if (was === "none") bd.init = false;
        startRide(kindNow);
      }
    }
    if (placeNow) {
      leaveImpostor(group);
      const bus = getTransitRenderPose();
      const spot = placeNow.kind === "seat" ? BUS_SEATS[placeNow.index]! : null;
      const body = spot ? seatBodyPoint(spot) : null;
      stepBackSquash(avatar.root, avatar.materials, spot ? busSeatBackFace(spot) : 0, CHAIR_BACK_BAND, delta);
      const tA = body ? body.ahead : rec.busAhead ?? 0;
      const tR = body ? body.right : rec.busRight ?? 0;
      const tYaw = spot ? spot.yaw : rec.busYaw ?? 0;
      if (!bd.init) {
        bd.ahead = tA;
        bd.right = tR;
        bd.yaw = tYaw;
        bd.init = true;
      }
      // bus v3 ("행동이 실제와 비슷한 느낌", not snappy): onto a seat and off it the body glides (about a third of a second), as walking does
      const k = placeNow.kind === "seat" ? 1 - Math.exp(-delta * 9) : 1 - Math.exp(-delta * 14);
      const dA = (tA - bd.ahead) * k;
      const dR = (tR - bd.right) * k;
      bd.ahead += dA;
      bd.right += dR;
      bd.yaw = normalizeYaw(bd.yaw + normalizeYaw(tYaw - bd.yaw) * Math.min(1, delta * 12));
      const p = busRiderWorldPose(bus, busSlot, bd.ahead, bd.right, bd.yaw, riderPoseRef.current);
      // drawn at the eased point (a seated rider's too: the seat's body point is where it glides to)
      busLocalToWorld(bus, bd.ahead, bd.right, p);
      p.yaw = bus.yaw + bd.yaw;
      const targetY = p.y;
      bd.y = bd.init && bd.y > 0 ? bd.y + (targetY - bd.y) * Math.min(1, delta * 12) : targetY;
      group.position.set(p.x, bd.y, p.z);
      group.rotation.y = p.yaw + MODEL_FACING_OFFSET;
      group.visible = !riderInTheWay(state.camera, p.x, bd.y, p.z, group.visible);
      const drawn = drawnRef.current;
      drawn.x = p.x;
      drawn.z = p.z;
      drawn.yaw = p.yaw;
      noteRemoteDrawn(rec, p.x, p.z);
      advancePlayout(rec.playout, rec.snapshots, performance.now()); // its clock keeps going for the walk after
      // walking in the aisle: the foot loop follows the speed in the bus's frame
      if (placeNow.kind !== "seat" && delta > 0) {
        const speedBus = Math.hypot(dA, dR) / delta;
        const fx = Math.sin(bus.yaw);
        const fz = Math.cos(bus.yaw);
        const moving = speedBus > 0.15;
        const drive = driveRef.current;
        const loop = stepLoop(drive, loopRef.current ?? "idle", moving, moving ? speedBus : 0, delta, REMOTE_SPEED_SMOOTH_S);
        stepFacing(drive, moving ? alongFacing(dA * fx - dR * fz, dA * fz + dR * fx, p.yaw) : Number.NaN, delta);
        const loopSpeedNow = loopSpeed(drive);
        if (loop !== loopRef.current) switchLoop(loop, loopSpeedNow);
        else if (loop !== "idle") {
          const playing = loopAction(loop);
          if (playing) playing.timeScale = loopTimeScale(loop, loopSpeedNow, stride, playing.time, playing.getClip().duration);
        }
        const fading = fadingRef.current;
        if (fading) {
          const out = loopAction(fading.loop);
          if (out) out.timeScale = loopTimeScale(fading.loop, loopSpeedNow, stride, out.time, out.getClip().duration);
          fading.left -= delta;
          if (fading.left <= 0) fadingRef.current = null;
        }
      }
      if (import.meta.env.DEV) {
        const probe = remoteDrawnProbe.get(sessionId) ?? { t: 0, x: 0, z: 0, yaw: 0 };
        probe.t = performance.now();
        probe.x = p.x;
        probe.z = p.z;
        probe.yaw = p.yaw;
        probe.y = bd.y;
        probe.mode = p.seated ? "bus-seated" : "bus-standing";
        remoteDrawnProbe.set(sessionId, probe);
      }
      if (rec.connected !== prevConnectedRef.current) {
        setAvatarOpacity(avatar, rec.connected ? 1 : 0.5);
        prevConnectedRef.current = rec.connected;
      }
      const loopActive = loopRef.current !== null && loopRef.current !== "idle";
      if (fadeRef.current > 0 || loopActive) {
        mixer.update(delta);
        fadeRef.current = Math.max(0, fadeRef.current - delta);
      }
      // a rider moves with the bus: its node tree every frame (step 8's LOD is for walkers)
      if (!group.matrixWorldAutoUpdate) group.refreshTransform();
      return;
    }
    const seat = seatRef.current;

    // 1) Advance this remote's playout clock (it trails the newest data by an adaptive lag and never
    //    passes it — playout.ts) and sample the snapshot buffer there. Seated players emit no moves, so the
    //    buffer ends on the seat position/yaw.
    const nowMs = performance.now();
    const renderT = advancePlayout(rec.playout, rec.snapshots, nowMs);
    const target = sample(rec.snapshots, renderT);
    const drawn = drawnRef.current;
    const fromX = drawn.x;
    const fromZ = drawn.z;
    let snapped = false;
    if (target) {
      snapped = exceedsSnapDistance(drawn.x, drawn.z, target.x, target.z);
      // 2) Seat changes (server-authoritative seatIndex) are drawn when the render time reaches them: the sit /
      //    stand clips start there, and the seat motion decides the pose — the sampled one while up, a glide onto
      //    / off a bench from the drawn pose, a snap onto / off a legacy chair (remoteSeat.ts).
      const line = (rec.seatLine ??= createSeatLine(rec.seatIndex));
      stepSeatMotion(seat, line, renderT, target, delta, activeSeats(), drawn, seatTransition);
      // Never drawn inside the moving bus (checker r2): the server puts anyone its body reaches out on a flank, but this
      // avatar is drawn a moment behind its moves (the playout lag) while the bus is drawn at the present — so the same
      // push (shared busBody.ts) is applied to the drawn pose too, and it sits against the flank on every screen.
      if (seat.mode === "up") {
        const out = pushOutOfMovingBus(drawn.x, drawn.z);
        if (out) {
          drawn.x = out.x;
          drawn.z = out.z;
        }
      }
      group.position.x = drawn.x;
      group.position.z = drawn.z;
      group.rotation.y = drawn.yaw + MODEL_FACING_OFFSET;
      // The body the local player collides with is the one drawn here (remoteStore.forEachRemotePosition).
      noteRemoteDrawn(rec, drawn.x, drawn.z);
    }
    // The speed (m/s) this avatar is drawn going at this frame — what the viewer sees, playout warp included — which
    // the loop on its body follows (stride.ts). A snap is a teleport, not a step; seat glides are the clips' own; the
    // first frame after the bind moves the drawn pose off where the bind seeded it.
    const primed = primedRef.current;
    primedRef.current = true;
    const drawnDx = drawn.x - fromX;
    const drawnDz = drawn.z - fromZ;
    const drawnSpeed =
      primed && target && !snapped && seat.mode === "up" && delta > 0 ? Math.hypot(drawnDx, drawnDz) / delta : 0;

    // Hide what hangs inside the bench while the avatar is on it (benchClip.ts), as for the local player.
    const benchClip = benchClipRef.current;
    const onBench = benchClip.clip !== null && onBenchNow(seat);
    if (onBench !== benchClip.clipped) {
      if (onBench) enableBenchClipping(state.gl);
      clipAvatar(avatar, onBench ? benchClip.clip : null);
      benchClip.clipped = onBench;
    }
    // A backed seat: lean back while seated (leanBack.ts). `seat.seat` is the seat index on the one global list.
    const lean = stepLean(avatar.root, seat.mode === "seated" ? (activeSeats()[seat.seat]?.lean ?? 0) : 0, delta);
    {
      const seatNow = seat.mode === "seated" ? activeSeats()[seat.seat] : undefined;
      stepBackSquash(avatar.root, avatar.materials, seatBackFace(seatNow), backBandOf(seatNow), delta);
    }

    // Fishing lake: the rod, the fishing clips, the landed fish; a no-op without a rod.
    fishRig.update(delta, { seatMode: seat.mode, baseSit: sitIdleAction.current });

    // 3b) Jump (Task 11): a broadcast hop lifts the group (display only — the server
    //    y never changes) and plays Jump_Full_Short once, squeezed into
    //    JUMP_DURATION_MS. Only a standing avatar hops: a seated or sitting/standing
    //    one drops the hop (no late replay), and a hop in the air when the seat is
    //    confirmed just fades out. Registry reads allocate nothing.
    let lift = 0;
    {
      const canJump = seat.mode === "up";
      const entry = currentJump(sessionId, canJump, nowMs);
      const phase = jumpPhase(entry, canJump, jumpSeqRef.current);
      const jump = jumpAction.current;
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
            reportClip(jump);
          }
        }
        lift = jumpOffsetY(nowMs - hop.startedAt, jumpHeadroom(group.position.x, group.position.z, localArea(), avatar.topY));
      } else if (phase === "landed" || phase === "dropped") {
        jumpSeqRef.current = -1;
        if (jump) {
          // The take-off took the loop off the body: on landing step 4 (this same frame) puts on the one for the gait
          // at the speed the avatar is drawn at.
          jump.fadeOut(ANIM_FADE);
          fadeRef.current = ANIM_FADE; // keep the mixer ticking through the crossfade
        }
      }
      // A bench raises its sitter onto the seat surface (eased in / out with the clips); the shadow stays down.
      // The porch's lift (A8) under the drawn pose; a seat's own lift is not added on top of it.
      stepLiftRef.current = easeLift(stepLiftRef.current, stepLiftAt(group.position.x, group.position.z), Math.min(0.1, delta));
      const raise = lift + withSeatLift(stepLiftRef.current, seatLift(seat) * fishRig.liftFactor());
      group.position.y = raise;
      if (shadowRef.current) shadowRef.current.position.y = -raise + stepLiftRef.current;
    }
    if (import.meta.env.DEV && target) {
      // E2E probe (window.__cv.getRemoteDrawn): what this viewer sees, frame by frame. Mutated in place.
      const probe = remoteDrawnProbe.get(sessionId);
      if (probe) {
        probe.t = nowMs;
        probe.x = group.position.x;
        probe.z = group.position.z;
        probe.yaw = drawn.yaw;
        probe.y = group.position.y;
        probe.mode = seat.mode;
      } else {
        remoteDrawnProbe.set(sessionId, {
          t: nowMs,
          x: group.position.x,
          z: group.position.z,
          yaw: drawn.yaw,
          y: group.position.y,
          mode: seat.mode,
        });
      }
    }

    // 4) Locomotion from interpolated speed — ONLY while standing (a seated avatar
    //    must never show the walk or run cycle, even if a stray snapshot implies speed)
    //    and not mid-hop (the hop owns the body; on landing this puts the loop back on).
    if (target && seat.mode === "up" && jumpSeqRef.current === -1) {
      // Gait speed is a windowed path length (not the noisy per-segment speed), so
      // bursts and jitter cannot flip walk <-> run; held on its newest pose, the avatar
      // goes idle (see playoutGaitSpeed / remoteGaitSpeed).
      const speed = snapped ? 0 : playoutGaitSpeed(rec.playout, rec.snapshots);
      const gait = nextGait(gaitRef.current, speed);
      if (gait !== gaitRef.current) setGait(gait);
      // The loop on the body: the one its drawn speed calls for while it moves (Idle while it is held still), played
      // every frame at the rate that keeps the planted foot still. It steps off as soon as it is DRAWN moving — the
      // windowed gait speed ramps over SPEED_WINDOW_MS, and Idle's feet would slide along with the body until then —
      // on the walk cycle (stepLoop: a few jerky frames of a walker just mounted are no run), and a remote that starts
      // running is not stuck on a too-slow loop while the gait catches up: its smoothed drawn speed takes it on.
      // Backward while it is drawn backing up (a first-person player's S), and a loop still fading out after a walk
      // <-> run switch follows the speed too.
      const drive = driveRef.current;
      const moving = gait !== "idle" || drawnSpeed > 0;
      const loop = stepLoop(drive, loopRef.current ?? "idle", moving, drawnSpeed, delta, REMOTE_SPEED_SMOOTH_S);
      stepFacing(drive, drawnSpeed > 0 ? alongFacing(drawnDx, drawnDz, drawn.yaw) : Number.NaN, delta);
      const loopSpeedNow = loopSpeed(drive);
      if (loop !== loopRef.current) switchLoop(loop, loopSpeedNow);
      else if (loop !== "idle") {
        const playing = loopAction(loop);
        if (playing) {
          playing.timeScale = loopTimeScale(loop, loopSpeedNow, stride, playing.time, playing.getClip().duration);
        }
      }
      const fading = fadingRef.current;
      if (fading) {
        const out = loopAction(fading.loop);
        if (out) out.timeScale = loopTimeScale(fading.loop, loopSpeedNow, stride, out.time, out.getClip().duration);
        fading.left -= delta;
        if (fading.left <= 0) fadingRef.current = null;
      }
    }

    // 5) Connected → opacity, applied only on transition (not every frame). Restoring 1
    //    returns each material to its authored state (the BLEND face stays blended).
    if (rec.connected !== prevConnectedRef.current) {
      setAvatarOpacity(avatar, rec.connected ? 1 : 0.5);
      prevConnectedRef.current = rec.connected;
    }

    // 6) Camera distance for the mixer throttle below. (The nametag — fade, size, stacking,
    //    typing — is the NametagSystem's job; this avatar only registered it.)
    const camDist = state.camera.position.distanceTo(group.position);

    // 6b) Far stand-in (crowdImpostor.ts): a standing or walking avatar well away from the camera is one instance of the crowd
    //     mesh — no mixer, no node tree, no draws of its own. Hysteresis between ENTER and EXIT; anything but a plain ground
    //     avatar (seated, getting up, hopping, fishing, ghosted) stays a full avatar.
    if (crowd && CROWD_STAND_INS && !crowdLodOff()) {
      const eligible =
        !!target && seat.mode === "up" && jumpSeqRef.current === -1 && rec.connected && !hasRod && !fishRig.needsTick();
      if (!eligible) {
        leaveImpostor(group); // at once: the avatar sits, boards, hops...
      } else {
        crowd.report(camDist);
        const forced = import.meta.env.DEV ? crowdForce(sessionId) : null;
        const want = forced ? forced === "imp" : wantsImpostor(wantImpRef.current, true, camDist, crowd.thresholdM);
        wantImpRef.current = want;
        if (want && slotRef.current < 0) {
          const slot = crowd.acquire(crowdColors);
          if (slot >= 0) {
            slotRef.current = slot;
            impARef.current = 0;
            if (crowd.blob && shadowRef.current) shadowRef.current.visible = false;
          } else {
            wantImpRef.current = false;
          }
        }
        if (slotRef.current >= 0) {
          // the dissolve: a quarter of a second between the full avatar and its stand-in, both drawn meanwhile
          const a = impARef.current;
          const next = want ? Math.min(1, a + delta * IMPOSTOR_FADE_PER_S) : Math.max(0, a - delta * IMPOSTOR_FADE_PER_S);
          impARef.current = next;
          if (next >= 1) {
            if (avatar.root.parent === group) avatar.root.removeFromParent();
          } else {
            if (avatar.root.parent !== group) {
              group.add(avatar.root);
              mixer.update(0);
              group.refreshTransform();
              treeDirtyRef.current = false;
              lodFramesRef.current = 0;
            }
            setFadeCut(avatar.materials, next);
          }
          if (next <= 0 && !want) leaveImpostor(group);
        }
      }
    }
    if (slotRef.current >= 0) {
      if (group.matrixWorldAutoUpdate) {
        group.matrixAutoUpdate = false;
        group.matrixWorldAutoUpdate = false;
      }
      const moving = loopRef.current !== null && loopRef.current !== "idle";
      const speed = moving ? loopSpeed(driveRef.current) : 0;
      phaseRef.current += (4 + speed) * delta;
      crowd!.place(slotRef.current, group.position.x, group.position.y, group.position.z, group.rotation.y, speed, phaseRef.current, stepLiftRef.current, impARef.current);
      if (impARef.current >= 1) {
        lodFramesRef.current += 1;
        if (lodFramesRef.current >= 2) {
          lodFramesRef.current = 0;
          group.refreshTransform(); // the tag and the blob under it (the avatar's tree is out of the scene)
        }
        return;
      }
      // dissolving: the full avatar is still in the scene and goes through the whole frame below
    }

    // 7) Mixer discipline: paused while idle/seated-settled; every-frame during a
    //    crossfade OR a one-shot sit/stand/jump clip; distance-throttled while walking/running.
    const transient = seat.mode === "sitting" || seat.mode === "standing" || jumpSeqRef.current !== -1;
    const active = (loopRef.current !== null && loopRef.current !== "idle") || fadeRef.current > 0 || transient || fishRig.needsTick();
    if (active) {
      accDeltaRef.current += delta;
      framesSinceRef.current += 1;
      if (fadeRef.current > 0 || transient || fishRig.needsTick()) {
        mixer.update(accDeltaRef.current);
        accDeltaRef.current = 0;
        framesSinceRef.current = 0;
        treeDirtyRef.current = true;
        if (fadeRef.current > 0) fadeRef.current = Math.max(0, fadeRef.current - delta);
      } else {
        const tick = decideMixerTick(camDist, framesSinceRef.current, accDeltaRef.current);
        if (tick.update) {
          mixer.update(tick.delta);
          accDeltaRef.current = 0;
          framesSinceRef.current = 0;
          treeDirtyRef.current = true;
        }
      }
    }

    // 7b) The fishing wrist (fishingRig.ts): after the frame's last mixer update, or the mixer rewrites the relaxed bones and the
    //    rod, turned back to keep its direction, points sideways.
    fishRig.afterMixer(delta);

    // 8) Far LOD (avatarLod.ts): the avatar's node tree (bones, meshes, tag) is refreshed here, every frame near, every few
    //    frames far or behind the camera (three's own pass skips it); only near avatars cast a shadow. A standing avatar that
    //    has not moved and whose pose has not been touched since the last refresh (idle: the mixer is paused) is refreshed
    //    rarely beyond the near band: nothing in its tree has changed (the tag's size and fade follow at that pace).
    if (group.matrixWorldAutoUpdate) {
      group.matrixAutoUpdate = false;
      group.matrixWorldAutoUpdate = false;
    }
    const ce = state.camera.matrixWorld.elements;
    const behind = behindCamera(group.position.x, group.position.z, state.camera.position.x, state.camera.position.z, -ce[8]!, -ce[10]!);
    lodFramesRef.current += 1;
    const at = refreshedAtRef.current;
    const still =
      !treeDirtyRef.current &&
      seat.mode === "up" &&
      at.x === group.position.x &&
      at.y === group.position.y &&
      at.z === group.position.z &&
      at.yaw === group.rotation.y;
    let cadence = avatarTreeCadence(camDist, behind);
    if (still && camDist >= AVATAR_LOD.nearM && !crowdLodOff()) cadence = Math.max(cadence, AVATAR_LOD.stillCadence);
    if (lodFramesRef.current >= cadence || transient || fadeRef.current > 0) {
      lodFramesRef.current = 0;
      group.refreshTransform();
      treeDirtyRef.current = false;
      at.x = group.position.x;
      at.y = group.position.y;
      at.z = group.position.z;
      at.yaw = group.rotation.y;
    }
    if (!active && seat.mode === "up" && !hasRod && lean === 0 && !crowdLodOff()) group.restingBody = avatar.root;
    const casts = camDist < AVATAR_LOD.shadowM;
    if (casts !== castsRef.current) {
      castsRef.current = casts;
      // the meshes that cast as built (characterAvatar.ts), found once
      if (!castersRef.current) {
        const list: Object3D[] = [];
        avatar.root.traverse((o) => {
          if (o.castShadow) list.push(o);
        });
        castersRef.current = list;
      }
      for (const o of castersRef.current) o.castShadow = casts;
    }
  });

  return (
    <AvatarGroup ref={groupRef} userData={PICK_AS_BODY}>
      <primitive object={avatar.root} />
      {blobShadow && (
        <group ref={shadowRef}>
          <BlobShadow />
        </group>
      )}
    </AvatarGroup>
  );
}
