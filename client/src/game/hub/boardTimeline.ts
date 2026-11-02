import type { RoomId } from "@caysonverse/shared/escape/constants";

/**
 * The progress board's window flash (AI 학교 탈출, Task 16): when a team escapes a room, that
 * room's window on the school-model board lights up with a short sparkle — a bright glow that
 * settles to a soft one, a halo that swells and fades, and a small pop. Pure and allocation-free
 * (an optional `out`), so the board's frame loop can use it directly; once the flash is over the
 * values stop changing and the loop does nothing.
 */

/** How long the sparkle lasts. */
export const BOARD_FLASH_MS = 1400;
/** The emissive strength of a lit window once the flash is over ("약한 발광"). */
export const STEADY_LIT_GLOW = 0.55;
/** The halo's strongest opacity. */
const HALO_PEAK = 0.85;
/** The halo grows from 1x to this many times the window. */
const HALO_GROWTH = 2.4;
/** How much the pane swells at the top of the pop (1 + this). */
const POP_SIZE = 0.16;

export interface BoardFlash {
  /** Emissive intensity of the lit pane: 1 → STEADY_LIT_GLOW. */
  glow: number;
  /** Halo opacity: HALO_PEAK → 0. */
  halo: number;
  /** Halo scale: 1 → HALO_GROWTH. */
  haloScale: number;
  /** Pane scale: 1 → 1 + POP_SIZE → 1. */
  pop: number;
}

/** Each lit window's own bright colour (unlit ones are pale grey glass). The Record type makes a missing room a compile error. */
export const WINDOW_COLORS: Record<RoomId, string> = {
  counsel: "#FFC94D",
  library: "#7ED6A8",
  broadcast: "#FF8FA3",
  career: "#7FB8FF",
  art: "#C79BFF",
  science: "#5EE0D0",
  media: "#FFA86B",
};

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/** The flash `elapsedMs` after the window lit up. Before the start reads as the start. */
export function boardFlash(elapsedMs: number, out: BoardFlash = { glow: 1, halo: 0, haloScale: 1, pop: 1 }): BoardFlash {
  const t = Math.min(1, Math.max(0, elapsedMs / BOARD_FLASH_MS));
  const e = easeOut(t);
  out.glow = 1 - (1 - STEADY_LIT_GLOW) * e;
  out.halo = HALO_PEAK * (1 - e);
  out.haloScale = 1 + (HALO_GROWTH - 1) * e;
  // A quick swell (up in the first fifth of the flash, back down by the middle), then still.
  out.pop = t < 0.2 ? 1 + POP_SIZE * (t / 0.2) : t < 0.5 ? 1 + POP_SIZE * (1 - (t - 0.2) / 0.3) : 1;
  return out;
}

/** The rooms lit in `next` that were not lit in `prev`, in `next`'s order. */
export function newlyLit(prev: readonly RoomId[], next: readonly RoomId[]): RoomId[] {
  return next.filter((r) => !prev.includes(r));
}
