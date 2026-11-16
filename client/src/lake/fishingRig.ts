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

import { AnimationMixer, LoopOnce, LoopRepeat, Quaternion, Vector3, type AnimationAction, type AnimationClip, type Object3D } from "three";
import { FISHING_CLIPS, GRIP_OFFSET, NET_AXIS_L, ROD_AXIS_R, type FishingClip } from "@caysonverse/shared/village/fishingAnims";
import type { BuiltAvatar } from "../game/characterAvatar";
import { fishingAnimsNow, loadFishingAnims, withoutRightArm } from "./fishAnims";
import { elapsedSince, readFishView } from "./lakeNet";
import { FISH_PHASE, emptyFishView, needsNet, species, type FishView } from "./lakeProtocol";
import { createFishModel, createNet, createRod, type FishModel, type Net, type Rod } from "./lakeProps";
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

function bone(root: Object3D, name: string): Object3D | null {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/[.[\]:/]/g, "")) ?? null;
}

/** The clip a phase wants while seated at the chair (null: leave the body to the held sit). */
export function clipForPhase(phase: number): FishingClip | null {
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
    case FISH_PHASE.netting:
      return 0.4;
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
  let fish: FishModel | null = null;
  let rodHost: Object3D | null = null;
  let netHost: Object3D | null = null;
  let unregisterTip: (() => void) | null = null;
  const actions = new Map<FishingClip, AnimationAction>();
  let current: FishingClip | null = null;
  let loading = false;
  let unfold = 0;
  let lift = 1;
  let baseBlend = 1;
  let baseTouched = false;
  let lastPhase = -1;
  let lastSeq = -1;
  const hands = { l: new Vector3(), r: new Vector3(), tmp: new Vector3() };
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
    q.setFromUnitVectors(Y, new Vector3(...ROD_AXIS_R).normalize());
    rod.root.quaternion.copy(q);
    rod.root.position.set(GRIP_OFFSET[0], GRIP_OFFSET[1], GRIP_OFFSET[2]);
    // the bone's own scale (the rig is 1:1 in metres, but a parent scale would shrink the rod: undone here)
    handR.add(rod.root);
    rodHost = handR;
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
  };
  const attachNet = (): void => {
    if (net) return;
    handL = handL ?? bone(root, "handslot.l");
    if (!handL) return;
    net = createNet();
    q.setFromUnitVectors(Y, new Vector3(...NET_AXIS_L).normalize());
    net.root.quaternion.copy(q);
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
  const hideFish = (): void => {
    if (fish) fish.root.visible = false;
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
        if (atSpot && seated) want = clipForPhase(view.phase);
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
      // the fish: in the left hand when lifted, between the hands when shown and released
      const showFish = atSpot && (view.phase === FISH_PHASE.lifting && t > 0.5 || view.phase === FISH_PHASE.landed || view.phase === FISH_PHASE.releasing || view.phase === FISH_PHASE.netting && t > 0.7);
      if (showFish) {
        handR = handR ?? bone(root, "handslot.r");
        handL = handL ?? bone(root, "handslot.l");
        const host = root.parent;
        if (handR && handL && host) {
          if (!fish) {
            fish = createFishModel();
            host.add(fish.root);
          } else if (fish.root.parent !== host) {
            host.add(fish.root);
          }
          const sp = species(view.kind);
          fish.setCm(view.cm);
          if (sp) fish.setColor(sp.color);
          handL.getWorldPosition(hands.l);
          handR.getWorldPosition(hands.r);
          if (view.phase === FISH_PHASE.lifting || view.phase === FISH_PHASE.netting) hands.tmp.copy(hands.l).add(new Vector3(0, -0.05, 0));
          else hands.tmp.copy(hands.l).add(hands.r).multiplyScalar(0.5).add(new Vector3(0, 0.07, 0));
          host.worldToLocal(hands.tmp);
          fish.root.position.copy(hands.tmp);
          // lie along the line between the hands (landed / released), else hang
          const dir = hands.r.clone().sub(hands.l);
          if (dir.lengthSq() > 1e-4 && view.phase !== FISH_PHASE.lifting && view.phase !== FISH_PHASE.netting) {
            fish.root.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), host.worldToLocal(dir.add(hands.l)).sub(host.worldToLocal(hands.l.clone())).normalize());
          } else {
            fish.root.rotation.set(0, 0, Math.PI / 2.3 + Math.sin(t * 9) * 0.25);
          }
          fish.root.visible = true;
        }
      } else hideFish();
    },
    dispose() {
      play(null);
      detachRod();
      detachNet();
      if (fish) {
        fish.root.removeFromParent();
        fish.dispose();
        fish = null;
      }
      for (const a of actions.values()) a.stop();
      actions.clear();
    },
  };
}
