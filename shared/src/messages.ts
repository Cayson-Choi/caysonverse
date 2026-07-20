// Browser-safe message contract shared between client and server.
// Message *values* live here; Schema *state* lives in schema.ts (server-only).

/** Identifiers for client <-> server room messages. */
export const MessageType = {
  Move: "move",
  /** Client -> server: submit a chat line. Server -> all: relay a chat line. */
  Chat: "chat",
  /** Server -> one client: a personal notice that their chat line was rejected. */
  ChatRejected: "chat_rejected",
  /** Client -> server: fire an emoji reaction. Server -> all: relay a reaction. */
  Emoji: "emoji",
  /** Client(admin) -> server: set/clear the announcement banner (schema state). */
  Announce: "announce",
  /** Client(admin) -> server: kick a target player by session id. */
  Kick: "kick",
  /** Client -> server: request to sit on a specific seat index. */
  Sit: "sit",
  /** Client -> server: request to stand up from the current seat. */
  Stand: "stand",
  /** Server -> one client: a personal notice that their sit request was rejected. */
  SitRejected: "sit_rejected",
  /**
   * Server -> all clients: a room-wide system notice (dimmed chat-log row for
   * EVERYONE). Used by the maze escape broadcast. Carries the escaper's `sid` so
   * the client can fire the local 🎉 celebration on self without a new sync.
   */
  System: "system",
  /**
   * Client -> server: EXPLICIT return-to-lobby request from the maze goal
   * chamber (design 34 후속 — 발주자: 가운데 도달만으로 자동 포탈 금지, 큐리와
   * 대화 후 버튼으로만). Server validates the sender actually stands in the
   * chamber (shared canUsePortal) before teleporting; elsewhere it is a no-op.
   */
  PortalReturn: "portal_return",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** Client -> server request to update the sender's position and facing. */
export interface MovePayload {
  x: number;
  z: number;
  yaw: number;
}

/** Client -> server: a chat line the sender typed (validated server-side). */
export interface ChatPayload {
  text: string;
}

/** Server -> every client: an accepted chat line, tagged with its author. */
export interface ChatBroadcast {
  /** Sender session id (matches the avatar's key in world state). */
  sid: string;
  /** Sender nickname, resolved from state at broadcast time. */
  name: string;
  /** The sanitized message text. */
  text: string;
}

/** Server -> the sender only: why their chat line was dropped (Korean reason). */
export interface ChatRejectedPayload {
  reason: string;
}

/** Client -> server: an emoji reaction the sender fired (index into EMOJIS). */
export interface EmojiPayload {
  index: number;
}

/** Server -> every client: an accepted emoji reaction, tagged with its author. */
export interface EmojiBroadcast {
  /** Sender session id (matches the avatar's key in world state). */
  sid: string;
  /** Index into EMOJIS. */
  index: number;
}

/**
 * Client(admin) -> server: set the announcement banner. An empty (or
 * whitespace-only) string is VALID and CLEARS the banner. The server verifies
 * the sender is admin (server-side marker, never in schema) and drops otherwise.
 */
export interface AnnouncePayload {
  text: string;
}

/** Client(admin) -> server: kick the player owning `sid`. */
export interface KickPayload {
  /** Target session id (the admin cannot kick themselves). */
  sid: string;
}

/** Client -> server: request to sit on seat `seatIndex` (0..SEATS.length-1). */
export interface SitPayload {
  seatIndex: number;
}

/** Client -> server: request to stand up. Carries no data. */
export type StandPayload = Record<string, never>;

/** Server -> the sender only: why their sit request was dropped (Korean reason). */
export interface SitRejectedPayload {
  reason: string;
}

/**
 * Server -> every client: a system notice rendered as a dimmed chat-log row for
 * all. `sid` (when present) is the session the notice is ABOUT — the client
 * compares it to its own session id to fire a local self-celebration.
 */
export interface SystemBroadcast {
  text: string;
  sid?: string;
}

/** Payload type for each message id, keyed by MessageType. */
export interface MessagePayloads {
  [MessageType.Move]: MovePayload;
  [MessageType.Chat]: ChatPayload;
  [MessageType.ChatRejected]: ChatRejectedPayload;
  [MessageType.Emoji]: EmojiPayload;
  [MessageType.Announce]: AnnouncePayload;
  [MessageType.Kick]: KickPayload;
  [MessageType.Sit]: SitPayload;
  [MessageType.Stand]: StandPayload;
  [MessageType.SitRejected]: SitRejectedPayload;
  [MessageType.System]: SystemBroadcast;
}
