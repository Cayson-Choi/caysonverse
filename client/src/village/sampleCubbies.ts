import { VILLAGE_LAYOUT, cubbyAnchors, type CubbyAnchor } from "@caysonverse/shared/village/villageLayout";

/**
 * The memorial hall's example cubbies (케이슨 마을 Task 9): until families can place their own, 60 % of the 266 cubbies
 * are filled with a sample memorial so the hall reads as a real 봉안당 — the props in the cubby (from
 * memorial_props.glb), a pet's portrait (a tile of the placeholder atlas), a name, the years and one line.
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

/** How many of the hall's cubbies hold a sample (brief: 60 %). */
export const SAMPLE_FILL = 0.6;

/** The nine props of memorial_props.glb (`prop__<kind>`). */
export type PropKind =
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
  /** The cubby (a `cubbyAnchors` id, `<wall>_<row>_<col>`). */
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

/** FNV-1a hash of a string (32-bit): the seed of a cubby's choices. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

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

const between = (rnd: () => number, lo: number, hi: number) => lo + (hi - lo) * rnd();

/** The props of one filled cubby (the Task 8 render's recipe; every filled cubby has an urn, a portrait and a name card). */
function propsFor(rnd: () => number): PropPlacement[] {
  const out: PropPlacement[] = [];
  const put = (kind: PropKind, u: number, w: number, turn = 0, dy = 0) => out.push({ kind, u, w, dy, turn });
  put(rnd() < 0.55 ? "urn_wood" : "urn_ceramic", between(rnd, -0.1, -0.05), 0.2, between(rnd, -0.3, 0.3));
  put("photo_frame", between(rnd, 0.06, 0.09), 0.14, between(rnd, -0.15, 0.05));
  if (rnd() < 0.35) put("house_frame", between(rnd, -0.03, 0.03), 0.3);
  if (rnd() < 0.55) put("flowers", between(rnd, 0.11, 0.15), 0.08, between(rnd, -1, 1));
  if (rnd() < 0.3) put("plush_bear", between(rnd, -0.15, -0.12), 0.1, between(rnd, -0.4, 0.2));
  else if (rnd() < 0.5) put("tealight", between(rnd, -0.15, -0.11), 0.06);
  if (rnd() < 0.2) put("stone_jar", between(rnd, 0, 0.04), 0.27);
  put("name_card", between(rnd, -0.06, 0.02), 0.03);
  return out;
}

/**
 * The sample memorials for `anchors`: the `SAMPLE_FILL` share of them (rounded) with the lowest hash of their id — a
 * seed-stable choice spread over both walls and every row — each with its props, a name, the years, a line and a
 * portrait. In the order of `anchors`.
 */
export function makeSampleCubbies(anchors: readonly CubbyAnchor[], fill: number = SAMPLE_FILL): SampleCubby[] {
  const want = Math.round(anchors.length * fill);
  const chosen = new Set(
    [...anchors]
      .sort((a, b) => hashId(`fill:${a.id}`) - hashId(`fill:${b.id}`) || (a.id < b.id ? -1 : 1))
      .slice(0, want)
      .map((a) => a.id),
  );
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
      props: propsFor(rnd),
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
