import { cutAt, distToPolyline, envelopeRadius, pointAt, polyLength, type Envelope, type KeepOut } from "./crownGrowth";
import type { Branch } from "./treeSkeleton";
import type { Vec3 } from "./vegLod";

/**
 * Room for each crown (the reviewer, 2026-11-13: with every crown in 3D, crowns ran through each other and through
 * the houses' roofs). The village file keeps its trees where they stand (the art's places, its baked trunks and
 * limbs), so the crowns make room instead, as real ones do: a crown does not grow into a house beside it (its
 * collision box, a little more), and two crowns that meet share the air between them, each taking the part nearer
 * its own crown (by the envelopes' normalised radius) with a thin gap between. Only the crowns that meet something
 * get a keep-out; every other one grows exactly as before. Pure: unit-tested.
 */

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** The buildings' collision boxes (`col__*` in the village file) a crown keeps out of, and how much more round them. */
export const BUILDING_BOX = /^col__(house_\d+|cafe|kiosk|memorial_(back|e|w)|construction|pavilion)$/;
const MARGIN = 0.3;
/** The pavilion's box is its floor (1.2 m): its roof stands to ~4.6 m and overhangs it. */
const PAVILION = { top: 4.8, margin: 0.9 };

/** A building's collision box as the space a crown keeps out of. */
export function buildingSpace(name: string, min: Vec3, max: Vec3): Box {
  const pav = /pavilion/.test(name);
  const m = pav ? PAVILION.margin : MARGIN;
  return { min: [min[0] - m, -1, min[2] - m], max: [max[0] + m, pav ? PAVILION.top : max[1] + m, max[2] + m] };
}

const inBox = (p: Vec3, b: Box) => p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2];

/** A crown's bounding radius round its envelope's centre (with the lumps' 15 %). */
const reach = (e: Envelope) => Math.max(e.rx, e.up, e.down) * 1.15;

/** The band (normalised radius) left empty between two crowns that meet. */
const SHARE_GAP = 0.05;

/**
 * The keep-out of the crown `own` (game space) among `others` and `boxes`, or undefined when it meets nothing (it
 * grows as it always did).
 */
export function crownKeepOut(own: Envelope, others: readonly Envelope[], boxes: readonly Box[]): KeepOut | undefined {
  const r = reach(own);
  const c = own.c;
  const near = others.filter((o) => o !== own && Math.hypot(o.c[0] - c[0], o.c[1] - c[1], o.c[2] - c[2]) < r + reach(o));
  const walls = boxes.filter((b) => {
    const dx = Math.max(b.min[0] - c[0], 0, c[0] - b.max[0]);
    const dy = Math.max(b.min[1] - c[1], 0, c[1] - b.max[1]);
    const dz = Math.max(b.min[2] - c[2], 0, c[2] - b.max[2]);
    return Math.hypot(dx, dy, dz) < r;
  });
  if (!near.length && !walls.length) return undefined;
  return (p) => {
    for (const b of walls) if (inBox(p, b)) return true;
    if (!near.length) return false;
    const mine = envelopeRadius(own, p);
    for (const o of near) {
      const theirs = envelopeRadius(o, p);
      if (theirs < 1.2 && theirs < mine + SHARE_GAP) return true;
    }
    return false;
  };
}

/** The houses' part of a crown's keep-out alone (`crownKeepOut` without the neighbours' air), or undefined: none near. */
export function buildingKeepOut(own: Envelope, boxes: readonly Box[]): KeepOut | undefined {
  return crownKeepOut(own, [], boxes);
}

/**
 * A skeleton with its limbs and side branches cut back short of a house (`inside`: the house's keep-out), `back` metres
 * before they would enter it, and the side branches that grew from a part cut away dropped. The crown makes room for
 * the house (crownKeepOut), and a limb running on into that room was left bare, ending in its fork's stubs against the
 * pavilion's eaves (review r1, 2026-11-13: scherry04): a real tree beside a house has that limb pruned. The crown is
 * grown on the cut skeleton (no twig from a limb that is not there) and its bark drawn from it. `cut`: how many
 * branches were cut or dropped (0: the skeleton itself is returned).
 */
export function trimSkeleton<T extends { limbs: Branch[]; sides: Branch[] }>(sk: T, inside: KeepOut, back = 0.45, step = 0.05): { sk: T; cut: number } {
  let cut = 0;
  const firstInside = (b: Branch): number => {
    const total = polyLength(b);
    for (let s = 0; s <= total + 1e-9; s += step) if (inside(pointAt(b, Math.min(s, total)).p)) return s;
    return Infinity;
  };
  const limbs: Branch[] = [];
  const kept: Array<Branch | null> = sk.limbs.map((l) => {
    const s = firstInside(l);
    if (s === Infinity) return l;
    cut++;
    const keep = s - back;
    return keep < 0.3 ? null : cutAt(l, keep, Infinity);
  });
  for (const l of kept) if (l) limbs.push(l);
  const sides: Branch[] = [];
  sk.sides.forEach((side) => {
    // its limb: the side branches come two per limb, in order
    const limb = kept[Math.floor(sk.sides.indexOf(side) / 2)] ?? null;
    if (!limb || distToPolyline(side.pts[0]!, limb) > 0.03) {
      cut++;
      return;
    }
    const s = firstInside(side);
    if (s === Infinity) {
      sides.push(side);
      return;
    }
    cut++;
    if (s - back >= 0.2) sides.push(cutAt(side, s - back, Infinity));
  });
  if (!cut) return { sk, cut };
  return { sk: { ...sk, limbs, sides }, cut };
}
