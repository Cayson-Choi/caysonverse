/**
 * 별자리 찾기 — the state the HUD card renders from (zustand): changed only on discrete events (opened, a new target, found,
 * the hint, day / night), never per frame. The per-frame parts (the reticle's ring, the edge arrow, the names on the sky)
 * are written straight into their elements by finderRuntime.ts.
 */

import { create } from "zustand";
import { figureById } from "@caysonverse/shared/village/constellations";
import { loadStarProgress, saveStarProgress, type StarProgress } from "./starProgress";

export type FinderPhase = "day" | "night";
export type FinderView = "find" | "album";

/** The target's real shape as it stands in the sky now (the card's little picture), in a -1..1 box, y up. */
export interface TargetShape {
  points: { x: number; y: number; r: number }[];
  lines: [number, number][];
  /** The aim point's place in the box. */
  aim: { x: number; y: number };
}

export interface StarFinderState {
  /** The card is up. */
  open: boolean;
  view: FinderView;
  /** "day" while the sun is higher than -6° (not even the bright stars show). */
  phase: FinderPhase;
  /** When the bright stars come out ("오늘 오후 5시 51분쯤"), for the day card. */
  duskText: string;
  /** The star file is in (the finder needs it at night). */
  catalogReady: boolean;
  /** The view is first person (the reticle works); false in third person and on the map. */
  firstPerson: boolean;
  /** The figures that are up now, best first. */
  ranking: string[];
  targetId: string | null;
  targetShape: TargetShape | null;
  /** "북동쪽 하늘, 중간쯤 (고도 54°)" */
  targetWhere: string;
  /** 20 s without finding: the target's faint lines show. */
  ghost: boolean;
  /** The figure just found: the card shows its story until "다음 별자리". */
  foundNow: string | null;
  /** What the reticle passes over: "목성 — 별이 아니라 행성이에요" / "시리우스 (천랑성)". */
  aimInfo: string | null;
  progress: StarProgress;
  /** A short line on the card (the view switch, the dawn). */
  notice: string | null;
  /** For screen readers (aria-live). */
  announce: string;
}

export const useStarFinder = create<StarFinderState>(() => ({
  open: false,
  view: "find",
  phase: "day",
  duskText: "",
  catalogReady: false,
  firstPerson: false,
  ranking: [],
  targetId: null,
  targetShape: null,
  targetWhere: "",
  ghost: false,
  foundNow: null,
  aimInfo: null,
  progress: loadStarProgress(),
  notice: null,
  announce: "",
}));

/** Set only the fields that changed (no render when nothing did). */
export function patchFinder(patch: Partial<StarFinderState>): void {
  const cur = useStarFinder.getState() as unknown as Record<string, unknown>;
  const changed: Partial<StarFinderState> = {};
  let any = false;
  for (const [k, v] of Object.entries(patch)) {
    if (cur[k] !== v) {
      (changed as Record<string, unknown>)[k] = v;
      any = true;
    }
  }
  if (any) useStarFinder.setState(changed);
}

/** Open the card (the 🔭 button). The runtime picks the phase and the target on its next frame. */
export function openFinder(): void {
  useStarFinder.setState({ open: true, view: "find", foundNow: null, notice: null, aimInfo: null, ghost: false, targetId: null, targetShape: null });
}

export function closeFinder(): void {
  useStarFinder.setState({ open: false, foundNow: null, notice: null, aimInfo: null, ghost: false, targetId: null, targetShape: null });
}

export function setFinderView(view: FinderView): void {
  patchFinder({ view });
}

/** "찾은 별자리 보기": keep the found figures drawn (remembered on this device). */
export function setShowFound(on: boolean): void {
  const progress = { ...useStarFinder.getState().progress, showFound: on };
  saveStarProgress(progress);
  useStarFinder.setState({ progress });
}

/** Store and publish new progress (a figure found). */
export function setProgress(progress: StarProgress): void {
  saveStarProgress(progress);
  useStarFinder.setState({ progress });
}

/** The Korean object particle for a name: "카시오페이아자리를", "북두칠성을". */
export function withObjectParticle(name: string): string {
  const last = name.charCodeAt(name.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${name}을(를)`;
  return (last - 0xac00) % 28 === 0 ? `${name}를` : `${name}을`;
}

/** The display name of a figure id ("" for none). */
export function figureName(id: string | null): string {
  return (id && figureById(id)?.name) || "";
}
