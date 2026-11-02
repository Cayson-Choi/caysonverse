/**
 * Bridge a team-classroom (EscapeRoom) connection into the escape store: the room's public
 * content (`EscapeMsg.Content`, every join and reconnect), the close-up view (`InspectView`, to
 * the asker only), the team's events (`Event`, the escape's lines and summary re-sent after a
 * reconnect) and personal notices (`Notice`), plus the synced EscapeState as a plain view.
 *
 * Bound by the connection layer the moment a classroom connection exists (`adoptEscapeRoom`),
 * before any await — the server sends Content right after the join and the SDK drops a message
 * that has no handler yet. The state is copied in only when its discrete part changed
 * (fingerprint.ts): a teammate walking around never re-renders the HUD.
 */

import type { Room } from "@colyseus/sdk";
// TYPE-ONLY: schema decorators must never enter the browser bundle.
import type { EscapeState, Player } from "@caysonverse/shared/schema";
import {
  EscapeMsg,
  type EscapeEventPayload,
  type InspectViewPayload,
  type NoticePayload,
  type RoomContent,
} from "@caysonverse/shared/escape/messages";
import { Fingerprint } from "./fingerprint";
import { toEscapeView, useEscapeStore } from "../stores/escapeStore";

/** Fold everything EscapeView shows (players' positions left out on purpose). */
function escapePrint(state: EscapeState, fp: Fingerprint, walk: Walkers): void {
  fp.reset()
    .str(state.phase)
    .bool(state.paused)
    .bool(state.solo)
    .bool(state.overtime)
    .int(state.timeLeftS)
    .int(state.cooldownS)
    .int(state.finaleStep)
    .int(state.hintsUsed)
    .int(state.wrongAttempts)
    .str(state.teamName)
    .str(state.roomDefId)
    .str(state.textLevel);
  state.flags?.forEach(walk.str);
  fp.int(state.flags?.length);
  state.bag?.forEach(walk.str);
  fp.int(state.bag?.length);
  state.hints?.forEach(walk.str);
  fp.int(state.hints?.length);
  state.lockInput?.forEach(walk.entry);
  fp.int(state.lockInput?.size);
  state.board?.forEach(walk.entry);
  fp.int(state.board?.size);
  state.votes?.forEach(walk.entry);
  fp.int(state.votes?.size);
  state.players?.forEach(walk.player);
  fp.int(state.players?.size);
}

interface Walkers {
  str: (v: string) => void;
  entry: (v: string, k: string) => void;
  player: (p: Player, sid: string) => void;
}

/** The per-item folds, made ONCE per sync (nothing allocated per patch). */
function walkers(fp: Fingerprint): Walkers {
  return {
    str: (v) => void fp.str(v),
    entry: (v, k) => void fp.str(k).str(v),
    player: (p, sid) => void fp.str(sid).str(p.nickname).bool(p.connected).int(p.role),
  };
}

/**
 * Start syncing a classroom connection. Returns a teardown that detaches every handler (the
 * store carries over a reconnect; `unbindEscapeSync` forgets the classroom).
 */
export function startEscapeSync(room: Room<EscapeState>): () => void {
  const fp = new Fingerprint();
  const walk = walkers(fp);
  let lastA = Number.NaN;
  let lastB = Number.NaN;

  const onPatch = (): void => {
    const state = room.state;
    if (!state?.players) return; // the first state has not arrived yet
    escapePrint(state, fp, walk);
    if (fp.same(lastA, lastB)) return;
    lastA = fp.a;
    lastB = fp.b;
    useEscapeStore.getState().setView(toEscapeView(state));
  };
  room.onStateChange(onPatch);
  onPatch();

  const offs = [
    room.onMessage(EscapeMsg.Content, (c: RoomContent) => {
      if (typeof c === "object" && c !== null) useEscapeStore.getState().setContent(c);
    }),
    room.onMessage(EscapeMsg.InspectView, (v: InspectViewPayload) => {
      if (typeof v === "object" && v !== null) useEscapeStore.getState().setInspect(v);
    }),
    room.onMessage(EscapeMsg.Event, (ev: EscapeEventPayload) => {
      if (typeof ev === "object" && ev !== null && typeof ev.e === "string") useEscapeStore.getState().pushEvent(ev);
    }),
    room.onMessage(EscapeMsg.Notice, (n: NoticePayload) => {
      if (typeof n?.text === "string" && n.text !== "") useEscapeStore.getState().showToast(n.text);
    }),
  ];

  return () => {
    room.onStateChange.remove(onPatch);
    for (const off of offs) off();
  };
}

let bound: { room: Room<EscapeState>; stop: () => void } | null = null;

/** Sync `room` for as long as it is THE classroom connection (a reconnect's room replaces it). */
export function bindEscapeSync(room: Room<EscapeState>): void {
  if (bound?.room === room) return;
  bound?.stop();
  bound = { room, stop: startEscapeSync(room) };
}

/** Stop syncing and forget the classroom (left it). */
export function unbindEscapeSync(): void {
  const b = bound;
  bound = null;
  b?.stop();
  useEscapeStore.getState().reset();
}
