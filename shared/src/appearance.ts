// 플레이어 외형의 단일 소스: 15개 uint8 필드, 범위, 팔레트, 기본값, 프리셋 8개, 랜덤, 검증.
// 서버·클라이언트·봇이 모두 이 모듈만 본다(설계 5.2). 브라우저 안전 모듈이므로
// schema.ts(@colyseus/schema 데코레이터)를 import 하지 않는다.
//
// 슬롯 필드(hat, hair, face, top, bottom, shoes, item)의 값은 부품 인덱스다.
// 모자·머리카락·소품은 인덱스 0이 "없음"이라 manifest 목록보다 한 칸 길다.
// 색 필드는 팔레트 인덱스이고, voice는 VOICE_GENDERS 인덱스다.

import { CHARACTER_MANIFEST, CHARACTER_SLOTS, type CharacterSlot } from "./characterManifest";

/** 동기화되는 외형 필드. 순서는 설계 5.2의 순서이고, 스키마·메시지·봇은 이 목록에서 필드를 가져온다. */
export const APPEARANCE_FIELDS = [
  "hat", "hatColor", "hair", "hairColor", "face", "skin", "top", "topColor",
  "bottom", "bottomColor", "shoes", "shoesColor", "item", "itemColor", "voice",
] as const;
export type AppearanceField = (typeof APPEARANCE_FIELDS)[number];

/** 슬롯 필드 = 부품 인덱스(필드 이름 = 슬롯 이름), 색 필드 = 팔레트 인덱스, voice = 목소리 인덱스. */
export type Appearance = Record<AppearanceField, number>;

// ── 팔레트(1단계 승인 뷰어 값). 배열 순서가 곧 인덱스다. ──

export interface PaletteColor {
  hex: string;
  label: string;
}

function palette(entries: readonly (readonly [label: string, hex: string])[]): readonly PaletteColor[] {
  return Object.freeze(entries.map(([label, hex]) => Object.freeze({ hex, label })));
}

/** 모자·웃옷·바지·신발·소품이 함께 쓰는 옷 색 12가지. */
export const CLOTHES_PALETTE: readonly PaletteColor[] = palette([
  ["빨강", "#E53E3E"], ["주황", "#F6873F"], ["노랑", "#F6C445"], ["연두", "#8BCF5A"],
  ["초록", "#2F9E62"], ["하늘", "#4FB3E8"], ["파랑", "#2F6FDE"], ["남색", "#2D3A75"],
  ["보라", "#8B5CF6"], ["분홍", "#F07AAE"], ["흰색", "#F7F7F2"], ["금색", "#D4A93A"],
]);

/** 머리카락 색 8가지. */
export const HAIR_PALETTE: readonly PaletteColor[] = palette([
  ["검정", "#2B2420"], ["진갈색", "#4A3226"], ["갈색", "#8A5A3B"], ["금발", "#F0C060"],
  ["주황", "#E07A3A"], ["분홍", "#F49AC1"], ["파랑", "#5B8DEF"], ["회색", "#B8B8B8"],
]);

/** 피부색 5가지. */
export const SKIN_PALETTE: readonly PaletteColor[] = palette([
  ["피부색 1", "#FFDCC2"], ["피부색 2", "#F5C9A0"], ["피부색 3", "#E0A47A"],
  ["피부색 4", "#B07A52"], ["피부색 5", "#7A4E33"],
]);

const NO_COLORS: readonly PaletteColor[] = Object.freeze([]);

const PALETTES: Readonly<Partial<Record<AppearanceField, readonly PaletteColor[]>>> = {
  hatColor: CLOTHES_PALETTE,
  hairColor: HAIR_PALETTE,
  skin: SKIN_PALETTE,
  topColor: CLOTHES_PALETTE,
  bottomColor: CLOTHES_PALETTE,
  shoesColor: CLOTHES_PALETTE,
  itemColor: CLOTHES_PALETTE,
};

/**
 * 색 필드가 고르는 팔레트: 옷 5필드 → CLOTHES, hairColor → HAIR, skin → SKIN.
 * 색 필드가 아닌 필드(부품 인덱스·voice)는 팔레트가 없으므로 빈 배열이다.
 */
export function paletteFor(field: AppearanceField): readonly PaletteColor[] {
  return PALETTES[field] ?? NO_COLORS;
}

// ── 슬롯 ──

/** 인덱스 0이 "없음"인 슬롯. 얼굴·웃옷·바지·신발은 항상 하나를 입는다. */
export const OPTIONAL_SLOTS: readonly CharacterSlot[] = Object.freeze(["hat", "hair", "item"] as const);

/**
 * 슬롯별 선택지. 선택 슬롯은 [null, ...manifest]이고 나머지는 manifest 그대로다. 인덱스가 외형 필드 값이다.
 * 이 인덱스는 동기화·서버 재접속 캐시·localStorage["cv.entry"]에 그대로 실리므로 부품은 슬롯 끝에 덧붙이기만 한다
 * (append only: 끼워 넣기·지우기·순서 바꾸기 금지). appearance.test.ts의 "slot part order" 고정값을 함께 늘린다.
 */
export const SLOT_OPTIONS: Record<CharacterSlot, readonly (string | null)[]> = Object.fromEntries(
  CHARACTER_SLOTS.map((slot) => {
    const ids: readonly string[] = CHARACTER_MANIFEST.slots[slot];
    return [slot, Object.freeze(OPTIONAL_SLOTS.includes(slot) ? [null, ...ids] : [...ids])];
  }),
) as Record<CharacterSlot, readonly (string | null)[]>;

/** 슬롯 → 그 슬롯을 칠하는 색 필드. 얼굴은 피부색(skin)이 칠한다. */
export const SLOT_COLOR_FIELD: Record<CharacterSlot, AppearanceField> = {
  hat: "hatColor",
  hair: "hairColor",
  face: "skin",
  top: "topColor",
  bottom: "bottomColor",
  shoes: "shoesColor",
  item: "itemColor",
};

function isSlot(field: AppearanceField): field is CharacterSlot {
  return (CHARACTER_SLOTS as readonly string[]).includes(field);
}

// ── 목소리 ──

export const VOICE_GENDERS = ["male", "female"] as const;
export type VoiceGender = (typeof VOICE_GENDERS)[number];

/** 0 → male, 1 → female, 그 밖의 값은 male. */
export function voiceGender(index: number): VoiceGender {
  return VOICE_GENDERS[index] ?? "male";
}

// ── 범위와 검증 ──

function rangeOf(field: AppearanceField): number {
  if (isSlot(field)) return SLOT_OPTIONS[field].length;
  if (field === "voice") return VOICE_GENDERS.length;
  return paletteFor(field).length;
}

/** 필드별 값의 개수(유효한 값은 [0, 범위)). SLOT_OPTIONS·팔레트·VOICE_GENDERS 길이에서 계산한다. */
export const APPEARANCE_RANGES: Readonly<Record<AppearanceField, number>> = Object.freeze(
  Object.fromEntries(APPEARANCE_FIELDS.map((f) => [f, rangeOf(f)])) as Record<AppearanceField, number>,
);

/** 잘못된 외형으로 입장하려 할 때 서버가 돌려주고 입장 화면이 보여 주는 문구. */
export const APPEARANCE_ERROR = "외형 선택이 올바르지 않습니다";

/**
 * 네트워크에서 온 값을 외형으로 검증한다. 15필드가 모두 [0, 범위) 정수여야 하고,
 * 통과하면 그 15필드만 담은 새 객체를 돌려준다(여분 키·-0은 버린다). 아니면 null.
 */
export function validateAppearance(value: unknown): Appearance | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const src = value as Record<string, unknown>;
  const out = {} as Appearance;
  for (const field of APPEARANCE_FIELDS) {
    const v = src[field];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= APPEARANCE_RANGES[field]) return null;
    out[field] = v === 0 ? 0 : v;
  }
  return retireParts(out);
}

/**
 * 더 이상 고를 수 없는 부품(발주자 2026-11-09: 멜빵바지 없앰). 부품 순서는 인덱스로 저장되므로 manifest·GLB에서
 * 지우지 않고(지우면 뒤 부품 번호가 밀린다), 조립실 카드와 🎲에서만 빼고, 저장돼 있거나 들어온 외형은 기본 부품으로 바꾼다.
 */
export const RETIRED_PARTS: Readonly<Partial<Record<CharacterSlot, readonly string[]>>> = Object.freeze({
  bottom: Object.freeze(["overalls"]),
});

/** 그 슬롯의 index 부품이 은퇴한 부품인가. */
export function isRetiredPart(slot: CharacterSlot, index: number): boolean {
  const id = SLOT_OPTIONS[slot][index];
  return id != null && (RETIRED_PARTS[slot]?.includes(id) ?? false);
}

/** 은퇴한 부품을 입고 있으면 그 슬롯만 기본 외형의 부품으로 바꾼 새 외형(없으면 a 그대로). */
export function retireParts(a: Appearance): Appearance {
  let out = a;
  for (const slot of Object.keys(RETIRED_PARTS) as CharacterSlot[]) {
    if (isRetiredPart(slot, a[slot])) out = { ...out, [slot]: DEFAULT_APPEARANCE[slot] };
  }
  return out;
}

/** Player 같은 객체에서 15필드만 새 객체로 복사한다. */
export function pickAppearance(src: Readonly<Record<AppearanceField, number>>): Appearance {
  const out = {} as Appearance;
  for (const field of APPEARANCE_FIELDS) out[field] = src[field];
  return out;
}

/**
 * 부품 id(없음 = null)와 색으로 외형을 만든다. 프리셋과 기본값을 id로 적어 두고 모듈이 뜰 때
 * 인덱스로 바꾸므로 manifest 순서가 바뀌어도 안전하다. 모르는 id나 범위를 벗어난 색은 던진다.
 */
export function appearanceFromIds(
  parts: Record<CharacterSlot, string | null>,
  colors: Omit<Appearance, CharacterSlot>,
): Appearance {
  const out = {} as Appearance;
  for (const field of APPEARANCE_FIELDS) {
    if (isSlot(field)) {
      const index = SLOT_OPTIONS[field].indexOf(parts[field]);
      if (index < 0) throw new Error(`appearance: unknown ${field} part "${String(parts[field])}"`);
      out[field] = index;
    } else {
      out[field] = colors[field];
    }
  }
  const checked = validateAppearance(out);
  if (checked === null) throw new Error(`appearance: color or voice out of range ${JSON.stringify(out)}`);
  return checked;
}

/** 1단계 시안의 기본 외형: 짧은 머리, 웃는 얼굴, 티셔츠, 긴바지, 운동화(모자·소품 없음). */
export const DEFAULT_APPEARANCE: Readonly<Appearance> = Object.freeze(
  appearanceFromIds(
    { hat: null, hair: "short", face: "smile", top: "tee", bottom: "pants", shoes: "sneakers", item: null },
    { hatColor: 2, hairColor: 1, skin: 0, topColor: 6, bottomColor: 7, shoesColor: 0, itemColor: 2, voice: 0 },
  ),
);

/** 필드마다 min(범위−1, floor(rand()·범위)). rand는 [0, 1)을 돌려주는 함수다. */
export function randomAppearance(rand: () => number): Appearance {
  const out = {} as Appearance;
  for (const field of APPEARANCE_FIELDS) {
    const range = APPEARANCE_RANGES[field];
    out[field] = Math.min(range - 1, Math.floor(rand() * range));
  }
  // 은퇴한 부품은 뽑지 않는다: 그 슬롯의 다음 부품으로 넘긴다(고를 수 있는 부품이 늘 있다).
  for (const slot of Object.keys(RETIRED_PARTS) as CharacterSlot[]) {
    const range = APPEARANCE_RANGES[slot];
    while (isRetiredPart(slot, out[slot])) out[slot] = (out[slot] + 1) % range;
  }
  return out;
}

const DEFAULT_COLORS: Readonly<Record<string, Readonly<Record<string, string>>>> = CHARACTER_MANIFEST.defaultColors;

/**
 * 슬롯의 부품을 index로 바꾼 새 외형. manifest.defaultColors에 그 부품의 기본색(왕관·티아라 = 금색)이
 * 있고 그 hex가 슬롯의 팔레트에 있으면(대소문자 무시) 색도 그 색으로 바꾼다. 아니면 색은 그대로다.
 */
export function withPart(a: Appearance, slot: CharacterSlot, index: number): Appearance {
  const next: Appearance = { ...a };
  next[slot] = index;
  const id = SLOT_OPTIONS[slot][index];
  const hex = id ? DEFAULT_COLORS[slot]?.[id] : undefined;
  if (hex !== undefined) {
    const colorField = SLOT_COLOR_FIELD[slot];
    const wanted = hex.toLowerCase();
    const colorIndex = paletteFor(colorField).findIndex((c) => c.hex.toLowerCase() === wanted);
    if (colorIndex >= 0) next[colorField] = colorIndex;
  }
  return next;
}

// ── 프리셋 ──

export interface AppearancePreset {
  id: string;
  label: string;
  parts: Record<CharacterSlot, string | null>;
  colors: Pick<Appearance, "hatColor" | "hairColor" | "topColor" | "bottomColor" | "shoesColor" | "itemColor">;
}

function freezePreset(p: AppearancePreset): AppearancePreset {
  return Object.freeze({ ...p, parts: Object.freeze({ ...p.parts }), colors: Object.freeze({ ...p.colors }) });
}

/**
 * 프리셋 캐릭터 8개(설계 4장). 모두 동화·모험 주인공이고 모자·머리·얼굴·웃옷·바지·신발·소품을 다 갖춘다.
 * 색은 CLOTHES·HAIR 팔레트 인덱스다. 프리셋은 skin을 기본값으로 되돌리고 voice는 바꾸지 않는다.
 */
export const APPEARANCE_PRESETS: readonly AppearancePreset[] = Object.freeze([
  {
    id: "prince", label: "왕자",
    parts: { hat: "crown", hair: "short", face: "smile", top: "prince_coat", bottom: "pants", shoes: "tall_boots", item: "scepter" },
    colors: { hatColor: 11, hairColor: 3, topColor: 6, bottomColor: 10, shoesColor: 7, itemColor: 11 },
  },
  {
    id: "princess", label: "공주",
    parts: { hat: "tiara", hair: "twintails", face: "wink", top: "gown_top", bottom: "longskirt", shoes: "dress", item: "rose" },
    colors: { hatColor: 11, hairColor: 2, topColor: 9, bottomColor: 9, shoesColor: 10, itemColor: 0 },
  },
  {
    id: "knight", label: "기사",
    parts: { hat: "knight_helmet", hair: "short", face: "smile", top: "armor", bottom: "pants", shoes: "tall_boots", item: "wooden_sword" },
    colors: { hatColor: 0, hairColor: 1, topColor: 0, bottomColor: 7, shoesColor: 7, itemColor: 2 },
  },
  {
    id: "wizard", label: "마법사",
    parts: { hat: "wizard", hair: "curly", face: "calm", top: "robe", bottom: "pants", shoes: "wizard_shoes", item: "staff" },
    colors: { hatColor: 8, hairColor: 7, topColor: 8, bottomColor: 7, shoesColor: 8, itemColor: 5 },
  },
  {
    id: "fairy", label: "요정",
    parts: { hat: "flower_crown", hair: "bob", face: "wink", top: "petal_top", bottom: "petal_skirt", shoes: "sandals", item: "wand" },
    colors: { hatColor: 9, hairColor: 5, topColor: 3, bottomColor: 3, shoesColor: 9, itemColor: 2 },
  },
  {
    id: "explorer", label: "탐험가",
    parts: { hat: "safari", hair: "ponytail", face: "glasses", top: "explorer_vest", bottom: "shorts", shoes: "hiking_boots", item: "map" },
    colors: { hatColor: 11, hairColor: 2, topColor: 4, bottomColor: 11, shoesColor: 1, itemColor: 2 },
  },
  {
    id: "pirate", label: "해적",
    parts: { hat: "pirate_hat", hair: "curly", face: "tongue", top: "pirate_stripe", bottom: "shorts", shoes: "tall_boots", item: "telescope" },
    colors: { hatColor: 7, hairColor: 0, topColor: 0, bottomColor: 7, shoesColor: 7, itemColor: 11 },
  },
  {
    id: "astronaut", label: "우주비행사",
    parts: { hat: "space_helmet", hair: "short", face: "wow", top: "spacesuit", bottom: "space_pants", shoes: "space_boots", item: "flag" },
    colors: { hatColor: 10, hairColor: 1, topColor: 10, bottomColor: 10, shoesColor: 6, itemColor: 6 },
  },
].map(freezePreset));

/**
 * 프리셋의 부품과 색으로 바꾼 새 외형. 프리셋은 그 캐릭터의 원래 모습이라 skin은 기본값으로 돌아가고
 * (🎲 뒤에 프리셋을 눌러도 랜덤 피부색이 남지 않는다, 발주자 2026-11-09), voice만 a의 값을 유지한다.
 */
export function applyPreset(a: Appearance, p: AppearancePreset): Appearance {
  return appearanceFromIds(p.parts, { ...p.colors, skin: DEFAULT_APPEARANCE.skin, voice: a.voice });
}

// 모듈이 뜰 때 프리셋이 모두 풀리는지 확인한다: manifest에서 부품이 빠지면 학생이 프리셋을
// 누르는 순간이 아니라 서버·클라이언트가 시작하는 순간에 바로 드러난다.
for (const preset of APPEARANCE_PRESETS) applyPreset(DEFAULT_APPEARANCE, preset);
