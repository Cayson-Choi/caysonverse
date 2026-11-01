import type { Client, AuthContext } from "colyseus";
import { Player, WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import {
  MAX_CLIENTS,
  PATCH_RATE_MS,
  SPAWN_POINT,
  SPAWN_JITTER,
  KICK_CLOSE_CODE,
  ROLE_STUDENT,
  ROLE_TEACHER,
} from "@caysonverse/shared/constants";
import { LEGACY_GEOMETRY, SEATS } from "@caysonverse/shared/worldMap";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
import { APPEARANCE_FIELDS } from "@caysonverse/shared/appearance";
import {
  MAZE_RETURN,
  canUsePortal,
  isInMazeGoal,
  escapeAllowed,
  escapeMessage,
} from "@caysonverse/shared/maze";
import { PlayerRoom, baseTracking, spawnInDisk, type Tracking } from "./PlayerRoom";
import { validateSit } from "./seating";
import { validateJoinOptions } from "./joinValidation";
import { sanitizeAnnounce } from "./announce";
import { DenySet } from "./denySet";
import { resolveClientIp } from "./clientIp";
import { compareAdminCode, AdminAttemptLimiter } from "./adminAuth";

// User-facing Korean strings for admin auth / kick. Identifiers stay English.
const ADMIN_CODE_WRONG = "관리자 코드가 올바르지 않습니다";
const ADMIN_TOO_MANY = "관리자 코드 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.";
const KICKED_OUT = "입장이 제한되었습니다";

/**
 * Shared key used by the brute-force limiter when the client IP is not
 * obtainable. The installed Colyseus 0.17 sources `AuthContext.ip` ONLY from the
 * `x-forwarded-for` / `x-client-ip` / `x-real-ip` headers (see onAuth) — never
 * the socket address — so without a reverse proxy the IP is undefined and every
 * failed attempt falls back to this single global counter (per the brief).
 */
const GLOBAL_IP_KEY = "__no_ip__";

/**
 * Server-side per-connection marker. The marker itself (`isAdmin`, ip, nickname)
 * is NEVER synchronized into schema state; the only public trace of `isAdmin` is
 * the derived `Player.role`, written once in onJoin (controls-ux §5).
 */
interface AdminMarker {
  /** True only for a connection that presented the correct admin code at join. */
  isAdmin: boolean;
  /** Resolved client IP, or null when unavailable (used for the kick denySet). */
  ip: string | null;
  /** Trimmed nickname, cached for the denySet nickname fallback on kick. */
  nickname: string;
}

/** What `onAuth` hands to `onJoin` (becomes `client.auth`). */
interface AuthResult {
  ip: string | null;
}

/** Per-client bookkeeping (not part of synced state): the base's, plus the maze clock. */
interface WorldTracking extends Tracking {
  /**
   * ms timestamp of this client's last maze-escape broadcast. Seeded to
   * `-Infinity` so the first escape always fires; the 30 s cooldown then
   * suppresses re-entry spam (design 18). Room-timed, injected-clock testable.
   */
  lastEscapeAt: number;
}

/**
 * The authoritative world room.
 *
 * Thin by design: the shared player messages (Move, Chat, Emoji, Jump, Typing),
 * their rate caps and the reconnection lifecycle live in `PlayerRoom`; this room
 * supplies the legacy map, the world's spawn, the seated-can't-move rule and the
 * maze judgment through the base's hooks, and keeps what only the world has:
 * join + admin auth, seats, the maze return portal, announce, kick and the deny
 * list. All movement/nickname rules live in pure modules (`validateJoinOptions`,
 * `validateMove`, `validateSit`) so they stay unit-testable.
 *
 * Rejection policy (from the design, binding): invalid move messages are
 * DROPPED silently — never partially applied, never a disconnect. Invalid join
 * options reject the join by throwing (the client receives the Korean error).
 */
export class WorldRoom extends PlayerRoom<WorldState, WorldTracking> {
  // Production cap is MAX_CLIENTS (110). `CV_MAX_CLIENTS` is a TEST-ONLY override
  // (read once at construction) so an integration test can fill a tiny room and
  // observe the full-room join failure WITHOUT weakening the production value.
  maxClients = readMaxClients();
  patchRate = PATCH_RATE_MS;
  // Singleton-world topology (Task 11 fix): the world is ONE shared room that must
  // exist before any client joins and survive 0-player periods. The room is
  // pre-created at server boot (see server/src/index.ts) and never auto-disposes
  // when empty, so the client's join-existing-only `client.join(WORLD_ROOM)` always
  // has exactly one room to land in — a full room is rejected (capacity notice)
  // rather than silently spawning a second, parallel world. (A forced
  // `room.disconnect()` still flips this to true, so test cleanup / shutdown dispose
  // it normally.)
  autoDispose = false;
  state = new WorldState();

  /**
   * Seat occupancy: seatIndex → the sessionId sitting there. Server memory only
   * (the per-player `seatIndex` is the synced mirror). Enforces 1-chair-1-person
   * and is freed through the single `releaseSeat` helper on every removal path.
   */
  private readonly occupancy = new Map<number, string>();

  /** Kick deny list — per-room-instance memory (cleared on server restart). */
  private readonly denySet = new DenySet();

  /** Per-IP failed-admin-code counter (global fallback when IP is unavailable). */
  private readonly adminAttempts = new AdminAttemptLimiter();

  onCreate(): void {
    // Move, Chat, Emoji, Jump, Typing (+ the "*" catch-all for stray types).
    this.registerPlayerMessages();
    this.onMessage(MessageType.Announce, (client, payload) => {
      this.handleAnnounce(client, payload);
    });
    this.onMessage(MessageType.Kick, (client, payload) => {
      this.handleKick(client, payload);
    });
    this.onMessage(MessageType.Sit, (client, payload) => {
      this.handleSit(client, payload);
    });
    this.onMessage(MessageType.Stand, (client) => {
      this.handleStand(client);
    });
    this.onMessage(MessageType.PortalReturn, (client) => {
      this.handlePortalReturn(client);
    });
  }

  /**
   * Runs BEFORE onJoin. The ONLY place the client IP is exposed by the installed
   * Colyseus 0.17: `context.ip` is derived from `x-forwarded-for` / `x-client-ip`
   * / `x-real-ip` headers (see default_routes.ts) — not the socket — so it is
   * commonly `undefined` in dev/test/no-proxy. `resolveClientIp` selects the
   * RIGHT-most (trusted-proxy-appended) hop so a client-spoofed X-Forwarded-For
   * prefix cannot control the IP that keys the admin throttle (see clientIp.ts).
   * We hand the result to onJoin via the returned auth object. We never reject
   * here (that keeps all user-facing rejections in onJoin, where the Korean
   * message is known to propagate to the client); a truthy return allows the seat.
   */
  onAuth(_client: Client, _options: unknown, context: AuthContext): AuthResult {
    return { ip: resolveClientIp(context) };
  }

  onJoin(client: Client, options: unknown, auth?: AuthResult): void {
    const ip = auth?.ip ?? null;

    const result = validateJoinOptions(options);
    if ("error" in result) {
      // Reject the join; Colyseus forwards this message to the client.
      throw new Error(result.error);
    }

    // Kick deny list: a kicked player cannot rejoin under the same nickname
    // (normalized-nickname key only — IP is NOT a ban key, see denySet.ts / F7).
    // Checked before admin so a banned connection never reaches code verification.
    if (this.denySet.isDenied({ ip, nickname: result.nickname })) {
      throw new Error(KICKED_OUT);
    }

    // Admin authentication (optional). A provided code is verified server-side
    // only; the result is a per-connection marker (never schema state) plus the
    // derived, public `Player.role` set below.
    const isAdmin = this.authenticateAdmin(options, ip);

    const spawn = this.spawnPosition();
    const player = new Player();
    player.nickname = result.nickname;
    // Appearance (character stage 3): all 15 fields, written once here and never
    // again — no client message changes them, so every client reads them once.
    for (const field of APPEARANCE_FIELDS) player[field] = result.appearance[field];
    player.x = spawn.x;
    player.z = spawn.z;
    player.yaw = 0;
    player.connected = true;
    // The ONLY write of `role`: it follows the admin-code result and nothing a
    // client sent (join options are never read for it). Set before the player
    // enters the map so the first patch already carries it.
    player.role = isAdmin ? ROLE_TEACHER : ROLE_STUDENT;

    const marker: AdminMarker = { isAdmin, ip, nickname: result.nickname };
    client.userData = marker;
    this.seatPlayer(client, player); // state + tracking (createTracking below)
  }

  /** The legacy world's map: WORLD_BOUNDS + OBSTACLES (the very same objects). */
  protected geometry(): MapGeometry {
    return LEGACY_GEOMETRY;
  }

  /**
   * Spawn point plus uniform random jitter within `SPAWN_JITTER` radius, clamped
   * to WORLD_BOUNDS so joiners don't stack yet always land in-bounds.
   */
  protected spawnPosition(): { x: number; z: number } {
    return spawnInDisk(SPAWN_POINT.x, SPAWN_POINT.z, SPAWN_JITTER, this.geometry());
  }

  /** The base bookkeeping plus the maze-escape clock (first escape always fires). */
  protected createTracking(now: number): WorldTracking {
    return { ...baseTracking(now), lastEscapeAt: Number.NEGATIVE_INFINITY };
  }

  /**
   * Seated → Move and Jump are dropped silently. Standing up is an explicit
   * Stand message (design 14): while seated the player is fully server-positioned.
   */
  protected canMove(player: Player): boolean {
    return player.seatIndex < 0;
  }

  /** v2-3: judge the maze goal on every accepted move (no new tick loop). */
  protected afterMove(client: Client, player: Player, track: WorldTracking, now: number): void {
    this.judgeMaze(client, player, track, now);
  }

  /**
   * Verify the optional admin code from join options. Returns true only for the
   * correct code. No code provided → normal user (false). Wrong code → throws
   * the Korean typo error so the instructor notices. Brute-force guard: 5 failed
   * attempts per minute per IP (or the shared global key), exceeded → generic
   * Korean error, WITHOUT comparing (so a flood cannot brute-force the code).
   * ADMIN_CODE is read fresh from the environment on every attempt; unset ⇒ any
   * provided code is wrong ⇒ admin login is impossible.
   */
  private authenticateAdmin(options: unknown, ip: string | null): boolean {
    const provided = (options as { adminCode?: unknown } | null | undefined)?.adminCode;
    if (typeof provided !== "string" || provided.length === 0) return false;

    const key = ip ?? GLOBAL_IP_KEY;
    const now = this.now();
    if (this.adminAttempts.isBlocked(key, now)) {
      throw new Error(ADMIN_TOO_MANY);
    }

    if (compareAdminCode(provided, process.env.ADMIN_CODE)) return true;

    this.adminAttempts.recordFailure(key, now);
    throw new Error(ADMIN_CODE_WRONG);
  }

  /**
   * Permanent departure: a consented leave, a kick (4001), or a reconnection
   * window that expired. (onDrop / onReconnect come from PlayerRoom unchanged:
   * a kick opens no window, any other drop leaves a ghost for the window.)
   */
  onLeave(client: Client): void {
    // Free the seat FIRST (the single cleanup path for every permanent removal:
    // consented leave, kick, and reconnection-window expiry all land here). A
    // transient drop does NOT reach onLeave (onDrop opens a window), so a ghost
    // keeps its seat as required.
    this.releaseSeat(client.sessionId);
    this.unseatPlayer(client.sessionId); // state + tracking
  }

  /**
   * Maze escape + return-portal judgment, run on each accepted move.
   *  - Inside the GOAL area: broadcast the Korean escape notice to everyone
   *    (dimmed system row), gated by this session's 30 s cooldown so re-entry
   *    can't spam. The escaper's sid rides along for the client self-celebration.
   *  - On the PORTAL pad: teleport to the clear lounge spot near the maze door
   *    (NOT the spawn) and RESET the move-clock baseline (same anti-teleport
   *    pattern as sitting/standing) so the jump can't seed a huge next step.
   * Position stays server-authoritative; the client's existing >3 m self kick-
   * back snap applies the teleport locally with no new code.
   */
  private judgeMaze(client: Client, player: Player, track: WorldTracking, now: number): void {
    if (isInMazeGoal(player.x, player.z) && escapeAllowed(track.lastEscapeAt, now)) {
      track.lastEscapeAt = now;
      this.broadcast(MessageType.System, {
        text: escapeMessage(player.nickname),
        sid: client.sessionId,
      });
    }

    // NOTE (design 34 후속): stepping on the portal pad NO LONGER teleports —
    // arriving players must be able to meet 큐리 first (발주자: 가운데 가자마자
    // 포탈돼서 대화를 못 함). The explicit PortalReturn message below is the
    // only way home; the pad remains as the chamber's visual marker.
  }

  /**
   * Explicit return-to-lobby (design 34 후속): the 큐리 panel button sends
   * this. Server-authoritative validation — the sender must actually stand in
   * the goal chamber (shared canUsePortal); anywhere else it is a silent no-op
   * (a tampered client cannot teleport from arbitrary positions). Seated
   * players cannot be in the maze, but the seat guard keeps the invariant
   * explicit. Baseline reset mirrors the old pad teleport (anti-teleport D1).
   */
  private handlePortalReturn(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.seatIndex >= 0) return;
    if (!canUsePortal(player.x, player.z)) return;
    const track = this.tracking.get(client.sessionId);
    player.x = MAZE_RETURN.x;
    player.z = MAZE_RETURN.z;
    if (track) track.lastAcceptedAt = Date.now();
  }

  /**
   * Announce pipeline: sender MUST be admin (else silent drop — an unauthorized
   * message is never acknowledged) → sanitize with the 300-char announce cap →
   * write schema state. The banner lives in `state.announcement` (NOT a
   * broadcast), so late joiners receive the current banner automatically via
   * state sync. An empty result is a valid CLEAR (sanitizeAnnounce returns "").
   */
  private handleAnnounce(client: Client, payload: unknown): void {
    if (!this.isAdmin(client)) return; // silent drop

    const text = sanitizeAnnounce((payload as { text?: unknown } | null | undefined)?.text);
    if (text === null) return; // not a string / oversized → drop

    this.state.announcement = text;
    this.state.announcedAt = this.now();
  }

  /**
   * Kick pipeline: sender MUST be admin (else silent drop). The target must
   * exist and must not be the admin themselves. On kick, add the target to the
   * denySet by NORMALIZED NICKNAME ONLY so a same-name rejoin is blocked, then
   * close the target's connection with KICK_CLOSE_CODE (4001) — the client maps
   * exactly that code to the kicked UX.
   *
   * We deliberately do NOT ban the IP (final-review F7): behind Railway the IP is
   * the shared public NAT of a whole classroom, so an IP ban would lock out every
   * other student after one kick. The nickname key blocks the kicked user's
   * trivial rejoin without over-blocking classmates (see denySet.ts). The target
   * IP is still passed for shape/audit but is ignored as a ban key.
   */
  private handleKick(client: Client, payload: unknown): void {
    if (!this.isAdmin(client)) return; // silent drop

    const sid = (payload as { sid?: unknown } | null | undefined)?.sid;
    if (typeof sid !== "string" || sid.length === 0) return;
    if (sid === client.sessionId) return; // cannot kick oneself

    const target = this.clients.getById(sid);
    if (!target) return; // target must exist

    const targetMarker = target.userData as AdminMarker | undefined;
    const nickname = this.state.players.get(sid)?.nickname ?? targetMarker?.nickname ?? "";
    this.denySet.add({ ip: targetMarker?.ip ?? null, nickname }); // ip ignored (F7)

    target.leave(KICK_CLOSE_CODE);
  }

  /**
   * Sit pipeline: sender must have a seat in state → pure validate (garbage /
   * already-seated / out-of-range distance → SILENT drop; occupied-by-other →
   * personal Korean notice). On success, claim the seat, snap the player onto it
   * (position + screen-facing yaw), and reset the move-clock baseline so the
   * seated span can't later be spent as a one-shot displacement budget (D1).
   * Server-authoritative: the client only sees itself seated once seatIndex syncs.
   */
  private handleSit(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return; // no seat yet / already left → drop

    const result = validateSit(
      { x: player.x, z: player.z, seatIndex: player.seatIndex },
      payload,
      this.occupancy,
      client.sessionId,
    );
    if (result === null) return; // malformed / already seated / out of reach → silent
    if ("reason" in result) {
      client.send(MessageType.SitRejected, { reason: result.reason }); // occupied race
      return;
    }

    const seat = SEATS[result.seatIndex];
    this.occupancy.set(result.seatIndex, client.sessionId);
    player.seatIndex = result.seatIndex;
    player.x = seat.x;
    player.z = seat.z;
    player.yaw = seat.yaw;
    track.lastAcceptedAt = this.now();
  }

  /**
   * Stand pipeline: only a SEATED sender is served (else silent drop). Move the
   * player to the seat's clear dismount point, free the seat (single helper), and
   * reset the move-clock baseline — the just-freed seated span must not seed the
   * first walking step's elapsed budget.
   */
  private handleStand(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return;
    if (player.seatIndex < 0) return; // not seated → silent drop

    const seat = SEATS[player.seatIndex];
    player.x = seat.standX;
    player.z = seat.standZ;
    this.releaseSeat(client.sessionId);
    track.lastAcceptedAt = this.now();
  }

  /**
   * The ONE place a seat is freed. Clears the occupancy entry (only if this
   * session still owns it) and resets the synced `seatIndex` to standing. Called
   * from Stand and from onLeave (consented leave, kick, reconnection expiry) —
   * never from onDrop, so a transient-drop ghost keeps its seat. Safe to call for
   * a standing player (no-op).
   */
  private releaseSeat(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player || player.seatIndex < 0) return;
    if (this.occupancy.get(player.seatIndex) === sessionId) {
      this.occupancy.delete(player.seatIndex);
    }
    player.seatIndex = -1;
  }

  /** True if this connection authenticated as admin (server-side marker only). */
  private isAdmin(client: Client): boolean {
    return (client.userData as AdminMarker | undefined)?.isAdmin === true;
  }
}

/**
 * Resolve the room's client cap. Production uses MAX_CLIENTS (110). A test may
 * set `CV_MAX_CLIENTS` (a positive integer) BEFORE the room is created to shrink
 * the cap for a full-room test — never set in production.
 */
function readMaxClients(): number {
  const raw = process.env.CV_MAX_CLIENTS;
  const n = raw !== undefined ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : MAX_CLIENTS;
}
