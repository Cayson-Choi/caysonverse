/**
 * Bridge a class (반) connection into the client: the class's discrete state into the class
 * store, and its personal messages into their sinks —
 *  - `ClassMsg.EscapeTicket` → join the team classroom (`joinEscape`) → the escape screen;
 *  - `ClassMsg.Notice` → a toast; `ClassMsg.TeamChatMirror` → the teacher's chat mirror;
 *  - `ClassMsg.ResultsCsv` → the browser saves "AI학교탈출_<CODE>_<시각>.csv".
 * Chat lines and System notices stay with chatSync (the chat UI binds to the active room).
 *
 * Lifetime: the WHOLE class connection, not a scene. The connection layer binds it
 * (`bindClassSync`, from attachResilience in class mode) right after every (re)join, before any
 * await: the SDK DROPS a message that has no handler yet, and a refreshed tab that takes its ghost
 * over is sent its ticket right after the join completes; while the player is inside a
 * classroom (hall scene unmounted) an `EscapeRejoin` is answered with a ticket too. Scenes read
 * the store; they never call startClassSync themselves.
 *
 * State: each patch folds the discrete fields into a fingerprint (no allocation) and the store is
 * written only when that changed (fingerprint.ts) — a walking crowd never re-renders the panels.
 * The same pass watches the own `place`: when it goes 1 → 0 (back from a classroom; the server put
 * the player at the door's return point), the scene must snap the local pose to the server's
 * (`takeHubSnap`, read by the frame loop).
 */

import type { Room } from "@colyseus/sdk";
// TYPE-ONLY: schema decorators must never enter the browser bundle.
import type { ClassState, Player, Team } from "@caysonverse/shared/schema";
import {
  PLACE_ESCAPE,
  PLACE_HUB,
  ROOM_IDS,
  ROOM_LABELS,
  type RoomId,
} from "@caysonverse/shared/escape/constants";
import {
  ClassMsg,
  type EscapeTicketPayload,
  type NoticePayload,
  type ResultsCsvPayload,
  type TeamChatMirrorPayload,
} from "@caysonverse/shared/escape/messages";
import { Fingerprint } from "./fingerprint";
import { joinEscape, leaveEscape } from "./connection";
import { FAILED_NOTICE } from "./reconnectPolicy";
import { downloadCsv, resultsFilename } from "./download";
import { useClassStore } from "../stores/classStore";
import { useAppStore } from "../stores/appStore";
import { enteringText } from "../escape/format";
import { useEnterTransition } from "../escape/enterTransition";

// ───────────────────────────── Snap back into the hall (place 1 → 0) ─────────────────────────────

const snap = { pending: false, x: 0, z: 0, yaw: 0 };

/**
 * If the server has just moved the local player out of a classroom (place 1 → 0), copy its
 * position into `out` once and return true. Allocation-free: the hall's frame loop calls it
 * every frame and moves the local pose (and camera target) when it returns true.
 */
export function takeHubSnap(out: { x: number; z: number; yaw: number }): boolean {
  if (!snap.pending) return false;
  snap.pending = false;
  out.x = snap.x;
  out.z = snap.z;
  out.yaw = snap.yaw;
  return true;
}

// ─────────────────────────────────────── Fingerprint ───────────────────────────────────────

/**
 * Fold everything the class store shows: code / phase / level, open and lit rooms, each team
 * (look, members, classroom, escapes, stars, door pad) and each player's nickname / place / team.
 * Positions are left out on purpose.
 */
function classPrint(state: ClassState, fp: Fingerprint, walk: Walkers): void {
  fp.reset().str(state.classCode).str(state.phase).str(state.textLevel);
  state.openRooms?.forEach(walk.str);
  fp.int(state.openRooms?.length);
  state.litRooms?.forEach(walk.str);
  fp.int(state.litRooms?.length);
  state.teams?.forEach(walk.team);
  fp.int(state.teams?.size);
  state.players?.forEach(walk.player);
  fp.int(state.players?.size);
}

/** The per-item folds, made ONCE per sync (no closures allocated per patch). */
interface Walkers {
  str: (v: string) => void;
  team: (team: Team, id: string) => void;
  player: (p: Player, sid: string) => void;
}

function walkers(fp: Fingerprint): Walkers {
  const str = (v: string): void => void fp.str(v);
  const star = (count: number, room: string): void => void fp.str(room).int(count);
  return {
    str,
    team: (team, id) => {
      fp.str(id).int(team.nameIndex).int(team.colorIndex);
      team.members?.forEach(str);
      fp.int(team.members?.length).str(team.escapeRoomId).str(team.escapeDoor);
      team.escaped?.forEach(str);
      fp.int(team.escaped?.length);
      team.stars?.forEach(star);
      fp.int(team.stars?.size).str(team.padDoor).str(team.padLeaderSid).int(team.padCount);
    },
    player: (p, sid) => {
      fp.str(sid).str(p.nickname).int(p.place).str(p.teamId);
    },
  };
}

// ─────────────────────────────────────────── Sync ───────────────────────────────────────────

/**
 * The card's line for the team's classroom ("상담실로 들어가는 중…"): the door the team's classroom is behind
 * (`escapeDoor`), else the door the team stands at (`padDoor` — the ticket can come before the state
 * patch that names the classroom), else the one open room of this phase; "교실" when none is known.
 */
function enteringLabel(): string {
  const st = useClassStore.getState();
  const mine = st.teams.find((t) => t.mine);
  const known = (v: string | undefined): v is RoomId => (ROOM_IDS as readonly string[]).includes(v ?? "");
  const door = known(mine?.escapeDoor)
    ? mine.escapeDoor
    : known(mine?.padDoor)
      ? mine.padDoor
      : st.openRooms.length === 1
        ? st.openRooms[0]
        : null;
  return enteringText(door ? ROOM_LABELS[door] : "");
}

/**
 * Join the classroom a ticket admits us to, then show it (or say why not). The "…로 들어가는 중" card
 * (LoadingTransition) covers the hall from the ticket until the classroom scene is up and its minimum
 * time has passed (Task 17); a refused ticket drops it at once.
 */
async function admitTicket(payload: EscapeTicketPayload | undefined): Promise<void> {
  if (typeof payload?.roomId !== "string" || typeof payload.ticket !== "string") return;
  useEnterTransition.getState().begin(enteringLabel(), performance.now());
  try {
    await joinEscape(payload.roomId, payload.ticket);
  } catch (err) {
    useEnterTransition.getState().end();
    useClassStore.getState().showToast(err instanceof Error && err.message ? err.message : FAILED_NOTICE);
    return;
  }
  // The class session may have ended while we were joining: do not stay in a classroom alone.
  const screen = useAppStore.getState().screen;
  if (screen !== "hub" && screen !== "escape") {
    useEnterTransition.getState().end();
    void leaveEscape();
    return;
  }
  useAppStore.getState().enterEscape();
  useEnterTransition.getState().ready();
}

/**
 * Start syncing a class connection (see the file comment). Returns a teardown that detaches
 * every handler. It keeps the store (a reconnect rebinds without losing the teacher's chat
 * mirror); `unbindClassSync` forgets the class when it is left.
 */
export function startClassSync(room: Room<ClassState>): () => void {
  const selfSid = room.sessionId;
  const fp = new Fingerprint();
  const walk = walkers(fp);
  let lastA = Number.NaN;
  let lastB = Number.NaN;
  let lastPlace = -1;

  const onPatch = (): void => {
    const state = room.state;
    if (!state?.players) return; // the first state has not arrived yet
    classPrint(state, fp, walk);
    if (!fp.same(lastA, lastB)) {
      lastA = fp.a;
      lastB = fp.b;
      useClassStore.getState().applyState(state, selfSid);
    }
    const me = state.players.get(selfSid);
    const place = me ? me.place : -1;
    if (me && lastPlace === PLACE_ESCAPE && place === PLACE_HUB) {
      snap.pending = true;
      snap.x = me.x;
      snap.z = me.z;
      snap.yaw = me.yaw;
    }
    lastPlace = place;
  };
  room.onStateChange(onPatch);
  onPatch();

  const offs = [
    room.onMessage(ClassMsg.EscapeTicket, (p: EscapeTicketPayload) => {
      void admitTicket(p);
    }),
    room.onMessage(ClassMsg.Notice, (p: NoticePayload) => {
      if (typeof p?.text === "string" && p.text !== "") useClassStore.getState().showToast(p.text);
    }),
    room.onMessage(ClassMsg.TeamChatMirror, (p: TeamChatMirrorPayload) => {
      if (typeof p === "object" && p !== null && typeof p.text === "string") useClassStore.getState().pushMirror(p);
    }),
    room.onMessage(ClassMsg.ResultsCsv, (p: ResultsCsvPayload) => {
      if (typeof p?.csv !== "string") return;
      const code = room.state?.classCode || useClassStore.getState().classCode;
      downloadCsv(resultsFilename(code, new Date()), p.csv);
    }),
  ];

  return () => {
    room.onStateChange.remove(onPatch);
    for (const off of offs) off();
  };
}

// ───────────────────────────── One binding per class connection ─────────────────────────────

let bound: { room: Room<ClassState>; stop: () => void } | null = null;

/**
 * Sync `room` for as long as it is THE class connection. A reconnect's new room replaces the
 * previous binding; the store carries over (its next patch rewrites the state part).
 */
export function bindClassSync(room: Room<ClassState>): void {
  if (bound?.room === room) return;
  bound?.stop();
  bound = { room, stop: startClassSync(room) };
}

/** Stop syncing and forget the class (leaving it): store reset, no pending snap. */
export function unbindClassSync(): void {
  const b = bound;
  bound = null;
  b?.stop();
  useClassStore.getState().reset();
  snap.pending = false;
}
