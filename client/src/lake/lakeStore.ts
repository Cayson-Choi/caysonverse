// What the lake HUD shows that is not in the schema: the personal answers (progress, the catch card), notices, the trophy
// toasts and the dex. Discrete UI state (changes a few times a minute), never per frame.

import { create } from "zustand";
import { loadDex, markCoachSeen, recordCatch, saveDex, type Dex } from "./lakeDex";
import { catchBadge, species, type BoardLine, type PersonalFishingState, type TrophyPayload } from "./lakeProtocol";
import { DEFAULT_SEAM, type LakeSeam } from "./lakeModelPrep";

export interface CatchCard {
  id: number;
  kind: number;
  cm: number;
  first: boolean;
  record: boolean;
  badge: string;
  until: number;
}
export interface Toast {
  id: number;
  text: string;
  until: number;
}

interface LakeStore {
  personal: PersonalFishingState;
  notice: Toast | null;
  card: CatchCard | null;
  toasts: Toast[];
  dex: Dex;
  dexOpen: boolean;
  /** The first-time speech under the top bar was shown (this device). */
  coachShown: boolean;
  /** The lake's big button is up: the village's context button (ActionButton) and its E key step aside. */
  ownsAction: boolean;
  /** Draw a faint ring round my own float (menu: "내 찌 테두리"). */
  halo: boolean;
  /** The lake (greybox or lake.glb) is drawn: the village's old backdrop lake is taken out of its clone (lakeVillagePatch.ts). */
  drawn: boolean;
  /** What the village patch cuts: lake.glb's seam rectangles and the ridge's footprint (the lake zone for the greybox). */
  seam: LakeSeam;
  /** "오늘의 대어": the room's board (the server's memory; it empties at 04:00 Korea time). */
  board: BoardLine[];
  setPersonal(s: PersonalFishingState): void;
  landed(kind: number, cm: number, nowMs: number): void;
  say(text: string, ms?: number): void;
  trophy(t: TrophyPayload): void;
  setDexOpen(open: boolean): void;
  dismissCard(): void;
  coachDone(): void;
}

let counter = 1;
function haloOn(): boolean {
  try {
    return localStorage.getItem("cv.lake.halo") !== "0";
  } catch {
    return true;
  }
}
const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
export const CARD_MS = 4500;
export const NOTICE_MS = 2600;
export const TOAST_MS = 6000;

export const useLakeStore = create<LakeStore>((set, get) => ({
  personal: {},
  notice: null,
  card: null,
  toasts: [],
  dex: loadDex(),
  dexOpen: false,
  coachShown: false,
  ownsAction: false,
  halo: haloOn(),
  drawn: false,
  seam: DEFAULT_SEAM,
  board: [],
  setPersonal(s) {
    set({ personal: s });
  },
  landed(kind, cm, nowMs) {
    // The fish is landed (phase `landed`, kind and length from the schema): the card, and the dex of this device.
    const rec = recordCatch(get().dex, kind, cm, nowMs);
    saveDex(rec.dex);
    set({ dex: rec.dex, card: { id: counter++, kind, cm, first: rec.first, record: rec.record, badge: catchBadge(kind, cm), until: now() + CARD_MS } });
  },
  say(text, ms = NOTICE_MS) {
    set({ notice: { id: counter++, text, until: now() + ms } });
  },
  trophy(t) {
    const s = species(t.kind);
    const text = `${t.name}님이 ${s?.label ?? "물고기"} ${Math.round(t.cm)}cm를 낚았어요!`;
    set((st) => ({ toasts: [...st.toasts.slice(-2), { id: counter++, text, until: now() + TOAST_MS }] }));
  },
  setDexOpen: (dexOpen) => set({ dexOpen }),
  dismissCard: () => set({ card: null }),
  coachDone() {
    if (get().coachShown) return;
    markCoachSeen();
    set({ coachShown: true });
  },
}));

/** Remove what has timed out (the HUD calls this a few times a second). Returns true when something changed. */
export function expireLakeUi(): boolean {
  const t = now();
  const s = useLakeStore.getState();
  const patch: Partial<LakeStore> = {};
  if (s.notice && s.notice.until <= t) patch.notice = null;
  if (s.card && s.card.until <= t) patch.card = null;
  if (s.toasts.some((x) => x.until <= t)) patch.toasts = s.toasts.filter((x) => x.until > t);
  if (Object.keys(patch).length === 0) return false;
  useLakeStore.setState(patch);
  return true;
}
