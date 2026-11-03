/**
 * 케이슨 마을 room messages — browser-safe (values and types only), shared by the server and the client.
 * World messages stay in ../messages.ts and the class/escape ones in ../escape/messages.ts; a village
 * client also hears the world's Move/Chat/Emoji/Jump/Typing (VillageRoom is a PlayerRoom), so a value here
 * must never equal one of those (a test pins it).
 */

/** VillageRoom messages (client → server). */
export const VillageMsg = {
  /**
   * The sender uses the door they stand at: the memorial hall's front door from the village, or the way
   * out from inside. The server checks the distance to the door pad (pad radius + a small reach) and a
   * 1-per-second rate, moves the player to the other side and flips `Player.area`. Anything else is
   * dropped silently.
   */
  UseDoor: "UseDoor",
} as const;

export type VillageMsg = (typeof VillageMsg)[keyof typeof VillageMsg];

/** Client → server: use the door at hand. Carries no data (the server never reads it). */
export type UseDoorPayload = Record<string, never>;

/** Payload type for each VillageMsg value. */
export interface VillageMsgPayloads {
  [VillageMsg.UseDoor]: UseDoorPayload;
}
