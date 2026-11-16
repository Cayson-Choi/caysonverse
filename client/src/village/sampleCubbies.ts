import { VILLAGE_LAYOUT, cubbyAnchors, type CubbyAnchor } from "@caysonverse/shared/village/villageLayout";
import { SAMPLE_CUBBY_IDS, hashId, sampleFilledIds } from "@caysonverse/shared/village/sampleFill";

// The choice of WHICH cubbies are filled lives in the shared package: the server lights candles only on those.
export { SAMPLE_CUBBY_IDS, hashId };

/**
 * The memorial hall's example cubby (케이슨 마을 Task 9, cut down 2026-11-13): until families can place their own, ONE of the 368
 * cubbies is filled with a sample memorial (견본) — the props in the cubby (from memorial_props.glb), a pet's portrait, a name, the
 * years and one line. The other 367 are empty.
 *
 * Seed-stable: every choice comes from the cubby's own id (a hash), so every visitor, every visit and every client sees
 * the same hall, and a change to one cubby's data moves nothing else. Pure data; the scene instances it (cubbyProps.ts)
 * and the close-up card reads it (CubbyView).
 *
 * The props are placed in the cubby's own frame, the way the Task 8 renders placed them (art/village/tools/render_memorial.py
 * `dress_cubbies`): `u` along the run (m, from the opening centre), `w` back from the opening into the cubby (m), `dy` up
 * from the cubby's floor, `turn` (rad) added to the cubby's facing.
 */

/** The placeholder portraits: one atlas of 4 x 4 tiles (128 x 160 px each), drawn by scripts/make-sample-photos.mjs. */
export const SAMPLE_PHOTO_ATLAS = { url: "/village/sample-photos/atlas.webp", cols: 4, rows: 4, count: 16 } as const;

/**
 * The large hi-res portrait of the sample cubby (2026-11-17: the photo is the cubby's main object now, 45 % of its height, so the
 * 128 px atlas tile was too soft). 512 x 640 WebP, 4:5.
 */
export const SAMPLE_PHOTO_URL = "/village/sample-photos/sample_1.webp";

/** The props of memorial_props.glb (`prop__<kind>`). Since 2026-11-17 a cubby uses only frame_large, mum_vase and candle. */
export type PropKind =
  | "frame_large"
  | "candle"
  | "mum_vase"
  | "urn_wood"
  | "urn_ceramic"
  | "photo_frame"
  | "house_frame"
  | "flowers"
  | "plush_bear"
  | "tealight"
  | "stone_jar"
  | "name_card";

export const PROP_KINDS: readonly PropKind[] = [
  "frame_large",
  "candle",
  "mum_vase",
  "urn_wood",
  "urn_ceramic",
  "photo_frame",
  "house_frame",
  "flowers",
  "plush_bear",
  "tealight",
  "stone_jar",
  "name_card",
];

/** One prop in a cubby, in the cubby's frame (see the file header). */
export interface PropPlacement {
  kind: PropKind;
  u: number;
  w: number;
  dy: number;
  turn: number;
}

export interface SampleCubby {
  /** The cubby (a `cubbyAnchors` id, `M1-<bank>-r<row>-c<col>`). */
  id: string;
  name: string;
  born: number;
  passed: number;
  /** One line from the family. */
  line: string;
  /** The portrait: a tile index into `SAMPLE_PHOTO_ATLAS`. */
  photo: number;
  props: readonly PropPlacement[];
}

/** Pet names (a fixed list). */
export const SAMPLE_NAMES: readonly string[] = [
  "초코", "콩이", "보리", "두부", "나비", "까미", "해피", "몽이", "별이", "루비",
  "코코", "하늘이", "밤이", "쿠키", "모카", "구름이", "사랑이", "토리", "단비", "호두",
  "달이", "봄이", "망고", "솜이", "레오", "치즈", "감자", "뭉치", "복실이", "누리",
];

/** One line from the family: gentle, "~요" (no "!"). */
export const SAMPLE_LINES: readonly string[] = [
  "늘 곁에 있어 줘서 고마웠어요",
  "산책길마다 네 생각이 나요",
  "함께한 모든 날이 선물이었어요",
  "따뜻했던 너를 오래 기억할게요",
  "무지개다리 너머에서 편히 쉬어요",
  "다음에 꼭 다시 만나요",
  "우리 집 막내, 많이 사랑해요",
  "햇살 좋은 날이면 네가 보고 싶어요",
  "너와 보낸 시간이 참 행복했어요",
  "언제나 우리 가족이에요",
];

/** Where the latest sample years end (the hall opened in 2026). */
const LAST_YEAR = 2026;

/** A small seeded generator (mulberry32): the same seed always gives the same numbers in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What a cubby holds (owner 2026-11-17: "추모관은 사진과 국화꽃과 초만 넣는 걸로 하자"), the same in the sample and in every
 * family's cubby: the photo in a walnut frame standing at the back in the middle (the cubby's main object, 60 % of its height),
 * white chrysanthemums in a small vase at the front left, a pillar candle in a glass holder at the front right — unlit until
 * someone presses 촛불 켜기 (CANDLE_SPOT). The vase's heads lean away from the photo, the candle stays below it.
 */
export const CUBBY_SET: readonly PropPlacement[] = Object.freeze([
  { kind: "frame_large", u: 0, w: 0.215, dy: 0, turn: 0 },
  { kind: "mum_vase", u: -0.13, w: 0.1, dy: 0, turn: 0 },
  { kind: "candle", u: 0.135, w: 0.09, dy: 0, turn: 0 },
] satisfies PropPlacement[]);

/** Kept for the old name. */
export const SAMPLE_PROPS = CUBBY_SET;

/**
 * The sample memorials for `anchors`: the ids of `SAMPLE_CUBBY_IDS` that are among them, each with its props, a name, the years, a
 * line and a portrait (seed-stable from the id). In the order of `anchors`.
 */
export function makeSampleCubbies(anchors: readonly CubbyAnchor[], ids: readonly string[] = SAMPLE_CUBBY_IDS): SampleCubby[] {
  const chosen = sampleFilledIds(anchors, ids);
  const out: SampleCubby[] = [];
  for (const a of anchors) {
    if (!chosen.has(a.id)) continue;
    const rnd = seeded(hashId(a.id));
    const age = 8 + Math.floor(rnd() * 10); // 8..17 years
    const passed = LAST_YEAR - Math.floor(rnd() * 7); // 2020..2026
    out.push({
      id: a.id,
      name: SAMPLE_NAMES[Math.floor(rnd() * SAMPLE_NAMES.length)]!,
      born: passed - age,
      passed,
      line: SAMPLE_LINES[Math.floor(rnd() * SAMPLE_LINES.length)]!,
      photo: Math.floor(rnd() * SAMPLE_PHOTO_ATLAS.count),
      props: SAMPLE_PROPS,
    });
  }
  return out;
}

/** The hall's cubbies (every anchor of the layout). */
export const HALL_CUBBY_ANCHORS: readonly CubbyAnchor[] = Object.freeze(cubbyAnchors(VILLAGE_LAYOUT));

/** The hall's sample memorials (brief: `SAMPLE_CUBBIES`). */
export const SAMPLE_CUBBIES: readonly SampleCubby[] = Object.freeze(makeSampleCubbies(HALL_CUBBY_ANCHORS));

/** The sample of a cubby by id (absent: the cubby is empty). */
export const SAMPLE_BY_ID: ReadonlyMap<string, SampleCubby> = new Map(SAMPLE_CUBBIES.map((s) => [s.id, s]));
