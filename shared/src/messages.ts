// Browser-safe message contract shared between client and server.
// Message *values* live here; Schema *state* lives in schema.ts (server-only).
// The concrete room messages are wired up in Task 3.

/** Identifiers for client <-> server room messages. */
export const MessageType = {
  // e.g. Move: "move", Chat: "chat" — added in Task 3.
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** Payload type for each message id, keyed by MessageType. Filled in Task 3. */
export interface MessagePayloads {}
