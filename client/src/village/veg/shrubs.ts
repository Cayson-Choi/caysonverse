import type { Vec3 } from "./vegLod";

/**
 * The village's bushes (veg3d). Pure: unit-tested.
 *
 * `parts_trees.shrub(F, x, z, H, R, seed, y0)` drew a bush as 12 overlapping leaf cards round (x, y0 + H/2, z): card
 * centres within +-0.7 R across and +-H/4 up and down, each card 0.8-1.15 x max(H, 1.6 R) wide. The instanced ones
 * (`inst__shrub_0`) are placed by their instance matrices; the others (the houses' porch corners, the plot lanes, the
 * plaza planters, the memorial's planted roof edge) are merged into the leaf meshes with the trees' cards. Those are
 * found here from the cards the trees did not claim: grouped by a mean shift (a bush's cards gather round its centre,
 * the next bush is at least 0.95 m away), each group measured back into a bush: centre, ground, height and radius.
 */

export interface ShrubCard {
  x: number;
  y: number;
  z: number;
  /** The card's width (m). */
  s: number;
}

export interface Bush {
  x: number;
  /** The ground the bush stands on (m). */
  y: number;
  z: number;
  /** Height and horizontal radius of the bush as drawn (m). */
  h: number;
  r: number;
  /** A hash in [0, 1) (roll, tint). */
  seed: number;
  /** The cards it stands in for. */
  cards: number[];
}

/** The drawn bush for a shrub(H, R): a little wider than the old cards' leafy middle, as high as they were. */
export function bushSize(H: number, R: number): { h: number; r: number } {
  return { h: H * 1.05, r: Math.max(R * 1.25, H * 0.62) };
}

/** Group leftover leaf cards into bushes (see the file header). `bandwidth`: the mean shift's radius (m). */
export function findBushes(cards: readonly ShrubCard[], bandwidth = 0.5): Bush[] {
  const n = cards.length;
  if (!n) return [];
  const cell = bandwidth;
  const grid = new Map<string, number[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  cards.forEach((c, i) => {
    const k = key(c.x, c.z);
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  });
  const neighbours = (p: Vec3): number[] => {
    const out: number[] = [];
    const i0 = Math.floor(p[0] / cell);
    const k0 = Math.floor(p[2] / cell);
    for (let i = -1; i <= 1; i++)
      for (let k = -1; k <= 1; k++)
        for (const j of grid.get(`${i0 + i},${k0 + k}`) ?? []) {
          const c = cards[j]!;
          if (Math.hypot(c.x - p[0], c.z - p[2]) <= bandwidth && Math.abs(c.y - p[1]) <= 0.8) out.push(j);
        }
    return out;
  };
  // every card climbs to its density peak
  const modes: Vec3[] = cards.map((c) => {
    let p: Vec3 = [c.x, c.y, c.z];
    for (let it = 0; it < 12; it++) {
      const near = neighbours(p);
      if (!near.length) break;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const j of near) {
        x += cards[j]!.x;
        y += cards[j]!.y;
        z += cards[j]!.z;
      }
      const q: Vec3 = [x / near.length, y / near.length, z / near.length];
      const moved = Math.hypot(q[0] - p[0], q[2] - p[2]);
      p = q;
      if (moved < 1e-3) break;
    }
    return p;
  });
  // peaks closer than 0.35 m are one bush
  const centres: Array<{ p: Vec3; cards: number[] }> = [];
  modes.forEach((m, i) => {
    const hit = centres.find((c) => Math.hypot(c.p[0] - m[0], c.p[2] - m[2]) < 0.35 && Math.abs(c.p[1] - m[1]) < 0.6);
    if (hit) hit.cards.push(i);
    else centres.push({ p: m, cards: [i] });
  });
  // a wide bush's cards can climb to two peaks: a group much smaller than a bush's 12 cards joins its neighbour
  for (let pass = 0; pass < 256; pass++) {
    let merged = false;
    centres.sort((a, b) => a.cards.length - b.cards.length);
    for (let i = 0; i < centres.length; i++) {
      const c = centres[i]!;
      if (c.cards.length >= 10) continue;
      let best = -1;
      let bestD = 0.8;
      centres.forEach((o, j) => {
        if (j === i) return;
        const d = Math.hypot(o.p[0] - c.p[0], o.p[2] - c.p[2]);
        if (d < bestD && Math.abs(o.p[1] - c.p[1]) < 0.6) {
          bestD = d;
          best = j;
        }
      });
      if (best < 0) continue;
      const o = centres[best]!;
      const k = o.cards.length + c.cards.length;
      o.p = [(o.p[0] * o.cards.length + c.p[0] * c.cards.length) / k, (o.p[1] * o.cards.length + c.p[1] * c.cards.length) / k, (o.p[2] * o.cards.length + c.p[2] * c.cards.length) / k];
      o.cards.push(...c.cards);
      centres.splice(i, 1);
      merged = true;
      break;
    }
    if (!merged) break;
  }
  return centres.map((c) => {
    const list = c.cards.map((i) => cards[i]!);
    const k = list.length;
    let x = 0;
    let y = 0;
    let z = 0;
    let s = 0;
    for (const q of list) {
      x += q.x;
      y += q.y;
      z += q.z;
      s += q.s;
    }
    x /= k;
    y /= k;
    z /= k;
    s /= k;
    let vxz = 0;
    for (const q of list) vxz += ((q.x - x) ** 2 + (q.z - z) ** 2) / 2;
    const spread = Math.sqrt(vxz / k) / 0.404; // the cards are uniform within +-0.7 R: std 0.404 R
    const H = Math.min(1.3, Math.max(0.45, s / 0.975));
    const R = Math.min(0.85, Math.max(0.3, k >= 6 ? 0.5 * spread + 0.5 * H * 0.62 : H * 0.62));
    const size = bushSize(H, R);
    const seed = (Math.abs(Math.sin(x * 12.9898 + z * 78.233)) * 43758.5453) % 1;
    return { x, y: y - H / 2, z, h: size.h, r: size.r, seed, cards: c.cards };
  });
}
