import { BUS_SEATS, BUS_SEAT_BACKS, BUS_SOLIDS } from "@caysonverse/shared/village/busCabin";

/**
 * Bus v3 (owner 2026-11-16: "버스에 있는 의자에는 어디든 앉을 수 있게"): which of the bus's seats a tap or a click points at. The
 * ray (world) is turned into the bus's own frame (ahead / right / up) and tested against each seat's box: its walk footprint
 * (BUS_SOLIDS `seat_<id>`) up to just over the cushion, and its backrest (BUS_SEAT_BACKS). The nearest hit wins (a seat's
 * backrest in front of another seat is what the finger touched); -1 when the ray meets none.
 */

interface SeatBox {
  minA: number;
  maxA: number;
  minR: number;
  maxR: number;
  minY: number;
  maxY: number;
}

/** Each seat as two boxes: the cushion (its walk footprint, floor to just over the cushion) and the backrest (BUS_SEAT_BACKS). */
const BOXES: Array<{ seat: number; box: SeatBox }> = BUS_SEATS.flatMap((s, i) => {
  const solid = BUS_SOLIDS.find((b) => b.id === `seat_${s.id}`);
  const back = BUS_SEAT_BACKS.find((b) => b.seat === s.id);
  const out: Array<{ seat: number; box: SeatBox }> = [
    {
      seat: i,
      box: {
        minA: solid ? solid.minAhead : s.ahead - 0.3,
        maxA: solid ? solid.maxAhead : s.ahead + 0.3,
        minR: solid ? solid.minRight : s.right - 0.4,
        maxR: solid ? solid.maxRight : s.right + 0.4,
        minY: s.floor,
        maxY: s.floor + 0.55,
      },
    },
  ];
  if (back) out.push({ seat: i, box: { minA: back.min[0], maxA: back.max[0], minR: back.min[1], maxR: back.max[1], minY: back.min[2], maxY: back.max[2] } });
  return out;
});

/** Where a world ray meets a seat's box first: the seat's index, or -1. `bus`: the bus's pose (x, z, yaw) the seats ride in. */
export function busSeatUnderRay(
  bus: { x: number; z: number; yaw: number },
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
): number {
  const fx = Math.sin(bus.yaw);
  const fz = Math.cos(bus.yaw);
  const ox = origin.x - bus.x;
  const oz = origin.z - bus.z;
  // bus-local: ahead = (x, z)·(fx, fz), right = (x, z)·(-fz, fx)
  const oA = ox * fx + oz * fz;
  const oR = -ox * fz + oz * fx;
  const dA = dir.x * fx + dir.z * fz;
  const dR = -dir.x * fz + dir.z * fx;
  const o = [oA, oR, origin.y];
  const d = [dA, dR, dir.y];
  let best = -1;
  let bestT = Infinity;
  BOXES.forEach(({ seat: i, box: b }) => {
    const lo = [b.minA, b.minR, b.minY];
    const hi = [b.maxA, b.maxR, b.maxY];
    let t0 = 0;
    let t1 = Infinity;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]!) < 1e-9) {
        if (o[k]! < lo[k]! || o[k]! > hi[k]!) return;
        continue;
      }
      let a = (lo[k]! - o[k]!) / d[k]!;
      let c = (hi[k]! - o[k]!) / d[k]!;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      if (t0 > t1) return;
    }
    if (t0 < bestT) {
      bestT = t0;
      best = i;
    }
  });
  return best;
}
