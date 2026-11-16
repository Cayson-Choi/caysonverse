// One avatar's fishing layer (design 6.2 / 6.3): the rod on the right hand (and the net on the left), the nine fishing clips on the
// avatar's own mixer, the landed fish in the hands. The same object serves my avatar and every other angler: it reads the
// schema fields of its session id (lakeNet.readFishView) and decides what to show — nothing else.
//
// Clips are layered by weight on the player's mixer:
//  - seated at a fishing chair: the Fish_Sit_* / Fish_Net / Fish_Stand_Show / Fish_Release body clips replace the held sit (the
//    player's Sit_Chair_Idle action is held at weight 0 meanwhile; their legs are Sit_Chair_Idle's first frame, so the chair fit
//    does not move);
//  - standing with a rod: Carry_Rod on the right arm. The walk, run and idle clips of a carrier have their right-arm tracks
//    removed (`stripArm`, bound by the player when `hasRod` flips) so the arm is Carry_Rod's alone.
// The rod folds to 1.15 m for walking and opens to 3.6 m over 0.6 s when the angler sits.

import { AnimationMixer, LoopOnce, LoopRepeat, Object3D, Quaternion, Vector3, type AnimationAction, type AnimationClip, type Camera } from "three";
import { FISHING_CLIPS, GRIP_OFFSET, NET_AXIS_L, ROD_AXIS_R, type FishingClip } from "@caysonverse/shared/village/fishingAnims";
import type { BuiltAvatar } from "../game/characterAvatar";
import { fishingAnimsNow, loadFishingAnims, withoutRightArm } from "./fishAnims";
import { elapsedSince, readFishView } from "./lakeNet";
import { FISH_PHASE, emptyFishView, needsNet, type FishView } from "./lakeProtocol";
import { createNet, createRod, lakeGearReady, loadLakeGear, type Net, type Rod } from "./lakeProps";
import { createCatchRig } from "./catchRig";
import { HANG_END_S, NET_SCOOP_S, REEL_S } from "./fishCatch";
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
}

export interface FishingRig {
  update(delta: number, ctx: RigContext): void;
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
  // lake v2: the reel-in before the lift, the fight at the surface before the net (fishCatch.ts)
  if (phase === FISH_PHASE.lifting && t < REEL_S) return "Fish_Sit_Fight";
  if (phase === FISH_PHASE.netting && t < NET_SCOOP_S - 0.25) return "Fish_Sit_Fight";
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
    case FISH_PHASE.netting:
      return "Fish_Net";
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
      return 0.75 + 0.2 * Math.sin(t * 5.5);
    case FISH_PHASE.lifting:
      // reeled in hard, then the fish's weight on the line as it swings, then the hand takes it
      if (t < REEL_S) return 0.72 + 0.14 * Math.sin(t * 9.5) + 0.06 * Math.sin(t * 23);
      if (t < HANG_END_S) return 0.45 + 0.12 * Math.sin(t * 7.5);
      return Math.max(0, 0.45 - (t - HANG_END_S) * 0.9);
    case FISH_PHASE.netting:
      return t < NET_SCOOP_S ? 0.8 + 0.12 * Math.sin(t * 8) : 0.35;
    default:
      return 0;
  }
}

export function createFishingRig(o: { sid: string; avatar: BuiltAvatar; mixer: AnimationMixer }): FishingRig {
  const { sid, avatar, mixer } = o;
  const view = emptyFishView();
  const root = avatar.root;
  let rod: Rod | null = null;
  let net: Net | null = null;
  const catchRig = createCatchRig(sid);
  let fpRod: Rod | null = null;
  let rodHost: Object3D | null = null;
  let netHost: Object3D | null = null;
  let unregisterTip: (() => void) | null = null;
  let stow: ReturnType<typeof stowHandItem> | null = null;
  const hasItem = avatar.parts.some((p) => p.startsWith("item__"));
  carries.set(sid, hasItem);
  const actions = new Map<FishingClip, AnimationAction>();
  let current: FishingClip | null = null;
  let loading = false;
  let unfold = 0;
  let lift = 1;
  let baseBlend = 1;
  let baseTouched = false;
  let lastPhase = -1;
  let lastSeq = -1;
  const q = new Quaternion();
  let handR: Object3D | null = null;
  let handL: Object3D | null = null;

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
    rod.dispose();
    rod = null;
    unfold = 0;
    // the item comes back from the shop
    stow?.restore();
    stow = null;
    stowed.delete(sid);
  };
  const attachNet = (): void => {
    if (net) return;
    handL = handL ?? bone(root, "handslot.l");
    if (!handL) return;
    net = createNet();
    if (net.real) net.root.quaternion.identity();
    else net.root.quaternion.copy(q.setFromUnitVectors(Y, new Vector3(...NET_AXIS_L).normalize()));
    net.root.position.set(GRIP_OFFSET[0], GRIP_OFFSET[1], GRIP_OFFSET[2]);
    handL.add(net.root);
    netHost = handL;
  };
  const detachNet = (): void => {
    if (!net) return;
    netHost?.remove(net.root);
    net.dispose();
    net = null;
  };
  const hideFish = (): void => catchRig.hide();
  const dropFpRod = (): void => {
    if (!fpRod) return;
    fpRod.root.removeFromParent();
    fpRod.dispose();
    fpRod = null;
    unregisterTip?.();
    unregisterTip = rod ? registerRodTip(sid, rod.tip) : null;
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
    update(delta, ctx) {
      if (!readFishView(sid, view) || view.rod === 0) {
        if (rod || net || current) {
          play(null);
          dropFpRod();
          detachRod();
          detachNet();
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
        dropFpRod();
        detachRod(); // the stand-in made before lake_gear.glb came in: the real rod replaces it
        detachNet();
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
      if (want !== current || (want && !actions.get(want)?.isRunning())) {
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
        rod.setBend(atSpot ? rodBend(view, t) : 0);
      }
      // the net: left hand while a big fish is fought and landed
      const wantNet = atSpot && (view.phase === FISH_PHASE.netting || (view.phase === FISH_PHASE.fighting && needsNet(view.kind, view.cm)));
      if (wantNet) attachNet();
      else detachNet();
      // the fish (lake v2, catchRig.ts): under the water, out on the line, into the hand or the net, shown, let go
      handR = handR ?? bone(root, "handslot.r");
      handL = handL ?? bone(root, "handslot.l");
      let world: Object3D | null = root;
      while (world.parent) world = world.parent;
      const fpCam = ctx.fpCamera ?? null;
      catchRig.update({ view, t, delta, atSpot, handL, handR, rodTip: fpRod?.tip ?? rod?.tip ?? null, netBag: net?.bag ?? null, world: world === root ? null : world, fpCamera: fpCam });
      // first person: the own body is hidden, so the rod is drawn by a copy that follows the hidden one (the line starts at its tip)
      if (fpCam && rod && atSpot) {
        if (!fpRod && world !== root) {
          fpRod = createRod();
          fpRod.root.matrixAutoUpdate = false;
          fpRod.root.traverse((o) => (o.frustumCulled = false));
          world.add(fpRod.root);
          unregisterTip?.();
          unregisterTip = registerRodTip(sid, fpRod.tip);
        }
        if (fpRod) {
          rod.root.updateWorldMatrix(true, false);
          fpRod.root.matrix.copy(rod.root.matrixWorld);
          fpRod.root.matrixWorldNeedsUpdate = true;
          fpRod.setUnfold(unfold);
          fpRod.setBend(rodBend(view, t));
        }
      } else if (fpRod) dropFpRod();
    },
    dispose() {
      play(null);
      dropFpRod();
      detachRod();
      detachNet();
      catchRig.dispose();
      carries.delete(sid);
      for (const a of actions.values()) a.stop();
      actions.clear();
    },
  };
}
