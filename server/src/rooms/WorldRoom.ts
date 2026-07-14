import { Room, type Client, type AuthContext } from "colyseus";
import { Player, WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import {
  MAX_CLIENTS,
  PATCH_RATE_MS,
  MOVE_MAX_MSGS_PER_SEC,
  CHAT_RATE,
  EMOJI_RATE,
  SPAWN_POINT,
  SPAWN_JITTER,
  WORLD_BOUNDS,
  PLAYER_RADIUS,
  KICK_CLOSE_CODE,
} from "@caysonverse/shared/constants";
import { validateMove } from "./movement";
import { validateJoinOptions } from "./joinValidation";
import { sanitizeChat } from "./chat";
import { sanitizeAnnounce } from "./announce";
import { validateEmojiIndex } from "./emoji";
import { RateWindow } from "./rateLimit";
import { DenySet } from "./denySet";
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
  maxClients = MAX_CLIENTS;
  patchRate = PATCH_RATE_MS;
  state = new WorldState();

  private readonly tracking = new Map<string, ClientTracking>();

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
  }

  /**
   * Runs BEFORE onJoin. The ONLY place the client IP is exposed by the installed
   * Colyseus 0.17: `context.ip` is derived from `x-forwarded-for` / `x-client-ip`
   * / `x-real-ip` headers (see default_routes.ts) — not the socket — so it is
   * commonly `undefined` in dev/test/no-proxy. We resolve it here and hand it to
   * onJoin via the returned auth object. We never reject here (that keeps all
   * user-facing rejections in onJoin, where the Korean message is known to
   * propagate to the client); returning a truthy object always allows the seat.
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

    // Kick deny list: a kicked player cannot rejoin (IP match when available,
    // else the normalized-nickname fallback). Checked before admin so a banned
    // connection never even reaches code verification.
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

  onLeave(client: Client): void {
    // Reconnection (allowReconnection/onDrop) is Task 11 — just remove for now.
    this.state.players.delete(client.sessionId);
    this.tracking.delete(client.sessionId);
  }

  private handleMove(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return; // no seat yet / already left → drop

    const now = this.now();

    // Step 2: per-client rate cap (drop floods silently). Kept ahead of the
    // pure validator so malformed floods are throttled too; a dropped message
    // never consumes a slot, so legal traffic is unaffected.
    if (!track.rate.tryAccept(now)) return;

    // Steps 1,3,4,5: shape + speed + bounds + yaw, decided purely.
    const elapsed = now - track.lastAcceptedAt;
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
   * denySet (IP when available, ALWAYS the normalized nickname too) so a rejoin
   * is blocked, then close the target's connection with KICK_CLOSE_CODE (4001) —
   * the client maps exactly that code to the kicked UX.
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
    this.denySet.add({ ip: targetMarker?.ip ?? null, nickname });

    target.leave(KICK_CLOSE_CODE);
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
 * Normalize the auth-context IP to a single string, or null when unavailable.
 * `x-forwarded-for` may carry a comma-separated chain (or arrive as an array) —
 * the left-most entry is the originating client. Anything empty ⇒ null (the
 * caller then uses the global limiter key + nickname-only denySet fallback).
 */
function resolveClientIp(context: AuthContext | undefined): string | null {
  const raw = context?.ip;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string") return null;
  const ip = first.split(",")[0]?.trim() ?? "";
  return ip.length > 0 ? ip : null;
}
