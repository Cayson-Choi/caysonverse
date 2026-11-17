/**
 * The flowers' layout and the beds' soil from plain data (perf/no-hitch, 2026-11-17): placeFlowers + buildSoil were a
 * slow phone's largest single step of the arrival (2-6 s at 4x CPU, in pieces of up to a second). The same function
 * runs in the crowns' worker (crownWorker.ts) and, where there is none, on the page.
 */
import type { BufferGeometry } from "three";
import { PLAZA_BEDS, placeFlowers, type Bed, type Plant } from "./flowerPlacement";
import { buildSoil } from "./vegSoil";
import type { Card } from "./vegCards";
import { geoData, type GeoData } from "./crownGrow";
import type { Vec3 } from "./vegLod";

/** The layout as plain data: the cards replaced by plants as indices into the cards sent. */
export interface FloraResult {
  plants: Plant[];
  replaced: number[];
  soil: Array<{ geo: GeoData | BufferGeometry; centre: Vec3; radius: number }>;
  coping: GeoData | BufferGeometry | null;
  tris: number;
  beds: number;
}

/**
 * Lay the flowers out on `cards` in `beds`, build their beds' soil and stand the plants on it. `asData`: geometries as
 * arrays. `beds`: the plaza's, and for the Colmar houses' own file also their window boxes (houses/houseFlowerBoxes.ts).
 */
export function layFlora(cards: readonly Card[], asData = false, beds: readonly Bed[] = PLAZA_BEDS): FloraResult {
  const placed = placeFlowers(cards, beds);
  const soil = buildSoil(placed.plants);
  for (const p of placed.plants) {
    const h = soil.heightAt(p);
    if (h !== null) p.y = h - 0.004;
  }
  const index = new Map<Card, number>(cards.map((c, i) => [c, i]));
  const g = (geo: BufferGeometry) => (asData ? geoData(geo) : geo);
  return {
    plants: placed.plants,
    replaced: placed.replaced.map((c) => index.get(c)!),
    soil: soil.soil.map((a) => ({ geo: g(a.geo), centre: a.centre, radius: a.radius })),
    coping: soil.coping ? g(soil.coping) : null,
    tris: soil.tris,
    beds: soil.beds,
  };
}

/** The buffers to transfer with a layout. */
export function floraTransfers(r: FloraResult): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const add = (d: GeoData | BufferGeometry | null) => {
    if (!d || "isBufferGeometry" in d) return;
    for (const a of Object.values(d.attrs)) out.push(a.array.buffer as ArrayBuffer);
    if (d.index) out.push(d.index.buffer as ArrayBuffer);
  };
  for (const s of r.soil) add(s.geo);
  add(r.coping);
  return out;
}
