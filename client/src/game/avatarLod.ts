/**
 * Far-avatar level of detail (perf/no-hitch, 2026-11-17; owner: "100명이 플레이하는데 끊김이나 렉이나 이런게 걸리면 안돼").
 *
 * With 100 players in the plaza most of a frame went to three's scene-graph pass: every remote avatar's node tree (its
 * bones, meshes, nametag) had its matrices recomposed and multiplied every frame (e2e/perf-routes.mjs crowd route, 99
 * bots: updateMatrixWorld + multiplyMatrices ≈ 21 % of the main thread). A far or off-screen avatar's tree is now refreshed
 * every few frames instead (its animation already ticks that rarely: mixerThrottle.ts), and only near ones cast a shadow
 * (the near cascade would draw every avatar a second time; beyond this distance their shadows are a few pixels).
 * The near ones stay exactly as before: every frame.
 */

/** Distances (m) of the bands, and the frames between two refreshes in each. */
export const AVATAR_LOD = {
  nearM: 18,
  midM: 35,
  farM: 60,
  /** frames between refreshes: near, mid, far, beyond far, behind the camera */
  cadence: [1, 2, 3, 4, 6] as const,
  /** Avatars within this distance cast a shadow. */
  shadowM: 24,
  /** Frames between refreshes of a standing avatar that has not moved nor had its pose touched, beyond the near band. */
  stillCadence: 12,
};

/** Frames between two refreshes of an avatar's node tree at `distance` (m); `behind`: it is behind the camera. */
export function avatarTreeCadence(distance: number, behind: boolean): number {
  const c = AVATAR_LOD.cadence;
  if (distance < AVATAR_LOD.nearM) return c[0];
  if (behind) return c[4];
  if (distance < AVATAR_LOD.midM) return c[1];
  if (distance < AVATAR_LOD.farM) return c[2];
  return c[3];
}

/** Whether the point (x, z) lies behind a camera at (cx, cz) looking along the world direction (fx, fz) (with a margin). */
export function behindCamera(x: number, z: number, cx: number, cz: number, fx: number, fz: number): boolean {
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d < 4) return false;
  // more than ~100° off the view direction: out of any phone or desktop field of view
  return (dx * fx + dz * fz) / (d * (Math.hypot(fx, fz) || 1)) < -0.17;
}

/**
 * DEV only (e2e/crowd-100.mjs --lod old): the avatar level of detail of perf/crowd (stand-ins for far avatars, the slow
 * refresh of avatars that stand still) switched off, to measure the same build with and without it in one run.
 */
export function crowdLodOff(): boolean {
  return import.meta.env.DEV && typeof window !== "undefined" && (window as unknown as { __cvLodOff?: boolean }).__cvLodOff === true;
}

/** DEV only (e2e/crowd-look.mjs): `window.__cvAvatarForce[sessionId]` = "full" | "imp" pins one avatar's drawing, to photograph both side by side. */
export function crowdForce(sessionId: string): "full" | "imp" | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  return (window as unknown as { __cvAvatarForce?: Record<string, "full" | "imp"> }).__cvAvatarForce?.[sessionId] ?? null;
}
