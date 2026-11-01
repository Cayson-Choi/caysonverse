import { Room, type Client } from "colyseus";
import type { MapSchema } from "@colyseus/schema";
import type { Player } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import {
  MOVE_MAX_MSGS_PER_SEC,
  MOVE_ELAPSED_CEIL_MS,
  CHAT_RATE,
  EMOJI_RATE,
  JUMP_RATE,
  TYPING_RATE,
  KICK_CLOSE_CODE,
  RECONNECT_WINDOW_S,
} from "@caysonverse/shared/constants";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
import { validateMove } from "./movement";
import { sanitizeChat } from "./chat";
import { validateEmojiIndex } from "./emoji";
import { validateTypingPayload } from "./typing";
import { RateWindow } from "./rateLimit";
import { CHAT_NOT_NICE, checkProfanity as checkChatLine, type ProfanityResult } from "./profanity";

// Re-exported so every room built on this base finds its spawn helper here.
export { spawnInDisk } from "./movement";

/** Korean notice sent to a sender whose chat was dropped for exceeding the rate. */
const CHAT_TOO_FAST = "메시지가 너무 빨라요. 잠시 후 다시 시도해주세요.";

/** The part of a room's synced state this base reads and writes. */
export interface PlayersState {
  players: MapSchema<Player>;
}

/**
 * Per-client bookkeeping the base keeps for every seated player (never synced).
 * A room that needs more (WorldRoom's maze-escape clock) widens it through the
 * `T` parameter of `PlayerRoom` and builds it in `createTracking`.
 */
export interface Tracking {
  /** ms timestamp of this client's last accepted move (seeded at join). */
  lastAcceptedAt: number;
  /** Sliding-window rate cap for move messages. */
  rate: RateWindow;
  /** Sliding-window rate cap for chat messages (3 per 5s). */
  chatRate: RateWindow;
  /** Sliding-window rate cap for emoji reactions (1 per 500ms). */
  emojiRate: RateWindow;
  /** Sliding-window rate cap for jumps (1 per JUMP_RATE.windowMs = 800 ms). */
  jumpRate: RateWindow;
  /** Sliding-window rate cap for typing ON (1 per 3s); OFF is never limited. */
  typingRate: RateWindow;
  /**
   * Whether this client's last relayed typing event was ON. Gates the OFF relay
   * (an OFF from a non-typist is dropped) and is cleared when a chat is accepted.
   */
  typing: boolean;
}

/** Fresh base bookkeeping for a player seated at `now` (ms). */
export function baseTracking(now: number): Tracking {
  return {
    lastAcceptedAt: now,
    rate: new RateWindow(MOVE_MAX_MSGS_PER_SEC),
    chatRate: new RateWindow(CHAT_RATE.count, CHAT_RATE.windowMs),
    emojiRate: new RateWindow(EMOJI_RATE.count, EMOJI_RATE.windowMs),
    jumpRate: new RateWindow(JUMP_RATE.count, JUMP_RATE.windowMs),
    typingRate: new RateWindow(TYPING_RATE.count, TYPING_RATE.windowMs),
    typing: false,
  };
}

/**
 * The common room for anything where avatars walk around together: the legacy
 * world (WorldRoom), a class's hub (ClassRoom) and a team's classroom (EscapeRoom).
 *
 * It owns the player messages every such room shares — Move, Chat, Emoji, Jump,
 * Typing — with their rate caps and pure validators, the per-client tracking,
 * and the reconnection lifecycle (onDrop / onReconnect / onLeave). A subclass
 * supplies the map (`geometry`), the spawn rule and the tracking factory, may
 * override the hooks (`canMove`, `afterMove`, `deliverChat`, `checkProfanity`,
 * `onChatBlocked`), and keeps its own joins and room-specific messages. Its
 * `onCreate` must call `registerPlayerMessages()`; its `onJoin` builds the Player
 * and calls `seatPlayer`; a custom `onLeave` must end in `unseatPlayer` (or
 * `super.onLeave`).
 *
 * Rejection policy (binding, unchanged from the world): invalid player messages
 * are DROPPED silently — never partially applied, never a disconnect. The only
 * personal notices are the chat ones: the rate notice and, for a line the
 * profanity filter held back, CHAT_NOT_NICE. A message type nobody registered is
 * dropped the same way (see registerPlayerMessages).
 */
export abstract class PlayerRoom<S extends PlayersState, T extends Tracking = Tracking> extends Room<{
  state: S;
}> {
  /** Per-client bookkeeping, keyed by sessionId; same lifetime as the player in state. */
  protected readonly tracking = new Map<string, T>();

  /** The map the players of this room walk on (bounds + obstacles for every Move). */
  protected abstract geometry(): MapGeometry;

  /** Where a joining player is placed. */
  protected abstract spawnPosition(): { x: number; z: number };

  /**
   * Bookkeeping for a newly seated player. A room on the plain base returns
   * `baseTracking(now)`; a room that widens `T` spreads it and adds its fields.
   */
  protected abstract createTracking(now: number): T;

  /**
   * Wire the shared player messages. Call once from the subclass's onCreate.
   *
   * The `"*"` catch-all (ruling E6) drops any message type that has no handler
   * in this room — a stale client, or a legacy message such as Sit sent to a room
   * without chairs. Without it, production Colyseus answers an unregistered type
   * with `client.leave(4002 WITH_ERROR)`, i.e. the player is thrown out. Colyseus
   * consults the catch-all only when no specific handler exists, so every type
   * registered here or by the subclass keeps its own handler.
   */
  protected registerPlayerMessages(): void {
    this.onMessage(MessageType.Move, (client, payload) => {
      this.handleMove(client, payload);
    });
    this.onMessage(MessageType.Chat, (client, payload) => {
      this.handleChat(client, payload);
    });
    this.onMessage(MessageType.Emoji, (client, payload) => {
      this.handleEmoji(client, payload);
    });
    this.onMessage(MessageType.Jump, (client) => {
      this.handleJump(client);
    });
    this.onMessage(MessageType.Typing, (client, payload) => {
      this.handleTyping(client, payload);
    });
    this.onMessage("*", () => {});
  }

  /**
   * Put `player` into synced state and start its bookkeeping (call from onJoin).
   * "Seat" as in a seat in the room — unrelated to WorldRoom's chairs (Sit/Stand).
   */
  protected seatPlayer(client: Client, player: Player): void {
    this.state.players.set(client.sessionId, player);
    this.tracking.set(client.sessionId, this.createTracking(this.now()));
  }

  /** Remove a player from synced state and drop its bookkeeping. */
  protected unseatPlayer(sessionId: string): void {
    this.state.players.delete(sessionId);
    this.tracking.delete(sessionId);
  }

  /** May this player walk and jump right now? false → Move and Jump are silently dropped. */
  protected canMove(_player: Player): boolean {
    return true;
  }

  /** Runs after each ACCEPTED move, with the new position applied (default: nothing). */
  protected afterMove(_client: Client, _player: Player, _track: T, _now: number): void {}

  /**
   * Hand an accepted, sanitized chat line to its audience. Default: everyone in
   * this room, as a transient event (chat never touches synced state).
   */
  protected deliverChat(client: Client, player: Player, text: string): void {
    this.broadcast(MessageType.Chat, { sid: client.sessionId, name: player.nickname, text });
  }

  /**
   * May this sanitized chat line go out? Default: the Korean profanity filter, in EVERY room on
   * this base — the legacy world included, because the same children use it (ruling E21). A room
   * that must opt out overrides this with `return { ok: true }`; nothing else needs to change.
   */
  protected checkProfanity(text: string): ProfanityResult {
    return checkChatLine(text);
  }

  /**
   * A chat line was held back by `checkProfanity`. The sender has already been told
   * (CHAT_NOT_NICE) and nobody else hears the line. `masked` is the line with each offending
   * word replaced by ● — the original text is deliberately NOT passed on, so it cannot be stored
   * or logged by accident. Default: nothing. ClassRoom and EscapeRoom forward it to the teacher.
   */
  protected onChatBlocked(_client: Client, _player: Player, _masked: string): void {}

  /**
   * Reconnection grace window in seconds. Production is RECONNECT_WINDOW_S (20);
   * `CV_RECONNECT_WINDOW_S` is a TEST-ONLY override so an integration test can
   * force a sub-second expiry without waiting 20 real seconds or touching the
   * production constant.
   */
  protected reconnectWindowSeconds(): number {
    const raw = process.env.CV_RECONNECT_WINDOW_S;
    const seconds = raw !== undefined ? Number(raw) : NaN;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : RECONNECT_WINDOW_S;
  }

  /**
   * Unexpected disconnect (Colyseus 0.17 lifecycle). Fires for any non-consented
   * close. We keep the player in state but mark `connected = false` (drives the
   * client's 50%-opacity ghost) and open a reconnection window with
   * `allowReconnection(client, reconnectWindowSeconds())`. The framework tracks
   * that deferred: on a successful reconnect it calls `onReconnect`; on window
   * expiry it calls `onLeave` (permanent removal). We deliberately do NOT await it
   * here (the idiomatic 0.17 onDrop pattern — the framework owns the deferred).
   *
   * A KICK (KICK_CLOSE_CODE) is NOT a transient drop: we open NO window, so the
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
   * Permanent departure: a consented leave, a kick, or a reconnection window that
   * expired. Default: remove the player and its bookkeeping. A room with more
   * per-player resources frees them first, then calls this (or `unseatPlayer`).
   */
  onLeave(client: Client): void {
    this.unseatPlayer(client.sessionId);
  }

  /** Wall-clock time in ms. Isolated here so the pure validators never read it. */
  protected now(): number {
    return Date.now();
  }

  private handleMove(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return; // no seat yet / already left → drop

    // A player the room holds in place (WorldRoom: seated) is fully
    // server-positioned → moves are dropped silently.
    if (!this.canMove(player)) return;

    const now = this.now();

    // Step 2: per-client rate cap (drop floods silently). Kept ahead of the
    // pure validator so malformed floods are throttled too; a dropped message
    // never consumes a slot, so legal traffic is unaffected.
    if (!track.rate.tryAccept(now)) return;

    // Steps 1,3,4,5: shape + speed + bounds + yaw, decided purely on this room's map.
    // Cap elapsed to a small ceiling (anti-teleport, D1): lastAcceptedAt is
    // client-influenceable, so an idle/reconnect gap must NOT translate into a
    // world-spanning one-shot displacement budget. The validator then floors it.
    const elapsed = Math.min(now - track.lastAcceptedAt, MOVE_ELAPSED_CEIL_MS);
    const next = validateMove({ x: player.x, z: player.z }, payload, elapsed, this.geometry());
    if (next === null) return; // invalid → drop whole message

    // Step 6: apply.
    player.x = next.x;
    player.z = next.z;
    player.yaw = next.yaw;
    track.lastAcceptedAt = now;

    // Room-specific judgment on the ACCEPTED position only (server-authoritative).
    this.afterMove(client, player, track, now);
  }

  /**
   * Chat pipeline (binding order): sender must have a seat → per-client rate cap
   * (3 per 5s; exceeded → drop + personal Korean notice) → pure sanitize (garbage
   * → drop SILENTLY, no notice) → checkProfanity (blocked → personal CHAT_NOT_NICE
   * notice to the sender only + onChatBlocked, never broadcast) → deliverChat
   * (default: everyone, as a transient event). Chat never touches synced schema
   * state.
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

    // A chat — accepted or blocked — ends the typing state; receivers clear their own "…" on
    // Chat (the client sends its OFF before the line), so a late OFF from this client is dropped.
    // Cleared BEFORE the room's hooks run, so a hook that throws cannot leave typing on.
    track.typing = false;

    const verdict = this.checkProfanity(text);
    if (verdict.ok) {
      this.deliverChat(client, player, text);
    } else {
      // Held back: only the sender hears about it, and nothing is broadcast. The line itself is
      // never logged or stored — the hook gets the masked version only.
      client.send(MessageType.ChatRejected, { reason: CHAT_NOT_NICE });
      this.onChatBlocked(client, player, verdict.masked);
    }
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
   * Jump pipeline (binding order): sender must be in the room's state → a sender
   * that may not move (`canMove` false — WorldRoom: seated, a server-positioned
   * avatar cannot jump) is dropped silently → per-client rate cap (1 per
   * JUMP_RATE.windowMs = 800 ms; exceeded → drop silently, it's a key press) →
   * broadcast `{ sid }` to everyone EXCEPT the sender as a transient event (the
   * sender already hopped locally the instant it pressed). The payload is never
   * read: the sid always comes from the connection. y is server-fixed (no schema
   * field), so a jump is purely a cosmetic broadcast.
   */
  private handleJump(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return; // no seat yet / already left → drop

    if (!this.canMove(player)) return; // held in place → silent drop

    if (!track.jumpRate.tryAccept(this.now())) return; // flood → silent drop

    this.broadcast(MessageType.Jump, { sid: client.sessionId }, { except: client });
  }

  /**
   * Typing pipeline (binding order): sender must be in the room's state → pure
   * payload validate (garbage → drop silently; ahead of the rate cap because the
   * cap only applies to ON, and a malformed message must not consume a slot) →
   *  - ON: per-client rate cap (1 per 3s; exceeded → drop silently), then mark
   *    `track.typing` and broadcast `{ sid, on: true }`;
   *  - OFF: relayed ONLY if the sender is currently typing (else silent drop),
   *    then clear `track.typing` and broadcast `{ sid, on: false }`. OFF is
   *    never rate-limited — it must always get through to clear the indicator.
   * Both go to everyone EXCEPT the typist (nobody shows their own "…").
   * Typing never touches synced schema state.
   */
  private handleTyping(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return; // no seat yet / already left → drop

    const on = validateTypingPayload(payload);
    if (on === null) return; // invalid/garbage → silent drop

    if (on) {
      if (!track.typingRate.tryAccept(this.now())) return; // flood → silent drop
      track.typing = true;
    } else {
      if (!track.typing) return; // OFF without a prior ON → silent drop
      track.typing = false;
    }

    this.broadcast(MessageType.Typing, { sid: client.sessionId, on }, { except: client });
  }
}
