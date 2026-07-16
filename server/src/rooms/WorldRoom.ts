import { Room, type Client, type AuthContext } from "colyseus";
import { Player, WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import {
  MAX_CLIENTS,
  PATCH_RATE_MS,
  MOVE_MAX_MSGS_PER_SEC,
  MOVE_ELAPSED_CEIL_MS,
  CHAT_RATE,
  EMOJI_RATE,
  SPAWN_POINT,
  SPAWN_JITTER,
  WORLD_BOUNDS,
  PLAYER_RADIUS,
  KICK_CLOSE_CODE,
  RECONNECT_WINDOW_S,
} from "@caysonverse/shared/constants";
import { SEATS } from "@caysonverse/shared/worldMap";
import { validateMove } from "./movement";
import { validateSit } from "./seating";
import { validateJoinOptions } from "./joinValidation";
import { sanitizeChat } from "./chat";
import { sanitizeAnnounce } from "./announce";
import { validateEmojiIndex } from "./emoji";
import { RateWindow } from "./rateLimit";
import { DenySet } from "./denySet";
import { resolveClientIp } from "./clientIp";
import { compareAdminCode, AdminAttemptLimiter } from "./adminAuth";

/** Korean notice sent to a sender whose chat was dropped for exceeding the rate. */
const CHAT_TOO_FAST = "메시지가 너무 빨라요. 잠시 후 다시 시도해주세요.";

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

/** Server-side per-connection marker. NEVER synchronized into schema state. */
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

/** Per-client bookkeeping (not part of synced state). */
interface ClientTracking {
  /** ms timestamp of this client's last accepted move (seeded at join). */
  lastAcceptedAt: number;
  /** Sliding-window rate cap for move messages. */
  rate: RateWindow;
  /** Sliding-window rate cap for chat messages (3 per 5s). */
  chatRate: RateWindow;
  /** Sliding-window rate cap for emoji reactions (1 per 500ms). */
  emojiRate: RateWindow;
}

/**
 * The authoritative world room.
 *
 * Thin by design: it wires up Colyseus lifecycle, owns timing (clock + rate
 * window), and applies the result of the pure validators
 * (`validateJoinOptions`, `validateMove`). All movement/nickname rules live in
 * those modules so they stay unit-testable.
 *
 * Rejection policy (from the design, binding): invalid move messages are
 * DROPPED silently — never partially applied, never a disconnect. Invalid join
 * options reject the join by throwing (the client receives the Korean error).
 */
export class WorldRoom extends Room<{ state: WorldState }> {
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

  private readonly tracking = new Map<string, ClientTracking>();

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
    this.onMessage(MessageType.Move, (client, payload) => {
      this.handleMove(client, payload);
    });
    this.onMessage(MessageType.Chat, (client, payload) => {
      this.handleChat(client, payload);
    });
    this.onMessage(MessageType.Emoji, (client, payload) => {
      this.handleEmoji(client, payload);
    });
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
    // only; the result is a per-connection marker, NEVER schema state.
    const isAdmin = this.authenticateAdmin(options, ip);

    const spawn = this.spawnPosition();
    const player = new Player();
    player.nickname = result.nickname;
    player.character = result.character;
    player.tint = result.tint;
    player.x = spawn.x;
    player.z = spawn.z;
    player.yaw = 0;
    player.connected = true;

    this.state.players.set(client.sessionId, player);
    const marker: AdminMarker = { isAdmin, ip, nickname: result.nickname };
    client.userData = marker;
    this.tracking.set(client.sessionId, {
      lastAcceptedAt: this.now(),
      rate: new RateWindow(MOVE_MAX_MSGS_PER_SEC),
      chatRate: new RateWindow(CHAT_RATE.count, CHAT_RATE.windowMs),
      emojiRate: new RateWindow(EMOJI_RATE.count, EMOJI_RATE.windowMs),
    });
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
   * Unexpected disconnect (Colyseus 0.17 lifecycle). Fires for any non-consented
   * close. We keep the player in state but mark `connected = false` (drives the
   * client's 50%-opacity ghost) and open a reconnection window with
   * `allowReconnection(client, RECONNECT_WINDOW_S)`. The framework tracks that
   * deferred: on a successful reconnect it calls `onReconnect`; on window expiry
   * it calls `onLeave` (permanent removal). We deliberately do NOT await it here
   * (the idiomatic 0.17 onDrop pattern — the framework owns the deferred).
   *
   * A KICK (close code 4001) is NOT a transient drop: we open NO window, so the
   * subsequent `onLeave` removes the player immediately with no ghost.
   */
  onDrop(client: Client, code?: number): void {
    if (code === KICK_CLOSE_CODE) return; // kicked → no reconnection window

    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    // Fire-and-forget: the framework attaches its own handlers to this deferred
    // (resolve → onReconnect, reject/expiry → onLeave). Guard the rejection so a
    // window expiry never surfaces as an unhandled rejection.
    void this.allowReconnection(client, this.reconnectWindowSeconds()).catch(() => {});
  }

  /**
   * A dropped client re-established the SAME session within the window. Its
   * player never left state, so position/identity are already correct — we only
   * clear the ghost flag.
   */
  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    // Reset the move-speed clock so the disconnect gap (up to the reconnection
    // window) is not spendable as a one-shot displacement budget on the first
    // post-reconnect move (anti-teleport, D1). The handleMove ceiling also bounds
    // this, but resetting keeps elapsed honest from the moment the session resumes.
    const track = this.tracking.get(client.sessionId);
    if (track) track.lastAcceptedAt = this.now();
  }

  /**
   * Permanent departure: a consented leave, a kick (4001), or a reconnection
   * window that expired. Remove the player from state and drop its bookkeeping.
   */
  onLeave(client: Client): void {
    // Free the seat FIRST (the single cleanup path for every permanent removal:
    // consented leave, kick, and reconnection-window expiry all land here). A
    // transient drop does NOT reach onLeave (onDrop opens a window), so a ghost
    // keeps its seat as required.
    this.releaseSeat(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.tracking.delete(client.sessionId);
  }

  /**
   * Reconnection grace window in seconds. Production is RECONNECT_WINDOW_S (20);
   * `CV_RECONNECT_WINDOW_S` is a TEST-ONLY override so an integration test can
   * force a sub-second expiry without waiting 20 real seconds or touching the
   * production constant.
   */
  private reconnectWindowSeconds(): number {
    const raw = process.env.CV_RECONNECT_WINDOW_S;
    const seconds = raw !== undefined ? Number(raw) : NaN;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : RECONNECT_WINDOW_S;
  }

  private handleMove(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return; // no seat yet / already left → drop

    // Seated → moves are dropped silently. Standing up is an explicit Stand
    // message (design 14): while seated the player is fully server-positioned.
    if (player.seatIndex >= 0) return;

    const now = this.now();

    // Step 2: per-client rate cap (drop floods silently). Kept ahead of the
    // pure validator so malformed floods are throttled too; a dropped message
    // never consumes a slot, so legal traffic is unaffected.
    if (!track.rate.tryAccept(now)) return;

    // Steps 1,3,4,5: shape + speed + bounds + yaw, decided purely.
    // Cap elapsed to a small ceiling (anti-teleport, D1): lastAcceptedAt is
    // client-influenceable, so an idle/reconnect gap must NOT translate into a
    // world-spanning one-shot displacement budget. The validator then floors it.
    const elapsed = Math.min(now - track.lastAcceptedAt, MOVE_ELAPSED_CEIL_MS);
    const next = validateMove({ x: player.x, z: player.z }, payload, elapsed);
    if (next === null) return; // invalid → drop whole message

    // Step 6: apply.
    player.x = next.x;
    player.z = next.z;
    player.yaw = next.yaw;
    track.lastAcceptedAt = now;
  }

  /**
   * Chat pipeline (binding order): sender must have a seat → per-client rate cap
   * (3 per 5s; exceeded → drop + personal Korean notice) → pure sanitize (garbage
   * → drop SILENTLY, no notice) → broadcast to everyone as a transient event.
   * Chat never touches synced schema state.
   */
  private handleChat(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return; // no seat yet / already left → drop

    // Rate cap ahead of sanitize (mirrors move): floods are throttled with a
    // personal notice, and a rate-dropped message never consumes a slot.
    if (!track.chatRate.tryAccept(this.now())) {
      client.send(MessageType.ChatRejected, { reason: CHAT_TOO_FAST });
      return;
    }

    const text = sanitizeChat((payload as { text?: unknown } | null | undefined)?.text);
    if (text === null) return; // empty/oversized/garbage → silent drop

    this.broadcast(MessageType.Chat, { sid: client.sessionId, name: player.nickname, text });
  }

  /**
   * Emoji pipeline (binding order): sender must have a seat → per-client rate
   * cap (1 per 500ms; exceeded → drop, SILENTLY — it's a button, not typed
   * effort, so unlike chat there is no personal notice) → pure index validate
   * (garbage → drop silently) → broadcast to everyone as a transient event.
   * Emoji never touches synced schema state.
   */
  private handleEmoji(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return; // no seat yet / already left → drop

    if (!track.emojiRate.tryAccept(this.now())) return; // flood → silent drop

    const index = validateEmojiIndex(payload);
    if (index === null) return; // invalid/garbage → silent drop

    this.broadcast(MessageType.Emoji, { sid: client.sessionId, index });
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

  /** Wall-clock time in ms. Isolated here so the pure validators never read it. */
  private now(): number {
    return Date.now();
  }

  /**
   * Spawn point plus uniform random jitter within `SPAWN_JITTER` radius, clamped
   * to WORLD_BOUNDS so joiners don't stack yet always land in-bounds.
   */
  private spawnPosition(): { x: number; z: number } {
    const radius = SPAWN_JITTER * Math.sqrt(Math.random()); // uniform over the disk
    const angle = Math.random() * Math.PI * 2;
    const x = SPAWN_POINT.x + radius * Math.cos(angle);
    const z = SPAWN_POINT.z + radius * Math.sin(angle);
    return {
      x: clamp(x, WORLD_BOUNDS.minX + PLAYER_RADIUS, WORLD_BOUNDS.maxX - PLAYER_RADIUS),
      z: clamp(z, WORLD_BOUNDS.minZ + PLAYER_RADIUS, WORLD_BOUNDS.maxZ - PLAYER_RADIUS),
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
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
