/**
 * The escape, as time (AI 학교 탈출, Task 20) — spec §6: the door glows, the door opens, the room
 * brightens, Ari speaks. Pure numbers, no React, no three.js, no DOM: the scene's door and light parts
 * read `escapeTimeline(t)` once per frame into objects that already exist, the story and the summary
 * card read it a few times a second.
 *
 *    0 ..1200 ms  the door glows            (doorGlow  0 → 1)
 * 1200 ..2700 ms  the door swings open      (doorOpen  0 → 1)
 * 2700 ..4200 ms  the room brightens        (lights 0.72 → 1: the colours come back)
 * 4200 ms ..      Ari wakes up and speaks   (showLines); when the story box is empty, the summary card
 *
 * `t` is the time since the escape event. Linear on purpose (a test pins the middle values); the parts
 * that want a softer start or end ease it themselves (`easeInOut`).
 */

import type { EscapePhase } from "@caysonverse/shared/escape/constants";
import type { StoryLine } from "@caysonverse/shared/escape/messages";
import type { DialogueLine } from "./dialogue";

export const ESCAPE_FX = { doorGlowMs: 1200, doorOpenMs: 1500, lightsMs: 1500 } as const;

/** The room before it is set right: 72 % of its colour and light. */
export const LIGHTS_FROM = 0.72;
const OPEN_AT_MS = ESCAPE_FX.doorGlowMs;
const LIGHTS_AT_MS = OPEN_AT_MS + ESCAPE_FX.doorOpenMs;
/** When the lights are full and Ari starts to speak. */
export const ESCAPE_LINES_AT_MS = LIGHTS_AT_MS + ESCAPE_FX.lightsMs;
/** A time past every part of the show (a late joiner and reduced motion start the clock here). */
export const ESCAPE_DONE_MS = 60_000;

export interface EscapeFrame {
  /** 0 → 1 while the door glows, then 1. */
  doorGlow: number;
  /** 0 → 1 while the door swings, then 1 (the angle itself comes from the room's binding). */
  doorOpen: number;
  /** 0.72 → 1: how much of its light and colour the room has back. */
  lights: number;
  /** Ari may speak now. */
  showLines: boolean;
  /** The summary card may open: the story has started AND the story box has been emptied (`linesDone`). */
  showSummary: boolean;
}

/** `(t - from) / len`, clamped to 0..1; a broken time reads as the start. */
function progress(t: number, from: number, len: number): number {
  if (!(t > from)) return 0; // also catches NaN
  const p = (t - from) / len;
  return p >= 1 ? 1 : p;
}

/**
 * The state of the show at `t` ms. A per-frame caller passes its own `out` (made once) so nothing is allocated
 * per frame; everyone else just reads the returned object.
 */
export function escapeTimeline(t: number, linesDone = false, out?: EscapeFrame): EscapeFrame {
  const showLines = t >= ESCAPE_LINES_AT_MS;
  const lightsP = progress(t, LIGHTS_AT_MS, ESCAPE_FX.lightsMs);
  const frame = out ?? { doorGlow: 0, doorOpen: 0, lights: LIGHTS_FROM, showLines: false, showSummary: false };
  frame.doorGlow = progress(t, 0, ESCAPE_FX.doorGlowMs);
  frame.doorOpen = progress(t, OPEN_AT_MS, ESCAPE_FX.doorOpenMs);
  frame.lights = lightsP >= 1 ? 1 : LIGHTS_FROM + (1 - LIGHTS_FROM) * lightsP;
  frame.showLines = showLines;
  frame.showSummary = showLines && linesDone;
  return frame;
}

/** Smoothstep: slow in, slow out; 0 and 1 outside the range. */
export function easeInOut(x: number): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/** How strong each of the scene's light effects is at `t` (all 0..1). */
export interface EscapeFxLevels {
  /** The sunlight pouring through the door: the burst at the moment the door is open, then a soft glow. */
  sun: number;
  /** The patch of light on the floor in front of the door. */
  spill: number;
  /** The twinkling sparkles: in with the door, out a few seconds later. */
  sparkle: number;
}

const SPARKLE_IN_AT_MS = ESCAPE_FX.doorGlowMs;
const SPARKLE_IN_MS = 800;
const SPARKLE_OUT_AT_MS = 6500;
const SPARKLE_OUT_MS = 2000;
const SUN_DECAY_MS = 3300;
const SUN_REST = 0.25;

/** Like `escapeTimeline`: a per-frame caller passes its own `out`. */
export function escapeFxLevels(t: number, out?: EscapeFxLevels): EscapeFxLevels {
  const glow = progress(t, 0, ESCAPE_FX.doorGlowMs);
  const open = progress(t, OPEN_AT_MS, ESCAPE_FX.doorOpenMs);
  const decay = progress(t, LIGHTS_AT_MS, SUN_DECAY_MS);
  const sun = open < 1 ? 0.3 * glow + 0.7 * open : 1 - (1 - SUN_REST) * decay;
  const sparkle = progress(t, SPARKLE_IN_AT_MS, SPARKLE_IN_MS) * (1 - progress(t, SPARKLE_OUT_AT_MS, SPARKLE_OUT_MS));
  const levels = out ?? { sun: 0, spill: 0, sparkle: 0 };
  levels.sun = sun;
  levels.spill = open;
  levels.sparkle = sparkle;
  return levels;
}

/**
 * Ari's and Bandit's words after the escape, as story-box lines. Ari wakes up on her first line and smiles
 * for the ones after it. A line with no text or an unknown speaker is dropped.
 */
export function escapeDialogue(lines: readonly StoryLine[]): DialogueLine[] {
  const out: DialogueLine[] = [];
  let ariSpoke = false;
  for (const line of lines) {
    if (typeof line !== "object" || line === null || typeof line.text !== "string" || line.text === "") continue;
    if (line.speaker === "ari") {
      out.push({ speaker: "ari", text: line.text, mood: ariSpoke ? "smile" : "wake" });
      ariSpoke = true;
    } else if (line.speaker === "bandit" || line.speaker === "narrator") {
      out.push({ speaker: line.speaker, text: line.text });
    }
  }
  return out;
}

/**
 * The show's clock, as plain module state the scene's parts read per frame without allocating:
 * `start` when the escape begins, `elapsed(now)` ms since (0 before it). `skipMs` starts it part-way
 * (reduced motion, a player who comes in after the escape).
 */
export class EscapeClock {
  private startedAt = Number.NaN;

  start(nowMs: number, skipMs = 0): void {
    this.startedAt = nowMs - skipMs;
  }

  stop(): void {
    this.startedAt = Number.NaN;
  }

  running(): boolean {
    return !Number.isNaN(this.startedAt);
  }

  elapsed(nowMs: number): number {
    if (Number.isNaN(this.startedAt)) return 0;
    const t = nowMs - this.startedAt;
    return t > 0 ? t : 0;
  }
}

/** The one clock of the classroom scene (the door, the light effect and the veil read it; the scene starts and stops it). */
export const escapeClock = new EscapeClock();

/** Whether the escape plays out ("live": the player was in the game) or only the card is shown (a late joiner). */
export type EscapeStart = "live" | "replay";

export interface FinishMemory {
  /** The scene has seen the team still playing (intro, play, finale, time up). */
  sawGame: boolean;
  /** The escape has been started once. */
  started: boolean;
}

export const FINISH_START: FinishMemory = Object.freeze({ sawGame: false, started: false });

/**
 * What the scene does about the escape, given the team's phase and whether the `escaped` event has come:
 * the first time both say "escaped" it starts — live if this scene watched the game, replay if it did not
 * (a refresh or a late join after the escape: the server sends the event again, the card is all there is
 * to show). The state patch comes before the event, so "escaped" without the event waits.
 */
export function stepFinish(
  mem: FinishMemory,
  i: { phase: EscapePhase | null; hasSummary: boolean },
): { next: FinishMemory; start: EscapeStart | null } {
  const sawGame = mem.sawGame || i.phase === "intro" || i.phase === "play" || i.phase === "finale" || i.phase === "timeup";
  if (!mem.started && i.phase === "escaped" && i.hasSummary) {
    return { next: { sawGame, started: true }, start: sawGame ? "live" : "replay" };
  }
  if (sawGame === mem.sawGame) return { next: mem, start: null };
  return { next: { sawGame, started: mem.started }, start: null };
}
