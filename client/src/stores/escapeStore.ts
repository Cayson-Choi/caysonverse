import { create } from "zustand";
// TYPE-ONLY: schema decorators must never enter the browser bundle.
import type { EscapeState } from "@caysonverse/shared/schema";
import { ROLE_TEACHER } from "@caysonverse/shared/constants";
import { ROOM_IDS, type EscapePhase, type RoomId, type TextLevel } from "@caysonverse/shared/escape/constants";
import type {
  EscapeEventPayload,
  EscapedEvent,
  InspectViewPayload,
  RoomContent,
} from "@caysonverse/shared/escape/messages";
import type { Toast } from "./classStore";

/**
 * The team classroom as its UI reads it — DISCRETE state only. Written by escapeSync.ts:
 * the synced EscapeState is copied in (`toEscapeView`) only when its discrete part changed,
 * and the room's messages (content, close-up view, events, notices) land here as they come.
 * Players' positions never come here.
 */

/** The EscapeState as plain data (no schema collections), plus the team's name, room and level (ruling E14). */
export interface EscapeView {
  phase: EscapePhase;
  paused: boolean;
  solo: boolean;
  overtime: boolean;
  timeLeftS: number;
  cooldownS: number;
  flags: string[];
  bag: string[];
  lockInput: Record<string, string>;
  board: Record<string, string>;
  votes: Record<string, string>;
  finaleStep: number;
  hintsUsed: number;
  wrongAttempts: number;
  hints: string[];
  /** Who is here: connected members (never a teacher), in arrival order. */
  members: { sid: string; nickname: string }[];
  teamName: string;
  /** The room this classroom runs, or null when the state does not name a known one yet. */
  roomDefId: RoomId | null;
  textLevel: TextLevel;
}

const PHASES: readonly EscapePhase[] = ["intro", "play", "finale", "timeup", "escaped", "ended"];

type ForEachList = { forEach(cb: (value: string) => void): void } | undefined;
type ForEachMap = { forEach(cb: (value: string, key: string) => void): void } | undefined;

function listOf(list: ForEachList): string[] {
  const out: string[] = [];
  list?.forEach((v) => out.push(v));
  return out;
}

function recordOf(map: ForEachMap): Record<string, string> {
  const out: Record<string, string> = {};
  map?.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/** Copy the synced EscapeState into plain arrays / records (a view never aliases the schema). */
export function toEscapeView(state: EscapeState): EscapeView {
  const members: { sid: string; nickname: string }[] = [];
  state.players?.forEach((p, sid) => {
    if (p.connected && p.role !== ROLE_TEACHER) members.push({ sid, nickname: p.nickname });
  });
  const roomDefId = (ROOM_IDS as readonly string[]).includes(state.roomDefId) ? (state.roomDefId as RoomId) : null;
  return {
    phase: PHASES.includes(state.phase) ? state.phase : "intro",
    paused: state.paused,
    solo: state.solo,
    overtime: state.overtime,
    timeLeftS: state.timeLeftS,
    cooldownS: state.cooldownS,
    flags: listOf(state.flags),
    bag: listOf(state.bag),
    lockInput: recordOf(state.lockInput),
    board: recordOf(state.board),
    votes: recordOf(state.votes),
    finaleStep: state.finaleStep,
    hintsUsed: state.hintsUsed,
    wrongAttempts: state.wrongAttempts,
    hints: listOf(state.hints),
    members,
    teamName: state.teamName,
    roomDefId,
    textLevel: state.textLevel === "hard" ? "hard" : "easy",
  };
}

interface EscapeStoreState {
  view: EscapeView | null;
  /** The room's public content (`EscapeMsg.Content`, every join and reconnect). */
  content: RoomContent | null;
  /** The close-up the player asked for (`EscapeMsg.InspectView`); null = closed. */
  inspect: InspectViewPayload | null;
  /** The latest team event; `eventSeq` grows by one per event, so two equal events still differ. */
  lastEvent: EscapeEventPayload | null;
  eventSeq: number;
  /** The escape (lines, stars, time, summary card) — also re-sent after a reconnect. */
  summary: EscapedEvent | null;
  /** A personal notice (`EscapeMsg.Notice`). */
  toast: Toast | null;

  setView: (view: EscapeView) => void;
  setContent: (content: RoomContent) => void;
  setInspect: (inspect: InspectViewPayload | null) => void;
  pushEvent: (ev: EscapeEventPayload) => void;
  showToast: (text: string) => void;
  clearToast: (id?: number) => void;
  /** Forget the classroom (left it, or a new one starts). */
  reset: () => void;
}

let nextToastId = 1;

export const useEscapeStore = create<EscapeStoreState>((set) => ({
  view: null,
  content: null,
  inspect: null,
  lastEvent: null,
  eventSeq: 0,
  summary: null,
  toast: null,

  setView: (view) => set({ view }),
  setContent: (content) => set({ content }),
  setInspect: (inspect) => set({ inspect }),
  pushEvent: (ev) =>
    set((s) => ({
      lastEvent: ev,
      eventSeq: s.eventSeq + 1,
      ...(ev.e === "escaped" ? { summary: ev } : {}),
    })),
  showToast: (text) => set({ toast: { id: nextToastId++, text } }),
  clearToast: (id) => set((s) => (s.toast !== null && (id === undefined || s.toast.id === id) ? { toast: null } : s)),
  reset: () => set({ view: null, content: null, inspect: null, lastEvent: null, summary: null, toast: null }),
}));
