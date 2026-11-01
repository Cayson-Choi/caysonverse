import { describe, expect, it } from "vitest";
import {
  APPEARANCE_FIELDS,
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  SLOT_COLOR_FIELD,
  SLOT_OPTIONS,
  applyPreset,
  paletteFor,
  type Appearance,
} from "@caysonverse/shared/appearance";
import { BODY_MESHES, CHARACTER_MANIFEST, CHARACTER_SLOTS } from "@caysonverse/shared/characterManifest";
import { CLIP } from "./constants";
import {
  PLAYER_ACCENT,
  TINT_KEYS,
  clipFor,
  lookFromAppearance,
  lookKey,
  solidColorFor,
  visibleParts,
  type AvatarLook,
} from "./characterLook";

const BASE = lookFromAppearance(DEFAULT_APPEARANCE);

/** 기본 외형의 해석 결과에서 부품 몇 개만 바꾼 look. */
const look = (parts: Partial<AvatarLook["parts"]>): AvatarLook => ({
  ...BASE,
  parts: { ...BASE.parts, ...parts },
});

/** 매니페스트가 싣는 모든 메시 노드 이름(character.glb ↔ manifest 일치는 shared 테스트가 맡는다). */
const SHIPPED_MESHES: ReadonlySet<string> = new Set([
  ...BODY_MESHES,
  ...CHARACTER_SLOTS.flatMap((slot) => CHARACTER_MANIFEST.slots[slot].map((id) => `${slot}__${id}`)),
  ...Object.values(CHARACTER_MANIFEST.hatVariants),
]);

describe("visibleParts", () => {
  it("default look shows body head/hands, never the covered torso/legs/feet", () =>
    expect(visibleParts(lookFromAppearance(DEFAULT_APPEARANCE).parts)).toEqual(
      ["body__hands", "body__head", "bottom__pants", "face__smile", "hair__short", "shoes__sneakers", "top__tee"]));

  it("a hat swaps the hair for its hat variant; taking the hat off restores it", () => {
    expect(visibleParts(look({ hat: "cap", hair: "ponytail" }).parts)).toEqual(
      expect.arrayContaining(["hat__cap", "hair__ponytail__hat"]));
    expect(visibleParts(look({ hat: "cap", hair: "ponytail" }).parts)).not.toContain("hair__ponytail");
    expect(visibleParts(look({ hat: null, hair: "ponytail" }).parts)).toContain("hair__ponytail");
    expect(visibleParts(look({ hat: null, hair: "ponytail" }).parts)).not.toContain("hair__ponytail__hat");
  });

  it("bald + hat shows no hair mesh at all", () => {
    for (const hat of CHARACTER_MANIFEST.slots.hat) {
      const v = visibleParts(look({ hat, hair: null }).parts);
      expect(v).toContain(`hat__${hat}`);
      expect(v.filter((p) => p.startsWith("hair__"))).toEqual([]);
    }
    expect(visibleParts(look({ hat: null, hair: null }).parts).filter((p) => p.startsWith("hair__"))).toEqual([]);
  });

  it("hides the hair under a hatHidesHair helmet (Review Focus 6)", () => {
    expect(CHARACTER_MANIFEST.hatHidesHair.length).toBeGreaterThan(0);
    for (const hat of CHARACTER_MANIFEST.hatHidesHair) {
      for (const hair of CHARACTER_MANIFEST.slots.hair) {
        const v = visibleParts(look({ hat, hair }).parts);
        expect(v).toContain(`hat__${hat}`);
        expect(v.some((p) => p.startsWith("hair__"))).toBe(false);
      }
    }
    // 일반 모자는 그대로: 모자용 머리를 그린다
    expect(visibleParts(look({ hat: "cap", hair: "ponytail" }).parts)).toContain("hair__ponytail__hat");
  });

  it("an empty covering slot shows its body mesh (covers rule)", () => {
    expect(visibleParts(look({ top: null, bottom: null, shoes: null }).parts)).toEqual(
      expect.arrayContaining(["body__torso", "body__legs", "body__feet"]));
    // 하나만 비우면 그 몸 메시만 나온다
    const v = visibleParts(look({ bottom: null }).parts);
    expect(v).toContain("body__legs");
    expect(v).not.toContain("body__torso");
    expect(v).not.toContain("body__feet");
    expect(v).not.toContain("bottom__pants");
  });

  it("every option of every slot, with and without a hat, names a mesh the manifest ships", () => {
    for (const slot of CHARACTER_SLOTS) {
      for (const option of SLOT_OPTIONS[slot]) {
        for (const hat of [null, "cap"]) {
          const parts = { ...BASE.parts, hat, [slot]: option };
          const names = visibleParts(parts);
          for (const name of names) expect({ slot, option, hat, name, shipped: SHIPPED_MESHES.has(name) })
            .toEqual({ slot, option, hat, name, shipped: true });
        }
      }
    }
    // 모자 × 머리카락 조합 전부
    for (const hat of SLOT_OPTIONS.hat) {
      for (const hair of SLOT_OPTIONS.hair) {
        for (const name of visibleParts(look({ hat, hair }).parts)) {
          expect({ hat, hair, name, shipped: SHIPPED_MESHES.has(name) }).toEqual({ hat, hair, name, shipped: true });
        }
      }
    }
  });

  it("returns a sorted list without duplicates", () => {
    for (const hat of SLOT_OPTIONS.hat) {
      const v = visibleParts(look({ hat, item: "book" }).parts);
      expect(v).toEqual([...v].sort());
      expect(new Set(v).size).toBe(v.length);
    }
  });
});

describe("lookFromAppearance", () => {
  it("maps indices through SLOT_OPTIONS and the palettes", () => {
    for (const slot of CHARACTER_SLOTS) {
      SLOT_OPTIONS[slot].forEach((id, index) => {
        expect(lookFromAppearance({ ...DEFAULT_APPEARANCE, [slot]: index }).parts[slot]).toBe(id);
      });
    }
    const colorKeys = [
      ["hat", "hatColor"], ["hair", "hairColor"], ["top", "topColor"], ["bottom", "bottomColor"],
      ["shoes", "shoesColor"], ["item", "itemColor"], ["skin", "skin"],
    ] as const;
    for (const [key, field] of colorKeys) {
      paletteFor(field).forEach((color, index) => {
        expect(lookFromAppearance({ ...DEFAULT_APPEARANCE, [field]: index }).colors[key]).toBe(color.hex);
      });
    }
    // 각 슬롯을 칠하는 색 필드(SLOT_COLOR_FIELD)와 일치한다: 얼굴은 피부색
    expect(SLOT_COLOR_FIELD.face).toBe("skin");
    // 프리셋 차림: 공주
    const princess = APPEARANCE_PRESETS.find((p) => p.id === "princess")!;
    const l = lookFromAppearance(applyPreset(DEFAULT_APPEARANCE, princess));
    expect(l.parts).toEqual(princess.parts);
    expect(l.colors.top).toBe(paletteFor("topColor")[princess.colors.topColor].hex);
    expect(l.colors.hair).toBe(paletteFor("hairColor")[princess.colors.hairColor].hex);
  });

  it("covers every tint key, and the player never wears the accent part", () => {
    expect(TINT_KEYS).toEqual(Object.keys(CHARACTER_MANIFEST.tintMaterials)); // manifest 순서
    expect(Object.keys(BASE.colors)).toEqual([...TINT_KEYS]);
    expect(PLAYER_ACCENT).toBe("#FFFFFF");
    expect(BASE.colors.accent).toBe(PLAYER_ACCENT);
    for (const hex of Object.values(BASE.colors)) expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("falls back to the slot's default part and color for an index the client does not know (Review Focus 4)", () => {
    // 서버가 더 새 manifest를 써서 이 클라이언트의 SLOT_OPTIONS·팔레트보다 큰 인덱스를 보낸 경우
    const base = lookFromAppearance(DEFAULT_APPEARANCE);
    const l = lookFromAppearance({ ...DEFAULT_APPEARANCE, top: 99, topColor: 99, hat: 99, hatColor: 99, item: 99 });
    expect(l.parts).toEqual(base.parts); // top/hat/item 모두 기본 부품 (undefined 없음)
    expect(l.colors).toEqual(base.colors);
    expect(visibleParts(l.parts)).toEqual(visibleParts(base.parts)); // 빈 몸이나 예외가 아니다
    // 아는 필드는 그대로: 모르는 top 옆의 shoes는 바뀌지 않는다
    expect(lookFromAppearance({ ...DEFAULT_APPEARANCE, top: 99, shoes: 1 }).parts.shoes).toBe(SLOT_OPTIONS.shoes[1]);
    // 색도 필드 단위: 모르는 topColor 옆의 bottomColor는 바뀌지 않는다
    const c = lookFromAppearance({ ...DEFAULT_APPEARANCE, topColor: 99, bottomColor: 1 });
    expect(c.colors.top).toBe(base.colors.top);
    expect(c.colors.bottom).toBe(paletteFor("bottomColor")[1].hex);
  });

  it("falls back for every field that is out of range, negative, fractional or not a number, without throwing", () => {
    for (const bad of [99, 255, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
      for (const field of APPEARANCE_FIELDS) {
        const a: Appearance = { ...DEFAULT_APPEARANCE, [field]: bad };
        const l = lookFromAppearance(a);
        expect({ field, bad: String(bad), look: lookKey(l) }).toEqual({ field, bad: String(bad), look: lookKey(BASE) });
        expect(visibleParts(l.parts)).toEqual(visibleParts(BASE.parts));
      }
    }
  });

  it("an unknown index in the hat slot falls back to the default hat (none), not to an empty or hat-less crash", () => {
    // 기본 모자는 인덱스 0 = 없음(null): 모르는 모자 번호는 모자를 벗은 모습이다.
    expect(DEFAULT_APPEARANCE.hat).toBe(0);
    const l = lookFromAppearance({ ...DEFAULT_APPEARANCE, hat: 99, hair: SLOT_OPTIONS.hair.indexOf("ponytail") });
    expect(l.parts.hat).toBeNull();
    expect(visibleParts(l.parts)).toContain("hair__ponytail");
  });
});

describe("solidColorFor", () => {
  it("maps tint materials to the look and leaves fixed colors alone", () => {
    const l = lookFromAppearance(DEFAULT_APPEARANCE);
    expect(solidColorFor("mat_tint_top", l)).toBe(l.colors.top);
    expect(solidColorFor("mat_skin", l)).toBe(l.colors.skin);
    expect(solidColorFor("mat_fixed_gold", l)).toBeNull();
  });

  it("covers every manifest tint material and nothing else", () => {
    const l = look({});
    for (const [key, material] of Object.entries(CHARACTER_MANIFEST.tintMaterials)) {
      expect(solidColorFor(material, l)).toBe(l.colors[key as keyof AvatarLook["colors"]]);
    }
    expect(solidColorFor("mat_tint_accent", l)).toBe(PLAYER_ACCENT);
    expect(solidColorFor("mat_face_smile", l)).toBeNull(); // 텍스처 재질
    expect(solidColorFor("not_a_material", l)).toBeNull();
    expect(solidColorFor("constructor", l)).toBeNull();
    expect(solidColorFor("", l)).toBeNull();
  });

  it("follows the look when the colors change", () => {
    const red = lookFromAppearance({ ...DEFAULT_APPEARANCE, topColor: 0 });
    const blue = lookFromAppearance({ ...DEFAULT_APPEARANCE, topColor: 6 });
    expect(solidColorFor("mat_tint_top", red)).not.toBe(solidColorFor("mat_tint_top", blue));
  });
});

describe("lookKey", () => {
  it("is equal for equal looks and changes with any part or color", () => {
    const a = lookFromAppearance(DEFAULT_APPEARANCE);
    expect(lookKey(lookFromAppearance(DEFAULT_APPEARANCE))).toBe(lookKey(a));
    expect(lookKey(look({}))).toBe(lookKey(a)); // 복사본도 같다
    // 부품 7개 중 하나만 달라도 다르다
    for (const slot of CHARACTER_SLOTS) {
      const other = SLOT_OPTIONS[slot].find((id) => id !== a.parts[slot]);
      expect({ slot, same: lookKey(look({ [slot]: other })) === lookKey(a) }).toEqual({ slot, same: false });
    }
    // 부품 하나를 비워도(null) 다르다
    expect(lookKey(look({ top: null }))).not.toBe(lookKey(a));
    // 색 8개 중 하나만 달라도 다르다
    for (const key of TINT_KEYS) {
      const other = { ...a, colors: { ...a.colors, [key]: "#123456" } };
      expect({ key, same: lookKey(other) === lookKey(a) }).toEqual({ key, same: false });
    }
  });

  it("writes the 7 parts (empty = -) then the 8 colors, upper-cased", () => {
    const key = lookKey(look({ hat: null }));
    const [parts, colors] = key.split("|");
    expect(key.split("|")).toHaveLength(2);
    expect(parts.split(",")).toEqual(CHARACTER_SLOTS.map((slot) => (slot === "hat" || slot === "item" ? "-" : BASE.parts[slot])));
    expect(parts.split(",")).toHaveLength(7);
    expect(colors.split(",")).toEqual(TINT_KEYS.map((k) => BASE.colors[k].toUpperCase()));
    expect(colors.split(",")).toHaveLength(8);
    // 색 철자의 대소문자 차이는 같은 look이다
    const lower = Object.fromEntries(TINT_KEYS.map((k) => [k, BASE.colors[k].toLowerCase()])) as AvatarLook["colors"];
    expect(lookKey({ ...BASE, colors: lower })).toBe(lookKey(BASE));
  });
});

describe("clipFor", () => {
  it("every CLIP name exists in the manifest clips", () => {
    for (const c of Object.values(CLIP)) expect(CHARACTER_MANIFEST.clips).toContain(c);
  });

  it("clipFor plays the long-skirt variant for walk, run and jump (Review Focus 7)", () => {
    const skirt = look({ bottom: "longskirt" });
    expect(clipFor("Running_A", skirt)).toBe("Running_A_LongSkirt");
    expect(clipFor("Walking_A", skirt)).toBe("Walking_A_LongSkirt");
    expect(clipFor("Jump_Full_Short", skirt)).toBe("Jump_Full_Short_LongSkirt");
    expect(clipFor(CLIP.walk, skirt)).toBe("Walking_A_LongSkirt");
    expect(clipFor(CLIP.jump, skirt)).toBe("Jump_Full_Short_LongSkirt");
    const princess = APPEARANCE_PRESETS.find((p) => p.id === "princess")!; // 공주는 longskirt를 입는다
    expect(clipFor(CLIP.run, lookFromAppearance(applyPreset(DEFAULT_APPEARANCE, princess)))).toBe("Running_A_LongSkirt");
  });

  it("plays the short-skirt variant for skirt and petal_skirt (walk, run, jump)", () => {
    for (const bottom of ["skirt", "petal_skirt"]) {
      const l = look({ bottom });
      expect({ bottom, clip: clipFor("Walking_A", l) }).toEqual({ bottom, clip: "Walking_A_ShortSkirt" });
      expect({ bottom, clip: clipFor("Running_A", l) }).toEqual({ bottom, clip: "Running_A_ShortSkirt" });
      expect({ bottom, clip: clipFor("Jump_Full_Short", l) }).toEqual({ bottom, clip: "Jump_Full_Short_ShortSkirt" });
    }
    // 요정 프리셋은 petal_skirt를 입는다
    const fairy = APPEARANCE_PRESETS.find((p) => p.id === "fairy")!;
    expect(clipFor(CLIP.run, lookFromAppearance(applyPreset(DEFAULT_APPEARANCE, fairy)))).toBe("Running_A_ShortSkirt");
  });

  it("clipFor keeps the base clip for pants, for clips without a variant, and for an unknown or empty bottom (Review Focus 7)", () => {
    expect(clipFor("Running_A", look({ bottom: "pants" }))).toBe("Running_A"); // 바지 + 달리기
    expect(clipFor("Idle", look({ bottom: "longskirt" }))).toBe("Idle"); // 롱스커트 + 변형 없는 클립
    expect(clipFor("Sit_Chair_Idle", look({ bottom: "longskirt" }))).toBe("Sit_Chair_Idle");
    expect(clipFor("Running_A", look({ bottom: "future_bottom" }))).toBe("Running_A"); // 모르는 하의 id
    expect(clipFor("Running_A", look({ bottom: null }))).toBe("Running_A"); // 하의 없음(null)
    // 모르는 하의 인덱스(Review Focus 4)는 lookFromAppearance가 기본 하의로 바꾸므로 기본 클립이 나온다
    expect(clipFor("Running_A", lookFromAppearance({ ...DEFAULT_APPEARANCE, bottom: 99 }))).toBe("Running_A");
  });

  it("keeps Idle and the sit clips for every bottom, even skirts", () => {
    for (const bottom of [...SLOT_OPTIONS.bottom, "future_bottom", null]) {
      for (const base of [CLIP.idle, CLIP.sitDown, CLIP.sitIdle, CLIP.sitStand]) {
        expect({ bottom, base, clip: clipFor(base, look({ bottom })) }).toEqual({ bottom, base, clip: base });
      }
    }
  });

  it("clipFor always returns a clip the manifest ships, for every bottom and every CLIP", () => {
    const clips: readonly string[] = CHARACTER_MANIFEST.clips;
    for (const bottom of [...SLOT_OPTIONS.bottom, "future_bottom"]) {
      for (const base of Object.values(CLIP)) {
        const clip = clipFor(base, look({ bottom }));
        expect({ bottom, base, clip, shipped: clips.includes(clip) }).toEqual({ bottom, base, clip, shipped: true });
      }
    }
  });
});
