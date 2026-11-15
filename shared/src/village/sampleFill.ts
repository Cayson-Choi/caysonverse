import { VILLAGE_LAYOUT, cubbyAnchors, type CubbyAnchor } from "./villageLayout";

/**
 * Which of the memorial hall's cubbies hold the example memorial (견본), shared by the client (which draws and describes it,
 * client/src/village/sampleCubbies.ts) and the server (which lights a candle only on a filled cubby).
 *
 * 2026-11-13 (owner: "지금 추모관에는 다 빼고 예로 실사 사진 하나 첨부된 추모칸 하나만 만들어놓아보도록 해"): the 218 invented
 * example cubbies are gone. Exactly ONE cubby is filled, at eye height in bank A beside the niche, as a clearly marked sample.
 * Every other cubby of the 368 is empty and waits for a family.
 */

/** The single example cubby (a `cubbyId`: bank A, row 3 from the bottom = eye height, column 11). */
export const SAMPLE_CUBBY_IDS: readonly string[] = Object.freeze(["M1-A-r3-c11"]);

/** FNV-1a hash of a string (32-bit): the seed of a cubby's choices. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The ids of the filled cubbies among `anchors` (the example cubby, if it is one of them). */
export function sampleFilledIds(anchors: readonly CubbyAnchor[], ids: readonly string[] = SAMPLE_CUBBY_IDS): ReadonlySet<string> {
  const have = new Set(anchors.map((a) => a.id));
  return new Set(ids.filter((id) => have.has(id)));
}

/** The filled cubbies of the shared layout. */
export const SAMPLE_FILLED_IDS: ReadonlySet<string> = sampleFilledIds(cubbyAnchors(VILLAGE_LAYOUT));
