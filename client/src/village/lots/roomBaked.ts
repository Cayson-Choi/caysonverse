/**
 * Whether the room the player is in carries its own baked light (L6 lightmap, LotRoom.tsx): DayNight then turns the
 * outdoor sky and key down further inside (the bake already holds the daylight through the windows and its bounce),
 * so the baked shadows under the pews and in the corners are not washed out by the live fill.
 */
export const roomBaked = { on: false };

/** The live sky (hemisphere) and key in a baked room, as a share of what an unbaked room keeps (LOT_ROOM_LIGHT). */
export const BAKED_ROOM_LIGHT = { hemi: 0.35, key: 0.6 } as const;
