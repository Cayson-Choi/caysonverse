/**
 * Seeded random numbers for the runtime vegetation (veg3d).
 *
 *  - `mulberry32`: a small fast generator for everything the runtime invents itself (plant scatter, twigs, colours).
 *  - `PyRandom`: Python's `random.Random(int)` (MT19937, `init_by_array`, `random()` with 53 bits, `uniform`,
 *    `randrange`), bit for bit. The village's art script (`art/village/tools/parts_trees.py`, Blender's Python) drew the
 *    plaza cherries' trunks and limbs with it; replaying the same calls gives their exact limbs, so the new twigs and
 *    blossoms grow out of the baked, light-mapped limbs that stay in `village.glb` (checked against the file: every
 *    limb tip within 2 cm, cherryTree.test.ts).
 */

/** mulberry32: a 32-bit seeded generator, uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit integer hash of up to three integers (cell keys, per-instance seeds). */
export function hash3(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A hash of a point to [0, 1) (the same point always gives the same number). */
export function hashUnit(a: number, b: number, c = 0): number {
  return hash3(a, b, c) / 4294967296;
}

/** Smooth 3D value noise in [0, 1] (trilinear over a lattice of hashed corners, smoothstepped). */
export function valueNoise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const h = (i: number, j: number, k: number) => hashUnit(xi + i + seed * 131, yi + j, zi + k + seed * 17);
  const x00 = h(0, 0, 0) + (h(1, 0, 0) - h(0, 0, 0)) * sx;
  const x10 = h(0, 1, 0) + (h(1, 1, 0) - h(0, 1, 0)) * sx;
  const x01 = h(0, 0, 1) + (h(1, 0, 1) - h(0, 0, 1)) * sx;
  const x11 = h(0, 1, 1) + (h(1, 1, 1) - h(0, 1, 1)) * sx;
  const y0 = x00 + (x10 - x00) * sy;
  const y1 = x01 + (x11 - x01) * sy;
  return y0 + (y1 - y0) * sz;
}

const N = 624;
const M = 397;

/** Python's `random.Random(seed)` for a non-negative integer seed below 2^32 (all the art script uses). */
export class PyRandom {
  private readonly mt = new Uint32Array(N);
  private mti = N + 1;

  constructor(seed: number) {
    this.initByArray([seed >>> 0]);
  }

  private initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1]!;
      mt[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
    }
    this.mti = N;
  }

  private initByArray(key: readonly number[]): void {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1]!;
      mt[i] = ((mt[i]! ^ Math.imul(prev ^ (prev >>> 30), 1664525)) + key[j]! + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1]!;
      mt[i] = ((mt[i]! ^ Math.imul(prev ^ (prev >>> 30), 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  /** One raw 32-bit output (genrand_uint32). */
  uint32(): number {
    const mt = this.mt;
    if (this.mti >= N) {
      let kk = 0;
      const mag = (y: number) => (y & 1 ? 0x9908b0df : 0);
      for (; kk < N - M; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff);
        mt[kk] = (mt[kk + M]! ^ (y >>> 1) ^ mag(y)) >>> 0;
      }
      for (; kk < N - 1; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff);
        mt[kk] = (mt[kk + (M - N)]! ^ (y >>> 1) ^ mag(y)) >>> 0;
      }
      const y = (mt[N - 1]! & 0x80000000) | (mt[0]! & 0x7fffffff);
      mt[N - 1] = (mt[M - 1]! ^ (y >>> 1) ^ mag(y)) >>> 0;
      this.mti = 0;
    }
    let y = mt[this.mti++]!;
    y ^= y >>> 11;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** `random.random()`: 53 random bits in [0, 1). */
  random(): number {
    const a = this.uint32() >>> 5;
    const b = this.uint32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** `random.uniform(a, b)`. */
  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  /** `random.randrange(n)` for 0 < n <= 2^32 (`_randbelow_with_getrandbits`). */
  randrange(n: number): number {
    const k = Math.floor(Math.log2(n)) + 1; // n.bit_length()
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** `random.getrandbits(k)` for k <= 32. */
  getrandbits(k: number): number {
    return this.uint32() >>> (32 - k);
  }
}
