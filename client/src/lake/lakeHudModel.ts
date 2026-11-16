// The ONE big button of the fishing HUD (design 7.2): what it says, does and looks like for each moment — pure, so every
// state is a unit test. The text is short Korean + an icon; a phase never shows another phase's word (12.7: no "당겨요!" while
// waiting).

import { FISH_PHASE, FISH_SIG, type FishView } from "./lakeProtocol";

export type LakeAction =
  | { kind: "rent" }
  | { kind: "return" }
  | { kind: "sit"; spot: number }
  | { kind: "cast" }
  | { kind: "strike" }
  | { kind: "hold" }
  | { kind: "goRental" }
  | { kind: "tooEarly" }
  | { kind: "none" };

export type LakeTone = "go" | "wait" | "soft" | "alert" | "hold" | "done";

export interface LakeButtonSpec {
  /** Stable id: the DOM keeps the same button while only its words change. */
  id: string;
  label: string;
  icon: string;
  /** The key shown on a PC. */
  key: "E" | "Space";
  tone: LakeTone;
  /** False: drawn dim and does nothing (waiting, lifting...). */
  enabled: boolean;
  /** Pressed and held (the fight). */
  hold: boolean;
  action: LakeAction;
}

/** What the HUD knows besides the angler's own fields. */
export interface LakeContext {
  view: FishView;
  /** Standing within the rental pad (design 2.2: 2.5 m). */
  nearRental: boolean;
  /** The nearest free fishing chair in reach (index into LAKE_FISHING_SPOTS), or -1. */
  nearChair: number;
  /** Seated on a lake fishing chair (the server's fishSpot says so). */
  seatedAtSpot: boolean;
  /** Seated on a lake fishing chair but without a rod (12.2: "낚싯대 빌리러 가기"). */
  seatedNoRod: boolean;
  /** Already seated on a fishing chair (the room's seat) with a rod but not yet fishing there: the button starts the fishing. */
  onChair?: boolean;
}

const B = (id: string, label: string, icon: string, key: "E" | "Space", tone: LakeTone, enabled: boolean, action: LakeAction, hold = false): LakeButtonSpec => ({
  id, label, icon, key, tone, enabled, hold, action,
});

/** The button for this moment, or null when the lake has nothing to offer (the village's own button shows). */
export function lakeButton(c: LakeContext): LakeButtonSpec | null {
  const v = c.view;
  const p = v.phase;
  if (c.seatedNoRod) return B("goRental", "낚싯대 빌리러 가기", "🎣", "E", "go", true, { kind: "goRental" });
  if (v.rod === 0) {
    if (c.nearRental) return B("rent", "낚싯대 빌리기", "🎣", "E", "go", true, { kind: "rent" });
    return null;
  }
  // a rod in hand
  if (!c.seatedAtSpot) {
    if (c.nearChair >= 0) return B("sit", c.onChair ? "여기서 낚시" : "앉아서 낚시", c.onChair ? "🎣" : "🪑", "E", "go", true, { kind: "sit", spot: c.nearChair });
    // Returning is NOT the big button: right after renting, the thumb is still on that spot and would give the rod straight back.
    return null;
  }
  switch (p) {
    case FISH_PHASE.ready:
      return B("cast", "던지기", "🎣", "Space", "go", true, { kind: "cast" });
    case FISH_PHASE.casting:
      return B("cast", "던지는 중…", "🎣", "Space", "wait", false, { kind: "none" });
    case FISH_PHASE.settling:
      return B("cast", "찌가 서요…", "🎣", "Space", "wait", false, { kind: "none" });
    case FISH_PHASE.waiting:
      return B("cast", "기다리는 중…", "👀", "Space", "wait", false, { kind: "none" });
    case FISH_PHASE.nibble:
      // pressing now does no harm: "아직!" (design 7.1)
      return B("cast", "살짝… 아직!", "👀", "Space", "soft", true, { kind: "tooEarly" });
    case FISH_PHASE.bite:
      return B("cast", "당겨요!", "❗", "Space", "alert", true, { kind: "strike" });
    case FISH_PHASE.hooked:
    case FISH_PHASE.lifting:
      return B("cast", "올리는 중…", "🐟", "Space", "wait", false, { kind: "none" });
    case FISH_PHASE.fighting:
      return B("cast", "꾹 누르고 있어요", "💪", "Space", "hold", true, { kind: "hold" }, true);
    case FISH_PHASE.netting:
      return B("cast", "뜰채로 뜨는 중…", "🥅", "Space", "wait", false, { kind: "none" });
    case FISH_PHASE.landed:
      return B("cast", "잡았어요!", "🐟", "Space", "done", false, { kind: "none" });
    case FISH_PHASE.releasing:
      return B("cast", "놓아주는 중…", "🐟", "Space", "wait", false, { kind: "none" });
    case FISH_PHASE.missed:
      return B("cast", "놓쳤어요…", "💦", "Space", "wait", false, { kind: "none" });
    default:
      return B("cast", "던지기", "🎣", "Space", "go", true, { kind: "cast" });
  }
}

/** The small line under the top bar: what to look at (never a different phase's words). */
export function lakeCaption(c: LakeContext, firstTime: boolean): string {
  const v = c.view;
  if (c.seatedNoRod) return "관리소에서 낚싯대를 먼저 빌려요.";
  if (v.rod === 0) return c.nearRental ? "" : "";
  if (!c.seatedAtSpot) return c.nearChair >= 0 ? "빈 의자예요. 앉아서 낚시해요." : "";
  switch (v.phase) {
    case FISH_PHASE.ready:
      return "던지기를 눌러요.";
    case FISH_PHASE.casting:
    case FISH_PHASE.settling:
      return "찌가 물에 떨어져요.";
    case FISH_PHASE.waiting:
      return firstTime ? "찌가 쑥 잠기거나 솟으면 그때 눌러요." : "찌를 지켜봐요.";
    case FISH_PHASE.nibble:
      return "살짝 건드리네요. 조금만 더!";
    case FISH_PHASE.bite:
      return v.sig === FISH_SIG.rise ? "찌가 솟았어요! 지금 당겨요!" : "찌가 잠겼어요! 지금 당겨요!";
    case FISH_PHASE.hooked:
      return "걸렸어요!";
    case FISH_PHASE.fighting:
      return "버튼을 꾹 누르고 있어요. 힘을 빼면 끌려가요.";
    case FISH_PHASE.netting:
      return "뜰채로 떠요.";
    case FISH_PHASE.missed:
      return "찌가 다시 올라왔어요. 다음엔 빨간 버튼일 때!";
    default:
      return "";
  }
}

/** The small "일어나기" button: shown while seated at a fishing spot. */
export function showStandButton(c: LakeContext): boolean {
  return c.seatedAtSpot || c.seatedNoRod;
}

/** The small "반납하기" button (top strip): a rod in hand, standing on the rental pad. */
export function showReturnButton(c: LakeContext): boolean {
  return c.view.rod > 0 && !c.seatedAtSpot && c.nearRental;
}
