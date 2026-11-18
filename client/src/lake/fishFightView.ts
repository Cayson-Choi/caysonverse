// What the screen shows of a big fish's fight (owner 2026-11-19): the command ("당기세요" / "놓아주세요"), the line tension and the distance.
// The command is the PUBLIC schedule (shared fishFight.ts: the cast's seed + the fish's length, from the fight's start on the server clock),
// the tension and the distance come with the angler's schema fields (Player.fishReel: progress bits 0..6, held bit 7, tension bits 8..14).
// Pure: every state is a unit test.

import { FIGHT, fightCommand, fightSchedule, type FightKind, type FightSeg } from "@caysonverse/shared/village/fishFight";
import { fishSeed } from "@caysonverse/shared/village/fishing";
import { FISH_PHASE, type FishView } from "./lakeProtocol";

export interface FightPrompt {
  kind: FightKind;
  /** Still in the 0.5 s after the switch in which nothing counts either way. */
  inGrace: boolean;
  /** Stage number (0 = the first pull) of `stages`. */
  index: number;
  stages: number;
  /** Line tension 0..1 (snaps at 1), distance brought in 0..1 (landed at 1), the button held (the server's view). */
  tension: number;
  progress: number;
  held: boolean;
  /** ms until the next switch (null in the last stage, which has no end). */
  leftMs: number | null;
}

/** The tension from `Player.fishReel`. */
export const reelTension = (reel: number): number => Math.min(100, (reel >> 8) & 127) / 100;
/** The distance from `Player.fishReel`. */
export const reelDistance = (reel: number): number => Math.min(100, reel & 127) / 100;

let memo: { key: string; sched: FightSeg[] } | null = null;
/** The schedule of this cast's fight (memoised: the HUD asks every 80 ms). */
export function scheduleOf(view: Pick<FishView, "cm" | "spot" | "seq">): FightSeg[] {
  const key = `${view.cm}:${view.spot}:${view.seq}`;
  if (memo?.key !== key) memo = { key, sched: fightSchedule(view.cm, fishSeed(view.spot, view.seq)) };
  return memo.sched;
}

/** The prompt for a fight `sinceMs` after it began (the schema's `at` on the server clock), or null outside the fight. */
export function fightPromptOf(view: FishView, sinceMs: number): FightPrompt | null {
  if (view.phase !== FISH_PHASE.fighting || view.cm <= 0) return null;
  const sched = scheduleOf(view);
  const c = fightCommand(sched, sinceMs);
  const seg = sched[c.index]!;
  return {
    kind: c.kind,
    inGrace: c.inGrace,
    index: c.index,
    stages: sched.length,
    tension: reelTension(view.reel),
    progress: reelDistance(view.reel),
    held: (view.reel & 128) !== 0,
    leftMs: Number.isFinite(seg.endMs) ? Math.max(0, seg.endMs - sinceMs) : null,
  };
}

/** The meter's colour class: calm, tight, about to snap. */
export function tensionLevel(t: number): "calm" | "tight" | "danger" {
  return t >= 0.75 ? "danger" : t >= 0.45 ? "tight" : "calm";
}

/** The big words. */
export function fightWords(kind: FightKind): { text: string; arrow: string } {
  return kind === "pull" ? { text: "당기세요", arrow: "⬆" } : { text: "놓아주세요", arrow: "⬇" };
}

/** The small line under the prompt: how to do it (a first-timer gets the whole rule), what to expect after. */
export function fightHint(p: FightPrompt, touch: boolean, firstTime: boolean): string {
  const press = touch ? "버튼을 꾹 누르면" : "Space(마우스)를 꾹 누르면";
  if (firstTime) return `${press} 당기고, 떼면 놓아줘요. 시키는 대로 번갈아 해요!`;
  if (p.kind === "pull") return p.tension >= 0.75 ? "줄이 팽팽해요! 곧 놓아줘야 해요." : `${press.replace("누르면", "누르고")} 당겨요.`;
  return p.tension >= 0.75 ? "지금 놓아요! 줄이 끊어져요!" : "손을 떼요 — 물고기가 달려요. 줄을 풀어 줘요.";
}

export const FIGHT_GRACE_MS = FIGHT.graceMs;
