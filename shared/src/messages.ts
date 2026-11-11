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
  /**
   * Client -> server: the sender jumped. Server -> everyone except the sender: relay
   * tagged with the sender's sid (the sender hopped locally). A transient event
   * (y is server-fixed, never schema state).
   */
  Jump: "jump",
  /**
   * Client -> server: the sender started/stopped typing a chat line. Server ->
   * everyone except the sender: relay `{ sid, on }`. A transient event, never schema state.
   */
  Typing: "typing",
  /** Client -> server: request to board or leave the scheduled village bus. */
  BusRide: "bus_ride",
  /** Server -> every client: authoritative scheduled bus pose and signal state. */
  BusState: "bus_state",
  /** Server -> one client: why a bus boarding request was rejected. */
  BusRejected: "bus_rejected",
  /** Server -> one client: the sender's authoritative boarded state. */
  BusRideState: "bus_ride_state",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** Client -> server request to update the sender's position and facing. */
export interface MovePayload {
  x: number;
  z: number;
  yaw: number;
  /**
   * The sender's own clock (whole ms, `performance.now()`) on the frame it stood at this pose. The server
   * echoes it to everyone as `Player.moveT`, so the other clients replay the walk at the times it really
   * happened instead of at the times the patches reached them (network jitter, 10 Hz patch grouping).
   * Optional: an older client sends none and is drawn by arrival time.
   */
  t?: number;
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
 * the sender is admin (server-side `isAdmin` marker, not the synced
 * `Player.role`) and drops otherwise.
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

/** Client -> server: the sender jumped. Carries no data (the server never reads it). */
export type JumpPayload = Record<string, never>;

/** Server -> every client: someone jumped, tagged with the jumper's sid. */
export interface JumpBroadcast {
  /** Jumper session id (matches the avatar's key in world state). */
  sid: string;
}

/** Client -> server: the sender started (`on: true`) or stopped typing a chat line. */
export interface TypingPayload {
  on: boolean;
}

/** Server -> every client: someone started/stopped typing, tagged with their sid. */
export interface TypingBroadcast {
  /** Typist session id (matches the avatar's key in world state). */
  sid: string;
  on: boolean;
}

export interface BusRidePayload {
  action: "board" | "leave";
}

export interface BusStatePayload {
  tripId: number;
  status: "inTransit" | "atStop" | "boarding";
  progress: number;
  x: number;
  z: number;
  yaw: number;
  signal: "green" | "amber" | "red";
  /** Separate pedestrian crossing phase; optional for old clients during rolling deploys. */
  pedestrianSignal?: "walk" | "flashing" | "stop";
}

export interface BusRejectedPayload {
  reason: string;
}

export interface BusRideStatePayload {
  boarded: boolean;
  tripId: number;
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
  // Jump/Typing travel both ways under one id (request up, relay down), so each
  // entry lists both shapes.
  [MessageType.Jump]: JumpPayload | JumpBroadcast;
  [MessageType.Typing]: TypingPayload | TypingBroadcast;
  [MessageType.BusRide]: BusRidePayload;
  [MessageType.BusState]: BusStatePayload;
  [MessageType.BusRejected]: BusRejectedPayload;
  [MessageType.BusRideState]: BusRideStatePayload;
}
