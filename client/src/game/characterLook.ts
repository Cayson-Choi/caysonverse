// 외형(Appearance, 15개 숫자)을 아바타가 그릴 "모습"으로 해석하는 순수 모듈(설계 5.1·5.2).
// 부품 id·색(hex)을 정하고, 어느 메시를 그릴지(덮개·모자용 머리·투구가 머리 숨김) 고르고,
// 하의에 맞는 동작 클립 이름(clipFor)을 돌려준다. three.js를 import 하지 않으므로 서버 없이
// 단위 테스트할 수 있고, 아바타 조립(Task 5)·애니메이션(Task 6·7·8)이 이 결과만 본다.
//
// 모르는 인덱스(옛 탭 + 더 새 서버 manifest)는 던지지 않고 그 필드만 DEFAULT_APPEARANCE 값으로 해석한다.

import {
  DEFAULT_APPEARANCE,
  SLOT_COLOR_FIELD,
  SLOT_OPTIONS,
  paletteFor,
  type Appearance,
  type AppearanceField,
} from "@caysonverse/shared/appearance";
import { CHARACTER_MANIFEST, CHARACTER_SLOTS, type CharacterSlot } from "@caysonverse/shared/characterManifest";

/** manifest `tintMaterials`의 키: skin | hair | hat | top | bottom | shoes | item | accent. */
export type TintKey = keyof typeof CHARACTER_MANIFEST.tintMaterials;

/** manifest 순서의 틴트 키. lookKey가 이 순서로 색을 적는다. */
export const TINT_KEYS: readonly TintKey[] = Object.keys(CHARACTER_MANIFEST.tintMaterials) as TintKey[];

export interface AvatarLook {
  /** 슬롯별 부품 id. 없음 = null. */
  parts: Record<CharacterSlot, string | null>;
  /** 틴트 키별 `#RRGGBB`. */
  colors: Record<TintKey, string>;
}

/** 플레이어는 accent 부품(NPC 전용 AI 조교 옷)을 입지 않으므로 accent 틴트는 흰색으로 둔다. */
export const PLAYER_ACCENT = "#FFFFFF";

/** accent를 뺀 틴트 키 → 그 틴트를 고르는 외형 색 필드. 얼굴 슬롯은 피부색(skin)이 칠한다. */
const TINT_COLOR_FIELD: Record<Exclude<TintKey, "accent">, AppearanceField> = {
  skin: SLOT_COLOR_FIELD.face,
  hair: SLOT_COLOR_FIELD.hair,
  hat: SLOT_COLOR_FIELD.hat,
  top: SLOT_COLOR_FIELD.top,
  bottom: SLOT_COLOR_FIELD.bottom,
  shoes: SLOT_COLOR_FIELD.shoes,
  item: SLOT_COLOR_FIELD.item,
};

/** 재질 이름 → 틴트 키. solidColorFor가 매 호출마다 manifest를 훑지 않도록 한 번만 만든다. */
const TINT_BY_MATERIAL: ReadonlyMap<string, TintKey> = new Map(
  TINT_KEYS.map((key) => [CHARACTER_MANIFEST.tintMaterials[key], key]),
);

/** [0, length) 범위의 정수인가. 모르는 인덱스·NaN·소수·undefined를 한꺼번에 거른다. */
function isIndex(value: unknown, length: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < length;
}

/**
 * 외형 → 부품 id·색. 이 클라이언트의 SLOT_OPTIONS·팔레트 범위를 벗어난 인덱스(부품·색)는
 * 그 필드만 DEFAULT_APPEARANCE의 값으로 바꿔 해석한다. 던지지 않고, 부품이 undefined가 되지 않는다.
 */
export function lookFromAppearance(a: Appearance): AvatarLook {
  const parts = {} as Record<CharacterSlot, string | null>;
  for (const slot of CHARACTER_SLOTS) {
    const options = SLOT_OPTIONS[slot];
    parts[slot] = options[isIndex(a[slot], options.length) ? a[slot] : DEFAULT_APPEARANCE[slot]] ?? null;
  }
  const colors = {} as Record<TintKey, string>;
  for (const key of TINT_KEYS) {
    if (key === "accent") {
      colors[key] = PLAYER_ACCENT;
      continue;
    }
    const field = TINT_COLOR_FIELD[key];
    const palette = paletteFor(field);
    colors[key] = palette[isIndex(a[field], palette.length) ? a[field] : DEFAULT_APPEARANCE[field]].hex;
  }
  return { parts, colors };
}

/** 덮는 슬롯 → 그 슬롯이 비었을 때 드러나는 맨몸 메시. */
const COVERS: readonly (readonly [CharacterSlot, string])[] = Object.entries(CHARACTER_MANIFEST.covers) as [
  CharacterSlot,
  string,
][];

const HAT_VARIANTS: Readonly<Record<string, string | undefined>> = CHARACTER_MANIFEST.hatVariants;
const HAT_HIDES_HAIR: readonly string[] = CHARACTER_MANIFEST.hatHidesHair;

/**
 * 그릴 부품 메시 노드 이름(정렬). 머리·손은 항상 그리고, 덮는 부품(웃옷·바지·신발)이 없을 때만
 * 그 맨몸 메시(torso·legs·feet)를 그린다. 모자를 쓰면 머리카락은 모자용 변형(`hair__X__hat`)으로
 * 바뀌고, hatHidesHair 모자(투구·헬멧)를 쓰면 머리카락 메시를 아예 그리지 않는다.
 */
export function visibleParts(parts: AvatarLook["parts"]): string[] {
  const out = ["body__head", "body__hands"];
  for (const [slot, body] of COVERS) if (parts[slot] === null) out.push(body);
  for (const slot of CHARACTER_SLOTS) {
    const id = parts[slot];
    if (id === null) continue;
    if (slot === "hair" && parts.hat !== null && HAT_HIDES_HAIR.includes(parts.hat)) continue;
    // 모자용 변형이 없는 머리(manifest 검사가 막는 경우)는 보통 머리로 둔다. undefined를 내보내지 않는다.
    out.push(slot === "hair" && parts.hat !== null ? (HAT_VARIANTS[id] ?? `${slot}__${id}`) : `${slot}__${id}`);
  }
  return out.sort();
}

/** 틴트 재질이면 그 look의 색, 고정색·텍스처·모르는 재질이면 null. */
export function solidColorFor(materialName: string, look: AvatarLook): string | null {
  const key = TINT_BY_MATERIAL.get(materialName);
  return key === undefined ? null : look.colors[key];
}

/** 같은 모습이면 같은 문자열: `${부품 7개(없음 "-")}|${색 8개 대문자}`. 합친 지오메트리 공유의 키로 쓴다. */
export function lookKey(look: AvatarLook): string {
  let key = "";
  for (let i = 0; i < CHARACTER_SLOTS.length; i++) key += (i > 0 ? "," : "") + (look.parts[CHARACTER_SLOTS[i]] ?? "-");
  key += "|";
  for (let i = 0; i < TINT_KEYS.length; i++) key += (i > 0 ? "," : "") + look.colors[TINT_KEYS[i]].toUpperCase();
  return key;
}

const CLIP_VARIANTS: Readonly<Record<string, Readonly<Record<string, string>> | undefined>> =
  CHARACTER_MANIFEST.clipVariants;

/**
 * 아바타가 재생할 클립 이름. 하의가 변형을 가진 클립(걷기·달리기·점프)이면 그 변형(`*_LongSkirt`,
 * `*_ShortSkirt`)을, 아니면 base를 그대로 돌려준다. 반환값은 항상 manifest `clips`에 있다.
 * 할당이 없다. 외형이 바뀌면 look이 바뀌므로 호출한 쪽은 그때 클립 이름을 다시 정해야 한다.
 */
export function clipFor(base: string, look: AvatarLook): string {
  const bottom = look.parts.bottom;
  const variants = bottom === null ? undefined : CLIP_VARIANTS[bottom];
  return variants?.[base] ?? base;
}
