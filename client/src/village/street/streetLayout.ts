/**
 * 케이슨 마을's lamp posts and street banners (owner 2026-11-16: "깃발들도 너무 밋밋하다 뭔가 의미있고 실제같은 깃발들로
 * 바꾸자", and of the posts: "이것도 너무 엉성해"). The shipped village.glb bakes both into its merged per-cell meshes
 * (art/village/tools/parts_props.py `lamps` / `banners`, parts_fill.py `lane_lamps`): a faceted 10-sided post with an
 * 8-sided lantern, and 6.6 m poles with one flat painted card each. The game takes those triangles out of its clone
 * (streetTrim.ts) and draws the new ones here, at the SAME places (the night light map's warm pools stay under them).
 *
 * For the later village rebake (the transforms to bake in, all game metres, y up, yaw as three.js rotation.y = the
 * Blender scripts' `yaw` in vlib.loc):
 *  - LAMP_POSTS: every post's foot (x, z) and its lantern's centre height `lightY` (= the glb's `light__lamp_N` empty;
 *    plaza/ring posts 4.23, lane posts 3.83). `yaw` turns the base's access door away from the plaza centre.
 *  - BANNER_POLES: the eight poles around the plaza paving at r 26 (the old poles' places), now street lights 5.03 m to the
 *    lantern's centre, each carrying a PAIR of 60 x 180 cm banners on two-way arms (local -x: design A, +x: design B as
 *    seen from the plaza), fabric 0.12..0.72 m out from the pole axis, its top rod at 4.22 m and bottom rod at 2.42 m.
 *  - The prints: client/public/models/village/street_banners.webp, made by tools/banners (banners.html -> render ->
 *    print). BANNER_SLOTS says which atlas cell holds which banner.
 */

/** One post as it stands: its foot and the centre of its lantern. */
export interface LampPost {
  /** The glb's light empty for this lantern (light__lamp_N), kept for the rebake and the tests. */
  light: string;
  x: number;
  z: number;
  /** The lantern's centre (the light empty's height). */
  lightY: number;
  /** Turn (rad, three.js rotation.y): the base's access door faces local +z. */
  yaw: number;
}

/** The height the post model is drawn for (the plaza and ring posts); other heights stretch the shaft (`lift`). */
export const LAMP_MODEL_LIGHT_Y = 4.23;

/** Door away from the plaza centre (local +z = the direction from the centre to the post). */
const outward = (x: number, z: number): number => Math.atan2(x, z);

const post = (light: string, x: number, z: number, lightY: number): LampPost => ({ light, x, z, lightY, yaw: outward(x, z) });

/** The village's lamp posts, from village.glb's lights (plaza 1-5, ring road sidewalk 6-15, lanes 42-43). */
export const LAMP_POSTS: readonly LampPost[] = [
  post("light__lamp_1", 12.93, -24.84, 4.23),
  post("light__lamp_2", 27.57, -4.86, 4.23),
  post("light__lamp_3", 17.05, 22.21, 4.23),
  post("light__lamp_4", -17.05, 22.21, 4.23),
  post("light__lamp_5", -12.93, -24.84, 4.23),
  post("light__lamp_6", 33.255, 19.2, 4.23),
  post("light__lamp_7", 24.683, 29.416, 4.23),
  post("light__lamp_8", 13.134, 36.084, 4.23),
  post("light__lamp_9", -24.683, 29.416, 4.23),
  post("light__lamp_10", -33.255, 19.2, 4.23),
  post("light__lamp_11", -37.817, -6.668, 4.23),
  post("light__lamp_12", -24.683, -29.416, 4.23),
  post("light__lamp_13", -13.134, -36.084, 4.23),
  post("light__lamp_14", 13.134, -36.084, 4.23),
  post("light__lamp_15", 24.683, -29.416, 4.23),
  post("light__lamp_42", 2.35, -51, 3.83),
  post("light__lamp_43", -26.35, 44.723, 3.83),
];

/** The old posts' heights in the bake (parts_props.lamp h): the trim takes out what stood up to here (+ the cap). */
export const OLD_LAMP_TOP_ABOVE_LIGHT = 0.42;

/** What a banner pair says: one theme, two prints (A: the title, B: the details). */
export type BannerTheme = "village" | "cherry" | "lake" | "memorial" | "bus" | "stars";

/**
 * The atlas: 6 columns x 2 rows of 60 x 180 cm prints (row 0: each theme's A print, row 1: its B print), in this order.
 * (tools/banners/banners.html draws them in the same order.)
 */
export const BANNER_THEMES: readonly BannerTheme[] = ["village", "cherry", "lake", "memorial", "bus", "stars"];
export const BANNER_ATLAS = { cols: 6, rows: 2 } as const;

/** What each print says (for the report, the tests and anyone reading the code; the art is the source of truth). */
export const BANNER_TEXT: Readonly<Record<BannerTheme, { a: string; b: string }>> = {
  village: { a: "케이슨 마을 · 천천히 걷고 오래 머무는 곳 · CAYSON VILLAGE", b: "어서 오세요 · 분수 광장에서 만나요" },
  cherry: { a: "케이슨 마을 벚꽃 축제 · 꽃 피는 동안 언제나 열려요", b: "벚꽃길 따라 · 천천히 걸어 보세요" },
  lake: { a: "케이슨 낚시터 · 찌가 쑥 올라오면 그때 당겨요!", b: "낚싯대는 관리소 앞에서 빌려요 · 잡은 물고기로 도감을 채워요" },
  memorial: { a: "케이슨 마을 추모관 · 소중한 기억을 함께 간직해요", b: "촛불 하나 편지 한 장 · 언제든 들러 마음을 전해요" },
  bus: { a: "마을 버스 · 광장 옆 정류장에서 마을 한 바퀴", b: "출발 시각은 정류장 안내판에서 · 버스에 앉아 마을 구경해요" },
  stars: { a: "별 보기 좋은 마을 · 해가 지면 하늘을 올려다봐요", b: "별자리 찾기 · 밤이 되면 망원경 단추를 눌러 보세요" },
};

/** One banner pole: the old pole's place (r 26 around the plaza) and the pair it carries. */
export interface BannerPole {
  x: number;
  z: number;
  /** three.js rotation.y: local +z faces the plaza centre, the arms run along local x (as the bake's poles). */
  yaw: number;
  theme: BannerTheme;
}

/** The old poles' angles (deg, atan2(z, x)) in parts_props.banners, and what each pair now says. */
const BANNER_POLE_ANGLES: ReadonlyArray<readonly [number, BannerTheme]> = [
  [-100, "memorial"], // by the memorial hall's lane
  [-80, "village"],
  [-50, "cherry"],
  [-20, "bus"], // the nearest to the bus stop (ring road, -11 deg)
  [30, "lake"], // on the side of the fishing lake (x 95..186)
  [55, "stars"],
  [125, "village"],
  [150, "cherry"],
];

export const BANNER_POLE_RADIUS = 26;

export const BANNER_POLES: readonly BannerPole[] = BANNER_POLE_ANGLES.map(([deg, theme]) => {
  const a = (deg * Math.PI) / 180;
  const x = BANNER_POLE_RADIUS * Math.cos(a);
  const z = BANNER_POLE_RADIUS * Math.sin(a);
  return { x, z, yaw: Math.atan2(-x, -z), theme };
});

/** The banner poles are street lights too (a 가로등 with its 현수기, as Korean towns hang them): the lantern's centre. */
export const BANNER_POLE_LIGHT_Y = 5.03;

/** A banner: 60 x 180 cm (the common Korean 가로등 현수기 size), its rods, and how far from the pole axis it hangs. */
export const BANNER = {
  width: 0.6,
  height: 1.8,
  /** Fabric's inner edge from the pole axis (m): the arm's clamp and ~10 cm of air. */
  inner: 0.12,
  /** The top rod (through the top pocket) and the bottom rod (m above the ground). */
  topY: 4.22,
  bottomY: 2.42,
  /** The arms reach this far from the pole axis (m), past the fabric's outer edge. */
  armReach: 0.78,
} as const;

/** The old banner pole in the bake (parts_props.banners): its pole radius, arm reach and the card's height span. */
export const OLD_BANNER = { poleRadius: 0.12, top: 6.7, armReach: 0.74, cardBottom: 4.15, cardTop: 6.25 } as const;

/** The atlas cell (column, row) of a pole's print on one side: local -x carries A, +x carries B. */
export function bannerSlot(theme: BannerTheme, side: -1 | 1): { col: number; row: number } {
  return { col: BANNER_THEMES.indexOf(theme), row: side === -1 ? 0 : 1 };
}

/** Every lantern the new posts light (the lamp posts' and the banner poles'): world positions. */
export function lanternPositions(): Array<[number, number, number]> {
  return [
    ...LAMP_POSTS.map((p): [number, number, number] => [p.x, p.lightY, p.z]),
    ...BANNER_POLES.map((p): [number, number, number] => [p.x, BANNER_POLE_LIGHT_Y, p.z]),
  ];
}
