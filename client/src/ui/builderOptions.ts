// 입장 화면 "캐릭터 조립실"의 순수 데이터(설계 4장·5.3): 슬롯 칩 이름, 색 라벨, 견본을 보일지, 목소리 선택지,
// 화면 문구, 미리보기 카메라·조명·움직임, Jua 글꼴에 남길 글자. 무대 배치는 stageLayout.ts에 있다.
// React·three를 import 하지 않으므로 DOM 없이 단위 테스트한다.

import {
  APPEARANCE_PRESETS,
  SLOT_COLOR_FIELD,
  SLOT_OPTIONS,
  paletteFor,
  type Appearance,
  type AppearanceField,
  type AppearancePreset,
} from "@caysonverse/shared/appearance";
import { CHARACTER_MANIFEST, CHARACTER_SLOTS, type CharacterSlot } from "@caysonverse/shared/characterManifest";
import { NICKNAME_MAX, NICKNAME_MIN } from "@caysonverse/shared/constants";
import { DESTINATION_FONT_TEXT } from "./entryForm";

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

/** 조립실 화면 문구. Jua로 그리는 것은 BUILDER_FONT_TEXT에 모은다. */
export const BUILDER_COPY = {
  title: "캐릭터 조립실",
  presets: "추천 캐릭터",
  presetsHint: "누르면 한 번에 갈아입어요",
  random: "🎲 랜덤",
  voice: "목소리",
  voiceHint: "채팅을 읽어 줄 목소리",
  dragHint: "끌어서 돌려 보세요",
  loading: "캐릭터를 불러오는 중…",
  /** 미리보기가 모델 말고 다른 이유(WebGL 등)로 무너졌을 때. */
  failed: "미리보기를 띄우지 못했어요. 새로고침(F5)해 보세요.",
  /** character.glb를 못 받아 잠시 뒤 다시 받아 볼 때(MODEL_RETRY_DELAYS_MS). */
  modelRetrying: "캐릭터를 불러오지 못해 다시 받아 오는 중이에요…",
  /** 다시 받기를 다 해 봐도 못 받았을 때. 입장하기를 누르면 한 번 더 받아 본다. */
  modelFailed: "캐릭터를 불러오지 못했어요. 인터넷 연결을 확인한 뒤 입장하기를 눌러 주세요.",
  /** 입장하기에서 다시 받아 봐도 못 받았을 때(입장하지 않는다). */
  modelRetry: "캐릭터를 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요",
  nickname: "닉네임",
  nicknamePlaceholder: `이름을 지어 주세요 (${NICKNAME_MIN}~${NICKNAME_MAX}자)`,
  rotateLeft: "왼쪽으로 돌리기",
  rotateRight: "오른쪽으로 돌리기",
  sheetOpen: "꾸미기 창 크게 보기",
  sheetClose: "꾸미기 창 작게 보기",
  admin: "관리자이신가요?",
  adminCode: "관리자 코드",
  adminPlaceholder: "강사 전용",
  submit: "입장하기",
  submitting: "입장 중…",
} as const;

/** "🎲 랜덤" → 주사위와 글자. 주사위는 그림으로 그리고 글자 노드는 그대로 둔다. */
export const [RANDOM_ICON, RANDOM_TEXT] = BUILDER_COPY.random.split(" ") as [string, string];

/**
 * 조립실이 Jua(제목용 글꼴)로 그리는 고정 글자 전부: 제목·묶음 이름·탭·프리셋 이름·버튼·안내, 그리고 입장하기 뒤의
 * "어디로 갈까요?" 단계(entryForm.ts DESTINATION_FONT_TEXT: 제목·체험 이름·버튼·선생님/학생 전환).
 * scripts/subset-builder-font.mjs가 이 글자만 남긴 글꼴을 만들고, builderFont.test.ts가 빠진 글자가 없는지 본다.
 * 부품 카드 이름(61개)은 시안처럼 본문 굵은 글꼴이다: Jua 글리프가 커서(글자당 약 200 B) 넣으면 글꼴이 36 KB로
 * 25 KB 목표를 넘는다. 닉네임 입력·오류 문구·색 이름·작은 설명도 본문 글꼴이라 넣지 않는다.
 */
export const BUILDER_FONT_TEXT: string = [
  BUILDER_COPY.title,
  BUILDER_COPY.presets,
  RANDOM_TEXT,
  BUILDER_COPY.voice,
  BUILDER_COPY.dragHint,
  BUILDER_COPY.loading,
  BUILDER_COPY.nickname,
  BUILDER_COPY.admin,
  BUILDER_COPY.adminCode,
  BUILDER_COPY.submit,
  BUILDER_COPY.submitting,
  ...CHARACTER_SLOTS.map((slot) => CHARACTER_MANIFEST.slotLabels[slot]),
  ...CHARACTER_SLOTS.map((slot) => colorLabel(slot)),
  ...APPEARANCE_PRESETS.map((preset) => preset.label),
  ...VOICE_OPTIONS.map((option) => option.label),
  DESTINATION_FONT_TEXT,
].join(" ");

/** 지금 탭 머리에 보이는 "부품 · 색"(예: "마법사 모자 · 보라"). 색이 없는 슬롯("없음")은 부품 이름만. */
export function slotPickedLabel(a: Appearance, slot: CharacterSlot): string {
  const part = partChips(slot)[a[slot]]?.label ?? "";
  if (!showSwatches(a, slot)) return part;
  const color = paletteFor(SLOT_COLOR_FIELD[slot])[a[SLOT_COLOR_FIELD[slot]]]?.label;
  return color ? `${part} · ${color}` : part;
}

/** 화살표 키를 받는 방향: 가로 탭 막대(←/→), 세로 탭 레일(↑/↓), 라디오 묶음(네 방향 모두). */
export type ArrowAxis = "horizontal" | "vertical" | "both";

/**
 * 목록의 화살표 키(탭·목소리 라디오, WAI-ARIA 패턴): 다음 칸의 인덱스, 해당 키가 아니면 -1.
 * 오른쪽·아래 = 다음, 왼쪽·위 = 앞(양 끝에서 돌아간다), Home·End = 처음·끝. axis가 가로면 ←/→만,
 * 세로면 ↑/↓만 받는다(aria-orientation과 같게).
 */
export function arrowIndex(key: string, at: number, count: number, axis: ArrowAxis = "both"): number {
  const last = count - 1;
  const across = axis !== "vertical";
  const down = axis !== "horizontal";
  if ((across && key === "ArrowRight") || (down && key === "ArrowDown")) return at >= last ? 0 : at + 1;
  if ((across && key === "ArrowLeft") || (down && key === "ArrowUp")) return at <= 0 ? last : at - 1;
  if (key === "Home") return 0;
  if (key === "End") return last;
  return -1;
}

/**
 * 미리보기 카메라: 세로 시야각(도), 인형 중심에서의 수평 거리, 눈높이, 바라보는 높이(m).
 * 거리는 계획의 5.6에서 6.3으로 늘렸다: 5.6에서는 뒤쪽(yaw ≈ 2.4~3.9)에서 본 마법사 모자 끝(약 2.73 m)이
 * 위로 잘렸다. 6.3이면 모든 모자·소품·프리셋이 8방향 어디서 봐도 휴대폰 무대(321×275)에서 위 16 px,
 * 데스크톱 무대(340×346)에서 위 21 px·옆 27 px(깃발) 이상 떨어진다.
 */
export const PREVIEW_CAMERA = { fov: 30, distance: 6.3, eyeY: 1.8, targetY: 1.3 } as const;
/** 빛 하나: 색, 세기, (방향광이면) 위치. */
export interface LightSpec {
  color: number;
  intensity: number;
  position: readonly [number, number, number];
}

/**
 * 밝은 하늘 정원 무대의 조명(미리보기와 카드 그림이 함께 쓴다): 하늘빛 위 + 라벤더 바닥 반사(hemi: 하늘색, 바닥색,
 * 세기), 해(앞 오른쪽 위), 보조광, 보라 테두리광.
 */
export const PREVIEW_LIGHTS = {
  hemi: { sky: 0xfff8ee, ground: 0xb8a6e8, intensity: 1.5 },
  sun: { color: 0xffffff, intensity: 2.3, position: [3, 7, 6] },
  fill: { color: 0xdfe8ff, intensity: 0.6, position: [-5, 3, 4] },
  rim: { color: 0xd9ccff, intensity: 1.4, position: [-3, 4, -6] },
} as const satisfies { hemi: { sky: number; ground: number; intensity: number }; sun: LightSpec; fill: LightSpec; rim: LightSpec };

/** 카드 그림만의 테두리광: 작은 그림에서는 보라 테두리가 번져 보여 더 옅고 약하게 둔다(나머지는 같은 조명). */
export const THUMB_RIM_LIGHT: LightSpec = { color: 0xe6dcff, intensity: 1.1, position: PREVIEW_LIGHTS.rim.position };
export const THUMB_LIGHTS = { ...PREVIEW_LIGHTS, rim: THUMB_RIM_LIGHT } as const;

/** 가로로 1px 끌 때 도는 각도(rad). */
export const PREVIEW_DRAG_SPEED = 0.01;
/** 처음 보이는 각도(rad). 살짝 비스듬해야 입체감이 산다. */
export const PREVIEW_START_YAW = 0.5;

// ── 움직임(Task 7b) ────────────────────────────────────────────────────────────

/** 회전 버튼 ⟲ ⟳ 한 번에 도는 각도와 시간. */
export const PREVIEW_ROTATE_STEP = Math.PI / 4;
export const PREVIEW_ROTATE_MS = 200;
/** 프리셋·🎲을 누르면 인형이 한 바퀴 도는 시간. */
export const PREVIEW_SPIN_MS = 500;

/** 회전 애니메이션의 진행(0~1) → 각도. 부드럽게 출발해 부드럽게 멈춘다(easeInOutCubic). 1 이상이면 정확히 to. */
export function tweenYaw(from: number, to: number, progress: number): number {
  if (progress >= 1) return to;
  if (progress <= 0) return from;
  const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
  return from + (to - from) * eased;
}
