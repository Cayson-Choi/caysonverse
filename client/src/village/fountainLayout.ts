/**
 * 케이슨 마을's plaza fountain, as numbers: where its water goes (the pure part of fountainWater.ts, unit-tested in
 * fountainWater.test.ts). Game coordinates: metres, y up, angles measured from +x toward +z (the Blender script's
 * `x = cx + r cos a, z = cz + r sin a`), relative to the fountain's centre (VILLAGE_LAYOUT.plaza.fountain.centre).
 *
 * The shapes are the model's (art/village/tools/build_village.py `build_fountain()`): the same nozzles, the same
 * landing points, the same pools and lips. Only the water is drawn anew, at run time, as real water moves:
 *  - 16 arcing jets from the basin's rim (r 5.1, y 0.42) toward the pedestal, landing on the pool at r 2.9. The model's
 *    quadratic Bezier is a parabola: its apex 1.32 m above the nozzle gives a launch at 5.1 m/s up and 2.1 m/s in, 1.04 s
 *    in the air.
 *  - 8 upright jets on the pedestal's pool (r 1.9, y 0.80) rising 2.9 m: 7.5 m/s, 0.77 s up; they fall back as a crown.
 *  - 2 curtains over the bowl's lip (r 1.64, y 1.62 -> r 1.85, y 0.80) and the pedestal's (r 2.52, y 0.80 -> r 2.75, y 0.40):
 *    a parabola from the lip at the speed that lands where the model's sheet landed.
 *
 * Every periodic thing (the particles' cycles, the noise's scroll, the wobble) repeats a whole number of times in
 * `TIME_WRAP` s, so the clock handed to the shaders can wrap there without a jump (a phone's GPU keeps its precision).
 */

export const G = 9.81;

/** The clock the shaders get wraps every this many seconds. */
export const TIME_WRAP = 600;

/** Wrap the scene clock (s) for the shaders. */
export function wrapTime(seconds: number): number {
  const t = seconds % TIME_WRAP;
  return t < 0 ? t + TIME_WRAP : t;
}

/** A period (s) adjusted so that it repeats a whole number of times in `TIME_WRAP`. */
export function wrapPeriod(period: number): number {
  const n = Math.max(1, Math.round(TIME_WRAP / period));
  return TIME_WRAP / n;
}

/** An angular frequency (rad/s) adjusted so that it repeats a whole number of times in `TIME_WRAP`. */
export function wrapOmega(omega: number): number {
  return (2 * Math.PI) / wrapPeriod((2 * Math.PI) / omega);
}

/** The fountain's water surfaces and stone (the model's). */
export const FOUNTAIN = {
  /** The main basin's water. */
  pool: { y: 0.4, r: 5.41 },
  /** The pedestal's pool (the lower tier). Its stone lip reaches r 2.5. */
  tier: { y: 0.8, r: 2.06, lipR: 2.5 },
  /** The upper bowl's water. Its stone lip reaches r 1.62. */
  bowl: { y: 1.6, r: 1.52, lipR: 1.62 },
  /**
   * The model's arcs: a quadratic Bezier from the nozzle (r 5.1, y 0.42) to (r 2.9, y 0.45), its control point 2.6 m above
   * the middle (apex 1.735). A Bezier is a parabola: the jet follows it exactly and goes on down to the water (y 0.40).
   */
  arcs: { count: 16, nozzleR: 5.1, nozzleY: 0.42, endR: 2.9, endY: 0.45, lift: 2.6, apexY: 1.735 },
  uprights: { count: 8, r: 1.9, baseY: 0.8, height: 2.9, angle0: 0.2 },
  curtains: [
    { lipR: 1.64, lipY: 1.62, landR: 1.85, landY: 0.8 },
    { lipR: 2.52, lipY: 0.8, landR: 2.75, landY: 0.4 },
  ],
} as const;

/** The water surface (or stone lip) under a point `r` m from the centre: where a falling drop ends. */
export function surfaceY(r: number): number {
  if (r < FOUNTAIN.bowl.lipR) return FOUNTAIN.bowl.y;
  if (r < FOUNTAIN.tier.lipR) return FOUNTAIN.tier.y;
  return FOUNTAIN.pool.y;
}

export type Vec3 = [number, number, number];

/** A stream of water: launched at `origin` with `velocity`, `flight` s until it lands. */
export interface Jet {
  origin: Vec3;
  velocity: Vec3;
  /** Time in the air (s) from the nozzle to the water it lands in. */
  flight: number;
  /** Its angle around the fountain (rad). */
  angle: number;
}

/** Where a ballistic point is `t` s after launch. */
export function ballistic(o: Vec3, v: Vec3, t: number): Vec3 {
  return [o[0] + v[0] * t, o[1] + v[1] * t - 0.5 * G * t * t, o[2] + v[2] * t];
}

/** The time a point launched from `o` with `v` comes DOWN through height `h` (NaN if it never reaches it). */
export function timeDownTo(o: Vec3, v: Vec3, h: number): number {
  const disc = v[1] * v[1] + 2 * G * (o[1] - h);
  if (disc < 0) return NaN;
  return (v[1] + Math.sqrt(disc)) / G;
}

/**
 * When a drop launched from `o` with `v` (relative to the centre) first meets water or stone: the bowl (y 1.60) if it comes
 * down through that height inside the bowl's lip, else the pedestal's pool (0.80) inside its lip, else the basin (0.40).
 */
export function landingTime(o: Vec3, v: Vec3): number {
  for (const [h, inside] of [
    [FOUNTAIN.bowl.y, (r: number) => r < FOUNTAIN.bowl.lipR],
    [FOUNTAIN.tier.y, (r: number) => r < FOUNTAIN.tier.lipR],
  ] as const) {
    const t = timeDownTo(o, v, h);
    if (!(t > 0)) continue;
    const p = ballistic(o, v, t);
    if (inside(Math.hypot(p[0], p[2]))) return t;
  }
  return timeDownTo(o, v, FOUNTAIN.pool.y);
}

/**
 * The k-th arcing jet: the model's Bezier as a ballistic flight (its second difference is gravity's: 1.03 s from the
 * nozzle to its end), on down to the basin's water.
 */
export function arcJet(k: number): Jet {
  const a = FOUNTAIN.arcs;
  const angle = (2 * Math.PI * k) / a.count;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ctrlY = (a.nozzleY + a.endY) / 2 + a.lift;
  const tEnd = Math.sqrt((-2 * (a.nozzleY - 2 * ctrlY + a.endY)) / G);
  const vy = (2 * (ctrlY - a.nozzleY)) / tEnd;
  const vh = (a.nozzleR - a.endR) / tEnd;
  const origin: Vec3 = [a.nozzleR * c, a.nozzleY, a.nozzleR * s];
  const velocity: Vec3 = [-vh * c, vy, -vh * s];
  return { origin, velocity, flight: timeDownTo(origin, velocity, FOUNTAIN.pool.y), angle };
}

/** Where the arcs come down on the basin's water (m from the centre): 2 cm inside the model's end (r 2.9, 5 cm higher). */
export const ARC_LAND_R = (() => {
  const j = arcJet(0);
  const p = ballistic(j.origin, j.velocity, j.flight);
  return Math.hypot(p[0], p[2]);
})();

/** The k-th upright jet: straight up 2.9 m from the pedestal's pool (its `flight` is the rise, nozzle to apex). */
export function uprightJet(k: number): Jet {
  const u = FOUNTAIN.uprights;
  const angle = (2 * Math.PI * k) / u.count + u.angle0;
  const vy = Math.sqrt(2 * G * u.height);
  return { origin: [u.r * Math.cos(angle), u.baseY, u.r * Math.sin(angle)], velocity: [0, vy, 0], flight: vy / G, angle };
}

/** A curtain falling over a lip: its outward speed (m/s) and fall time (s), from the lip to the water it lands in. */
export function curtainFlow(i: number): { u: number; fall: number; lipR: number; lipY: number; landY: number } {
  const c = FOUNTAIN.curtains[i]!;
  const fall = Math.sqrt((2 * (c.lipY - c.landY)) / G);
  return { u: (c.landR - c.lipR) / fall, fall, lipR: c.lipR, lipY: c.lipY, landY: c.landY };
}

/** Where on the curtain `i` a parcel is `tau` s after it left the lip: radius and height. */
export function curtainPoint(i: number, tau: number): { r: number; y: number } {
  const f = curtainFlow(i);
  return { r: f.lipR + f.u * tau, y: f.lipY - 0.5 * G * tau * tau };
}

// ───────────────────────────────────────── the particles ─────────────────────────────────────────

/** What a particle is (the shader branches on it). */
export const PARTICLE_KIND = { arcDrop: 0, crown: 1, curtainDrop: 2, splash: 3, mist: 4, head: 5 } as const;
export type ParticleKind = (typeof PARTICLE_KIND)[keyof typeof PARTICLE_KIND];

/** How many particles each emitter has, per tier. The rich tier's cap is 2048; the light tier's 384. */
export const PARTICLE_BUDGET = {
  high: { arcDrop: 44, crown: 112, curtainDrop: 64, arcSplash: 10, crownSplash: 8, curtainSplash: 24, mist: 24, head: 2 },
  low: { arcDrop: 10, crown: 22, curtainDrop: 16, arcSplash: 0, crownSplash: 0, curtainSplash: 0, mist: 0, head: 1 },
} as const;
export const PARTICLE_CAP = { high: 2048, low: 384 } as const;

/** One particle: launched from `origin` with `velocity` every `life` s (offset by `phase`), kicked sideways after `kickAt` s. */
export interface Particle {
  kind: ParticleKind;
  origin: Vec3;
  velocity: Vec3;
  /** The sideways velocity (x, z) it picks up after `kickAt` s (the crown spreading, a drop peeling off the stream). */
  kick: [number, number];
  kickAt: number;
  /** Seconds per cycle (a whole number of cycles in `TIME_WRAP`). */
  life: number;
  /** Its offset in the cycle (0..1). */
  phase: number;
  /** Shown from this share of its life on (hidden inside the stream before it). */
  show: number;
  /** Its size (m): a drop's (or a clump's) diameter, the mist's width. */
  size: number;
  seed: number;
  /**
   * 1 = drawn up to the mid distance (25-60 m: half the drops, the crowns' heads), 0 = near only (< 25 m: the other half,
   * splashes, mist).
   */
  far: 0 | 1;
}

/** LOD distances (m from the fountain's centre): everything nearer than `near`, the far half up to `far`, nothing beyond. */
export const PARTICLE_LOD = { near: 25, far: 60, fade: 4 } as const;

/** How many particles to draw from `d` m away (the far-class ones come first in the buffer). */
export function particleCountAt(d: number, total: number, farCount: number): number {
  if (d < PARTICLE_LOD.near) return total;
  if (d < PARTICLE_LOD.far) return farCount;
  return 0;
}

/** A seeded generator (mulberry32): the same fountain on every client. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Breakup (0 smooth glass .. 1 drops) along an arcing jet, by the share `s` of its flight. */
export const ARC_BREAK = { start: 0.3, full: 0.62 } as const;
/** ... and along an upright jet, by the share of its rise. */
export const UPRIGHT_BREAK = { start: 0.55, full: 0.92 } as const;

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
/** How broken an arcing jet is at `s` (0..1 of its flight). */
export function arcBreakup(s: number): number {
  return smooth(ARC_BREAK.start, ARC_BREAK.full, s);
}

/**
 * Every particle of the fountain for a tier, the far class first (`farCount` of them), then the near class. Deterministic.
 * Each particle's cycle is its own flight to the water (`landingTime`), so it reappears at its emitter as it lands.
 */
export function buildParticles(tier: "high" | "low"): { particles: Particle[]; farCount: number } {
  const B = PARTICLE_BUDGET[tier];
  const rand = rng(tier === "high" ? 0x5eed : 0x10f);
  const far: Particle[] = [];
  const near: Particle[] = [];
  const put = (p: Particle) => (p.far ? far : near).push(p);
  const life = (o: Vec3, v: Vec3, kick: [number, number], kickAt: number) => {
    // The flight to the first water (or stone) it comes down on, the sideways kick's drift included: the bowl inside its
    // lip, else the pedestal's pool inside its lip, else the basin.
    const at = (t: number): Vec3 => {
      const p = ballistic(o, v, t);
      const dt = Math.max(0, t - kickAt);
      return [p[0] + kick[0] * dt, p[1], p[2] + kick[1] * dt];
    };
    let t = timeDownTo(o, v, FOUNTAIN.pool.y);
    for (const [h, lip] of [
      [FOUNTAIN.bowl.y, FOUNTAIN.bowl.lipR],
      [FOUNTAIN.tier.y, FOUNTAIN.tier.lipR],
    ] as const) {
      const th = timeDownTo(o, v, h);
      if (!(th > 0)) continue;
      const p = at(th);
      if (Math.hypot(p[0], p[2]) < lip) {
        t = th;
        break;
      }
    }
    return wrapPeriod(Math.max(0.12, t));
  };
  const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;

  // Drops off the arcing jets: launched with the stream, they peel off it once it breaks (kicked sideways, a little
  // faster or slower), so the second half of every arc is a widening veil of drops, as a real smooth-bore jet's is.
  for (let k = 0; k < FOUNTAIN.arcs.count; k++) {
    const j = arcJet(k);
    for (let i = 0; i < B.arcDrop; i++) {
      const along = 1 + 0.035 * gauss();
      const v: Vec3 = [j.velocity[0] * along, j.velocity[1] * (1 + 0.02 * gauss()), j.velocity[2] * along];
      const spread = 0.05 + 0.09 * rand();
      const a = rand() * Math.PI * 2;
      const kickAt = j.flight * (ARC_BREAK.start + 0.25 * rand());
      const kick: [number, number] = [Math.cos(a) * spread, Math.sin(a) * spread];
      put({
        kind: PARTICLE_KIND.arcDrop, origin: [...j.origin], velocity: v, kick, kickAt,
        life: life(j.origin, v, kick, kickAt), phase: rand(), show: ARC_BREAK.start + 0.12 * rand(),
        size: 0.004 + 0.006 * rand(), seed: k + rand() * 0.999, far: i % 2 === 0 ? 1 : 0,
      });
    }
  }
  // The upright jets' crowns: up the column, then out sideways near the top and down around it.
  for (let k = 0; k < FOUNTAIN.uprights.count; k++) {
    const j = uprightJet(k);
    for (let i = 0; i < B.crown; i++) {
      // Most of the water reaches near the top; a little falls off the column early.
      const vy = j.velocity[1] * (0.86 + 0.14 * Math.sqrt(rand()));
      const a = rand() * Math.PI * 2;
      const spread = 0.22 + 0.7 * rand() * rand() + 0.12 * rand();
      const kick: [number, number] = [Math.cos(a) * spread, Math.sin(a) * spread];
      const kickAt = (vy / G) * (0.68 + 0.3 * rand());
      const v: Vec3 = [0, vy, 0];
      put({
        kind: PARTICLE_KIND.crown, origin: [...j.origin], velocity: v, kick, kickAt,
        life: life(j.origin, v, kick, kickAt), phase: rand(), show: 0.32 + 0.1 * rand(),
        size: 0.005 + 0.008 * rand(), seed: k + rand() * 0.999, far: i % 2 === 0 ? 1 : 0,
      });
    }
  }
  // Drops leaving the curtains' lower part (where the sheet tears into strands).
  for (let c = 0; c < FOUNTAIN.curtains.length; c++) {
    const f = curtainFlow(c);
    for (let i = 0; i < B.curtainDrop; i++) {
      const a = rand() * Math.PI * 2;
      const u = f.u * (0.85 + 0.35 * rand());
      const o: Vec3 = [f.lipR * Math.cos(a), f.lipY, f.lipR * Math.sin(a)];
      const v: Vec3 = [u * Math.cos(a), 0.05 * gauss(), u * Math.sin(a)];
      const spread = 0.04 + 0.12 * rand();
      const kick: [number, number] = [Math.cos(a) * spread, Math.sin(a) * spread];
      const kickAt = f.fall * (0.4 + 0.3 * rand());
      put({
        kind: PARTICLE_KIND.curtainDrop, origin: o, velocity: v, kick, kickAt,
        life: life(o, v, kick, kickAt), phase: rand(), show: 0.55 + 0.2 * rand(),
        size: 0.004 + 0.005 * rand(), seed: c + rand() * 0.999, far: i % 2 === 0 ? 1 : 0,
      });
    }
  }
  // Splashes where the water lands: thrown up 2-13 cm and out, gone in a third of a second.
  const splash = (cx: number, y: number, cz: number, n: number, radius: number, up: [number, number], out: [number, number], seed: number) => {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const rr = radius * Math.sqrt(rand());
      const o: Vec3 = [cx + Math.cos(a) * rr, y + 0.005, cz + Math.sin(a) * rr];
      const vo = out[0] + (out[1] - out[0]) * rand();
      const b = rand() * Math.PI * 2;
      const v: Vec3 = [Math.cos(b) * vo, up[0] + (up[1] - up[0]) * rand(), Math.sin(b) * vo];
      put({
        kind: PARTICLE_KIND.splash, origin: o, velocity: v, kick: [0, 0], kickAt: 0,
        life: wrapPeriod((2 * v[1]) / G + 0.04), phase: rand(), show: 0, size: 0.003 + 0.005 * rand(), seed, far: 0,
      });
    }
  };
  for (let k = 0; k < FOUNTAIN.arcs.count; k++) {
    const a = arcJet(k).angle;
    splash(ARC_LAND_R * Math.cos(a), FOUNTAIN.pool.y, ARC_LAND_R * Math.sin(a), B.arcSplash, 0.1, [0.6, 1.6], [0.15, 0.6], k);
  }
  for (let k = 0; k < FOUNTAIN.uprights.count; k++) {
    const a = uprightJet(k).angle;
    splash(FOUNTAIN.uprights.r * Math.cos(a), FOUNTAIN.tier.y, FOUNTAIN.uprights.r * Math.sin(a), B.crownSplash, 0.3, [0.4, 1.0], [0.1, 0.4], k);
  }
  for (let c = 0; c < FOUNTAIN.curtains.length; c++) {
    const cur = FOUNTAIN.curtains[c]!;
    for (let i = 0; i < B.curtainSplash; i++) {
      const a = rand() * Math.PI * 2;
      splash(cur.landR * Math.cos(a), cur.landY, cur.landR * Math.sin(a), 1, 0.02, [0.3, 0.9], [0.05, 0.3], c);
    }
  }
  // The upright jets' heads: where the column stops and spreads the water is white and frothy (a soft, bubbling blob
  // a hand or two across, the brightest thing at night).
  for (let k = 0; k < FOUNTAIN.uprights.count; k++) {
    const j = uprightJet(k);
    for (let i = 0; i < B.head; i++) {
      put({
        kind: PARTICLE_KIND.head, origin: [j.origin[0], FOUNTAIN.uprights.baseY + FOUNTAIN.uprights.height - 0.07 - 0.06 * i, j.origin[2]],
        velocity: [0, 0, 0], kick: [0, 0], kickAt: 0, life: wrapPeriod(1.3 + 0.4 * rand()), phase: rand(), show: 0,
        size: 0.16 + 0.06 * rand() - 0.04 * i, seed: k + rand() * 0.999, far: 1,
      });
    }
  }
  // The mist: soft clouds over the crowns and the arcs' landing ring, drifting up slowly.
  for (let i = 0; i < B.mist; i++) {
    const crown = i < FOUNTAIN.uprights.count;
    const j = crown ? uprightJet(i) : arcJet((i - FOUNTAIN.uprights.count) % FOUNTAIN.arcs.count);
    const a = j.angle;
    const r = crown ? FOUNTAIN.uprights.r : ARC_LAND_R + 0.1;
    const y = crown ? FOUNTAIN.uprights.baseY + FOUNTAIN.uprights.height - 0.5 : FOUNTAIN.pool.y + 0.35;
    put({
      kind: PARTICLE_KIND.mist, origin: [r * Math.cos(a), y, r * Math.sin(a)], velocity: [0, 0.06, 0], kick: [0, 0], kickAt: 0,
      life: wrapPeriod(4 + 2 * rand()), phase: rand(), show: 0, size: crown ? 1.3 + 0.3 * rand() : 0.8 + 0.3 * rand(), seed: rand() * 16, far: 0,
    });
  }
  return { particles: [...far, ...near], farCount: far.length };
}

// ───────────────────────────────────────── the lights at night ─────────────────────────────────────────

/** The underwater lights: the model's 8 under the upright jets (r 1.9, in the pedestal's pool) and 16 in the arcs' nozzles. */
export function fountainLights(): Array<{ x: number; y: number; z: number; kind: "upright" | "nozzle" }> {
  const out: Array<{ x: number; y: number; z: number; kind: "upright" | "nozzle" }> = [];
  for (let k = 0; k < FOUNTAIN.uprights.count; k++) {
    const o = uprightJet(k).origin;
    out.push({ x: o[0], y: FOUNTAIN.tier.y - 0.02, z: o[2], kind: "upright" });
  }
  for (let k = 0; k < FOUNTAIN.arcs.count; k++) {
    const o = arcJet(k).origin;
    out.push({ x: o[0], y: FOUNTAIN.pool.y - 0.02, z: o[2], kind: "nozzle" });
  }
  return out;
}
