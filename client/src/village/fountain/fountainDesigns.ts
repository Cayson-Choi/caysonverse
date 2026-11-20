import { arc, profile, run, type FountainDesign, type ProfilePoint } from "./stoneFountain";

/**
 * The two turned fountains of 케이슨랜드 (fix/gate-fountain-park), as numbers (stoneFountain.ts draws them). Local
 * metres, y up from the ground the fountain stands on, r from its axis.
 *
 *  - The gate lot's (`GATE_FOUNTAIN`): a classical two-tier fountain in warm limestone that fits the lot's old footprint
 *    (its collider: 3.2 x 3.45 m, so the basin is 3.3 m across): a moulded basin (torus foot, sunk panels on the die, a
 *    bead, a cove and a rolled rim at seat height), a vase pedestal carrying a gadrooned bowl, a knopped stem to a small
 *    upper bowl, and a carved pine-cone finial whose crown of little jets falls into the upper bowl. Water sheets over
 *    both bowls' rolled lips into the next pool.
 *  - The park plaza's (`STAR_FOUNTAIN`): a 9.2 m basin (the plaza's old footprint) with a stepped foot, sunk panels and a
 *    heavy rolled rim; eight carved spout piers on the rim throw arcing jets inward; a fluted baluster pedestal with a
 *    gadrooned 3.6 m bowl and an upper bowl, both overflowing, under the gilded star (ParkWorld.tsx draws the star).
 */

/** Smooth 0..1 step. */
const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Points along a quarter ellipse from (r0, y0) to (r1, y1): convex outward and down (a bowl's belly seen from below). */
function belly(r0: number, y0: number, r1: number, y1: number, n: number): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = ((i / n) * Math.PI) / 2;
    out.push([r0 + (r1 - r0) * Math.sin(t), y0 + (y1 - y0) * (1 - Math.cos(t))]);
  }
  return out;
}

/** A bowl's inside: from its rim (r0, y0) down to its centre (r1, y1), a shallow dish. */
function dish(r0: number, y0: number, r1: number, y1: number, n: number): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = ((i / n) * Math.PI) / 2;
    out.push([r0 + (r1 - r0) * (1 - Math.cos(t)), y0 + (y1 - y0) * Math.sin(t)]);
  }
  return out;
}

/** Sunk panels round a die: `count` panels, `depth` (share of r), between heights y0 and y1. */
function panels(count: number, depth: number, y0: number, y1: number) {
  return (a: number, _r: number, y: number) => {
    const u = ((a * count) / (2 * Math.PI)) % 1;
    const inside = sstep(0.05, 0.11, u) * sstep(0.95, 0.89, u);
    const band = sstep(y0, y0 + 0.02, y) * sstep(y1, y1 - 0.02, y);
    return 1 - depth * inside * band;
  };
}

/** Gadroons (convex lobes) on a bowl's belly between heights y0 and y1. */
function gadroons(count: number, depth: number, y0: number, y1: number) {
  return (a: number, _r: number, y: number) => {
    const lobe = Math.pow(0.5 + 0.5 * Math.cos(count * a), 0.7);
    const w = sstep(y0, y0 + (y1 - y0) * 0.25, y) * sstep(y1, y1 - (y1 - y0) * 0.2, y);
    return 1 + depth * (lobe - 0.55) * w;
  };
}

const LIMESTONE = [1.14, 1.06, 0.92] as const;
const LIMESTONE_DARK = [1.04, 0.97, 0.85] as const;
const PALE = [1.2, 1.12, 0.98] as const;

// ───────────────────────────────────────── the gate lot's fountain ─────────────────────────────────────────

const G_POOL = 0.46;
const G_BOWL = 1.322;
const G_TOP = 1.902;

export const GATE_FOUNTAIN: FountainDesign = {
  pieces: [
    {
      // the basin: torus foot, sunk-panelled die, bead, cove, rolled rim, the inside wall and the floor
      profile: profile(
        [1.68, 0.0],
        [1.68, 0.06],
        arc(1.6, 0.105, 0.045, -90, 90, 7),
        [1.555, 0.15],
        run([1.555, 0.17], [1.54, 0.4], 10),
        arc(1.54, 0.415, 0.016, -90, 90, 4),
        arc(1.61, 0.43, 0.07, 180, 90, 6),
        arc(1.6, 0.535, 0.035, -90, 90, 7),
        [1.57, 0.574],
        [1.42, 0.58],
        arc(1.4, 0.555, 0.025, 90, 180, 3),
        [1.375, 0.09],
        arc(1.335, 0.09, 0.04, 0, -90, 3),
        [0.52, 0.05],
      ),
      tint: LIMESTONE,
      carve: panels(16, 0.011, 0.19, 0.39),
      sides: 96,
    },
    {
      // the pedestal (a vase baluster) and the gadrooned lower bowl with its rolled lip, its dish inside
      profile: profile(
        [0.52, 0.05],
        [0.52, 0.11],
        [0.47, 0.11],
        arc(0.45, 0.15, 0.04, -90, 90, 5),
        [0.4, 0.19],
        [0.35, 0.22],
        [0.33, 0.3],
        [0.335, 0.38],
        [0.32, 0.46],
        [0.28, 0.56],
        [0.22, 0.66],
        [0.175, 0.76],
        [0.165, 0.81],
        [0.215, 0.83],
        [0.215, 0.87],
        [0.17, 0.89],
        belly(0.17, 0.9, 0.99, 1.26, 12),
        arc(1.0, 1.295, 0.035, -90, 90, 7),
        [0.975, 1.332],
        dish(0.955, 1.31, 0.18, 1.1, 6),
      ),
      tint: LIMESTONE,
      carve: gadroons(16, 0.05, 0.92, 1.24),
      sides: 80,
    },
    {
      // the stem: a collar standing out of the lower bowl's water, a knop, the upper bowl, its dish
      profile: profile(
        [0.18, 1.1],
        [0.18, 1.36],
        arc(0.18, 1.39, 0.03, -90, 90, 4),
        [0.135, 1.42],
        [0.112, 1.5],
        [0.1, 1.57],
        arc(0.1, 1.615, 0.045, -90, 90, 6),
        [0.085, 1.68],
        belly(0.085, 1.69, 0.56, 1.86, 9),
        arc(0.565, 1.884, 0.024, -90, 90, 6),
        [0.548, 1.91],
        dish(0.53, 1.895, 0.1, 1.79, 5),
      ),
      tint: LIMESTONE,
      carve: gadroons(12, 0.06, 1.7, 1.85),
      sides: 60,
    },
    {
      // the finial: a plinth out of the upper bowl's water, a pine cone (carved scales), a little cup the crown jets leave
      profile: profile(
        [0.1, 1.79],
        [0.1, 1.95],
        arc(0.1, 1.97, 0.02, -90, 90, 3),
        [0.07, 1.995],
        [0.085, 2.03],
        [0.108, 2.08],
        [0.11, 2.13],
        [0.097, 2.18],
        [0.07, 2.22],
        [0.04, 2.255],
        [0.03, 2.27],
        [0.05, 2.29],
        [0.052, 2.31],
        [0.032, 2.325],
        [0.0, 2.326],
      ),
      tint: LIMESTONE_DARK,
      carve: (a, _r, y) => 1 + 0.09 * Math.pow(0.5 + 0.5 * Math.cos(10 * a + y * 70), 1.5) * sstep(2.0, 2.04, y) * sstep(2.26, 2.22, y),
      sides: 48,
    },
  ],
  pools: [
    { y: G_POOL, r: 1.375 },
    { y: G_BOWL, r: 0.958 },
    { y: G_TOP, r: 0.532 },
  ],
  curtains: [
    { lipR: 1.038, lipY: 1.3, pool: 0, out: 0.48 },
    { lipR: 0.592, lipY: 1.885, pool: 1, out: 0.42 },
  ],
  jets: [{ count: 7, angle0: 0.3, r: 0.03, y: 2.326, out: 0.36, up: 1.95, pool: 2, width: [0.012, 0.02] }],
  wet: (r, y) => {
    if (r < 1.39 && y < G_POOL + 0.05) return 1; // the basin's inside below the waterline, its floor, the pedestal's foot
    if (r < 0.36 && y < 0.62) return 1; // splashes on the pedestal
    if (r > 0.86 && y > 1.16 && y < 1.34) return 1; // the lower bowl's lip, where the sheet goes over
    if (r < 0.97 && y > 1.05 && y < G_BOWL + 0.02) return 1; // inside the lower bowl
    if (r > 0.44 && y > 1.8 && y < 1.92) return 1; // the upper bowl's lip
    if (r < 0.54 && y > 1.75 && y < G_TOP + 0.02) return 1;
    if (r < 0.12 && y > 1.9) return 1; // the finial, under its crown
    return 0;
  },
  glow: [1.0, 0.86, 0.6],
  radius: 1.7,
  height: 2.6,
  uvScale: 2.2,
};

// ───────────────────────────────────────── the park's star fountain ─────────────────────────────────────────

const S_POOL = 0.52;
const S_BOWL = 2.245;
const S_TOP = 3.215;
const S_RIM = 4.6;

/** The rim's spout piers (the jets leave from them). */
export const STAR_SPOUTS = { count: 8, angle0: Math.PI / 8, r: 4.42, y: 0.84 } as const;

export const STAR_FOUNTAIN: FountainDesign = {
  pieces: [
    {
      // the basin: a stepped foot, sunk panels on the die, a cove and a heavy rolled rim
      profile: profile(
        [S_RIM + 0.12, 0.0],
        [S_RIM + 0.12, 0.08],
        [S_RIM + 0.06, 0.08],
        arc(S_RIM + 0.02, 0.135, 0.055, -90, 90, 7),
        [S_RIM - 0.03, 0.19],
        run([S_RIM - 0.03, 0.21], [S_RIM - 0.05, 0.5], 12),
        arc(S_RIM - 0.05, 0.52, 0.02, -90, 90, 4),
        arc(S_RIM + 0.04, 0.54, 0.09, 180, 90, 6),
        arc(S_RIM + 0.03, 0.675, 0.045, -90, 90, 8),
        [S_RIM - 0.01, 0.72],
        [S_RIM - 0.34, 0.73],
        arc(S_RIM - 0.37, 0.7, 0.03, 90, 180, 3),
        [S_RIM - 0.4, 0.1],
        arc(S_RIM - 0.45, 0.1, 0.05, 0, -90, 3),
        [1.15, 0.05],
      ),
      tint: PALE,
      carve: panels(24, 0.006, 0.23, 0.49),
      sides: 120,
    },
    {
      // the pedestal: a stepped plinth in the pool, a fluted baluster, a collar, the gadrooned bowl with a rolled lip
      profile: profile(
        [1.15, 0.05],
        [1.15, 0.32],
        [1.0, 0.32],
        arc(0.95, 0.4, 0.08, -90, 90, 6),
        [0.86, 0.48],
        [0.86, 0.6],
        [0.7, 0.62],
        [0.62, 0.72],
        [0.6, 0.9],
        [0.63, 1.08],
        [0.56, 1.28],
        [0.42, 1.48],
        [0.34, 1.62],
        [0.33, 1.7],
        [0.42, 1.73],
        [0.42, 1.79],
        [0.34, 1.82],
        belly(0.34, 1.83, 1.8, 2.18, 14),
        arc(1.8, 2.225, 0.045, -90, 90, 8),
        [1.77, 2.27],
        dish(1.75, 2.24, 0.3, 2.0, 7),
      ),
      tint: PALE,
      carve: (a, r, y) =>
        gadroons(24, 0.035, 1.86, 2.16)(a, r, y) * (1 - 0.035 * Math.pow(0.5 + 0.5 * Math.cos(16 * a), 3) * sstep(0.66, 0.74, y) * sstep(1.58, 1.5, y)),
      sides: 96,
    },
    {
      // the upper stage: a column out of the bowl's water, a knop, the upper bowl, and the plinth the star stands on
      profile: profile(
        [0.3, 2.0],
        [0.3, 2.32],
        arc(0.3, 2.36, 0.04, -90, 90, 5),
        [0.22, 2.42],
        [0.19, 2.56],
        [0.17, 2.7],
        arc(0.17, 2.75, 0.05, -90, 90, 6),
        [0.14, 2.82],
        belly(0.14, 2.83, 0.86, 3.15, 10),
        arc(0.86, 3.185, 0.035, -90, 90, 7),
        [0.835, 3.222],
        dish(0.815, 3.205, 0.16, 3.07, 5),
        [0.16, 3.36],
        arc(0.16, 3.4, 0.04, -90, 90, 4),
        [0.12, 3.46],
        [0.09, 3.62],
        arc(0.11, 3.66, 0.045, -90, 90, 5),
        [0.06, 3.72],
        [0.0, 3.72],
      ),
      tint: PALE,
      carve: gadroons(16, 0.055, 2.85, 3.13),
      sides: 64,
    },
    {
      // the eight spout piers on the rim (one profile; copies round the rim): a moulded drum and cap
      profile: profile([0.21, 0.0], [0.21, 0.05], [0.18, 0.07], arc(0.17, 0.1, 0.03, -90, 90, 4), [0.15, 0.14], [0.13, 0.2], [0.14, 0.3], [0.13, 0.38], [0.165, 0.4], arc(0.175, 0.425, 0.025, -90, 90, 4), [0.15, 0.455], [0.08, 0.47], arc(0.0, 0.55, 0.09, -60, 90, 6)),
      tint: PALE,
      sides: 20,
      copies: Array.from({ length: STAR_SPOUTS.count }, (_, k) => {
        const a = STAR_SPOUTS.angle0 + (2 * Math.PI * k) / STAR_SPOUTS.count;
        return [Math.cos(a) * STAR_SPOUTS.r, 0.73, Math.sin(a) * STAR_SPOUTS.r] as const;
      }),
    },
  ],
  pools: [
    { y: S_POOL, r: S_RIM - 0.4 },
    { y: S_BOWL, r: 1.752 },
    { y: S_TOP, r: 0.818 },
  ],
  curtains: [
    { lipR: 1.85, lipY: 2.22, pool: 0, out: 0.55 },
    { lipR: 0.9, lipY: 3.2, pool: 1, out: 0.5 },
  ],
  jets: [
    // the rim's arcing jets, inward over the pool toward the pedestal
    { count: STAR_SPOUTS.count, angle0: STAR_SPOUTS.angle0, r: STAR_SPOUTS.r - 0.16, y: STAR_SPOUTS.y, out: -1.85, up: 3.9, pool: 0, width: [0.03, 0.05] },
  ],
  wet: (r, y) => {
    if (r < S_RIM - 0.38 && y < S_POOL + 0.06) return 1;
    if (r < 0.9 && y < 0.75) return 1;
    if (r > 1.6 && y > 2.08 && y < 2.28) return 1;
    if (r < 1.77 && y > 1.95 && y < S_BOWL + 0.02) return 1;
    if (r > 0.72 && y > 3.08 && y < 3.23) return 1;
    if (r < 0.83 && y > 3.0 && y < S_TOP + 0.02) return 1;
    return 0;
  },
  glow: [0.75, 0.86, 1.0],
  radius: S_RIM + 0.15,
  height: 4.2,
  uvScale: 2.2,
};
