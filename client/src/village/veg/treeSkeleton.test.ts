import { describe, expect, it } from "vitest";
import {
  PLAZA_CHERRY_SPECS,
  PLAZA_ZELKOVA_SPEC,
  SHRUB_VARIANT,
  VARIANT_SPECS,
  VILLAGE_TREE_SPECS,
  WILLOW_SPECS,
  YOUNG_SPECS,
  shrubCards,
  treeSkeleton,
  type TreeSpec,
} from "./treeSkeleton";

/**
 * Reference values: art/village/tools/parts_trees.tree() and shrub() run in plain Python 3 (random.Random, math; the
 * bpy Vector replaced by a 3-float class), every call made in the script's order, converted to game coordinates
 * (Blender (x, y, z) -> (x, z, -y)). The same replay was checked against village.glb: every limb and side tip within
 * the tubes' 2 cm end radius of the file's bark, every canopy card centre within 0.1 mm of the file's cards.
 */
type V3 = [number, number, number];
interface Ref {
  fork: V3;
  crownC: V3;
  crownH: number;
  limb0Tip: V3;
  limbLastTip: V3;
  side0Tip: V3;
  trunk1: V3;
  limbs: number;
  cards: number;
  card0: { c: V3; s: number };
  cardLast: { c: V3; s: number };
  petal0?: { c: V3; s: number };
}
const REF: Array<[string, TreeSpec, Ref]> = [
  [
    "village green (70, -15), seed 312",
    VILLAGE_TREE_SPECS.find((s) => s.seed === 312)!,
    {
      fork: [69.87979071512417, 3.42, -14.83369675941329],
      crownC: [69.87979071512417, 6.21, -14.83369675941329],
      crownH: 3.348,
      limb0Tip: [72.82930778469303, 4.920926239054632, -15.111706980040136],
      limbLastTip: [70.27236723374044, 7.168587410832119, -11.858993000495538],
      side0Tip: [73.21818432901925, 5.873990353962979, -14.549120278885942],
      trunk1: [69.96393721453725, 1.197, -14.950109027823986],
      limbs: 5,
      cards: 132,
      card0: { c: [72.8421339400529, 5.285050836477601, -14.786947713887496], s: 1.8674557599937025 },
      cardLast: { c: [67.28921573236636, 7.406173169033173, -13.146455937334261], s: 1.7650198811481457 },
    },
  ],
  [
    "village cherry (23, 42.5), seed 305 (its place in the mixed list)",
    VILLAGE_TREE_SPECS.find((s) => s.x === 23 && s.z === 42.5)!,
    {
      fork: [23.051489244634528, 2.088, 42.38578994752227],
      crownC: [23.051489244634528, 3.944, 42.38578994752227],
      crownH: 2.2272,
      limb0Tip: [25.227716357572426, 4.217677978161535, 42.298818879019244],
      limbLastTip: [23.88662067921622, 4.058924318944588, 44.370296000925165],
      side0Tip: [24.875809892344066, 4.577922435201486, 41.939072718307585],
      trunk1: [23.01544677339036, 0.7308, 42.46573698425668],
      limbs: 5,
      cards: 416,
      card0: { c: [25.800736286395068, 4.073400246489436, 42.59154741847504], s: 2.532220439197523 },
      cardLast: { c: [22.054577528599754, 3.9559737430317554, 44.95109017066696], s: 2.5230627085509854 },
      petal0: { c: [21.73105006338167, 0.015, 43.11357772956179], s: 1.9101213138293696 },
    },
  ],
  [
    "willow (-10, 70), seed 401",
    WILLOW_SPECS[1]!,
    {
      fork: [-10.178481140359704, 2.975, 69.99740528693307],
      crownC: [-10.178481140359704, 5.7375, 69.99740528693307],
      crownH: 3.315,
      limb0Tip: [-7.19744732641417, 7.440290925153697, 70.126829339541],
      limbLastTip: [-8.533260723087789, 6.706456166133258, 72.1850905445919],
      side0Tip: [-7.514508070831644, 9.76626816700735, 70.18710179377403],
      trunk1: [-10.05354434210791, 1.04125, 69.99922158607993],
      limbs: 6,
      cards: 150,
      card0: { c: [-7.626837524580704, 7.636669464082337, 70.28592220194072], s: 2.2484575773008775 },
      cardLast: { c: [-6.4574666625602575, 5.827852351875483, 70.57592097173621], s: 1.6447357976067605 },
    },
  ],
  [
    "memorial young tree (-8.2, -51.5), seed 500",
    YOUNG_SPECS[0]!,
    {
      fork: [-8.177053024821411, 1.305, -51.42513795133612],
      crownC: [-8.177053024821411, 2.1025, -51.42513795133612],
      crownH: 0.957,
      limb0Tip: [-7.46047777909351, 1.9263531083508727, -51.623209540663225],
      limbLastTip: [-8.037999872748752, 2.3694153170855192, -50.56547624597043],
      side0Tip: [-7.404775707514357, 2.26434813211903, -51.58697070024116],
      trunk1: [-8.193115907446423, 0.45675, -51.47754138540083],
      limbs: 4,
      cards: 72,
      card0: { c: [-7.234363059539867, 2.0606064360029794, -51.5235569890703], s: 0.9733281181338385 },
      cardLast: { c: [-8.692956675640417, 2.5964593164312584, -52.03840664413798], s: 1.0963008756895112 },
    },
  ],
  [
    "plaza zelkova (-25, -5), seed 7",
    PLAZA_ZELKOVA_SPEC,
    {
      fork: [-25.181214717690654, 4.05, -5.362196391605847],
      crownC: [-25.181214717690654, 8.775, -5.362196391605847],
      crownH: 5.67,
      limb0Tip: [-18.054509122693958, 7.668994775249214, -3.84698857558517],
      limbLastTip: [-21.26222805133931, 9.8776338616144, 0.8686335512154466],
      side0Tip: [-19.601393416724928, 8.719756952954091, -1.9364374910418167],
      trunk1: [-25.054364415307194, 1.4175, -5.108658917481755],
      limbs: 7,
      cards: 294,
      card0: { c: [-18.580783426691145, 7.977254182093657, -4.457748738030132], s: 2.5143345305680778 },
      cardLast: { c: [-19.553495561141908, 12.064530571138736, -4.512920268838757], s: 2.4794252236436183 },
    },
  ],
  [
    "street green variant (seed 11, at the origin)",
    VARIANT_SPECS.street_green,
    {
      fork: [-0.1481516061394851, 2.584, -0.04570014440120381],
      crownC: [-0.1481516061394851, 4.692, -0.04570014440120381],
      crownH: 2.5296,
      limb0Tip: [1.8740592608285418, 5.289870565548191, -0.11825467447510585],
      limbLastTip: [1.080400214393817, 5.198479142359764, 1.7062086927996492],
      side0Tip: [2.3524745956196584, 6.111893244037795, -0.2963462931794912],
      trunk1: [-0.04444548184184553, 0.9044, -0.013710043320361144],
      limbs: 5,
      cards: 132,
      card0: { c: [1.7107976290818527, 5.6793818158061375, -0.05871015282457822], s: 2.120898690507357 },
      cardLast: { c: [-0.38102225895390907, 6.5400721382735245, -1.706413977198825], s: 2.276428030375651 },
    },
  ],
  [
    "street cherry variant (seed 12)",
    VARIANT_SPECS.street_cherry,
    {
      fork: [-0.11941930403350783, 2.016, -0.019244516729515982],
      crownC: [-0.11941930403350783, 3.808, -0.019244516729515982],
      crownH: 2.1504,
      limb0Tip: [1.818199893967873, 3.9809426308603144, -0.20286428809186144],
      limbLastTip: [-0.01679132680583985, 3.363273269316969, 2.2612962638986915],
      side0Tip: [1.7693876287963595, 4.085643999744356, 0.006245474240909529],
      trunk1: [-0.035825791210052346, 0.7056, -0.0057733550188547944],
      limbs: 5,
      cards: 416,
      card0: { c: [1.4381935293193397, 3.751778310756963, -0.2642308647843816], s: 2.308729567987147 },
      cardLast: { c: [-1.4952923576450061, 4.775594409176086, -1.2634186833262362], s: 2.239607035224882 },
      petal0: { c: [0.8356601786700861, 0.015, 0.35770488339083223], s: 1.3449013685422568 },
    },
  ],
  [
    "orchard variant (seed 13)",
    VARIANT_SPECS.orchard,
    {
      fork: [-0.005417315964266291, 1.596, -0.09560664353350819],
      crownC: [-0.005417315964266291, 2.698, -0.09560664353350819],
      crownH: 1.3224,
      limb0Tip: [1.5704137523495403, 3.2087745101778373, -0.2714928020978478],
      limbLastTip: [-0.01747764061744602, 3.2626179514621603, 1.4254580420037024],
      side0Tip: [1.575918029793308, 3.2840079606608565, 0.10367723840980456],
      trunk1: [-0.0016251947892798873, 0.5586, -0.028681993060052455],
      limbs: 4,
      cards: 96,
      card0: { c: [1.8422797704850058, 3.319734133213834, -0.1752136692018711], s: 1.2812233171027698 },
      cardLast: { c: [-0.77714870142885, 3.8024188465300717, 0.33492286755682504], s: 1.2193376967248593 },
      petal0: { c: [-1.5696208575739445, 0.015, 0.029158967443009224], s: 1.9579336022109157 },
    },
  ],
];

const close3 = (a: readonly number[], b: readonly number[], digits = 9) => {
  for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k]!, digits);
};

describe("treeSkeleton replays parts_trees.tree() exactly", () => {
  for (const [label, spec, ref] of REF) {
    it(label, () => {
      const sk = treeSkeleton(spec);
      close3(sk.fork, ref.fork);
      close3(sk.crownC, ref.crownC);
      expect(sk.crownH).toBeCloseTo(ref.crownH, 9);
      expect(sk.limbs).toHaveLength(ref.limbs);
      expect(sk.sides).toHaveLength(ref.limbs * 2);
      close3(sk.limbs[0]!.pts[3]!, ref.limb0Tip);
      close3(sk.limbs[ref.limbs - 1]!.pts[3]!, ref.limbLastTip);
      close3(sk.sides[0]!.pts[2]!, ref.side0Tip);
      close3(sk.trunk.pts[1]!, ref.trunk1);
      // the cards: every draw of the sequence made, so the last card still matches
      expect(sk.cards).toHaveLength(ref.cards);
      close3(sk.cards[0]!.c, ref.card0.c);
      expect(sk.cards[0]!.s).toBeCloseTo(ref.card0.s, 9);
      close3(sk.cards[ref.cards - 1]!.c, ref.cardLast.c);
      expect(sk.cards[ref.cards - 1]!.s).toBeCloseTo(ref.cardLast.s, 9);
      if (ref.petal0) {
        expect(sk.petals).toHaveLength(5);
        close3(sk.petals[0]!.c, ref.petal0.c);
      } else expect(sk.petals).toHaveLength(0);
    });
  }

  it("keeps the plaza cherries' replay (the reference crowns) as it was", () => {
    const sk = treeSkeleton(PLAZA_CHERRY_SPECS[0]!);
    close3(sk.fork, [-8.838324873221294, 2.612, -16.88216603997739]);
    close3(sk.limbs[0]!.pts[3]!, [-6.165994462046419, 5.667587373465145, -16.80987845426456]);
  });
});

describe("the village's tree inventory", () => {
  it("has 16 greens and 11 cherries among the village trees, seeded by their place in the one list", () => {
    expect(VILLAGE_TREE_SPECS).toHaveLength(27);
    expect(VILLAGE_TREE_SPECS.filter((s) => s.kind === "green")).toHaveLength(16);
    expect(VILLAGE_TREE_SPECS.filter((s) => s.kind === "cherry")).toHaveLength(11);
    VILLAGE_TREE_SPECS.forEach((s, i) => expect(s.seed).toBe(300 + i));
  });

  it("has 4 willows on the creek and 10 young memorial trees", () => {
    expect(WILLOW_SPECS.map((s) => [s.x, s.z, s.seed])).toEqual([
      [-60, 66.6, 400],
      [-10, 70, 401],
      [38, 71, 402],
      [70, 68, 403],
    ]);
    expect(YOUNG_SPECS).toHaveLength(10);
    expect(YOUNG_SPECS.map((s) => s.seed)).toEqual([500, 501, 502, 503, 504, 505, 506, 507, 508, 509]);
    for (const s of YOUNG_SPECS) expect(s.R).toBeCloseTo(s.H * 0.32, 12);
  });

  it("replays the instanced shrub's cards (shrub(F, 0, 0, 0.9, 0.6, 14))", () => {
    const sh = shrubCards(0, 0, SHRUB_VARIANT.H, SHRUB_VARIANT.R, SHRUB_VARIANT.seed);
    close3(sh.centre, [0, 0.45, 0]);
    expect(sh.cards).toHaveLength(12);
    close3(sh.cards[0]!.c, [-0.3302640283306092, 0.518418909141424, -0.17017184014895861]);
    expect(sh.cards[0]!.s).toBeCloseTo(1.014643946352618, 9);
    close3(sh.cards[11]!.c, [-0.2583921958323043, 0.2251639989295581, 0.39884479086368635]);
  });
});
