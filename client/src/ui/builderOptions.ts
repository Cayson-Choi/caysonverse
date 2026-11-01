// 입장 화면 "캐릭터 조립실"의 순수 데이터(설계 4장·5.3): 슬롯 칩 이름, 색 라벨, 견본을 보일지, 목소리 선택지,
// 화면 문구, 미리보기 카메라. React·three를 import 하지 않으므로 DOM 없이 단위 테스트한다.

import {
  SLOT_OPTIONS,
  type Appearance,
  type AppearanceField,
  type AppearancePreset,
} from "@caysonverse/shared/appearance";
import { CHARACTER_MANIFEST, CHARACTER_SLOTS, type CharacterSlot } from "@caysonverse/shared/characterManifest";

export interface ChipOption {
  /** 외형 필드 값(부품 인덱스 또는 목소리 인덱스). */
  index: number;
  /** 칩에 보이는 한국어 이름. */
  label: string;
}

/** 선택 슬롯의 인덱스 0("없음") 칩 이름. 머리카락은 "민머리"다. */
export const NONE_LABELS = { hat: "없음", hair: "민머리", item: "없음" } as const;

const NONE: Readonly<Record<string, string>> = NONE_LABELS;
const PART_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = CHARACTER_MANIFEST.labels;

/** 슬롯별 칩 목록. 모듈이 뜰 때 한 번 만들고, 렌더마다 같은(얼린) 배열을 돌려준다. */
const CHIPS: Readonly<Record<CharacterSlot, readonly ChipOption[]>> = Object.fromEntries(
  CHARACTER_SLOTS.map((slot) => [
    slot,
    Object.freeze(
      SLOT_OPTIONS[slot].map((id, index) =>
        Object.freeze({ index, label: id === null ? (NONE[slot] ?? "없음") : (PART_LABELS[slot]?.[id] ?? id) }),
      ),
    ),
  ]),
) as Record<CharacterSlot, readonly ChipOption[]>;

/** 슬롯의 부품 칩: SLOT_OPTIONS 순서(인덱스 = 외형 값), 이름은 manifest labels(없음은 NONE_LABELS). */
export function partChips(slot: CharacterSlot): ChipOption[] {
  return CHIPS[slot] as ChipOption[];
}

/** 슬롯의 색 견본 위 라벨: 얼굴은 "피부색", 나머지는 "색". */
export function colorLabel(slot: CharacterSlot): string {
  return slot === "face" ? "피부색" : "색";
}

/** 그 슬롯이 무언가를 입고 있을 때만 색 견본을 보인다(모자·머리카락·소품이 "없음"이면 칠할 것이 없다). */
export function showSwatches(a: Appearance, slot: CharacterSlot): boolean {
  return SLOT_OPTIONS[slot][a[slot]] != null;
}

/**
 * 지금 외형이 그 프리셋 차림 그대로인가(프리셋 버튼의 aria-pressed). 프리셋은 skin·voice를 바꾸지 않으므로
 * 그 둘은 보지 않는다. 부품 하나나 색 하나라도 바꾸면 false다.
 */
export function presetWorn(a: Appearance, preset: AppearancePreset): boolean {
  for (const slot of CHARACTER_SLOTS) if (SLOT_OPTIONS[slot][a[slot]] !== preset.parts[slot]) return false;
  for (const [field, value] of Object.entries(preset.colors)) if (a[field as AppearanceField] !== value) return false;
  return true;
}

/** 이보다 밝은(상대 휘도) 견본은 고른 표시(✓)를 어둡게, 아니면 흰색으로 그린다. */
const LIGHT_SWATCH_LUMINANCE = 0.3;

function linearChannel(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 견본 위 고른 표시의 색: 밝은 견본(흰색·노랑·밝은 피부색 등)에는 남색, 어두운 견본에는 흰색. */
export function swatchInk(hex: string): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const luminance =
    0.2126 * linearChannel((n >> 16) & 0xff) + 0.7152 * linearChannel((n >> 8) & 0xff) + 0.0722 * linearChannel(n & 0xff);
  return luminance > LIGHT_SWATCH_LUMINANCE ? "#1b1640" : "#ffffff";
}

/** 목소리 선택지. 인덱스는 VOICE_GENDERS(0 = male, 1 = female)와 같다. */
export const VOICE_OPTIONS: readonly ChipOption[] = Object.freeze([
  Object.freeze({ index: 0, label: "남자 목소리" }),
  Object.freeze({ index: 1, label: "여자 목소리" }),
]);

export const BUILDER_COPY = {
  title: "캐릭터 조립실",
  presets: "추천 캐릭터",
  random: "🎲 랜덤",
  voice: "목소리",
  dragHint: "끌어서 돌려 보세요",
  loading: "캐릭터를 불러오는 중…",
} as const;

/**
 * 미리보기 카메라: 세로 시야각(도), 인형 중심에서의 수평 거리, 눈높이, 바라보는 높이(m).
 * 거리는 계획의 5.6에서 6.3으로 늘렸다: 5.6에서는 뒤쪽(yaw ≈ 2.4~3.9)에서 본 마법사 모자 끝(약 2.73 m)이
 * 위로 잘렸다. 6.3이면 모든 모자·소품·프리셋이 8방향 어디서 봐도 휴대폰 무대(321×275)에서 위 16 px,
 * 데스크톱 무대(340×346)에서 위 21 px·옆 27 px(깃발) 이상 떨어진다.
 */
export const PREVIEW_CAMERA = { fov: 30, distance: 6.3, eyeY: 1.8, targetY: 1.3 } as const;
/** 가로로 1px 끌 때 도는 각도(rad). */
export const PREVIEW_DRAG_SPEED = 0.01;
/** 처음 보이는 각도(rad). 살짝 비스듬해야 입체감이 산다. */
export const PREVIEW_START_YAW = 0.5;
