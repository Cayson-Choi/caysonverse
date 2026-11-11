import type { TransitPose } from "@caysonverse/shared/village/transit";

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

