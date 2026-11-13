/**
 * One seat marker of a model (the memorial hall's `seat__*` empties; shared/src/village/generated/memorialSeats.ts is
 * generated from them by scripts/gen-memorial-seats.ts). A marker is one PLACE to sit on one piece of furniture; the
 * seat list (`benchSeats.ts`) turns it into one seat, or — for a backless seat that can be sat from either side — two
 * facings of the same place that exclude each other.
 */
export interface SeatMarker {
  id: string;
  furn: "bench" | "sofa" | "armchair" | "chair";
  /** `backless`: a bench, sat from either side; `backed`: a sofa, an armchair, a chair — sat from the front only, leaning back. */
  kind: "backless" | "backed";
  /** The seat surface's middle (x, z) and height (m). */
  x: number;
  z: number;
  y: number;
  /** The way a sitter faces (game yaw: 0 faces +z). For a backless seat that is sat from both sides, the "front" facing. */
  yaw: number;
  /** From the marker forward to the seat's front edge (m). */
  edge: number;
  /** From the marker backward to the backrest's face (m); 0 for backless. */
  back: number;
  /** The seat's width along the furniture (m). */
  width: number;
  /** Seats of one group are never taken at the same time. */
  group: string;
  /** A backless seat that can be sat from either side. */
  both: boolean;
  /** Which way a sitter steps off, turned from the facing (rad): 0 ahead, pi behind. */
  exitTurn: number;
  /** How far the sitter leans back into a backrest (rad). */
  lean: number;
}
