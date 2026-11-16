// The fishing lake (A10, chunk E): what the client knows of the server's fishing rules. Names are design 9.3 / 9.4 exactly
// (D2 uses the same): messages FishingRentRod / FishingReturnRod / FishingSit {spot} / FishingCast / FishingStrike /
// FishingHold {down} / FishingStand, the personal FishingState / FishingRejected, the room's FishingTrophy, and the Player
// schema fields rod, fishSpot, fishPhase, fishSeq, fishSig, fishKind, fishCm, fishAt.
//
// This file is the ONE place the client states the numbers behind those fields (the phase and signal order, the species order).
// The design lists the phases but not their numbers: the order of the diagram in 9.2 is used. If D2's enum differs, F changes
// FISH_PHASE here (everything else reads the names).

export const LakeMsg = {
  RentRod: "FishingRentRod",
  ReturnRod: "FishingReturnRod",
  Sit: "FishingSit",
  Cast: "FishingCast",
  Strike: "FishingStrike",
  Hold: "FishingHold",
  Stand: "FishingStand",
} as const;

export const LakeServerMsg = {
  State: "FishingState",
  Rejected: "FishingRejected",
  Trophy: "FishingTrophy",
} as const;

/** 9.2's diagram, in order: the numbers of `Player.fishPhase`. */
export const FISH_PHASE = {
  none: 0,
  carry: 1,
  ready: 2,
  casting: 3,
  settling: 4,
  waiting: 5,
  nibble: 6,
  bite: 7,
  hooked: 8,
  lifting: 9,
  fighting: 10,
  netting: 11,
  landed: 12,
  releasing: 13,
  missed: 14,
} as const;
export type FishPhaseName = keyof typeof FISH_PHASE;
const PHASE_NAMES = Object.keys(FISH_PHASE) as FishPhaseName[];
export function phaseName(n: number): FishPhaseName {
  return PHASE_NAMES[n] ?? "none";
}

/** `Player.fishSig`: how the bite shows on the float (8: rise = 찌올림, sink = 쏙 잠김, drag = 끌고 잠김). */
export const FISH_SIG = { none: 0, rise: 1, sink: 2, drag: 3 } as const;
export type FishSigName = keyof typeof FISH_SIG;
export function sigName(n: number): FishSigName {
  return (["none", "rise", "sink", "drag"] as const)[n] ?? "none";
}

export interface FishSpecies {
  id: string;
  label: string;
  /** Length in cm from which the fish is "big" (landed with the net; the same table as design 8's "뜰채" column). */
  netFromCm: number;
  /** Design 8's release column: the invasive ones go to the bin. */
  invasive: boolean;
  /** The colour of the card's picture (placeholder until lake_fish.glb). */
  color: string;
  /** "대물" length: the whole lake is told. */
  trophyCm: number;
}

/** `Player.fishKind`: design 8's table order. */
export const FISH_SPECIES: readonly FishSpecies[] = [
  { id: "crucian", label: "붕어", netFromCm: 30, invasive: false, color: "#b9a46a", trophyCm: 30.3 },
  { id: "bluegill", label: "블루길", netFromCm: 99, invasive: true, color: "#6f8f9e", trophyCm: 99 },
  { id: "minnow", label: "피라미", netFromCm: 99, invasive: false, color: "#c9d3d8", trophyCm: 99 },
  { id: "prussian", label: "떡붕어", netFromCm: 30, invasive: false, color: "#c7b57c", trophyCm: 33 },
  { id: "bass", label: "배스", netFromCm: 40, invasive: true, color: "#6c7a4a", trophyCm: 45 },
  { id: "carp", label: "잉어", netFromCm: 0, invasive: false, color: "#b9803f", trophyCm: 70 },
  { id: "bagrid", label: "동자개", netFromCm: 99, invasive: false, color: "#a8924f", trophyCm: 99 },
  { id: "catfish", label: "메기", netFromCm: 40, invasive: false, color: "#5d5a4a", trophyCm: 55 },
  { id: "mirror", label: "향어", netFromCm: 0, invasive: false, color: "#a8844d", trophyCm: 55 },
  { id: "snakehead", label: "가물치", netFromCm: 0, invasive: false, color: "#4f5640", trophyCm: 60 },
  { id: "eel", label: "장어", netFromCm: 0, invasive: false, color: "#4b4b44", trophyCm: 60 },
];
export function species(kind: number): FishSpecies | null {
  return FISH_SPECIES[kind] ?? null;
}

/** A big fish (45 cm and over, design 8): the one that is held down and netted. */
export function needsNet(kind: number, cm: number): boolean {
  const s = species(kind);
  return s !== null && cm >= s.netFromCm;
}

/** The 월척 line for crucian (30.3 cm) and 4짜 (40 cm). */
export function catchBadge(kind: number, cm: number): string {
  const s = species(kind);
  if (!s) return "";
  if (s.id === "crucian" && cm >= 40) return "4짜!";
  if (s.id === "crucian" && cm >= 30.3) return "월척!";
  if (cm >= s.trophyCm && s.trophyCm < 99) return "대물!";
  return "";
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
}

export function emptyFishView(): FishView {
  return { rod: 0, spot: -1, phase: 0, seq: 0, sig: 0, kind: 0, cm: 0, at: 0 };
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

export function parsePersonalState(raw: unknown): PersonalFishingState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const out: PersonalFishingState = {};
  const phase = num(r.phase);
  if (phase !== undefined) out.phase = phase;
  const left = num(r.left ?? r.msLeft);
  if (left !== undefined) out.left = left;
  const progress = num(r.progress);
  if (progress !== undefined) out.progress = Math.max(0, Math.min(1, progress));
  if (typeof r.result === "string") out.result = r.result;
  const c = r.catch ?? r.caught;
  if (c && typeof c === "object") {
    const cc = c as Record<string, unknown>;
    const kind = num(cc.kind);
    const cm = num(cc.cm ?? cc.lengthCm);
    if (kind !== undefined && cm !== undefined) out.catch = { kind, cm, first: cc.first === true };
  }
  return out;
}

export interface TrophyPayload {
  name: string;
  kind: number;
  cm: number;
  /** "lake": told to the people at the lake, "village": the whole village (very rare). */
  scope?: string;
}
export function parseTrophy(raw: unknown): TrophyPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || typeof r.kind !== "number" || typeof r.cm !== "number") return null;
  return { name: r.name, kind: r.kind, cm: r.cm, scope: typeof r.scope === "string" ? r.scope : undefined };
}

/** Korean words for a refused action (`FishingRejected {reason}`), never a code. */
export function rejectText(reason: unknown): string {
  switch (reason) {
    case "not_near_rental":
    case "too_far":
      return "관리소 앞 노란 원으로 가까이 와요.";
    case "already_has_rod":
      return "이미 낚싯대를 빌렸어요.";
    case "rod_required":
      return "먼저 관리소에서 낚싯대를 빌려요.";
    case "spot_taken":
      return "그 자리는 다른 분이 앉아 있어요. 다른 빈 의자를 골라요.";
    case "no_free_spot":
      return "빈 자리가 없어요. 벤치에서 구경해요.";
    case "too_soon":
      return "잠깐만요, 조금 있다가 다시 해요.";
    case "not_yet":
      return "아직이에요! 찌가 크게 움직일 때까지 기다려요.";
    default:
      return "지금은 할 수 없어요.";
  }
}
