/**
 * Where a sitter stands up to (owner 2026-11-17: "식탁이나 의자가 너무 붙어서 앉고 일어날 의자 뒤로 갑자기 일어서고 이런 건 없어야 해
 * 실제처럼 의자 앞에 가서 앉고 일어서면 의자 앞에 서고 이래야 돼 등받이 있는 의자의 경우에는").
 *
 * A seat's own stand point (`Seat.standX/standZ`, benchSeats.ts) is worked out once from the furniture: in front of it, or for a chair
 * whose front is its table, beside it. When getting up, that spot may be taken — by another visitor standing there — so the server
 * tries the next ones (`standCandidates`): the stand point, then front-left / front-right of the seat, then a little further forward.
 * A candidate is never behind the backrest (`standSide` "behind"): a body is never put through it. None free: the sitter stays
 * seated and is told why (`STAND_BLOCKED`).
 *
 * Pure: the server (VillageRoom handleStand) and the tests (standSpot.test.ts, the sweep over every backed seat) share it.
 */
import { PLAYER_RADIUS, type Seat } from "../worldMap";

/** The words a sitter gets when nothing in front of the seat is free to stand on. */
export const STAND_BLOCKED = "앞이 막혀서 일어날 수 없어요";

/** In front of the seat point by at least this (m): "front". */
export const FRONT_MIN = 0.05;
/** How far behind its seat point (m) a seat's backrest stands when the seat does not say (`Seat.sidePlane`): its front edge plus a seat's depth. */
const SEAT_DEPTH_TO_BACK = 0.45;
/** Half a seat's width (m) when it does not say (`Seat.sideHalf`). */
const SEAT_HALF_DEFAULT = 0.3;
/** Two standing bodies keep at least this far apart (m): a spot nearer another visitor than this is taken. */
export const BODY_APART = 2 * PLAYER_RADIUS - 0.05;

/** How far (m) ahead of seat `s`'s point (x, z) lies, along its facing (negative: behind it). */
export function seatAhead(s: Seat, x: number, z: number): number {
  return (x - s.x) * Math.sin(s.yaw) + (z - s.z) * Math.cos(s.yaw);
}

/** How far (m) to the side of seat `s`'s point (x, z) lies, either side. */
export function seatLateral(s: Seat, x: number, z: number): number {
  return Math.abs((x - s.x) * Math.cos(s.yaw) - (z - s.z) * Math.sin(s.yaw));
}

/** How far behind its seat point (m) seat `s`'s backrest stands. */
export function backrestBehind(s: Seat): number {
  return s.backrest ?? s.sidePlane ?? (s.frontEdge ?? 0) + SEAT_DEPTH_TO_BACK;
}

export type StandSide = "front" | "beside" | "behind";

/**
 * Where (x, z) is from seat `s`: `front` (ahead of its seat point), `behind` (past its backrest, within the chair's width plus a body:
 * straight through the backrest from the seat), or `beside` (the rest: next to it, clear of its sides).
 */
export function standSide(s: Seat, x: number, z: number): StandSide {
  const ahead = seatAhead(s, x, z);
  if (ahead >= FRONT_MIN) return "front";
  if (ahead < -backrestBehind(s) && seatLateral(s, x, z) < (s.sideHalf ?? SEAT_HALF_DEFAULT) + PLAYER_RADIUS) return "behind";
  return "beside";
}

/**
 * The alternatives to a stand point, in the seat's frame from it (m): `side` to its right (+) or left (-), `fwd` further ahead. A body's
 * width to either side first (front-left / front-right), then a step forward and half a body aside, then further forward.
 */
const ALTERNATIVES: readonly { side: number; fwd: number }[] = [
  { side: -0.8, fwd: 0 },
  { side: 0.8, fwd: 0 },
  { side: -0.5, fwd: 0.4 },
  { side: 0.5, fwd: 0.4 },
  { side: 0, fwd: 0.8 },
  { side: -0.6, fwd: 0.8 },
  { side: 0.6, fwd: 0.8 },
  { side: 0, fwd: 1.2 },
];

/**
 * The spots a sitter on `s` may stand up to, in order: its stand point; then a body's width to its left and right (front-left /
 * front-right of the seat), then a step further forward. None behind the backrest, and none more behind the seat than its own stand
 * point (a chair stood up from beside it is never moved round to its back).
 */
export function standCandidates(s: Seat): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [{ x: s.standX, z: s.standZ }];
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  // the seat's right (the facing turned a quarter clockwise seen from above: x = cos, z = -sin)
  const rx = Math.cos(s.yaw);
  const rz = -Math.sin(s.yaw);
  const baseAhead = seatAhead(s, s.standX, s.standZ);
  for (const a of ALTERNATIVES) {
    const p = {
      x: Math.round((s.standX + rx * a.side + fx * a.fwd) * 1000) / 1000,
      z: Math.round((s.standZ + rz * a.side + fz * a.fwd) * 1000) / 1000,
    };
    if (standSide(s, p.x, p.z) === "behind" || seatAhead(s, p.x, p.z) < Math.min(baseAhead, FRONT_MIN) - 1e-6) continue;
    out.push(p);
  }
  return out;
}

/** The first of `standCandidates(s)` that `free(x, z)` allows, or null: the sitter stays seated (STAND_BLOCKED). */
export function pickStandSpot(s: Seat, free: (x: number, z: number) => boolean): { x: number; z: number } | null {
  for (const c of standCandidates(s)) if (free(c.x, c.z)) return c;
  return null;
}
