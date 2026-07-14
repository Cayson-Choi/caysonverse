// Browser-safe message contract shared between client and server.
// Message *values* live here; Schema *state* lives in schema.ts (server-only).

/** Identifiers for client <-> server room messages. */
export const MessageType = {
  Move: "move",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** Client -> server request to update the sender's position and facing. */
export interface MovePayload {
  x: number;
  z: number;
  yaw: number;
}

/** Payload type for each message id, keyed by MessageType. */
export interface MessagePayloads {
  [MessageType.Move]: MovePayload;
}
