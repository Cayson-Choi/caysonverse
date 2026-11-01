/**
 * Engine state → synced schema (AI 학교 탈출, Task 10). EscapeRoom calls `projectToSchema` after
 * every engine run, so every teammate's screen follows the server's one puzzle state.
 *
 * Writes only what changed, and never by index (the mid-patch-window rule, see
 * ClassRoom.writeMembers): flags are appended (the engine never removes one), the bag is rewritten
 * as a whole (clear + push) when it differs, and each map gets a set for a changed key and a
 * delete for a removed one. The engine's server-only bookkeeping (press times, the hold, hint
 * tiers, submit times, first tries, the cooldown deadline) is not copied: it is not public.
 */

import type { MapSchema } from "@colyseus/schema";
import type { EscapeState } from "@caysonverse/shared/schema";
import type { EngineState } from "./engine";

const UINT8_MAX = 255;
const UINT16_MAX = 65_535;

/** `dst` gets `src`'s entries: a set for every key whose value differs, a delete for every key `src` lacks. */
function syncMap(dst: MapSchema<string>, src: ReadonlyMap<string, string>): void {
  for (const [key, value] of src) if (dst.get(key) !== value) dst.set(key, value);
  // Every key of `src` is in `dst` now, so `dst` holds a stale key exactly when it is bigger.
  if (dst.size > src.size) for (const key of [...dst.keys()]) if (!src.has(key)) dst.delete(key);
}

function sameList(a: ArrayLike<string>, b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function projectToSchema(es: EngineState, st: EscapeState): void {
  for (const flag of es.flags) if (!st.flags.includes(flag)) st.flags.push(flag);

  if (!sameList(st.bag, es.bag)) {
    st.bag.clear();
    if (es.bag.length > 0) st.bag.push(...es.bag);
  }

  syncMap(st.lockInput, es.lockInput);
  syncMap(st.board, es.board);
  syncMap(st.votes, es.votes);

  const finaleStep = Math.min(es.finaleStep, UINT8_MAX);
  if (st.finaleStep !== finaleStep) st.finaleStep = finaleStep;
  const hintsUsed = Math.min(es.hintsUsed, UINT8_MAX);
  if (st.hintsUsed !== hintsUsed) st.hintsUsed = hintsUsed;
  const wrongAttempts = Math.min(es.wrongAttempts, UINT16_MAX);
  if (st.wrongAttempts !== wrongAttempts) st.wrongAttempts = wrongAttempts;
}
