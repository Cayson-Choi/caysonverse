/**
 * The registry of name tags the NametagSystem manages (controls-ux Task 14), living
 * OUTSIDE React like remoteStore / bubbleRegistry. An avatar (RemotePlayer, NpcCharacter)
 * creates its Nametag, parents the sprite to its own group and registers it here; the
 * NametagSystem then owns the tag's opacity, size, stacking lift, typing "…" and
 * highlight, and publishes the height the avatar's speech bubble should sit at.
 *
 * Also holds the "show name tags" mode (WorldScene feeds it from the "이름표 보기" setting) and the DEV-only
 * probes the debug hook reads (`__cv.getNametags`, `__cv.getNametagCostMs`).
 */

import type { Object3D } from "three";
import type { Nametag } from "./nametag";
import type { NametagMode } from "./nametagSelect";

export interface LabelEntry {
  /** The id the speech bubble and typing registries know this tag's owner by (session id). */
  id: string;
  /** The avatar's group. Its world position is the base the tag hangs from (the tag sprite is its child). */
  anchor: Object3D;
  tag: Nametag;
  /** Drawn whenever on screen and in range, whatever the nearest-15 rule says (teacher, AI assistants). */
  pinned: boolean;
  /**
   * Height (m above `anchor`) of the tag's CENTRE at rest (before any stacking lift): the avatar's
   * own, from its top — nametagRestHeight(BuiltAvatar.topY) — so a hat or the AI 조교 halo never
   * pokes through the tag. The avatar creates the tag with the same rest height (createNametag).
   * Omitted: NAMETAG_HEIGHT. The NametagSystem measures size, fade, stacking and the wall check
   * from this height, and puts the speech bubble above it.
   */
  heightM?: number;
  /**
   * Height (m, above `anchor`) of the bottom edge of this owner's speech bubble. The
   * NametagSystem rewrites it every frame so the bubble sits just above the tag; the
   * avatar passes the SAME object to useSpeechBubble.
   */
  bubbleAnchor: { y: number };
}

// ── registry ──────────────────────────────────────────────────────────────────

let entries: readonly LabelEntry[] = [];

/** Register a tag. Returns the unregister function (idempotent). */
export function registerLabel(e: LabelEntry): () => void {
  entries = [...entries, e];
  return () => {
    if (!entries.includes(e)) return;
    entries = entries.filter((x) => x !== e);
  };
}

/**
 * Every registered tag. The array is replaced only when a tag registers or unregisters,
 * so a caller can compare it by identity to learn that the roster changed. Treat it as
 * read-only.
 */
export function labelEntries(): readonly LabelEntry[] {
  return entries;
}

// ── mode ──────────────────────────────────────────────────────────────────────

let mode: NametagMode = "nearby";

/** "all" / "nearby" (default) / "off" — set from the "이름표 보기" setting while the world is up. */
export function setNametagMode(m: NametagMode): void {
  mode = m;
}

export function getNametagMode(): NametagMode {
  return mode;
}

// ── DEV probes (E2E hook only; nothing here is written in production builds) ─────

/** One tag's live state, mutated in place by the NametagSystem each frame. */
export interface NametagProbe {
  selected: boolean;
  opacity: number;
  occluded: boolean;
  /** The speaking highlight border is on (as last set on the tag). */
  highlight: boolean;
  /** The typing "…" is on (as last set on the tag). */
  typing: boolean;
  /** Stacking lift applied to the tag (m above its resting height). */
  liftM: number;
  /** Height (m above the avatar's group) of the tag's top edge. */
  tagTopM: number;
  /** Height (m above the avatar's group) of the bottom edge of the avatar's speech bubble. */
  bubbleM: number;
  /** Projected height (CSS px) of the tag's text at its current size — 12–16 once visible. */
  textPx: number;
}

/** id → live state, for `__cv.getNametags`. Populated by the NametagSystem under DEV only. */
export const nametagProbe = new Map<string, NametagProbe>();

/**
 * The overview room labels (OverviewLabels.tsx) as the dev/E2E hook sees them: how many
 * sprites exist, whether the group is drawn this frame (overview blend past OV_VIS_BLEND)
 * and their current opacity. Mutated in place by the labels; read only by debug.ts.
 */
export const overviewLabelProbe = { count: 0, visible: false, opacity: 0 };

const COST_FRAMES = 120;
const costRing = new Float64Array(COST_FRAMES);
let costCount = 0;
let costNext = 0;

/** Record how long (ms) the NametagSystem's frame took. DEV only. */
export function recordNametagCost(ms: number): void {
  costRing[costNext] = ms;
  costNext = (costNext + 1) % COST_FRAMES;
  if (costCount < COST_FRAMES) costCount++;
}

/** Average cost (ms) of the NametagSystem's frame over the most recent 120 frames (0 before any). */
export function getNametagCostMs(): number {
  if (costCount === 0) return 0;
  let sum = 0;
  for (let i = 0; i < costCount; i++) sum += costRing[i];
  return sum / costCount;
}

/** Forget the recorded costs (a fresh world, tests). */
export function resetNametagCost(): void {
  costCount = 0;
  costNext = 0;
}
