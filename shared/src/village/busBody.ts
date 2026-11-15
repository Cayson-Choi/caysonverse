/**
 * The moving village bus is solid (owner 2026-11-15: "도로에 캐릭터가 서 있으면 버스가 통과해버려"; checker r2: an avatar
 * walking at the side of the bus while it drove went straight into its body and rode along inside it).
 *
 * The bus's body is an oriented rectangle (2.5 x 9 m, transit.ts busFootprint) that moves every frame. An avatar's body
 * (a circle) must never overlap it, whoever moves: the avatar walking into the bus's flank, or the bus's body reaching an
 * avatar who stands still (at the kerb as it passes, beside it when it pulls away). One rule covers both: whenever the
 * circle overlaps the rectangle it is put back just outside it, on the nearest free side. Applied every frame to a
 * walking avatar it is a slide along the flank (the walk is projected onto the face); applied to an avatar the body
 * reaches it is a shove, a few cm a frame at the bus's pace, never a jump.
 *
 * Shared verbatim: the client applies it to its own avatar every frame (no wait for the server), and the server applies it
 * to every avatar on each bus tick and to every accepted Move (authoritative: every client sees the same push). Pure.
 *
 * Why not boxes for the slide: the old local collider was four axis-aligned boxes round the turned body, and walking into
 * a box one ALREADY overlapped was allowed (the escape rule for stuck players). On the ring road the bus is always turned,
 * so the boxes stuck out past the body; the bus advanced, a box came over the avatar, stopped blocking, and the next step
 * went inside. The rectangle here has no inflated corners and no escape hole: the push only ever moves the avatar out.
 */

import type { AABB } from "../collision";
import { isBlocked } from "../collision";

/** The body's half-extents (m): village_bus.glb is 2.49 x 9 m (transit.ts busFootprint's 2.5 x 9). */
export const BUS_BODY = { halfLength: 4.5, halfWidth: 1.25 } as const;

/**
 * A thin skin (m) round the body: a body nearer than this is pushed. The bus moves between the frame that pushed and the
 * next look at it (on the ring it also turns, which swings its ends sideways by a few mm a frame), so the push keeps this
 * much air, and the body itself is never reached.
 */
export const BUS_PUSH_SKIN = 0.03;

/** How far past the skin (m) a pushed avatar is put, so the next frame's test is clean. */
export const BUS_PUSH_MARGIN = 0.02;

export interface BusBodyPose {
  x: number;
  z: number;
  yaw: number;
}

/** (x, z) in the bus's own frame: `ahead` along its heading, `right` towards its doors (busFootprint's convention). */
export function busLocal(pose: BusBodyPose, x: number, z: number): { ahead: number; right: number } {
  const fx = Math.sin(pose.yaw);
  const fz = Math.cos(pose.yaw);
  const dx = x - pose.x;
  const dz = z - pose.z;
  return { ahead: dx * fx + dz * fz, right: -dx * fz + dz * fx };
}

function busWorld(pose: BusBodyPose, ahead: number, right: number): { x: number; z: number } {
  const fx = Math.sin(pose.yaw);
  const fz = Math.cos(pose.yaw);
  return { x: pose.x + fx * ahead - fz * right, z: pose.z + fz * ahead + fx * right };
}

/**
 * How far (m) a circle of radius `r` at (x, z) is from the body: negative = the circle overlaps it by that much (the
 * exact closest-point distance to the rectangle, minus r; inside the rectangle, minus the depth to its nearest face).
 */
export function busClearance(pose: BusBodyPose, x: number, z: number, r: number): number {
  const { ahead, right } = busLocal(pose, x, z);
  const ox = Math.abs(ahead) - BUS_BODY.halfLength;
  const oz = Math.abs(right) - BUS_BODY.halfWidth;
  if (ox <= 0 && oz <= 0) return Math.max(ox, oz) - r;
  return Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) - r;
}

/**
 * Where a circle (radius `r`) at (x, z) must be put so it is clear of the bus body, or null when it already is (by at
 * least `skin`). The candidates are the four faces (the circle moved straight out across each, just past it); the
 * nearest one wins, except that the bus's front (where it is going) is taken only when neither flank nor the rear is
 * free — pushed ahead, the bus would push the avatar again at once. A candidate inside a static obstacle (`blocked`) is
 * skipped; if all four are, the nearest is taken anyway (never left inside the bus).
 *
 * A circle off a corner (beside the body's end) is put out along the corner's outward direction instead, so grazing a
 * corner pushes it round it rather than across the whole body.
 */
export function pushOutOfBus(
  pose: BusBodyPose,
  x: number,
  z: number,
  r: number,
  blocked: ((x: number, z: number) => boolean) | null = null,
  skin = BUS_PUSH_SKIN,
): { x: number; z: number } | null {
  const clearance = busClearance(pose, x, z, r);
  if (clearance >= skin) return null;
  const { ahead, right } = busLocal(pose, x, z);
  const hl = BUS_BODY.halfLength;
  const hw = BUS_BODY.halfWidth;
  const out = r + skin + BUS_PUSH_MARGIN;
  const ox = Math.abs(ahead) - hl;
  const oz = Math.abs(right) - hw;
  const candidates: Array<{ ahead: number; right: number; cost: number; front: boolean }> = [];
  if (ox > 0 && oz > 0) {
    // off a corner: straight out from the corner, then the faces as a fallback
    const d = Math.hypot(ox, oz);
    const cornerA = Math.sign(ahead) * hl;
    const cornerR = Math.sign(right) * hw;
    candidates.push({
      ahead: cornerA + (ox / d) * out * Math.sign(ahead),
      right: cornerR + (oz / d) * out * Math.sign(right),
      cost: out - d,
      front: false,
    });
  }
  const rightSide = hw + out;
  const frontEnd = hl + out;
  candidates.push(
    { ahead, right: rightSide, cost: Math.abs(rightSide - right), front: false },
    { ahead, right: -rightSide, cost: Math.abs(-rightSide - right), front: false },
    { ahead: -frontEnd, right, cost: Math.abs(-frontEnd - ahead), front: false },
    { ahead: frontEnd, right, cost: Math.abs(frontEnd - ahead), front: true },
  );
  // the front last: only when nothing else is free (the bus drives on into whoever it put there)
  const ordered = candidates
    .filter((c) => !c.front)
    .sort((a, b) => a.cost - b.cost)
    .concat(candidates.filter((c) => c.front));
  for (const c of ordered) {
    const p = busWorld(pose, c.ahead, c.right);
    if (!blocked || !blocked(p.x, p.z)) return p;
  }
  const nearest = candidates.slice().sort((a, b) => a.cost - b.cost)[0]!;
  return busWorld(pose, nearest.ahead, nearest.right);
}

/** `blocked` for pushOutOfBus from a map's static colliders (the same test the server's Move validation uses). */
export function staticBlocked(obstacles: readonly AABB[], r: number): (x: number, z: number) => boolean {
  return (x, z) => isBlocked(x, z, r, obstacles);
}
