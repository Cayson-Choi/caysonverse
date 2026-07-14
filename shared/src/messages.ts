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

/** Payload type for each message id, keyed by MessageType. */
export interface MessagePayloads {
  [MessageType.Move]: MovePayload;
  [MessageType.Chat]: ChatPayload;
  [MessageType.ChatRejected]: ChatRejectedPayload;
  [MessageType.Emoji]: EmojiPayload;
}
