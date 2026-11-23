// One avatar's fishing layer (design 6.2 / 6.3): the rod on the right hand (no net since lake v2), the fishing clips on the
// avatar's own mixer, the landed fish in the hands. The same object serves my avatar and every other angler: it reads the
// schema fields of its session id (lakeNet.readFishView) and decides what to show — nothing else.
//
// Clips are layered by weight on the player's mixer:
//  - seated at a fishing chair: the Fish_Sit_* / Fish_Stand_Show / Fish_Release body clips replace the held sit (the
//    player's Sit_Chair_Idle action is held at weight 0 meanwhile; their legs are Sit_Chair_Idle's first frame, so the chair fit
//    does not move);
//  - standing with a rod: Carry_Rod on the right arm. The walk, run and idle clips of a carrier have their right-arm tracks
//    removed (`stripArm`, bound by the player when `hasRod` flips) so the arm is Carry_Rod's alone.
// The rod folds to 1.15 m for walking and opens to 3.6 m over 0.6 s when the angler sits.

import { AnimationMixer, LoopOnce, LoopRepeat, Object3D, Quaternion, Vector3, type AnimationAction, type AnimationClip, type Camera } from "three";
import { relaxWrist, restoreWrist, WRIST_RELAX } from "./wristRelax";
import { FISHING_CLIPS, GRIP_OFFSET, ROD_AXIS_R, type FishingClip } from "@caysonverse/shared/village/fishingAnims";
import type { BuiltAvatar } from "../game/characterAvatar";
import { fishingAnimsNow, loadFishingAnims, withoutRightArm } from "./fishAnims";
import { elapsedSince, readFishView } from "./lakeNet";
import { reelTension } from "./fishFightView";
import { FISH_PHASE, emptyFishView, type FishView } from "./lakeProtocol";
import { createRod, lakeGearReady, loadLakeGear, type Rod } from "./lakeProps";
import { createCatchRig } from "./catchRig";
import { BREAK_S, HANG_END_S, REEL_S, faceOf } from "./fishCatch";
import { registerRodTip } from "./rodTips";
import { tugDip } from "./lakeFloat";

const FADE = 0.22;
/** The rod opens in this long (design 6.1). */
const UNFOLD_S = 0.6;
const Y = new Vector3(0, 1, 0);

export interface RigContext {
  /** remoteSeat's mode: `up` standing, `sitting`, `seated`, `standing` (getting up). */
  seatMode: "up" | "sitting" | "seated" | "standing";
  /** The player's own held sit (Sit_Chair_Idle) action, faded out while a fishing clip owns the body. */
  baseSit: AnimationAction | null;
  /** My own avatar in first person (its body is hidden): the camera the catch is held up in front of. */
  fpCamera?: Camera | null;
  /** First person: the avatar's skin and top colours (its hands drawn holding the catch). */
  fpLook?: { skin: string; top: string } | null;
}

export interface FishingRig {
  update(delta: number, ctx: RigContext): void;
  /**
   * The wrist (owner 2026-11-19): the clips turn the hand far off the forearm; eased back, the rod keeping its world direction. MUST run
   * after the frame's last mixer update (the mixer rewrites the bones, so a relax written before it is lost while the rod's
   * compensation stays: a rod pointing sideways — the remote players' bug).
   */
  afterMixer(delta: number): void;
  /** A fishing clip is playing or fading: the mixer must tick. */
  needsTick(): boolean;
  /** 1 normally; eases to 0 while a clip that stands the avatar up plays (the chair's lift would float it). */
  liftFactor(): number;
  /** A base clip (idle / walk / run) without the right arm, for the rod carrier (cached). */
  stripArm(clip: AnimationClip): AnimationClip;
  dispose(): void;
}

const stripCache = new WeakMap<AnimationClip, AnimationClip>();

/** The base clips whose right arm a rod carrier gives up: idle, walk, run and the hop (every look's variant). */
export const CARRY_STRIPPED_CLIPS = /^(Idle|Walking_A|Running_A|Jump_Full_Short)/;

/** A base clip without the right arm, cached (the player's bind uses it when `hasRod` flips). */
export function stripArm(clip: AnimationClip): AnimationClip {
  let c = stripCache.get(clip);
  if (!c) {
    c = withoutRightArm(clip);
    stripCache.set(clip, c);
  }
  return c;
}

/** Whose held item (the character's 손에 드는 것) is with the shop while they hold the rod: the HUD's words on rent / return. */
const stowed = new Map<string, boolean>();
const carries = new Map<string, boolean>();
export function heldItemStowed(sid: string): boolean {
  return stowed.get(sid) === true;
}
/** Whether this avatar holds an item of its own (it goes to the shop while a rod is rented). */
export function carriesHandItem(sid: string): boolean {
  return carries.get(sid) === true;
}

/**
 * The held item goes to the shop while the rod is held (owner 2026-11-16): every item of character.glb is skinned to `handslot.r`
 * alone, the bone the rod is held by too. The bone's own matrix is shrunk to nothing after the mixer has posed it (the item folds
 * into the palm, nothing is rebuilt, the appearance is never touched), and the rod hangs from a proxy that copies the bone's
 * unshrunk pose. Undone when the rod goes back: the item is in the hand again exactly as it was. Same on every screen (the rod is
 * the schema's `rod`).
 */
export function stowHandItem(handslot: Object3D): { proxy: Object3D; restore(): void } {
  const parent = handslot.parent;
  const proxy = new Object3D();
  proxy.name = "handslot.r.rod";
  proxy.updateMatrix = function () {
    this.matrix.compose(handslot.position, handslot.quaternion, handslot.scale);
    this.matrixWorldNeedsUpdate = true;
  };
  parent?.add(proxy);
  const own = handslot.updateMatrix;
  handslot.updateMatrix = function () {
    own.call(this);
    this.matrix.scale(TINY);
  };
  return {
    proxy,
    restore() {
      handslot.updateMatrix = own;
      handslot.updateMatrix();
      proxy.removeFromParent();
    },
  };
}
const TINY = new Vector3(1e-4, 1e-4, 1e-4);

function bone(root: Object3D, name: string): Object3D | null {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/[.[\]:/]/g, "")) ?? null;
}

/** The clip a phase wants while seated at the chair (null: leave the body to the held sit). */
export function clipForPhase(phase: number, t = 0): FishingClip | null {
  // lake v2: the reel-in before the lift (fishCatch.ts)
  if (phase === FISH_PHASE.lifting && t < REEL_S) return "Fish_Sit_Fight";
  switch (phase) {
    case FISH_PHASE.ready:
    case FISH_PHASE.settling:
    case FISH_PHASE.waiting:
    case FISH_PHASE.nibble:
    case FISH_PHASE.bite:
    case FISH_PHASE.missed:
      return "Fish_Sit_Idle";
    case FISH_PHASE.casting:
      return "Fish_Sit_Cast";
    case FISH_PHASE.hooked:
      return "Fish_Sit_Strike";
    case FISH_PHASE.fighting:
      return "Fish_Sit_Fight";
    case FISH_PHASE.lifting:
      return "Fish_Sit_Lift";
    case FISH_PHASE.landed:
      return "Fish_Stand_Show";
    case FISH_PHASE.releasing:
      return "Fish_Release";
    default:
      return null;
  }
}

/** Clips that end standing: the chair's lift is taken off while they play. */
const STANDS: ReadonlySet<FishingClip> = new Set(["Fish_Stand_Show", "Fish_Release"]);

/** How hard the rod bends (0..1) in a phase, `t` seconds into it. */
export function rodBend(view: FishView, t: number): number {
  switch (view.phase) {
    case FISH_PHASE.nibble:
      return 0.12 * (tugDip(t, view.spot, view.seq) / 0.06);
    case FISH_PHASE.bite:
      return 0.18;
    case FISH_PHASE.hooked:
      return 0.5;
    case FISH_PHASE.fighting:
      // held: bent hard under the load; let go: the tension drops (the fish takes line)
      {
        // the rod bends with the line's tension (Player.fishReel), a little more while the angler pulls; it trembles faster when it is tight
        const tn = reelTension(view.reel);
        // (a fixed tremble rate: a rate that followed the tension jumped the sine's phase every time the tension changed: a jittery rod)
        return Math.min(1, 0.28 + 0.62 * tn + ((view.reel & 128) !== 0 ? 0.1 : 0) + (0.02 + 0.03 * tn) * Math.sin(t * 8));
      }
    case FISH_PHASE.lifting:
      // reeled in hard, then the fish's weight on the line as it swings, then the hand takes it
      // (calm, owner 2026-11-22: a steady load with a slow give, no quick shaking)
      if (t < REEL_S) return 0.7 + 0.05 * Math.sin(t * 4.2);
      if (t < HANG_END_S) {
        const k = Math.min(1, (t - REEL_S) / BREAK_S);
        return 0.42 + (0.7 + 0.05 * Math.sin(REEL_S * 4.2) - 0.42) * (1 - k * k * (3 - 2 * k)) + 0.03 * Math.sin(t * 3.2) * k;
      }
      return Math.max(0, 0.42 + 0.03 * Math.sin(HANG_END_S * 3.2) - (t - HANG_END_S) * 0.9);

    default:
      return 0;
  }
}

export function createFishingRig(o: { sid: string; avatar: BuiltAvatar; mixer: AnimationMixer }): FishingRig {
  const { sid, avatar, mixer } = o;
  const view = emptyFishView();
  const root = avatar.root;
  let rod: Rod | null = null;
  const catchRig = createCatchRig(sid);
  const aimV = { fw: new Vector3(), rt: new Vector3(), d: new Vector3(), cur: new Vector3(), axis: new Vector3(), hand: new Vector3(), late: new Vector3(), pq: new Quaternion(), dq: new Quaternion() };
  /** The lift: how far the rod is turned from the reel-in's 35 degrees toward over the hand (0..1), and my own first-person view. */
  let aimLate = 0;
  let aimFp = false;
  let aimCamera: Camera | null = null;
  /** The lift (every screen, owner 2026-11-23): the rod raised in front of the angler over the facing line, how far (eased 0..1). */
  let aimOn = false;
  let aimSpot = -1;
  let aimWant = 0;
  /** The rod's elevation (rad) during the lift: 35 degrees for the reel-in, raised high, a little past upright (~100), once the fish is out. */
  let aimEl = 0.62;
  let aimAmt = 0;
  let catchShown = false;
  let rodHost: Object3D | null = null;
  let unregisterTip: (() => void) | null = null;
  let stow: ReturnType<typeof stowHandItem> | null = null;
  const hasItem = avatar.parts.some((p) => p.startsWith("item__"));
  carries.set(sid, hasItem);
  const actions = new Map<FishingClip, AnimationAction>();
  let current: FishingClip | null = null;
  let loading = false;
  let unfold = 0;
  /** The rod's bend, eased (a phase change never snaps the rod). */
  let bendS = 0;
  let lift = 1;
  let baseBlend = 1;
  let baseTouched = false;
  let lastPhase = -1;
  let lastSeq = -1;
  const q = new Quaternion();
  let handR: Object3D | null = null;
  let handL: Object3D | null = null;
  let wristAmt = 0;
  let wristWant = false;
  const rodQ0 = new Quaternion();

  const ensureActions = (): boolean => {
    const clips = fishingAnimsNow();
    if (!clips) {
      if (!loading) {
        loading = true;
        void loadFishingAnims().then(() => (loading = false));
      }
      return false;
    }
    if (actions.size === 0) {
      for (const name of Object.keys(FISHING_CLIPS) as FishingClip[]) {
        const a = mixer.clipAction(clips[name]);
        a.setLoop(FISHING_CLIPS[name].loop ? LoopRepeat : LoopOnce, FISHING_CLIPS[name].loop ? Infinity : 1);
        a.clampWhenFinished = true;
        actions.set(name, a);
      }
    }
    return true;
  };

  const attachRod = (): void => {
    if (rod) return;
    handR = handR ?? bone(root, "handslot.r");
    if (!handR) return;
    rod = createRod();
    // the stand-in points along +Y; lake_gear.glb's rod is authored along ROD_AXIS_R in the slot's frame already
    if (rod.real) rod.root.quaternion.identity();
    else rod.root.quaternion.copy(q.setFromUnitVectors(Y, new Vector3(...ROD_AXIS_R).normalize()));
    rod.root.position.set(GRIP_OFFSET[0], GRIP_OFFSET[1], GRIP_OFFSET[2]);
    rodQ0.copy(rod.root.quaternion);
    // the held item goes to the shop: the rod hangs from the proxy of the shrunk hand slot
    if (hasItem && !stow) {
      stow = stowHandItem(handR);
      stowed.set(sid, true);
    }
    const host = stow ? stow.proxy : handR;
    host.add(rod.root);
    rodHost = host;
    unregisterTip = registerRodTip(sid, rod.tip);
  };
  const detachRod = (): void => {
    if (!rod) return;
    unregisterTip?.();
    unregisterTip = null;
    rodHost?.remove(rod.root);
    restoreWrist(root);
    wristAmt = 0;
    rod.dispose();
    rod = null;
    unfold = 0;
    // the item comes back from the shop
    stow?.restore();
    stow = null;
    stowed.delete(sid);
  };
  const hideFish = (): void => catchRig.hide();

  /**
   * The lift (owner 2026-11-23: "물밖에 고기가 나왔을 때 줄하고 고기가 캐릭터의 정면쪽으로 와야지"): the Fish_Sit_Lift clip swings the tip up
   * over the right shoulder, so the fish left the water, went far out to the angler's right and came back. The rod is turned (grip ->
   * its real tip, the bent rod's tip being off its straight axis) so the tip is raised over the spot's facing line in front of the
   * angler: the fish comes straight up and in, in front of the body. On every screen (the spot's facing and the avatar's own pose
   * only), `aimAmt` of the way.
   */
  const applyAim = (): void => {
    if (!rod || aimAmt <= 1e-3 || !aimOn) return;
    const parent = rod.root.parent;
    // the chair's facing; in my own first person where the eye looks (the view can be turned off the chair's facing while seated)
    const fw0 = aimV.rt.set(0, 0, -1);
    if (aimCamera) fw0.applyQuaternion(aimCamera.quaternion);
    fw0.y = 0;
    const f = aimFp && aimCamera && fw0.lengthSq() > 1e-6 ? fw0.normalize() : faceOf(aimSpot);
    if (!parent || !f) return;
    rod.root.updateWorldMatrix(true, true);
    const pq = parent.getWorldQuaternion(aimV.pq);
    const grip = aimV.axis.setFromMatrixPosition(rod.root.matrixWorld);
    const tipNow = rod.tip.getWorldPosition(aimV.cur);
    const reach = tipNow.distanceTo(grip);
    if (reach < 1e-3) return;
    const cur = tipNow.sub(grip).normalize();
    // the aim point: over the facing line through the body (not the right hand), up at 35 degrees from the grip
    const body = root.getWorldPosition(aimV.fw);
    const el = aimEl;
    const ahead = reach * Math.cos(el);
    // where along the line, measured from the body, the grip already is
    const gripAhead = (grip.x - body.x) * f.x + (grip.z - body.z) * f.z;
    const d = aimV.d.set(body.x + f.x * (gripAhead + ahead) - grip.x, reach * Math.sin(el), body.z + f.z * (gripAhead + ahead) - grip.z).normalize();
    // (third person, everyone's screen) the rod comes up until the tip is over the free (left) hand by the line's length: the fish on
    // the full line swings in and comes to rest right at the hand, which closes on it
    const line = catchRig.lineLength();
    if (!aimFp && aimLate > 0 && line > 0.5 && handL) {
      const hand = handL.getWorldPosition(aimV.hand);
      const late = aimV.late.set(hand.x - grip.x, hand.y + line - grip.y, hand.z - grip.z).normalize();
      d.lerp(late, aimLate).normalize();
    }
    d.lerp(cur, 1 - aimAmt).normalize();
    // world = pq * local: turned by D in the world, the local is pq^-1 * D * pq * local
    const D = aimV.dq.setFromUnitVectors(cur, d);
    rod.root.quaternion.premultiply(D.premultiply(pq.clone().invert()).multiply(pq));
  };

  const play = (name: FishingClip | null, speed = 1): void => {
    if (name === current && (name === null || actions.get(name)?.isRunning())) return;
    if (current) actions.get(current)?.fadeOut(FADE);
    current = name;
    if (!name) return;
    const a = actions.get(name);
    if (!a) return;
    a.reset();
    a.timeScale = speed;
    a.fadeIn(FADE).play();
  };

  return {
    stripArm,
    needsTick() {
      return current !== null || Math.abs(baseBlend - 1) > 1e-3 || (unfold > 1e-3 && unfold < 1);
    },
    liftFactor() {
      return lift;
    },
    afterMixer(delta) {
      if (!rod) return;
      wristAmt += ((wristWant ? ((globalThis as { __cvWristRelax?: number }).__cvWristRelax ?? WRIST_RELAX) : 0) - wristAmt) * Math.min(1, delta * 10);
      if (wristAmt < 1e-3) {
        if (wristAmt > 0) restoreWrist(root);
        wristAmt = 0;
        rod.root.quaternion.copy(rodQ0);
      } else {
        const fix = relaxWrist(root, wristAmt, handR);
        if (fix) rod.root.quaternion.copy(rodQ0).premultiply(fix);
      }
      // the lift: up in front of the angler (owner 2026-11-23: in 1st person the fish must come up out of
      // the water and hang in front of the angler; the lift clip swings the tip up over the right shoulder, out of the view). Only
      // this screen's own view: everyone else sees the clip.
      aimAmt += (aimWant - aimAmt) * Math.min(1, delta * 2.5);
      applyAim();
    },
    update(delta, ctx) {
      if (!readFishView(sid, view) || view.rod === 0) {
        wristWant = false;
        if (rod || current) {
          play(null);
          detachRod();
          hideFish();
        }
        if (baseTouched && ctx.baseSit) {
          ctx.baseSit.weight = 1;
          baseTouched = false;
          baseBlend = 1;
        }
        lift += (1 - lift) * Math.min(1, delta * 8);
        return;
      }
      if (!lakeGearReady()) void loadLakeGear();
      else if (rod && !rod.real) {
        detachRod(); // the stand-in made before lake_gear.glb came in: the real rod replaces it
      }
      attachRod();
      const clipsReady = ensureActions();
      const seated = ctx.seatMode === "seated";
      const atSpot = view.spot >= 0 && (seated || ctx.seatMode === "sitting");
      const t = elapsedSince(view.at) / 1000;
      const phaseChanged = view.phase !== lastPhase || view.seq !== lastSeq;
      lastPhase = view.phase;
      lastSeq = view.seq;

      // which clip
      let want: FishingClip | null = null;
      if (clipsReady) {
        if (atSpot && seated) want = clipForPhase(view.phase, t);
        else if (!atSpot && ctx.seatMode === "up") want = "Carry_Rod";
      }
      // (a one-shot that has played out holds its last pose: replaying it made the lift clip snap the rod back up every second,
      // owner 2026-11-22 "너무 정신없이"; a phase change replays it below)
      if (want !== current || (want && FISHING_CLIPS[want].loop && !actions.get(want)?.isRunning())) {
        // a one-shot (the cast, the strike) is sped to the phase it plays in
        const clip = want ? FISHING_CLIPS[want] : null;
        const phaseLen = view.phase === FISH_PHASE.casting ? 0.8 : view.phase === FISH_PHASE.hooked ? 0.4 : 0;
        const speed = clip && phaseLen > 0 ? clip.seconds / phaseLen : 1;
        play(want, speed);
      } else if (phaseChanged && want && !FISHING_CLIPS[want].loop) {
        actions.get(want)?.reset().play();
      }

      // the held sit steps aside while a body clip owns the body
      const bodyClip = current !== null && current !== "Carry_Rod";
      baseBlend += ((bodyClip ? 0 : 1) - baseBlend) * Math.min(1, delta / FADE);
      if (ctx.baseSit && (bodyClip || baseTouched)) {
        ctx.baseSit.weight = baseBlend;
        baseTouched = Math.abs(baseBlend - 1) > 1e-3 || bodyClip;
        if (!baseTouched) ctx.baseSit.weight = 1;
      }
      // the chair's lift goes while a clip stands the avatar up
      const standing = current !== null && STANDS.has(current);
      lift += ((standing ? 0 : 1) - lift) * Math.min(1, delta * 7);

      // the rod: open when seated, bent by the bite
      if (rod) {
        // open while seated and fishing; folded again for the two-handed show of the catch and the release (both hands are the fish's)
        const openTarget = atSpot && !standing ? 1 : atSpot ? 0.25 : 0;
        unfold += Math.max(-delta / UNFOLD_S, Math.min(delta / UNFOLD_S, openTarget - unfold));
        rod.setUnfold(unfold);
        // eased while a fish is on (hooked .. releasing); the nibble's quick tugs stay crisp
        const bendTo = atSpot ? rodBend(view, t) : 0;
        bendS = view.phase >= FISH_PHASE.hooked && view.phase <= FISH_PHASE.releasing ? bendS + (bendTo - bendS) * Math.min(1, delta * 8) : bendTo;
        rod.setBend(bendS);
      }
      wristWant = atSpot && seated; // applied by afterMixer(), once the mixer has posed the bones this frame
      // the fish (lake v2, catchRig.ts): under the water, out on the line, into the hand, taken in the arms, let go
      handR = handR ?? bone(root, "handslot.r");
      handL = handL ?? bone(root, "handslot.l");
      // only while a fish is on (hooked .. releasing): an angler waiting, walking or anyone without a catch costs nothing here
      const fpCam = ctx.fpCamera ?? null;
      const catching = atSpot && view.phase >= FISH_PHASE.hooked && view.phase <= FISH_PHASE.releasing;
      if (catching || catchShown) {
        // (the lift: the rod raised again on the bones the mixer has just posed, so the fish hangs from where the tip is drawn)
        if (rod) applyAim();
        let world: Object3D | null = root;
        while (world.parent) world = world.parent;
        catchRig.update({ view, t, delta, atSpot, handL, handR, rodTip: rod?.tip ?? null, body: root, world: world === root ? null : world, fpCamera: fpCam, fpLook: ctx.fpLook ?? null });
        catchShown = catching;
      }
      // the lift (every screen): the rod is raised in front of the angler while the fish is brought up (afterMixer), so the fish comes
      // straight in over the facing line and hangs in front of the body (and in sight in first person)
      aimOn = !!rod && atSpot && seated;
      aimSpot = view.spot;
      aimWant = aimOn && view.phase === FISH_PHASE.lifting ? 1 : 0;
      // the lift: the rod comes up high, just past upright, so the fish swings in on the full line to the angler's hand
      {
        const k = view.phase === FISH_PHASE.lifting ? Math.max(0, Math.min(1, (t - REEL_S) / 1.0)) : 0;
        // (my own first-person view: raised less, ~60 degrees, so the fish swinging in stays out in front of the eye, in sight, until the
        // hand reaches for it; the swing in under an upright rod comes in under the chin, out of the view)
        const kk = k * k * (3 - 2 * k);
        aimFp = !!fpCam;
        aimCamera = fpCam;
        // third person: from 35 degrees toward over the hand (applyAim); first person: up to 60 degrees in front of the eye
        aimEl = aimFp ? 0.62 + (1.05 - 0.62) * kk : 0.62;
        aimLate = aimFp ? 0 : kk;
      }
      if (!aimOn) aimAmt = 0;
    },
    dispose() {
      play(null);
      detachRod();
      catchRig.dispose();
      carries.delete(sid);
      for (const a of actions.values()) a.stop();
      actions.clear();
    },
  };
}
