/**
 * The own avatar's place in the village bus (owner 2026-11-15: after boarding, the avatar must be in the bus, not left
 * on the pad): the schema's `Player.busSeat` for the local player, mirrored here by remoteSync (as `seatIndex` is into
 * the SeatState) and read every frame by LocalPlayer and the ride camera. -1 = not on the bus. Remotes keep theirs on
 * their store record (remoteStore.ts `busSeat`).
 */
export const selfBusRide = { slot: -1 };
