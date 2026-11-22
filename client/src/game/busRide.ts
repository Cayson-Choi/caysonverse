/**
 * The own avatar's place in the village bus (owner 2026-11-15): the schema's `Player.busSeat` and bus-local point for the
 * local player, mirrored here by remoteSync and read every frame by LocalPlayer, the rider camera and the ride panel.
 * -1 = not aboard; 0 = aboard and free (walking / standing in the aisle); 1.. = a seat (shared
 * village/busCabin.ts busPlaceOf). `ahead` / `right` / `yaw`: the server's point in the bus's own frame (the walk predicts
 * its own and reconciles against these). Remotes keep theirs on their store record (remoteStore.ts).
 */
export const selfBusRide = { slot: -1, ahead: 0, right: 0, yaw: 0 };

/**
 * My own predicted point while I walk in the aisle (LocalPlayer integrates it every frame and sends BusMove; the schema's
 * point above is the server's, a round trip behind). The camera and the ride's prompts read this one while I am free.
 */
export const busWalk = { ahead: 0, right: 0, yaw: 0, valid: false };

/** My point in the bus's frame now: the predicted walk while free, the seat's while sitting. */
export function riderBusPoint(self: { ahead: number; right: number }, kind: "free" | "seat", seat?: { ahead: number; right: number }): { ahead: number; right: number } {
  if (kind === "free") return busWalk.valid ? busWalk : self;
  return seat ?? self;
}

/**
 * Bus v3 (owner 2026-11-16: "버스안에서 조금씩 이동해서 원하는 자리로 이동해서 … 어디든 앉을 수 있게"): a seat the rider tapped or
 * clicked (an index into BUS_SEATS), or -1. LocalPlayer walks the rider down the aisle to the seat's approach point and stops
 * there (owner 2026-11-17: no auto-sit — E / the 앉기 button sits, and offers that seat: busSeatPreferred); a key or the stick
 * clears it.
 */
export const busSeatGoal = { index: -1, at: 0 };

/**
 * Owner 2026-11-18 ("버스안에서 이동이 잘 안되고"): a spot on the cabin's floor the rider clicked or tapped (bus-local), walked to by
 * LocalPlayer like a seat goal (down the aisle, then across); `active` false when there is none. A key or the stick clears it.
 */
export const busWalkGoal = { ahead: 0, right: 0, at: 0, active: false };

/**
 * The seat a tap walked the rider to (owner 2026-11-17: a tap never sits by itself): while the rider can still sit in it from
 * where they stand, the E key / the 앉기 button offers THAT seat, whatever else is near. -1: none.
 */
export const busSeatPreferred = { index: -1 };

/**
 * A request for the in-bus camera to turn to a quick view (the panel's ◀ 앞 ▶ 뒤 buttons): the orbit yaw relative to the
 * bus's heading to ease to, or null. CameraRig eases `orbit.yaw` to it while riding and clears it on arrival (or when the
 * player drags).
 */
export const busCamGoal: { yaw: number | null } = { yaw: null };

/** The quick views' camera azimuths (rad, relative to the bus's heading): the camera sits where the avatar looks FROM. */
export const BUS_VIEW_YAW = {
  /** over the shoulder, looking down the bus towards its front */
  front: Math.PI,
  /** looking towards the rear */
  back: 0,
  /** looking out of the left windows (the camera on the doors' side looking left) */
  left: -Math.PI / 2,
  /** looking out of the right windows, the door side's (the camera on the left looking right) */
  right: Math.PI / 2,
} as const;

/**
 * What the in-bus camera did this frame (CameraRig writes, LocalPlayer and VillageBus read): whether it is the rider's own
 * eye (the avatar is hidden), and the eye / head / chest in the bus's own frame (the fixtures that come between them fade).
 */
export const busCamState = {
  active: false,
  firstPerson: false,
  eye: [0, 0, 0] as [number, number, number],
  head: [0, 0, 0] as [number, number, number],
  chest: [0, 0, 0] as [number, number, number],
  /** the arm's length (m) after the cabin shortened it */
  arm: 0,
  /** the third-person lens is so near the head that the own body is hidden (transitCamera.ts busSelfHidden) */
  selfHidden: false,
  /** the local avatar's three.js group (e2e measures its share of the screen); null off the bus */
  avatar: null as { visible: boolean } | null,
};

