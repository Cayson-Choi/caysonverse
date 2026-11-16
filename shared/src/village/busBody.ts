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

/** The world (x, z) of a bus-frame point (`ahead` along the heading, `right` towards the doors). */
export function busWorld(pose: BusBodyPose, ahead: number, right: number): { x: number; z: number } {
  const fx = Math.sin(pose.yaw);
  const fz = Math.cos(pose.yaw);
  return { x: pose.x + fx * ahead - fz * right, z: pose.z + fz * ahead + fx * right };
}

/**
 * The body's side mirrors (village_bus.glb mirror(): rabbit ears at head height). One bus-local rectangle each, a little
 * overlapping the body's front corners (no seam), reaching `BUS_MIRROR_REACH` past the box: 0.27 m out, 0.37 m ahead.
 * They are part of the one solid the avatars and the camera meet (2026-11-15 check: the moving bus had no mirror
 * collision while the parked one had its own boxes).
 */
export const BUS_MIRRORS = {
  side: 0.27,
  ahead: 0.37,
} as const;

/** A bus-local rectangle (m): `a0..a1` along the heading, `r0..r1` towards the doors. */
export interface BusRect {
  a0: number;
  a1: number;
  r0: number;
  r1: number;
  /** The mirror's side (+1 door side, -1 the other), 0 for the body. A mirror is never pushed across the body. */
  mirror: -1 | 0 | 1;
}

/** The solid shapes of the bus in its own frame: the body and the two mirrors. */
export const BUS_SHAPES: readonly BusRect[] = [
  { a0: -BUS_BODY.halfLength, a1: BUS_BODY.halfLength, r0: -BUS_BODY.halfWidth, r1: BUS_BODY.halfWidth, mirror: 0 },
  { a0: BUS_BODY.halfLength - 0.1, a1: BUS_BODY.halfLength + BUS_MIRRORS.ahead, r0: BUS_BODY.halfWidth - 0.1, r1: BUS_BODY.halfWidth + BUS_MIRRORS.side, mirror: 1 },
  { a0: BUS_BODY.halfLength - 0.1, a1: BUS_BODY.halfLength + BUS_MIRRORS.ahead, r0: -BUS_BODY.halfWidth - BUS_MIRRORS.side, r1: -BUS_BODY.halfWidth + 0.1, mirror: -1 },
];

function rectClearance(rc: BusRect, ahead: number, right: number, r: number): number {
  const ox = Math.max(rc.a0 - ahead, ahead - rc.a1);
  const oz = Math.max(rc.r0 - right, right - rc.r1);
  if (ox <= 0 && oz <= 0) return Math.max(ox, oz) - r;
  return Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) - r;
}

/**
 * How far (m) a circle of radius `r` at (x, z) is from the bus (body and mirrors): negative = the circle overlaps it by
 * that much (the exact closest-point distance to the nearest shape, minus r; inside a shape, minus the depth to its
 * nearest face).
 */
export function busClearance(pose: BusBodyPose, x: number, z: number, r: number): number {
  const { ahead, right } = busLocal(pose, x, z);
  let best = Number.POSITIVE_INFINITY;
  for (const rc of BUS_SHAPES) best = Math.min(best, rectClearance(rc, ahead, right, r));
  return best;
}

/**
 * One push out of one shape: the candidates are its faces (the circle moved straight out across each, just past it); the
 * nearest one wins, except that the front (where the bus is going) is taken only when nothing else is free (pushed ahead,
 * the bus would push the avatar again at once). A mirror is pushed out sideways or ahead only, never across the body. A
 * candidate inside a static obstacle (`blocked`) is skipped; if all are, the nearest is taken anyway.
 */
function pushOutOfRect(
  pose: BusBodyPose,
  rc: BusRect,
  ahead: number,
  right: number,
  r: number,
  blocked: ((x: number, z: number) => boolean) | null,
  skin: number,
): { x: number; z: number } {
  const out = r + skin + BUS_PUSH_MARGIN;
  const ox = Math.max(rc.a0 - ahead, ahead - rc.a1);
  const oz = Math.max(rc.r0 - right, right - rc.r1);
  const candidates: Array<{ ahead: number; right: number; cost: number; front: boolean }> = [];
  if (ox > 0 && oz > 0) {
    // off a corner: straight out from the corner, then the faces as a fallback
    const d = Math.hypot(ox, oz);
    const sa = ahead > rc.a1 ? 1 : -1;
    const sr = right > rc.r1 ? 1 : -1;
    const cornerA = sa > 0 ? rc.a1 : rc.a0;
    const cornerR = sr > 0 ? rc.r1 : rc.r0;
    candidates.push({
      ahead: cornerA + (ox / d) * out * sa,
      right: cornerR + (oz / d) * out * sr,
      cost: out - d,
      front: false,
    });
  }
  const rightSide = rc.r1 + out;
  const leftSide = rc.r0 - out;
  const frontEnd = rc.a1 + out;
  const backEnd = rc.a0 - out;
  if (rc.mirror === 0) {
    candidates.push(
      { ahead, right: rightSide, cost: Math.abs(rightSide - right), front: false },
      { ahead, right: leftSide, cost: Math.abs(leftSide - right), front: false },
      { ahead: backEnd, right, cost: Math.abs(backEnd - ahead), front: false },
      { ahead: frontEnd, right, cost: Math.abs(frontEnd - ahead), front: true },
    );
  } else {
    // a mirror: out to its own side, or ahead of it (the body is on its other side, the flank behind is the body's)
    if (rc.mirror > 0) candidates.push({ ahead, right: rightSide, cost: Math.abs(rightSide - right), front: false });
    else candidates.push({ ahead, right: leftSide, cost: Math.abs(leftSide - right), front: false });
    candidates.push({ ahead: frontEnd, right, cost: Math.abs(frontEnd - ahead), front: true });
  }
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

/**
 * Where a circle (radius `r`) at (x, z) must be put so it is clear of the bus (body and mirrors), or null when it already
 * is (by at least `skin`). Up to three rounds: each pushes the circle out of the deepest shape it overlaps (a push out of
 * a mirror may land it against the body). A circle off a corner (beside the body's end) is put out along the corner's
 * outward direction instead, so grazing a corner pushes it round it rather than across the whole body.
 */
export function pushOutOfBus(
  pose: BusBodyPose,
  x: number,
  z: number,
  r: number,
  blocked: ((x: number, z: number) => boolean) | null = null,
  skin = BUS_PUSH_SKIN,
): { x: number; z: number } | null {
  let cx = x;
  let cz = z;
  let moved = false;
  for (let round = 0; round < 3; round++) {
    const { ahead, right } = busLocal(pose, cx, cz);
    let deepest: BusRect | null = null;
    let depth = skin;
    for (const rc of BUS_SHAPES) {
      const c = rectClearance(rc, ahead, right, r);
      if (c < depth) {
        depth = c;
        deepest = rc;
      }
    }
    if (!deepest) break;
    const p = pushOutOfRect(pose, deepest, ahead, right, r, blocked, skin);
    cx = p.x;
    cz = p.z;
    moved = true;
  }
  return moved ? { x: cx, z: cz } : null;
}

/** `blocked` for pushOutOfBus from a map's static colliders (the same test the server's Move validation uses). */
export function staticBlocked(obstacles: readonly AABB[], r: number): (x: number, z: number) => boolean {
  return (x, z) => isBlocked(x, z, r, obstacles);
}
