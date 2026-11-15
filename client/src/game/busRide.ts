/**
 * The own avatar's place in the village bus (owner 2026-11-15): the schema's `Player.busSeat` and bus-local point for the
 * local player, mirrored here by remoteSync and read every frame by LocalPlayer, the rider camera and the ride panel.
 * -1 = not aboard; 0 = aboard and free (walking / standing in the aisle); 1.. = a seat or a hold spot (shared
 * village/busCabin.ts busPlaceOf). `ahead` / `right` / `yaw`: the server's point in the bus's own frame (the walk predicts
 * its own and reconciles against these). Remotes keep theirs on their store record (remoteStore.ts).
 */
export const selfBusRide = { slot: -1, ahead: 0, right: 0, yaw: 0 };

/**
 * My own predicted point while I walk in the aisle (LocalPlayer integrates it every frame and sends BusMove; the schema's
 * point above is the server's, a round trip behind). The camera and the ride's prompts read this one while I am free.
 */
export const busWalk = { ahead: 0, right: 0, yaw: 0, valid: false };

/** My point in the bus's frame now: the predicted walk while free, the seat's or the hold spot's while sitting or holding. */
export function riderBusPoint(self: { ahead: number; right: number }, kind: "free" | "seat" | "hold", seat?: { ahead: number; right: number }): { ahead: number; right: number } {
  if (kind === "free") return busWalk.valid ? busWalk : self;
  return seat ?? self;
}

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
};

/** How the world orbit's zoom maps to the arm in the bus (m): the wheel / pinch keep working, the bus has its own range. */
export const BUS_ARM = { near: 0.7, far: 2.6, orbitNear: 3.2, orbitFar: 10 } as const;

/** The camera's elevation over the head (rad) from the world orbit's pitch. */
export function busElevation(orbitPitch: number): number {
  return Math.max(-0.5, Math.min(0.85, orbitPitch - 0.35));
}

/** The arm (m) the orbit's zoom asks for in the bus. */
export function busArmFor(orbitDistance: number, portrait: boolean): number {
  const k = Math.max(0, Math.min(1, (orbitDistance - BUS_ARM.orbitNear) / (BUS_ARM.orbitFar - BUS_ARM.orbitNear)));
  return (BUS_ARM.near + (BUS_ARM.far - BUS_ARM.near) * k) * (portrait ? 1.12 : 1);
}
