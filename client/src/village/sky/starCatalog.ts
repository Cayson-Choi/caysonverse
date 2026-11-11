/**
 * The village's star file (`/sky/stars.v1.bin`, scripts/build-star-catalog.ts): read once, kept in memory (20 KB), shared
 * by the star layer and the star finder. Pure parsing (`parseStarCatalog`, unit-tested) plus a cached fetch.
 *
 * Format (little-endian): a 16-byte header "CVS1" · count u16 · the cumulative counts at V ≤ 3.0 / 4.0 / 4.5 / 5.0 / 5.5
 * (u16 × 5), then 8 bytes a star, brightest first: HR u16 · RA u16 (×360°/65536) · Dec i16 (×90°/32767) · V u8 (/25 − 2)
 * · B−V u8 (/70 − 0.5; 255 = none). J2000.0 positions.
 */

/** The file's address (a new format gets a new name, so a cached old file is never read as the new one). */
export const STAR_CATALOG_URL = "/sky/stars.v1.bin";

/** The magnitudes the header's cumulative counts are for. */
export const CATALOG_CUTS = [3, 4, 4.5, 5, 5.5] as const;

export interface StarCatalog {
  count: number;
  /** How many of the first stars are at or brighter than each of `CATALOG_CUTS`. */
  cumulative: readonly number[];
  hr: Uint16Array;
  /** J2000 unit vectors, 3 floats a star (x toward the equinox, z toward the north pole). */
  eq: Float32Array;
  /** V magnitude. */
  mag: Float32Array;
  /** B−V colour index; NaN where the catalogue has none. */
  bv: Float32Array;
  /** Index of an HR number, -1 when absent. */
  indexOf(hr: number): number;
}

const HEADER = 16;
const RECORD = 8;

/** Parse the file. Throws on a wrong magic, a truncated body or counts that do not add up. */
export function parseStarCatalog(buffer: ArrayBuffer): StarCatalog {
  const view = new DataView(buffer);
  if (buffer.byteLength < HEADER) throw new Error("star file: too short");
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "CVS1") throw new Error(`star file: bad magic ${JSON.stringify(magic)}`);
  const count = view.getUint16(4, true);
  if (buffer.byteLength !== HEADER + count * RECORD) throw new Error(`star file: ${buffer.byteLength} bytes for ${count} stars`);
  const cumulative: number[] = [];
  for (let i = 0; i < CATALOG_CUTS.length; i++) {
    const n = view.getUint16(6 + i * 2, true);
    if (n > count || (i > 0 && n < cumulative[i - 1]!)) throw new Error("star file: bad cumulative counts");
    cumulative.push(n);
  }
  const hr = new Uint16Array(count);
  const eq = new Float32Array(count * 3);
  const mag = new Float32Array(count);
  const bv = new Float32Array(count);
  const index = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const o = HEADER + i * RECORD;
    hr[i] = view.getUint16(o, true);
    const ra = (view.getUint16(o + 2, true) / 65536) * 2 * Math.PI;
    const dec = (view.getInt16(o + 4, true) / 32767) * (Math.PI / 2);
    const cd = Math.cos(dec);
    eq[i * 3] = cd * Math.cos(ra);
    eq[i * 3 + 1] = cd * Math.sin(ra);
    eq[i * 3 + 2] = Math.sin(dec);
    mag[i] = view.getUint8(o + 6) / 25 - 2;
    const b = view.getUint8(o + 7);
    bv[i] = b === 255 ? Number.NaN : b / 70 - 0.5;
    if (!index.has(hr[i]!)) index.set(hr[i]!, i);
  }
  return { count, cumulative, hr, eq, mag, bv, indexOf: (n) => index.get(n) ?? -1 };
}

/** How many of the brightest stars a draw shows when it stops at magnitude `cut` (one of `CATALOG_CUTS`, else all). */
export function countUpTo(cat: Pick<StarCatalog, "count" | "cumulative">, cut: number): number {
  const i = CATALOG_CUTS.indexOf(cut as (typeof CATALOG_CUTS)[number]);
  return i < 0 ? cat.count : cat.cumulative[i]!;
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

let cached: StarCatalog | null = null;
let pending: Promise<StarCatalog> | null = null;

/**
 * The catalogue, fetched once (later calls share the request and then the result). A failed request is forgotten, so a
 * later call tries again; the caller keeps the random stars meanwhile.
 */
export function loadStarCatalog(fetchFn: FetchLike = (u) => fetch(u), url = STAR_CATALOG_URL): Promise<StarCatalog> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = fetchFn(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(`star file: HTTP ${res.status}`);
      const cat = parseStarCatalog(await res.arrayBuffer());
      cached = cat;
      return cat;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** The catalogue if it is already in memory. */
export function cachedStarCatalog(): StarCatalog | null {
  return cached;
}

/** Tests: forget the cache. */
export function resetStarCatalogCache(): void {
  cached = null;
  pending = null;
}
