/**
 * 케이슨 마을의 밤하늘 — 별자리 찾기의 목표 31개 (별자리 23 + 별무리 8) — pure data, shared by the client (and, later, the
 * server's progress save: the `id`s are the keys and never change).
 *
 * Every line is a stick figure drawn for this project (no planetarium's line data is used): its ends are star numbers of
 * the Yale Bright Star Catalogue, 5th ed. (`HR`, Hoffleit & Warren 1991; the stars themselves ship in
 * client/public/sky/stars.v1.bin, built by scripts/build-star-catalog.ts, which fails when a figure's star is missing).
 * The Korean names are the Korean Astronomical Society's standard names and the traditional names in common use (facts);
 * every hint and one-line story is new text written for this project (from Greek myth and Korean folklore, public domain).
 *
 * Seasons follow the Korean calendar date (KST): 3-5 spring, 6-8 summer, 9-11 autumn, 12-2 winter; `north` is the
 * all-year northern sky. `evening` is where the figure's centre stands at 21:00 KST in the middle of its season (for the
 * album's "언제 보이는지" line; the live sky is computed, never read from here).
 */

export type SkySeason = "spring" | "summer" | "autumn" | "winter" | "north";

export interface SkyFigure {
  /** The progress key ("UMa", "dipper", ...): never renamed. */
  id: string;
  /** "큰곰자리" */
  name: string;
  /** A second name shown in brackets ("플레이아데스"). */
  alias?: string;
  kind: "constellation" | "asterism";
  season: SkySeason;
  /** The shape to look for ("북두칠성 국자를 등과 꼬리로 진 큰 곰"). */
  hint: string;
  /** The one-line story shown when it is found. */
  story: string;
  /** Where its centre stands at 21:00 KST mid-season: altitude (°) and an 8-point compass word. */
  evening: { altDeg: number; dir: string };
  /** The stick figure: pairs of BSC5 HR numbers. */
  lines: readonly (readonly [number, number])[];
  /** The star the finder aims at instead of the figure's mean direction (the spring arc: Arcturus). */
  anchorHr?: number;
  /** Drawn as a small circle of this radius (°) instead of lines (the Pleiades: too small for lines). */
  ring?: number;
  /** Drawn dashed (the Polaris pointer). */
  dashed?: boolean;
}

/** Korean season names. */
export const SEASON_NAME: Readonly<Record<SkySeason, string>> = {
  spring: "봄",
  summer: "여름",
  autumn: "가을",
  winter: "겨울",
  north: "북쪽 하늘",
};

/** The four seasons in calendar order, then the all-year northern sky. */
export const SEASON_ORDER: readonly SkySeason[] = ["spring", "summer", "autumn", "winter", "north"];

export const SKY_FIGURES: readonly SkyFigure[] = [
  {
    id: "UMa",
    name: "큰곰자리",
    kind: "constellation",
    season: "spring",
    hint: "북두칠성 국자를 등과 꼬리로 진 큰 곰",
    story: "헤라의 질투로 곰이 된 칼리스토가 하늘에 올랐대요. 등과 꼬리가 북두칠성이에요.",
    evening: { altDeg: 72, dir: "북동" },
    lines: [[4301, 4295], [4295, 4554], [4554, 4660], [4660, 4301], [4660, 4905], [4905, 5054], [5054, 5191], [4301, 3757], [3757, 3323], [3757, 3888], [3888, 4295], [3888, 3775], [3775, 3569], [3569, 3594], [4554, 4518], [4518, 4377], [4377, 4375], [4518, 4335], [4335, 4069], [4069, 4033]],
  },
  {
    id: "Boo",
    name: "목동자리",
    kind: "constellation",
    season: "spring",
    hint: "아르크투루스에서 뻗은 연(아이스크림콘) 모양",
    story: "큰곰을 뒤쫓는 곰지기예요. 주황빛 아르크투루스는 봄밤에 가장 밝은 별이에요.",
    evening: { altDeg: 33, dir: "동" },
    lines: [[5340, 5506], [5506, 5681], [5681, 5602], [5602, 5435], [5435, 5429], [5429, 5340], [5340, 5235], [5340, 5478]],
  },
  {
    id: "Vir",
    name: "처녀자리",
    kind: "constellation",
    season: "spring",
    hint: "하얀 스피카 위로 Y자",
    story: "곡식 이삭을 든 여신이에요. 스피카는 '이삭'이라는 뜻이래요.",
    evening: { altDeg: 36, dir: "남동" },
    lines: [[4540, 4689], [4689, 4825], [4825, 4910], [4910, 4932], [4825, 4963], [4963, 5056], [4910, 5107]],
  },
  {
    id: "Leo",
    name: "사자자리",
    kind: "constellation",
    season: "spring",
    hint: "뒤집힌 물음표 머리 + 삼각형 엉덩이",
    story: "헤라클레스가 물리친 네메아의 사자예요. 머리 아래 밝은 별이 레굴루스예요.",
    evening: { altDeg: 72, dir: "남" },
    lines: [[3982, 3975], [3975, 4057], [4057, 4031], [4031, 3905], [3905, 3873], [4057, 4357], [4357, 4534], [4534, 4359], [4359, 3982]],
  },
  {
    id: "CrB",
    name: "북쪽왕관자리",
    kind: "constellation",
    season: "spring",
    hint: "작은 반원",
    story: "아리아드네의 왕관이 하늘에 걸렸대요. 작은 반원 속 밝은 별이 알페카예요.",
    evening: { altDeg: 20, dir: "동" },
    lines: [[5778, 5747], [5747, 5793], [5793, 5849], [5849, 5889], [5889, 5947], [5947, 5971]],
  },
  {
    id: "dipper",
    name: "북두칠성",
    kind: "asterism",
    season: "spring",
    hint: "국자 모양 일곱 별",
    story: "국자 모양 일곱 별이에요. 옛사람들은 칠성님께 오래 살기를 빌었대요.",
    evening: { altDeg: 59, dir: "북동" },
    lines: [[4301, 4295], [4295, 4554], [4554, 4660], [4660, 4301], [4660, 4905], [4905, 5054], [5054, 5191]],
  },
  {
    id: "springArc",
    name: "봄의 대곡선",
    kind: "asterism",
    season: "spring",
    hint: "손잡이 곡선을 따라 아르크투루스 → 스피카",
    story: "북두칠성 손잡이의 곡선을 따라가면 아르크투루스, 더 가면 스피카예요.",
    evening: { altDeg: 47, dir: "동" },
    anchorHr: 5340,
    lines: [[4905, 5054], [5054, 5191], [5191, 5340], [5340, 5056]],
  },
  {
    id: "Lyr",
    name: "거문고자리",
    kind: "constellation",
    season: "summer",
    hint: "베가 옆 작은 평행사변형",
    story: "오르페우스의 거문고예요. 베가는 칠월 칠석에 견우를 만나는 직녀성이에요.",
    evening: { altDeg: 81, dir: "동" },
    lines: [[7001, 7051], [7001, 7056], [7051, 7056], [7056, 7139], [7139, 7178], [7178, 7106], [7106, 7056]],
  },
  {
    id: "Cyg",
    name: "백조자리",
    kind: "constellation",
    season: "summer",
    hint: "큰 십자 모양",
    story: "남쪽으로 날아가는 백조예요. 큰 십자 모양이라 '북십자성'이라고도 해요.",
    evening: { altDeg: 66, dir: "동" },
    lines: [[7924, 7796], [7796, 7615], [7615, 7417], [7796, 7528], [7528, 7420], [7420, 7328], [7796, 7949], [7949, 8115]],
  },
  {
    id: "Aql",
    name: "독수리자리",
    kind: "constellation",
    season: "summer",
    hint: "밝은 별 양옆에 작은 별 둘",
    story: "제우스의 독수리예요. 알타이르는 직녀를 기다리는 견우성이에요.",
    evening: { altDeg: 53, dir: "남동" },
    lines: [[7525, 7557], [7557, 7602], [7557, 7377], [7377, 7236], [7377, 7235], [7235, 7176], [7602, 7570], [7570, 7710]],
  },
  {
    id: "Sco",
    name: "전갈자리",
    kind: "constellation",
    season: "summer",
    hint: "붉은 별에서 휘어지는 S자 낚싯바늘",
    story: "오리온을 쏜 전갈이라, 전갈이 뜨면 오리온은 숨는대요. 붉은 별은 안타레스예요.",
    evening: { altDeg: 18, dir: "남" },
    anchorHr: 6134,
    lines: [[5984, 5953], [5953, 5944], [5944, 5928], [5953, 6084], [5984, 6084], [6084, 6134], [6134, 6165], [6165, 6241], [6241, 6247], [6247, 6271], [6271, 6380], [6380, 6553], [6553, 6615], [6615, 6580], [6580, 6527], [6527, 6508]],
  },
  {
    id: "Sgr",
    name: "궁수자리",
    kind: "constellation",
    season: "summer",
    hint: "찻주전자 모양",
    story: "활을 겨눈 반인반마 케이론이에요. 찻주전자 모양을 찾아보세요.",
    evening: { altDeg: 24, dir: "남" },
    lines: [[6746, 6859], [6859, 6879], [6879, 6746], [6859, 6913], [6913, 7039], [7039, 6859], [7039, 7121], [7121, 7234], [7234, 7194], [7194, 7039], [7194, 6879]],
  },
  {
    id: "summerTri",
    name: "여름의 대삼각형",
    kind: "asterism",
    season: "summer",
    hint: "베가·데네브·알타이르",
    story: "직녀성·데네브·견우성을 이은 큰 삼각형이에요.",
    evening: { altDeg: 70, dir: "동" },
    lines: [[7001, 7924], [7924, 7557], [7557, 7001]],
  },
  {
    id: "southDipper",
    name: "남두육성",
    kind: "asterism",
    season: "summer",
    hint: "궁수자리 속 작은 국자",
    story: "궁수자리의 작은 국자 여섯 별이에요. 북두칠성과 짝을 이루는 별로 여겼대요.",
    evening: { altDeg: 27, dir: "남" },
    lines: [[7039, 6913], [6913, 6812], [7039, 7121], [7121, 7234], [7234, 7194], [7194, 7039]],
  },
  {
    id: "Peg",
    name: "페가수스자리",
    kind: "constellation",
    season: "autumn",
    hint: "큰 사각형 몸통 + 목과 앞다리",
    story: "날개 달린 말이에요. 몸통의 큰 사각형이 가을 하늘의 길잡이예요.",
    evening: { altDeg: 72, dir: "남동" },
    lines: [[8781, 8775], [8775, 15], [15, 39], [39, 8781], [8781, 8634], [8634, 8450], [8450, 8308], [8775, 8650], [8650, 8454], [8775, 8684], [8684, 8667]],
  },
  {
    id: "And",
    name: "안드로메다자리",
    kind: "constellation",
    season: "autumn",
    hint: "사각형 모서리에서 뻗은 두 줄",
    story: "바다 괴물에게서 구해진 공주예요. 근처에 안드로메다 은하가 희미하게 있어요.",
    evening: { altDeg: 56, dir: "동" },
    lines: [[15, 165], [165, 337], [337, 603], [337, 269], [269, 226]],
  },
  {
    id: "Cas",
    name: "카시오페이아자리",
    kind: "constellation",
    season: "autumn",
    hint: "W 모양",
    story: "안드로메다의 어머니 왕비예요. W 모양으로 북극성을 찾을 때도 써요.",
    evening: { altDeg: 54, dir: "북동" },
    lines: [[21, 168], [168, 264], [264, 403], [403, 542]],
  },
  {
    id: "Per",
    name: "페르세우스자리",
    kind: "constellation",
    season: "autumn",
    hint: "미르파크에서 갈라진 줄기",
    story: "메두사를 물리친 영웅이에요. 알골은 밝기가 변하는 '악마의 별'이에요.",
    evening: { altDeg: 31, dir: "북동" },
    lines: [[834, 915], [915, 1017], [1017, 1122], [1122, 1135], [1135, 1220], [1220, 1228], [1228, 1203], [1017, 937], [937, 941], [941, 936], [936, 921]],
  },
  {
    id: "Ari",
    name: "양자리",
    kind: "constellation",
    season: "autumn",
    hint: "작게 굽은 세 별",
    story: "황금 양털을 가진 양이에요. 하말이 가장 밝아요.",
    evening: { altDeg: 38, dir: "동" },
    lines: [[617, 553], [553, 546]],
  },
  {
    id: "square",
    name: "페가수스 사각형",
    kind: "asterism",
    season: "autumn",
    hint: "큰 사각형 모양",
    story: "가을 하늘 한가운데 큰 사각형이에요. 한 모서리는 안드로메다자리 별이에요.",
    evening: { altDeg: 66, dir: "남동" },
    lines: [[8781, 8775], [8775, 15], [15, 39], [39, 8781]],
  },
  {
    id: "Ori",
    name: "오리온자리",
    kind: "constellation",
    season: "winter",
    hint: "나란한 세 별 허리띠",
    story: "힘센 사냥꾼이에요. 허리띠의 세 별이 나란해서 찾기 쉬워요.",
    evening: { altDeg: 49, dir: "남동" },
    lines: [[2061, 1879], [1879, 1790], [2061, 1948], [1790, 1852], [1852, 1903], [1903, 1948], [1948, 2004], [1852, 1713]],
  },
  {
    id: "CMa",
    name: "큰개자리",
    kind: "constellation",
    season: "winter",
    hint: "가장 밝은 별 시리우스",
    story: "오리온의 사냥개예요. 시리우스는 밤하늘에서 가장 밝은 별이에요.",
    evening: { altDeg: 19, dir: "남동" },
    lines: [[2294, 2491], [2491, 2596], [2596, 2657], [2491, 2653], [2653, 2693], [2693, 2618], [2618, 2282], [2693, 2827]],
  },
  {
    id: "CMi",
    name: "작은개자리",
    kind: "constellation",
    season: "winter",
    hint: "밝은 별 하나와 작은 별 하나",
    story: "또 한 마리 사냥개예요. 프로키온은 '개보다 먼저' 뜬다는 뜻이에요.",
    evening: { altDeg: 35, dir: "동" },
    lines: [[2943, 2845]],
  },
  {
    id: "Gem",
    name: "쌍둥이자리",
    kind: "constellation",
    season: "winter",
    hint: "나란한 두 밝은 별에서 뻗은 두 줄",
    story: "사이좋은 형제 카스토르와 폴룩스예요.",
    evening: { altDeg: 50, dir: "동" },
    lines: [[2891, 2697], [2697, 2473], [2473, 2286], [2286, 2216], [2990, 2905], [2905, 2777], [2777, 2650], [2650, 2421], [2777, 2763], [2697, 2821], [2821, 2905]],
  },
  {
    id: "Tau",
    name: "황소자리",
    kind: "constellation",
    season: "winter",
    hint: "V자 얼굴, 붉은 눈",
    story: "제우스가 변한 흰 황소예요. 붉은 눈은 알데바란이에요.",
    evening: { altDeg: 71, dir: "남동" },
    lines: [[1346, 1373], [1373, 1409], [1346, 1412], [1412, 1457], [1457, 1910], [1409, 1791]],
  },
  {
    id: "Aur",
    name: "마차부자리",
    kind: "constellation",
    season: "winter",
    hint: "오각형 모양",
    story: "마차를 모는 사람이에요. 노란 카펠라가 겨울밤 머리 위에서 빛나요.",
    evening: { altDeg: 73, dir: "동" },
    lines: [[1708, 2088], [2088, 2095], [2095, 1791], [1791, 1577], [1577, 1708]],
  },
  {
    id: "winterTri",
    name: "겨울의 대삼각형",
    kind: "asterism",
    season: "winter",
    hint: "베텔게우스·시리우스·프로키온",
    story: "겨울밤 가장 밝은 세 별을 이은 삼각형이에요.",
    evening: { altDeg: 37, dir: "남동" },
    lines: [[2061, 2491], [2491, 2943], [2943, 2061]],
  },
  {
    id: "pleiades",
    name: "좀생이별",
    alias: "플레이아데스",
    kind: "asterism",
    season: "winter",
    hint: "옹기종기 작은 별 무리",
    story: "옛날엔 좀생이별을 보고 그해 농사를 점쳤대요.",
    evening: { altDeg: 77, dir: "남서" },
    ring: 1.2,
    lines: [[1178, 1165], [1165, 1156], [1156, 1142], [1142, 1145], [1145, 1149], [1149, 1165]],
  },
  {
    id: "polaris",
    name: "북극성 찾기",
    kind: "asterism",
    season: "north",
    hint: "국자 끝 두 별을 5배 → 북극성",
    story: "국자 끝 두 별 사이를 다섯 번 이어 가면 북극성이에요. 북극성 높이는 약 36.5°, 우리 마을의 위도와 같아요!",
    evening: { altDeg: 36.5, dir: "북" },
    anchorHr: 424,
    dashed: true,
    lines: [[4295, 4301], [4301, 424]],
  },
  {
    id: "UMi",
    name: "작은곰자리",
    kind: "constellation",
    season: "north",
    hint: "작은 국자, 손잡이 끝이 북극성",
    story: "칼리스토의 아들 아르카스예요. 꼬리 끝이 북극성이에요.",
    evening: { altDeg: 31, dir: "북" },
    lines: [[424, 6789], [6789, 6322], [6322, 5903], [5903, 5563], [5563, 5735], [5735, 6116], [6116, 5903]],
  },
  {
    id: "Cep",
    name: "세페우스자리",
    kind: "constellation",
    season: "north",
    hint: "뾰족 지붕 집",
    story: "안드로메다의 아버지 왕이에요. 집 모양을 찾아보세요.",
    evening: { altDeg: 57, dir: "북" },
    lines: [[8162, 8238], [8238, 8694], [8694, 8465], [8465, 8162], [8238, 8974], [8974, 8694], [8465, 8571]],
  },
];

/** Bright stars' Korean names (BSC5 HR -> name), shown small beside a found figure and large when aimed at. */
export const STAR_NAMES: Readonly<Record<number, string>> = {
  424: "북극성",
  4301: "두베",
  4295: "메라크",
  4554: "페크다",
  4660: "메그레즈",
  4905: "알리오트",
  5054: "미자르",
  5191: "알카이드",
  5340: "아르크투루스",
  5056: "스피카",
  3982: "레굴루스",
  4534: "데네볼라",
  5793: "알페카",
  7001: "베가 (직녀성)",
  7557: "알타이르 (견우성)",
  7924: "데네브",
  6134: "안타레스",
  7121: "눈키",
  15: "알페라츠",
  8781: "마르카브",
  8775: "셰아트",
  39: "알게니브",
  168: "셰다르",
  1017: "미르파크",
  936: "알골",
  617: "하말",
  2061: "베텔게우스",
  1713: "리겔",
  1790: "벨라트릭스",
  1852: "민타카",
  1903: "알닐람",
  1948: "알니타크",
  2491: "시리우스 (천랑성)",
  2943: "프로키온",
  2891: "카스토르",
  2990: "폴룩스",
  1457: "알데바란",
  1708: "카펠라",
  1165: "알키오네",
  5563: "코카브",
  8162: "알데라민",
};

/** The figure with this id, or undefined. */
export function figureById(id: string): SkyFigure | undefined {
  return SKY_FIGURES.find((f) => f.id === id);
}

/** Every distinct star a figure's lines use, in first-use order. */
export function figureStars(f: SkyFigure): number[] {
  const seen = new Set<number>();
  for (const [a, b] of f.lines) {
    seen.add(a);
    seen.add(b);
  }
  return [...seen];
}

/** Every distinct star any figure uses (the catalogue builder keeps all of them, whatever their magnitude). */
export function allFigureStars(): number[] {
  const seen = new Set<number>();
  for (const f of SKY_FIGURES) for (const hr of figureStars(f)) seen.add(hr);
  return [...seen].sort((a, b) => a - b);
}

/** The display name with its alias: "좀생이별 (플레이아데스)". */
export function figureTitle(f: SkyFigure): string {
  return f.alias ? `${f.name} (${f.alias})` : f.name;
}

/** "겨울 저녁 남동쪽 낮게" / "일 년 내내 북쪽 하늘": when and where to look, for the album. */
export function whenToLook(f: SkyFigure): string {
  const height = f.evening.altDeg >= 60 ? "높이" : f.evening.altDeg >= 30 ? "중간쯤" : "낮게";
  if (f.season === "north") return `일 년 내내 저녁 ${f.evening.dir}쪽 하늘 ${height}`;
  return `${SEASON_NAME[f.season]} 저녁 ${f.evening.dir}쪽 하늘 ${height}`;
}
