/**
 * What every ride's sound module builds: a `RideMix` owns its nodes (made once, into `out`), a tick moves their parameters with
 * the ride's state, `dispose` stops them. The live driver (land/rideSfx.ts) and the offline renderer (e2e/sfx-render.mjs) call the
 * same two functions, so the WAV files are the game's own sound.
 */
export interface RideMix<I> {
  /** `t` is the context time to align events to; `input` is the ride's state this tick (see each ride's input type). */
  update(t: number, input: I): void;
  dispose(): void;
}
