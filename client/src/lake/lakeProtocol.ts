// The fishing lake (A10, chunk E): what the client knows of the server's fishing rules. Names are design 9.3 / 9.4 exactly:
// messages FishingRentRod / FishingReturnRod / FishingSit {spot} / FishingCast / FishingStrike / FishingHold {down} /
// FishingStand / FishingBoardRequest, the personal FishingState / FishingRejected / FishingBoard, the room's FishingTrophy,
// and the Player schema fields rod, fishSpot, fishPhase, fishSeq, fishSig, fishKind, fishCm, fishAt.
//
// The numbers behind those fields are NOT stated here: they come from the server's own rules (shared/village/fishing.ts:
// FISHING_PHASES, FISH_SIGNALS, FISH_KINDS / FISH_TABLE), the single source of truth (F, 2026-11-16).

import {
  FISHING_PHASES,
  FISH_KINDS,
  FISH_SIGNALS,
  FISH_TABLE,
  fishKindFromId,
  fishKindId,
  needsNet as sharedNeedsNet,
  trophyTier,
  type FishKind,
  type FishingPhase,
  type FishSignal,
} from "@caysonverse/shared/village/fishing";
import { VillageMsg, VillageServerMsg } from "@caysonverse/shared/village/messages";

export const LakeMsg = {
  RentRod: VillageMsg.FishingRentRod,
  ReturnRod: VillageMsg.FishingReturnRod,
  Sit: VillageMsg.FishingSit,
  Cast: VillageMsg.FishingCast,
  Strike: VillageMsg.FishingStrike,
  Hold: VillageMsg.FishingHold,
  Stand: VillageMsg.FishingStand,
  BoardRequest: VillageMsg.FishingBoardRequest,
} as const;

export const LakeServerMsg = {
  State: VillageServerMsg.FishingState,
  Rejected: VillageServerMsg.FishingRejected,
  Trophy: VillageServerMsg.FishingTrophy,
  Board: VillageServerMsg.FishingBoard,
} as const;

/** `Player.fishPhase` numbers: the index in the server's FISHING_PHASES. */
export const FISH_PHASE = Object.freeze(Object.fromEntries(FISHING_PHASES.map((p, i) => [p, i]))) as Readonly<Record<FishingPhase, number>>;
export type FishPhaseName = FishingPhase;
export function phaseName(n: number): FishPhaseName {
  return FISHING_PHASES[n] ?? "none";
}

/** `Player.fishSig`: how the bite shows on the float (rise = 찌올림, sink = 쏙 잠김, drag = 끌고 잠김); the index in FISH_SIGNALS. */
export const FISH_SIG = Object.freeze(Object.fromEntries(FISH_SIGNALS.map((p, i) => [p, i]))) as Readonly<Record<FishSignal, number>>;
export type FishSigName = FishSignal;
export function sigName(n: number): FishSigName {
  return FISH_SIGNALS[n] ?? "none";
}

export interface FishSpecies {
  /** The server's kind name (= lake_fish.glb's `fish_<id>` node). */
  id: FishKind;
  /** `Player.fishKind` (1..11; 0 = none). */
  kind: number;
  label: string;
  /** Length in cm from which the fish is "big" (held and netted): the server's table. */
  netFromCm: number;
  /** The invasive ones go to the bin (the server's `disposal`). */
  invasive: boolean;
  /** The colour of the card's little picture. */
  color: string;
}

/** Colours of the card pictures, by kind (presentation only). */
const CARD_COLOR: Record<FishKind, string> = {
  crucian_carp: "#b9a46a",
  bluegill: "#6f8f9e",
  minnow: "#c9d3d8",
  prussian_carp: "#c7b57c",
  bass: "#6c7a4a",
  carp: "#b9803f",
  korean_bullhead: "#a8924f",
  catfish: "#5d5a4a",
  mirror_carp: "#a8844d",
  snakehead: "#4f5640",
  eel: "#4b4b44",
};

/** Every species, in `Player.fishKind` order (FISH_SPECIES[i].kind = i + 1). */
export const FISH_SPECIES: readonly FishSpecies[] = FISH_TABLE.map((t) => ({
  id: t.kind,
  kind: fishKindId(t.kind),
  label: t.label,
  netFromCm: t.netFromCm,
  invasive: t.disposal === "bin",
  color: CARD_COLOR[t.kind],
}));

/** The species of a `Player.fishKind` number, or null (0 / out of range). */
export function species(kind: number): FishSpecies | null {
  return kind >= 1 ? (FISH_SPECIES[kind - 1] ?? null) : null;
}

/** A big fish (held down and netted): the server's own rule. */
export function needsNet(kind: number, cm: number): boolean {
  const k = fishKindFromId(kind);
  return k !== null && sharedNeedsNet(k, cm);
}

/** The card's badge: 4짜 / 월척 for a crucian (the server's integer 31 cm line), 대물 for any announced catch. */
export function catchBadge(kind: number, cm: number): string {
  const k = fishKindFromId(kind);
  if (!k) return "";
  if (k === "crucian_carp" && cm >= 40) return "4짜!";
  if (k === "crucian_carp" && cm >= 31) return "월척!";
  return trophyTier(k, cm) !== "none" ? "대물!" : "";
}

/** Everything about one angler that the schema carries (design 9.4). */
export interface FishView {
  rod: number;
  spot: number;
  phase: number;
  seq: number;
  sig: number;
  kind: number;
  cm: number;
  /** Room-clock ms at which the phase began. */
  at: number;
  /** Lake v2, the fight: bit 7 the angler holds (reels in), bits 0..6 how far the fish is brought in (0..100). */
  reel: number;
}

export function emptyFishView(): FishView {
  return { rod: 0, spot: -1, phase: 0, seq: 0, sig: 0, kind: 0, cm: 0, at: 0, reel: 0 };
}

/** The personal FishingState (9.3). Fields are optional: the client reads what is there. */
export interface PersonalFishingState {
  phase?: number;
  /** Seconds left in the phase (for the UI only). */
  left?: number;
  /** Hold progress 0..1 while fighting. */
  progress?: number;
  result?: string;
  catch?: { kind: number; cm: number; first?: boolean };
}

/**
 * The personal FishingState (shared messages.ts `FishingStatePayload`): the phase NAME, the hold progress in ms and the fish by
 * kind name. Read tolerantly; the HUD gets numbers (phase id, progress 0..1, fishKind id).
 */
export function parsePersonalState(raw: unknown): PersonalFishingState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const out: PersonalFishingState = {};
  if (typeof r.phase === "string" && (FISHING_PHASES as readonly string[]).includes(r.phase)) out.phase = FISH_PHASE[r.phase as FishingPhase];
  const closes = num(r.windowClosesInMs);
  if (closes !== undefined) out.left = closes / 1000;
  const hold = num(r.holdMs);
  const need = num(r.holdNeedMs);
  if (hold !== undefined && need !== undefined && need > 0) out.progress = Math.max(0, Math.min(1, hold / need));
  if (typeof r.lastResult === "string") out.result = r.lastResult;
  const c = r.catch;
  if (c && typeof c === "object") {
    const cc = c as Record<string, unknown>;
    const kind = typeof cc.kind === "string" && (FISH_KINDS as readonly string[]).includes(cc.kind) ? fishKindId(cc.kind as FishKind) : undefined;
    const cm = num(cc.cm);
    if (kind !== undefined && cm !== undefined) out.catch = { kind, cm };
  }
  return out;
}

export interface TrophyPayload {
  name: string;
  /** `Player.fishKind` number. */
  kind: number;
  cm: number;
  /** "lake": told to the people at the lake, "village": the whole village (very rare). */
  scope?: string;
}
/** The room's FishingTrophy (shared `FishingTrophyPayload`: by, kind name, cm, tier). */
export function parseTrophy(raw: unknown): TrophyPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.by !== "string" || typeof r.kind !== "string" || typeof r.cm !== "number") return null;
  if (!(FISH_KINDS as readonly string[]).includes(r.kind)) return null;
  return { name: r.by, kind: fishKindId(r.kind as FishKind), cm: r.cm, scope: typeof r.tier === "string" ? r.tier : undefined };
}

/** One line of the "오늘의 대어" board (shared `FishingBoardEntry`). */
export interface BoardLine {
  kind: number;
  label: string;
  cm: number;
  by: string;
}
/** The room's FishingBoard (shared `FishingBoardPayload`): the best of each species today, read tolerantly. */
export function parseBoard(raw: unknown): BoardLine[] | null {
  if (!raw || typeof raw !== "object") return null;
  const entries = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return null;
  const out: BoardLine[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r.kind !== "string" || !(FISH_KINDS as readonly string[]).includes(r.kind) || typeof r.cm !== "number" || typeof r.by !== "string") continue;
    out.push({ kind: fishKindId(r.kind as FishKind), label: typeof r.label === "string" ? r.label : "", cm: r.cm, by: r.by });
  }
  return out;
}

/** Korean words for a refused action (`FishingRejected {reason}`: shared `FishingReject`), never a code. */
export function rejectText(reason: unknown): string {
  switch (reason) {
    case "not_near_rental":
      return "관리소 앞 노란 원으로 가까이 와요.";
    case "not_near_return":
      return "낚싯대는 관리소 앞에서 돌려줘요.";
    case "already_has_rod":
      return "이미 낚싯대를 빌렸어요.";
    case "no_rod":
      return "먼저 관리소에서 낚싯대를 빌려요.";
    case "stand_first":
      return "먼저 일어나요.";
    case "not_seated":
      return "낚시 의자에 앉아서 해요.";
    case "bad_spot":
    case "too_far":
      return "그 의자에 더 가까이 가요.";
    case "spot_taken":
      return "그 자리는 다른 분이 앉아 있어요. 다른 빈 의자를 골라요.";
    case "too_soon":
      return "잠깐만요, 조금 있다가 다시 해요.";
    case "already_cast":
      return "이미 찌를 던졌어요. 찌를 봐요.";
    case "too_early":
    case "no_bite":
      return "아직이에요! 찌가 크게 움직일 때까지 기다려요.";
    case "bite_expired":
      return "조금 늦었어요. 다시 던져요.";
    case "not_fighting":
      // the held button's last repeats after the fight ended (the fish is in the net): nothing went wrong
      return "";
    default:
      return "지금은 할 수 없어요.";
  }
}
