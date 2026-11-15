import type { TransitPose } from "@caysonverse/shared/village/transit";
import { busPlace } from "@caysonverse/shared/village/busSeats";

export interface TransitCameraPose {
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

/**
 * A modest passenger eye point, just behind the front half of the cabin, aimed
 * through the right-side window. The bus route yaw uses the same `atan2(dx,dz)`
 * convention as this helper, so the view follows a moving bus without a snap.
 */
export function transitWindowCamera(pose: TransitPose, eyeHeight = 1.62): TransitCameraPose {
  const forwardX = Math.sin(pose.yaw);
  const forwardZ = Math.cos(pose.yaw);
  const rightX = Math.cos(pose.yaw);
  const rightZ = -Math.sin(pose.yaw);
  const x = pose.x + forwardX * 0.8;
  const z = pose.z + forwardZ * 0.8;
  return {
    x,
    y: eyeHeight,
    z,
    targetX: x + rightX * 9,
    targetY: eyeHeight - 0.08,
    targetZ: z + rightZ * 9,
  };
}


/**
 * The rider's own view (owner 2026-11-15: the rider is in the bus now, busSeats.ts): from high in the aisle a couple of
 * metres behind the rider's place, over its shoulder and out of the window on its side (the door side for a middle
 * seat; further back on a portrait phone), so the player sees themself sitting in the bus and the village going by. The toy figure's head is big: closer
 * than this it fills the screen. Inside the cabin (in front of its back wall, under its 2.5 m ceiling) everywhere.
 */
export function transitRiderCamera(bus: TransitPose, slot: number, aspect = 16 / 10): TransitCameraPose {
  const place = busPlace(slot);
  const fx = Math.sin(bus.yaw);
  const fz = Math.cos(bus.yaw);
  const rx = -fz; // the bus's right (doors)
  const rz = fx;
  const side = place.right < -0.3 ? -1 : 1;
  // in the aisle just across its middle from the rider's side, 2.2 m behind (in front of the back wall: the back row)
  // a portrait phone's narrow view sits further back (else the big head fills its width)
  const back = aspect < 1 ? 3.0 : 2.2;
  const camAhead = Math.max(place.ahead - back, -(4.5 - 0.3));
  const camRight = Math.max(-0.9, Math.min(0.9, -side * 0.15));
  const eye = 2.3;
  const at = (ahead: number, right: number) => ({ x: bus.x + fx * ahead + rx * right, z: bus.z + fz * ahead + rz * right });
  const cam = at(camAhead, camRight);
  // portrait: the rider in the middle of the narrow view, the window beside them; landscape: past them, out of it
  const look = aspect < 1 ? at(place.ahead + 0.9, place.right + side * 0.45) : at(place.ahead + 1.6, place.right + side * 1.4);
  return { x: cam.x, y: eye, z: cam.z, targetX: look.x, targetY: place.floor + 0.95, targetZ: look.z };
}
