import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_ERROR,
  APPEARANCE_FIELDS,
  APPEARANCE_PRESETS,
  APPEARANCE_RANGES,
  CLOTHES_PALETTE,
  DEFAULT_APPEARANCE,
  HAIR_PALETTE,
  OPTIONAL_SLOTS,
  SKIN_PALETTE,
  SLOT_COLOR_FIELD,
  SLOT_OPTIONS,
  VOICE_GENDERS,
  appearanceFromIds,
  applyPreset,
  paletteFor,
  pickAppearance,
  randomAppearance,
  validateAppearance,
  voiceGender,
  withPart,
  type Appearance,
  type AppearancePreset,
} from "./appearance";
import { CHARACTER_MANIFEST, CHARACTER_SLOTS } from "./characterManifest";
import { APPEARANCE_FIELDS as ConstantsFields, APPEARANCE_RANGES as ConstantsRanges } from "./constants";

/** 시드 LCG — 테스트가 매번 같은 난수열을 쓰도록. 반환값은 [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** 모든 필드를 같은 값으로 채운 외형(테스트 입력용). */
function filled(value: (f: (typeof APPEARANCE_FIELDS)[number]) => number): Appearance {
  return Object.fromEntries(APPEARANCE_FIELDS.map((f) => [f, value(f)])) as Appearance;
}

describe("appearance model — fields and ranges", () => {
  it("lists the 15 spec fields in spec order (spec §5.2)", () => {
    expect([...APPEARANCE_FIELDS]).toEqual([
      "hat", "hatColor", "hair", "hairColor", "face", "skin", "top", "topColor",
      "bottom", "bottomColor", "shoes", "shoesColor", "item", "itemColor", "voice",
    ]);
    expect(APPEARANCE_FIELDS).toHaveLength(15);
  });

  it("derives every range from the manifest and palettes (spec §4)", () =>
    expect(APPEARANCE_RANGES).toEqual({ hat: 12, hatColor: 12, hair: 6, hairColor: 8, face: 6, skin: 5, top: 12,
      topColor: 12, bottom: 7, bottomColor: 12, shoes: 8, shoesColor: 12, item: 13, itemColor: 12, voice: 2 }));

  it("puts 없음 first only on hat, hair and item", () => {
    expect([...OPTIONAL_SLOTS]).toEqual(["hat", "hair", "item"]);
    for (const s of ["hat", "hair", "item"] as const) expect(SLOT_OPTIONS[s][0]).toBeNull();
    for (const s of ["face", "top", "bottom", "shoes"] as const) expect(SLOT_OPTIONS[s]).not.toContain(null);
  });

  it("SLOT_OPTIONS is the manifest list, with 없음 prepended on the optional slots", () => {
    for (const s of CHARACTER_SLOTS) {
      const ids: readonly string[] = CHARACTER_MANIFEST.slots[s];
      const expected = (OPTIONAL_SLOTS as readonly string[]).includes(s) ? [null, ...ids] : [...ids];
      expect(SLOT_OPTIONS[s]).toEqual(expected);
    }
  });

  it("pairs every slot with its color field (face is painted by skin)", () => {
    expect(SLOT_COLOR_FIELD).toEqual({
      hat: "hatColor", hair: "hairColor", face: "skin", top: "topColor",
      bottom: "bottomColor", shoes: "shoesColor", item: "itemColor",
    });
    // 슬롯 하나하나가 15필드 안에 있고, 색 필드는 서로 겹치지 않는다.
    expect(new Set(Object.values(SLOT_COLOR_FIELD)).size).toBe(CHARACTER_SLOTS.length);
    for (const s of CHARACTER_SLOTS) {
      expect(APPEARANCE_FIELDS).toContain(s);
      expect(APPEARANCE_FIELDS).toContain(SLOT_COLOR_FIELD[s]);
    }
  });

  it("voice has a male and a female option", () => expect([...VOICE_GENDERS]).toEqual(["male", "female"]));

  it("keeps the error text the server and the entry screen both show", () =>
    expect(APPEARANCE_ERROR).toBe("외형 선택이 올바르지 않습니다"));
});

describe("appearance model — palettes", () => {
  it("CLOTHES has the 12 approved colors in index order", () => {
    expect(CLOTHES_PALETTE.map((c) => `${c.label} ${c.hex}`)).toEqual([
      "빨강 #E53E3E", "주황 #F6873F", "노랑 #F6C445", "연두 #8BCF5A",
      "초록 #2F9E62", "하늘 #4FB3E8", "파랑 #2F6FDE", "남색 #2D3A75",
      "보라 #8B5CF6", "분홍 #F07AAE", "흰색 #F7F7F2", "금색 #D4A93A",
    ]);
  });

  it("HAIR has the 8 approved colors in index order", () => {
    expect(HAIR_PALETTE.map((c) => `${c.label} ${c.hex}`)).toEqual([
      "검정 #2B2420", "진갈색 #4A3226", "갈색 #8A5A3B", "금발 #F0C060",
      "주황 #E07A3A", "분홍 #F49AC1", "파랑 #5B8DEF", "회색 #B8B8B8",
    ]);
  });

  it("SKIN has the 5 approved tones labelled 피부색 1~5", () => {
    expect(SKIN_PALETTE.map((c) => `${c.label} ${c.hex}`)).toEqual([
      "피부색 1 #FFDCC2", "피부색 2 #F5C9A0", "피부색 3 #E0A47A", "피부색 4 #B07A52", "피부색 5 #7A4E33",
    ]);
  });

  it("paletteFor maps the five clothes fields to CLOTHES, hairColor to HAIR and skin to SKIN", () => {
    for (const f of ["hatColor", "topColor", "bottomColor", "shoesColor", "itemColor"] as const)
      expect(paletteFor(f)).toBe(CLOTHES_PALETTE);
    expect(paletteFor("hairColor")).toBe(HAIR_PALETTE);
    expect(paletteFor("skin")).toBe(SKIN_PALETTE);
  });

  it("paletteFor has no colors for the part and voice fields", () => {
    for (const f of ["hat", "hair", "face", "top", "bottom", "shoes", "item", "voice"] as const)
      expect(paletteFor(f)).toHaveLength(0);
  });
});

// The wire / storage contract: a slot field's value is the part's index in SLOT_OPTIONS, which is the manifest
// slot order (with "없음" = null first for hat/hair/item). Those numbers are synced to every client, kept by the
// server's reconnect cache and saved in localStorage["cv.entry"], so inserting, removing or reordering a part
// silently changes what everyone already wears. New parts are APPENDED to the end of their slot only, and this
// pin is extended at the same time (the art manifest and scripts/sync-character-assets.mjs carry the same note).
describe("slot part order — append only (wire / storage index)", () => {
  it("pins every slot's part ids in index order", () => {
    expect(SLOT_OPTIONS).toEqual({
      hat: [
        null, "cap", "beanie", "catband", "crown", "wizard", "tiara", "safari", "knight_helmet", "pirate_hat",
        "space_helmet", "flower_crown",
      ],
      hair: [null, "short", "bob", "ponytail", "curly", "twintails"],
      face: ["smile", "wink", "glasses", "wow", "calm", "tongue"],
      top: [
        "tee", "hoodie", "shirt_tie", "suspenders", "robe", "prince_coat", "gown_top", "explorer_vest", "armor",
        "pirate_stripe", "spacesuit", "petal_top",
      ],
      bottom: ["pants", "shorts", "skirt", "longskirt", "overalls", "space_pants", "petal_skirt"],
      shoes: ["sneakers", "boots", "dress", "sandals", "tall_boots", "wizard_shoes", "hiking_boots", "space_boots"],
      item: [
        null, "book", "flag", "wand", "balloon", "pencil", "mic", "scepter", "rose", "staff", "map", "wooden_sword",
        "telescope",
      ],
    });
    // The slots themselves, in manifest order (the builder's tab order; APPEARANCE_FIELDS fixes the field order).
    expect(CHARACTER_SLOTS).toEqual(["hat", "hair", "face", "top", "bottom", "shoes", "item"]);
  });
});

describe("validateAppearance", () => {
  it("validateAppearance accepts every field at 0 and at range − 1", () => {
    const low = filled(() => 0);
    const high = filled((f) => APPEARANCE_RANGES[f] - 1);
    expect(validateAppearance(low)).toEqual(low);
    expect(validateAppearance(high)).toEqual(high);
    // 한 필드씩 끝값으로 바꿔도 통과한다.
    for (const f of APPEARANCE_FIELDS) {
      expect(validateAppearance({ ...low, [f]: APPEARANCE_RANGES[f] - 1 })).not.toBeNull();
      expect(validateAppearance({ ...high, [f]: 0 })).not.toBeNull();
    }
  });

  it("validateAppearance rejects −1, range, 1.5, \"0\", NaN, a missing field, null, arrays and numbers", () => {
    for (const f of APPEARANCE_FIELDS) {
      for (const bad of [-1, APPEARANCE_RANGES[f], 1.5, "0", NaN, Infinity, null, undefined, true, [0], {}])
        expect(validateAppearance({ ...DEFAULT_APPEARANCE, [f]: bad })).toBeNull();
      const { [f]: _omitted, ...missing } = DEFAULT_APPEARANCE;
      void _omitted;
      expect(validateAppearance(missing)).toBeNull();
    }
    for (const bad of [null, undefined, [], [0, 1, 2], 0, 7, "appearance", true, () => DEFAULT_APPEARANCE])
      expect(validateAppearance(bad)).toBeNull();
    // 배열이 필드 이름 속성을 달고 있어도 객체가 아니므로 거부한다.
    const arrayWithFields = Object.assign([], DEFAULT_APPEARANCE);
    expect(validateAppearance(arrayWithFields)).toBeNull();
  });

  it("validateAppearance returns a fresh object holding exactly the 15 fields", () => {
    expect(Object.keys(validateAppearance({ ...DEFAULT_APPEARANCE, evil: 1 })!).sort()).toEqual([...APPEARANCE_FIELDS].sort());
    const input = { ...DEFAULT_APPEARANCE };
    const out = validateAppearance(input)!;
    expect(out).not.toBe(input);
    expect(out).toEqual(DEFAULT_APPEARANCE);
    out.hat = 3;
    expect(input.hat).toBe(DEFAULT_APPEARANCE.hat);
  });

  it("validateAppearance normalizes −0 to 0 so the wire never carries a negative zero", () => {
    const out = validateAppearance({ ...DEFAULT_APPEARANCE, hat: -0 })!;
    expect(Object.is(out.hat, 0)).toBe(true);
  });
});

describe("pickAppearance", () => {
  it("copies exactly the 15 fields from a Player-like object into a new object", () => {
    const player = { ...DEFAULT_APPEARANCE, hat: 4, voice: 1, sessionId: "abc", nickname: "민수", x: 3 };
    const out = pickAppearance(player);
    expect(out).not.toBe(player);
    expect(Object.keys(out).sort()).toEqual([...APPEARANCE_FIELDS].sort());
    expect(out).toEqual({ ...DEFAULT_APPEARANCE, hat: 4, voice: 1 });
  });
});

describe("DEFAULT_APPEARANCE", () => {
  it("DEFAULT_APPEARANCE is valid and is the stage-1 look", () => {
    expect(validateAppearance(DEFAULT_APPEARANCE)).toEqual(DEFAULT_APPEARANCE);
    const part = (s: (typeof CHARACTER_SLOTS)[number]) => SLOT_OPTIONS[s][DEFAULT_APPEARANCE[s]];
    expect(part("hat")).toBeNull();
    expect(part("hair")).toBe("short");
    expect(part("face")).toBe("smile");
    expect(part("top")).toBe("tee");
    expect(part("bottom")).toBe("pants");
    expect(part("shoes")).toBe("sneakers");
    expect(part("item")).toBeNull();
    expect({
      hatColor: DEFAULT_APPEARANCE.hatColor, hairColor: DEFAULT_APPEARANCE.hairColor, skin: DEFAULT_APPEARANCE.skin,
      topColor: DEFAULT_APPEARANCE.topColor, bottomColor: DEFAULT_APPEARANCE.bottomColor,
      shoesColor: DEFAULT_APPEARANCE.shoesColor, itemColor: DEFAULT_APPEARANCE.itemColor, voice: DEFAULT_APPEARANCE.voice,
    }).toEqual({ hatColor: 2, hairColor: 1, skin: 0, topColor: 6, bottomColor: 7, shoesColor: 0, itemColor: 2, voice: 0 });
  });

  it("DEFAULT_APPEARANCE cannot be changed by accident (shared by server, client and bots)", () => {
    expect(Object.isFrozen(DEFAULT_APPEARANCE)).toBe(true);
    expect(Object.keys(DEFAULT_APPEARANCE).sort()).toEqual([...APPEARANCE_FIELDS].sort());
  });
});

describe("appearanceFromIds", () => {
  const colors = { hatColor: 1, hairColor: 2, skin: 3, topColor: 4, bottomColor: 5, shoesColor: 6, itemColor: 7, voice: 1 };

  it("turns part ids into indexes and copies the colors and voice", () => {
    const a = appearanceFromIds(
      { hat: "cap", hair: null, face: "wink", top: "hoodie", bottom: "skirt", shoes: "boots", item: "book" },
      colors,
    );
    expect(a).toEqual({
      hat: 1, hatColor: 1, hair: 0, hairColor: 2, face: 1, skin: 3, top: 1, topColor: 4,
      bottom: 2, bottomColor: 5, shoes: 1, shoesColor: 6, item: 1, itemColor: 7, voice: 1,
    });
  });

  it("throws on an id that is not in the manifest, and on a part that cannot be 없음", () => {
    const parts = { hat: null, hair: "short", face: "smile", top: "tee", bottom: "pants", shoes: "sneakers", item: null };
    expect(() => appearanceFromIds({ ...parts, top: "no_such_top" }, colors)).toThrow(/top/);
    expect(() => appearanceFromIds({ ...parts, face: null }, colors)).toThrow(/face/);
    expect(() => appearanceFromIds({ ...parts, hat: "android" }, colors)).toThrow(/hat/);
  });

  it("throws on a color or voice index outside its range", () => {
    const parts = { hat: null, hair: "short", face: "smile", top: "tee", bottom: "pants", shoes: "sneakers", item: null };
    expect(() => appearanceFromIds(parts, { ...colors, topColor: 12 })).toThrow();
    expect(() => appearanceFromIds(parts, { ...colors, skin: 5 })).toThrow();
    expect(() => appearanceFromIds(parts, { ...colors, voice: 2 })).toThrow();
  });

  it("ignores extra keys on the colors argument", () => {
    const a = appearanceFromIds(
      { hat: null, hair: "short", face: "smile", top: "tee", bottom: "pants", shoes: "sneakers", item: null },
      { ...colors, evil: 9 } as typeof colors,
    );
    expect(Object.keys(a).sort()).toEqual([...APPEARANCE_FIELDS].sort());
  });
});

describe("randomAppearance", () => {
  it("randomAppearance stays valid and reaches both ends of every range", () => {
    expect(randomAppearance(() => 0)).toEqual(Object.fromEntries(APPEARANCE_FIELDS.map((f) => [f, 0])));
    expect(randomAppearance(() => 0.999999)).toEqual(Object.fromEntries(APPEARANCE_FIELDS.map((f) => [f, APPEARANCE_RANGES[f] - 1])));
    // rand()가 1을 돌려줘도(부동소수 경계) 범위를 넘지 않는다.
    expect(randomAppearance(() => 1)).toEqual(Object.fromEntries(APPEARANCE_FIELDS.map((f) => [f, APPEARANCE_RANGES[f] - 1])));
    const rand = lcg(20261031);
    for (let i = 0; i < 500; i++) expect(validateAppearance(randomAppearance(rand))).not.toBeNull();
  });

  it("randomAppearance draws one number per field, in field order, and varies with the generator", () => {
    const seen: number[] = [];
    randomAppearance(() => {
      seen.push(seen.length);
      return 0;
    });
    expect(seen).toHaveLength(15);
    // 필드마다 floor(rand()·range): 0.5는 range의 절반이다.
    const half = randomAppearance(() => 0.5);
    for (const f of APPEARANCE_FIELDS) expect(half[f]).toBe(Math.floor(APPEARANCE_RANGES[f] / 2));
    const a = randomAppearance(lcg(1));
    const b = randomAppearance(lcg(2));
    expect(a).not.toEqual(b);
  });
});

describe("withPart", () => {
  it("withPart: choosing the crown or the tiara paints it gold; other hats keep the chosen color", () => {
    for (const gold of ["crown", "tiara"])
      expect(withPart({ ...DEFAULT_APPEARANCE, hatColor: 3 }, "hat", SLOT_OPTIONS.hat.indexOf(gold)).hatColor).toBe(11);
    expect(withPart({ ...DEFAULT_APPEARANCE, hatColor: 3 }, "hat", SLOT_OPTIONS.hat.indexOf("cap")).hatColor).toBe(3);
  });

  it("withPart sets the part, leaves every other field alone and never mutates its input", () => {
    const base = { ...DEFAULT_APPEARANCE, hatColor: 3 };
    const snapshot = { ...base };
    const crown = SLOT_OPTIONS.hat.indexOf("crown");
    const out = withPart(base, "hat", crown);
    expect(out).not.toBe(base);
    expect(base).toEqual(snapshot);
    expect(out).toEqual({ ...snapshot, hat: crown, hatColor: 11 });
    // 다른 슬롯: 부품만 바뀌고 색은 그대로.
    const hoodie = SLOT_OPTIONS.top.indexOf("hoodie");
    expect(withPart(base, "top", hoodie)).toEqual({ ...snapshot, top: hoodie });
  });

  it("withPart keeps the color when the part is 없음", () => {
    const gold = { ...DEFAULT_APPEARANCE, hat: SLOT_OPTIONS.hat.indexOf("crown"), hatColor: 11 };
    expect(withPart(gold, "hat", 0)).toEqual({ ...gold, hat: 0 });
  });
});

describe("withPart reading the manifest default colors (module re-evaluated against a doctored manifest)", () => {
  afterEach(() => {
    vi.doUnmock("./characterManifest");
    vi.resetModules();
  });

  async function loadWithManifest(patch: (real: typeof CHARACTER_MANIFEST) => Record<string, unknown>) {
    vi.resetModules();
    vi.doMock("./characterManifest", async () => {
      const real = await vi.importActual<typeof import("./characterManifest")>("./characterManifest");
      return { ...real, CHARACTER_MANIFEST: { ...real.CHARACTER_MANIFEST, ...patch(real.CHARACTER_MANIFEST) } };
    });
    return import("./appearance");
  }

  const loadWith = (defaultColors: Record<string, Record<string, string>>) => loadWithManifest(() => ({ defaultColors }));

  it("matches the hex case-insensitively", async () => {
    const mod = await loadWith({ hat: { crown: "#d4a93a" }, top: { hoodie: "#2f6fde" } });
    const crown = mod.SLOT_OPTIONS.hat.indexOf("crown");
    expect(mod.withPart({ ...mod.DEFAULT_APPEARANCE, hatColor: 3 }, "hat", crown).hatColor).toBe(11);
    // 모자 말고 다른 슬롯의 기본색도 그 슬롯의 색 필드로 간다.
    const hoodie = mod.SLOT_OPTIONS.top.indexOf("hoodie");
    expect(mod.withPart({ ...mod.DEFAULT_APPEARANCE, topColor: 0 }, "top", hoodie).topColor).toBe(6);
  });

  it("keeps the current color when the default hex is not in the palette", async () => {
    const mod = await loadWith({ hat: { crown: "#123456" } });
    const crown = mod.SLOT_OPTIONS.hat.indexOf("crown");
    expect(mod.withPart({ ...mod.DEFAULT_APPEARANCE, hatColor: 3 }, "hat", crown).hatColor).toBe(3);
  });

  it("keeps the current color when the manifest names no default colors", async () => {
    const mod = await loadWith({});
    const crown = mod.SLOT_OPTIONS.hat.indexOf("crown");
    expect(mod.withPart({ ...mod.DEFAULT_APPEARANCE, hatColor: 3 }, "hat", crown).hatColor).toBe(3);
  });

  it("refuses to load when a preset names a part the manifest no longer has", async () => {
    await expect(
      loadWithManifest((real) => ({ slots: { ...real.slots, hat: real.slots.hat.filter((id) => id !== "crown") } })),
    ).rejects.toThrow(/hat.*crown/);
  });

  it("follows the manifest order: presets and the default look still resolve to the same part ids", async () => {
    const mod = await loadWithManifest((real) => ({ slots: { ...real.slots, top: [...real.slots.top].reverse(), hat: [...real.slots.hat].reverse() } }));
    for (const p of mod.APPEARANCE_PRESETS) {
      const out = mod.applyPreset(mod.DEFAULT_APPEARANCE, p);
      expect(mod.SLOT_OPTIONS.top[out.top]).toBe(p.parts.top);
      expect(mod.SLOT_OPTIONS.hat[out.hat]).toBe(p.parts.hat);
    }
    expect(mod.SLOT_OPTIONS.top[mod.DEFAULT_APPEARANCE.top]).toBe("tee");
  });
});

describe("presets", () => {
  /** 설계 4장 표(id / label / parts / colors) — 구현과 따로 한 번 더 적은 기대값. */
  const SPEC: readonly (readonly [string, string, string, number, string, number, string, string, number, string, number, string, number, string, number])[] = [
    ["prince", "왕자", "crown", 11, "short", 3, "smile", "prince_coat", 6, "pants", 10, "tall_boots", 7, "scepter", 11],
    ["princess", "공주", "tiara", 11, "twintails", 2, "wink", "gown_top", 9, "longskirt", 9, "dress", 10, "rose", 0],
    ["knight", "기사", "knight_helmet", 0, "short", 1, "smile", "armor", 0, "pants", 7, "tall_boots", 7, "wooden_sword", 2],
    ["wizard", "마법사", "wizard", 8, "curly", 7, "calm", "robe", 8, "pants", 7, "wizard_shoes", 8, "staff", 5],
    ["fairy", "요정", "flower_crown", 9, "bob", 5, "wink", "petal_top", 3, "petal_skirt", 3, "sandals", 9, "wand", 2],
    ["explorer", "탐험가", "safari", 11, "ponytail", 2, "glasses", "explorer_vest", 4, "shorts", 11, "hiking_boots", 1, "map", 2],
    ["pirate", "해적", "pirate_hat", 7, "curly", 0, "tongue", "pirate_stripe", 0, "shorts", 7, "tall_boots", 7, "telescope", 11],
    ["astronaut", "우주비행사", "space_helmet", 10, "short", 1, "wow", "spacesuit", 10, "space_pants", 10, "space_boots", 6, "flag", 6],
  ];

  it("8 presets in spec order with the spec's parts (spec §4)", () => {
    expect(APPEARANCE_PRESETS.map((p) => p.label)).toEqual(["왕자", "공주", "기사", "마법사", "요정", "탐험가", "해적", "우주비행사"]);
    expect(APPEARANCE_PRESETS.map((p) => p.id)).toEqual(SPEC.map((s) => s[0]));
    // 표의 모든 칸: 부품 id와 색 인덱스
    APPEARANCE_PRESETS.forEach((p, i) => {
      const [id, label, hat, hatColor, hair, hairColor, face, top, topColor, bottom, bottomColor, shoes, shoesColor, item, itemColor] = SPEC[i];
      expect(p).toEqual({
        id, label,
        parts: { hat, hair, face, top, bottom, shoes, item },
        colors: { hatColor, hairColor, topColor, bottomColor, shoesColor, itemColor },
      });
    });
    // 모든 프리셋은 7개 슬롯이 모두 null이 아니다(모자·머리·얼굴·웃옷·바지·신발·소품을 다 갖춘다).
    for (const p of APPEARANCE_PRESETS) for (const s of CHARACTER_SLOTS) expect(p.parts[s]).not.toBeNull();
  });

  it("every preset part id exists in the manifest and every preset color is inside its palette", () => {
    for (const p of APPEARANCE_PRESETS) {
      for (const s of CHARACTER_SLOTS) expect(SLOT_OPTIONS[s]).toContain(p.parts[s]);
      expect(p.colors.hatColor).toBeLessThan(CLOTHES_PALETTE.length);
      expect(p.colors.topColor).toBeLessThan(CLOTHES_PALETTE.length);
      expect(p.colors.bottomColor).toBeLessThan(CLOTHES_PALETTE.length);
      expect(p.colors.shoesColor).toBeLessThan(CLOTHES_PALETTE.length);
      expect(p.colors.itemColor).toBeLessThan(CLOTHES_PALETTE.length);
      expect(p.colors.hairColor).toBeLessThan(HAIR_PALETTE.length);
    }
    // id는 서로 다르다.
    expect(new Set(APPEARANCE_PRESETS.map((p) => p.id)).size).toBe(APPEARANCE_PRESETS.length);
  });

  it("applyPreset keeps skin and voice, and every preset id resolves to a valid appearance", () => {
    const mine: Appearance = { ...DEFAULT_APPEARANCE, skin: 3, voice: 1, hat: 5, topColor: 2 };
    for (const p of APPEARANCE_PRESETS) {
      const out = applyPreset(mine, p);
      expect(validateAppearance(out)).toEqual(out);
      expect(out.skin).toBe(3);
      expect(out.voice).toBe(1);
      // 부품 인덱스는 id로 다시 풀면 프리셋의 id가 된다.
      for (const s of CHARACTER_SLOTS) expect(SLOT_OPTIONS[s][out[s]]).toBe(p.parts[s]);
      expect(out.hatColor).toBe(p.colors.hatColor);
      expect(out.hairColor).toBe(p.colors.hairColor);
      expect(out.topColor).toBe(p.colors.topColor);
      expect(out.bottomColor).toBe(p.colors.bottomColor);
      expect(out.shoesColor).toBe(p.colors.shoesColor);
      expect(out.itemColor).toBe(p.colors.itemColor);
    }
    // 입력은 바뀌지 않는다.
    expect(mine).toEqual({ ...DEFAULT_APPEARANCE, skin: 3, voice: 1, hat: 5, topColor: 2 });
  });

  it("applyPreset throws for a preset naming a part that is not in the manifest", () => {
    const broken: AppearancePreset = { ...APPEARANCE_PRESETS[0], id: "broken", parts: { ...APPEARANCE_PRESETS[0].parts, hat: "no_such_hat" } };
    expect(() => applyPreset(DEFAULT_APPEARANCE, broken)).toThrow(/hat/);
  });

  it("the preset list cannot be changed by accident", () => {
    expect(Object.isFrozen(APPEARANCE_PRESETS)).toBe(true);
    for (const p of APPEARANCE_PRESETS) {
      expect(Object.isFrozen(p)).toBe(true);
      expect(Object.isFrozen(p.parts)).toBe(true);
      expect(Object.isFrozen(p.colors)).toBe(true);
    }
  });
});

describe("voiceGender", () => {
  it("voiceGender maps 0 → male, 1 → female, anything else → male", () => {
    expect(voiceGender(0)).toBe("male");
    expect(voiceGender(1)).toBe("female");
    for (const other of [2, -1, 1.5, NaN, 99]) expect(voiceGender(other)).toBe("male");
  });
});

describe("single source", () => {
  it("constants re-exports the very same ranges object (single source)", () =>
    expect(ConstantsRanges).toBe(APPEARANCE_RANGES));

  it("constants re-exports the very same field list", () => expect(ConstantsFields).toBe(APPEARANCE_FIELDS));
});
