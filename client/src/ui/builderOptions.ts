// 입장 화면 "캐릭터 조립실"의 순수 데이터(설계 4장·5.3): 슬롯 칩 이름, 색 라벨, 견본을 보일지, 목소리 선택지,
// 화면 문구, 미리보기 카메라, 그리고 Task 7b의 무대 배치(배경 그림의 받침대 위에 인형 발을 놓는 계산)와
// Jua 글꼴에 남길 글자. React·three를 import 하지 않으므로 DOM 없이 단위 테스트한다.

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
  failed: "미리보기를 불러오지 못했어요. 그래도 입장할 수 있어요.",
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
 * 조립실이 Jua(제목용 글꼴)로 그리는 고정 글자 전부: 제목·묶음 이름·탭·프리셋 이름·버튼·안내.
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
].join(" ");

/** 지금 탭 머리에 보이는 "부품 · 색"(예: "마법사 모자 · 보라"). 색이 없는 슬롯("없음")은 부품 이름만. */
export function slotPickedLabel(a: Appearance, slot: CharacterSlot): string {
  const part = partChips(slot)[a[slot]]?.label ?? "";
  if (!showSwatches(a, slot)) return part;
  const color = paletteFor(SLOT_COLOR_FIELD[slot])[a[SLOT_COLOR_FIELD[slot]]]?.label;
  return color ? `${part} · ${color}` : part;
}

/**
 * 가로 목록의 화살표 키(탭·목소리 라디오, WAI-ARIA 패턴): 다음 칸의 인덱스, 해당 키가 아니면 -1.
 * 오른쪽·아래 = 다음, 왼쪽·위 = 앞(양 끝에서 돌아간다), Home·End = 처음·끝.
 */
export function arrowIndex(key: string, at: number, count: number): number {
  const last = count - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return at >= last ? 0 : at + 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return at <= 0 ? last : at - 1;
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

// ── 무대 배치(Task 7b) ─────────────────────────────────────────────────────────

/**
 * 미리보기 카메라로 본 점 (0, heightM, towardM)이 캔버스 위에서부터 몇 %에 그려지는가(0 = 위 끝, 1 = 아래 끝).
 * 카메라는 y축을 도는 궤도 위에 있으므로 인형 발(원점)의 위치는 회전 각도와 상관없이 같다. towardM은 카메라 쪽으로
 * 나온 거리(뒤에서 본 마법사 모자 끝처럼 기울어진 점). 캔버스 가로 비율과도 상관없다(세로 시야각 고정).
 */
export function previewFrameY(heightM: number, towardM = 0): number {
  const { fov, distance, eyeY, targetY } = PREVIEW_CAMERA;
  const pitch = Math.atan2(eyeY - targetY, distance);
  const below = Math.atan2(eyeY - heightM, distance - towardM) - pitch;
  return 0.5 + (0.5 * Math.tan(below)) / Math.tan((fov * Math.PI) / 360);
}

/** 가장 높은 모습: 마법사 모자 끝(약 2.73 m)이 뒤에서 볼 때 카메라 쪽으로 기운 정도까지 넣는다. */
export const FIGURE_TOP = { height: 2.73, toward: 0.35 } as const;
/**
 * 인형이 옆으로 가장 멀리 나가는 거리(m, 발 중심에서): 깃발을 든 모습이 돌아갈 때(모든 모자·소품 × 8방향을 찍어
 * 잰 값 약 1.40 m에 여유). 화면에서는 캔버스 높이 × FIGURE_HALF_WIDTH_PER_HEIGHT 만큼이다(1 m ≈ 캔버스 높이의 0.295).
 */
export const FIGURE_HALF_WIDTH_M = 1.45;
const PX_PER_M_PER_HEIGHT =
  1 / (2 * Math.hypot(PREVIEW_CAMERA.distance, PREVIEW_CAMERA.eyeY - PREVIEW_CAMERA.targetY) * Math.tan((PREVIEW_CAMERA.fov * Math.PI) / 360));
export const FIGURE_HALF_WIDTH_PER_HEIGHT = FIGURE_HALF_WIDTH_M * PX_PER_M_PER_HEIGHT;
/**
 * 신발 앞코는 발 중심(원점)보다 카메라 쪽에 있어 화면에서 발보다 조금 아래까지 내려온다: 캔버스 높이의 이 비율
 * (+ 4 px). 받침대 아래 안내 알약·이름판은 적어도 이만큼 띄운다(큰 화면일수록 더 띄운다).
 */
export const FIGURE_BELOW_FEET = 0.04;

/** 발 아래로 비워 둘 거리(px): 신발 앞코가 내려오는 만큼. */
function belowFeet(canvasH: number): number {
  return Math.ceil(FIGURE_BELOW_FEET * canvasH) + 4;
}

export type EntryArt = "desktop" | "phone";
export type StageMode = "wide" | "side" | "phone";

/** 배경 그림 한 장(A안). 받침대 값은 그림에서 잰 것이다(design-note "Podium anchors"). */
export interface EntryArtSpec {
  width: number;
  height: number;
  /** 받침대 윗면 가운데(그림 폭·높이에 대한 비율). */
  podiumX: number;
  podiumY: number;
  /** 받침대 윗면(타원)의 폭과 위아래 두께(그림 px). */
  podiumWidth: number;
  podiumThickness: number;
  /**
   * 무대 캔버스 높이 = canvasPerScale × 그림 배율. 시안에서 인형(모자 끝까지)이 받침대 윗면 폭의
   * 0.85배(넓은 그림)·1배(세로 그림)쯤 되게 잰 값이다. 화면이 좁거나 낮으면 이보다 작아진다.
   */
  canvasPerScale: number;
  avif: string;
  webp: string;
  /** 그림이 오기 전에 흐리게 깔아 두는 아주 작은 그림(LQIP). */
  lqip: string;
}

export const ENTRY_ART: Readonly<Record<EntryArt, EntryArtSpec>> = {
  desktop: {
    width: 1600,
    height: 900,
    podiumX: 0.5,
    podiumY: 0.701,
    podiumWidth: 542,
    podiumThickness: 87,
    canvasPerScale: 572,
    avif: "/entry/bg-desktop.avif",
    webp: "/entry/bg-desktop.webp",
    lqip: "data:image/webp;base64,UklGRt4AAABXRUJQVlA4INIAAABQBQCdASogABIAPtFUokuoJKMhsAgBABoJaACdMw6Crbryincnvoqvp5ApoMwXrcTizkAA/t/1cCsUnMacsVrXWg5Xko2ji8uGpMOh1ddPWqdKZT+ffsBqtQlNDv1+NvTgwRgslFFbd8wzoVKdM9tq7E35YgR5nsq5LHhIgv3VEfsijSSyFa2cit1jO2xnxVth1aGCbFOcRGKvpDxh5HYA/9IywW1TI8HdFSYxspf2DvFrzo7PuVKbaLlBXc/M5JMqhwp1OPFFMFcJpIw+ObogAAA=",
  },
  phone: {
    width: 720,
    height: 1280,
    podiumX: 0.5,
    podiumY: 0.437,
    podiumWidth: 422,
    podiumThickness: 65,
    canvasPerScale: 538,
    avif: "/entry/bg-phone.avif",
    webp: "/entry/bg-phone.webp",
    lqip: "data:image/webp;base64,UklGRgIBAABXRUJQVlA4IPYAAADwBQCdASoSACAAPtFcpk4oJSOiKAqpABoJagCCfC3FSgv+XgKW21cJNUoAYavYHTvt+IKRo7YbQAD+1RBK32VuXB6Z/sr9ClfBiOHe2ZgiQ/IZ1uINM0+j/SzJK7Nle6VRar4DIVwuQoNpIvwk//MOK69BKGDr/eAWKYKQCQrVFbOMa6yP2aZE/Z0e9YzDbsIGwtTh2J3sxGknfFZNboSxvg3GaO9EftwUl9Za0PDbH5BitfECoqoC0jRMd4DWawpMG3Ck2qVSz7nsevV28bNZcCmauB7MH8xPV3Rom6IlMUaasghgsMvvzP76cHlLllzjHo8AAAA=",
  },
};

/** 가로가 세로 이상이면 넓은 그림, 아니면 세로 그림(index.html의 preload media와 같은 규칙). */
export function entryArtFor(width: number, height: number): EntryArt {
  return width >= height ? "desktop" : "phone";
}

/** 휴대폰 아래 시트의 높이(화면 높이에 대한 비율): 쉴 때와 손잡이로 펼쳤을 때. */
export const SHEET_REST = 0.47;
export const SHEET_OPEN = 0.88;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 이름판 줄(⟲ 이름판 ⟳). y는 뷰포트 기준 줄의 위쪽. */
export interface NameRow {
  y: number;
  height: number;
  plateWidth: number;
  button: number;
  gap: number;
}

/** 조립실 한 화면의 배치(모두 뷰포트 CSS px). EntryScreen이 CSS 변수로 내린다. */
export interface StageLayout {
  mode: StageMode;
  art: EntryArt;
  /** 그림 배율(그림 px → 화면 px). */
  scale: number;
  /** 배경 그림이 그려지는 자리. */
  bg: Box;
  /** 받침대 윗면 가운데 = 인형 발. */
  feet: { x: number; y: number };
  /** 받침대 윗면 타원의 화면 크기(빛 고리용). */
  podium: { width: number; thickness: number };
  /** .cv-builder-preview(끌어서 돌리는 무대) 상자. */
  stage: Box;
  /** 3D 캔버스 상자. 발이 previewFrameY(0)에 오도록 놓는다. */
  canvas: Box;
  /** 위쪽 바 높이. */
  topBar: number;
  /** 끌기 안내 알약: 넓은 화면은 받침대 앞(x가 가운데), 그 밖은 무대 왼쪽 위(x가 왼쪽 끝). */
  hint: { x: number; y: number; height: number; centered: boolean };
  nameRow: NameRow;
  /** 넓은 화면의 입장 버튼. 시트가 있는 화면에서는 null(시트 아래에 고정). */
  cta: Box | null;
  /** 넓은 화면의 양쪽 유리 패널 폭. */
  panelWidth: number;
  /** 시트: 옆 시트(side)는 폭과 높이 = 화면 높이, 아래 시트(phone)는 폭 = 화면 폭과 쉴 때·펼친 높이. */
  sheet: { width: number; rest: number; open: number } | null;
  /** 위쪽 바가 좁다: 관리자 알약을 열쇠 아이콘만 보이게, 제목을 작게. */
  compactBar: boolean;
}

const EDGE = 24;
const WIDE_MIN_WIDTH = 900;
const WIDE_MIN_HEIGHT = 600;

/** 넓은 화면의 받침대 아래 줄: 안내(받침대 앞) → 이름판 줄 → 입장 버튼. 낮은 화면은 compact. */
const WIDE_STACK = {
  normal: { hint: 26, name: 72, nameH: 56, nameGap: 12, ctaH: 70, bottom: 26 },
  compact: { hint: 20, name: 56, nameH: 52, nameGap: 10, ctaH: 60, bottom: 20 },
} as const;

function stackNeed(s: (typeof WIDE_STACK)[keyof typeof WIDE_STACK]): number {
  return s.name + s.nameH + s.nameGap + s.ctaH + s.bottom;
}

/**
 * 그림 배율과 자리: 받침대 가운데가 (feetX, feetY)에 오고, 가로로 [x0, x1], 세로로 [0, bottom]을 덮는 가장 작은 배율.
 * 받침대가 그림 가운데(podiumX 0.5)에 있으므로 가로는 feetX에서 먼 쪽 가장자리가 정한다.
 */
function placeArt(spec: EntryArtSpec, feetX: number, feetY: number, x0: number, x1: number, bottom: number) {
  const halfSpan = Math.max(feetX - x0, x1 - feetX);
  const scale = Math.max(
    (2 * halfSpan) / spec.width,
    feetY / (spec.podiumY * spec.height),
    (bottom - feetY) / ((1 - spec.podiumY) * spec.height),
  );
  const width = spec.width * scale;
  const height = spec.height * scale;
  return { scale, bg: { x: feetX - spec.podiumX * width, y: feetY - spec.podiumY * height, width, height } };
}

/** 캔버스 높이: 그림 배율에 맞춘 크기를 넘지 않고, 모자 끝이 topClear 아래에, 옆은 무대 안에 들어가게. */
function canvasHeight(scale: number, spec: EntryArtSpec, feetY: number, topClear: number, stageWidth: number): number {
  const feetFrac = previewFrameY(0);
  const topFrac = previewFrameY(FIGURE_TOP.height, FIGURE_TOP.toward);
  return Math.max(
    0,
    Math.min(
      spec.canvasPerScale * scale,
      (feetY - topClear) / (feetFrac - topFrac),
      (stageWidth / 2 - 4) / FIGURE_HALF_WIDTH_PER_HEIGHT,
    ),
  );
}

function canvasBox(feet: { x: number; y: number }, height: number, stage: Box): Box {
  // 가로로는 무대 폭 전체(돌릴 때 소품이 나가도 잘리지 않게), 세로로는 발이 previewFrameY(0)에 오게.
  return { x: stage.x, y: feet.y - previewFrameY(0) * height, width: stage.width, height };
}

/**
 * 화면 크기 → 조립실 배치. 세 가지 모양:
 * - wide(가로 ≥ 900, 세로 ≥ 600): 배경을 화면 가득(cover) 깔고, 받침대 위에 인형, 양쪽에 유리 패널,
 *   받침대 아래로 안내 → 이름판 줄 → 입장 버튼. 아래가 모자라면 배경을 위로 밀거나(남는 만큼) 키운다.
 * - side(그 밖의 가로 ≥ 600 또는 가로 화면): 오른쪽에 시트(폭 280~360), 왼쪽 무대에 인형과 이름판 줄.
 * - phone(세로로 긴 좁은 화면): 아래 시트(쉴 때 높이 47%) 위의 무대에 인형과 이름판 줄.
 * 인형 발은 언제나 배경 받침대 윗면 가운데에 놓인다(캔버스를 그만큼 옮긴다).
 */
export function stageLayout(width: number, height: number): StageLayout {
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  const art = entryArtFor(W, H);
  const spec = ENTRY_ART[art];

  if (W >= WIDE_MIN_WIDTH && H >= WIDE_MIN_HEIGHT) {
    const topBar = 76;
    const panelWidth = Math.round(Math.min(400, Math.max(280, W * 0.3125)));
    const stage: Box = { x: EDGE + panelWidth, y: 0, width: W - 2 * (EDGE + panelWidth), height: H };
    const feetX = W / 2;
    // 화면 가득 덮는 배율(cover), 가운데 맞춤.
    let scale = Math.max(W / spec.width, H / spec.height);
    let bg: Box = {
      x: (W - spec.width * scale) / 2,
      y: (H - spec.height * scale) / 2,
      width: spec.width * scale,
      height: spec.height * scale,
    };
    let feetY = bg.y + spec.podiumY * bg.height;
    let stack: (typeof WIDE_STACK)[keyof typeof WIDE_STACK] = WIDE_STACK.normal;
    // 인형이 크면 신발 앞코가 받침대 앞으로 더 내려오므로 아래 줄 전체를 extra만큼 더 내린다(인형 크기에 맞춰 다시 잰다).
    let extra = 0;
    let canvasH = 0;
    for (let pass = 0; pass < 3; pass++) {
      if (H - feetY < stackNeed(stack) + extra) {
        // 그림이 화면보다 길면 남는 만큼 위로 민다(아래는 계속 덮는다).
        const shift = Math.max(0, Math.min(bg.y + bg.height - H, stackNeed(stack) + extra - (H - feetY)));
        bg = { ...bg, y: bg.y - shift };
        feetY -= shift;
      }
      if (H - feetY < stackNeed(stack) + extra) stack = WIDE_STACK.compact;
      if (H - feetY < stackNeed(stack) + extra) {
        // 아직 모자라면 아래 가장자리를 화면 아래에 붙인 채 그림을 키워 받침대를 올린다.
        feetY = H - stackNeed(stack) - extra;
        ({ scale, bg } = placeArt(spec, feetX, feetY, 0, W, H));
      }
      canvasH = canvasHeight(scale, spec, feetY, topBar + 6, stage.width);
      const next = Math.max(0, belowFeet(canvasH) - stack.hint);
      if (next <= extra) break;
      extra = next;
    }
    const feet = { x: feetX, y: feetY };
    const button = 48;
    const gap = 10;
    const ctaWidth = Math.min(380, stage.width - 24);
    return {
      mode: "wide",
      art,
      scale,
      bg,
      feet,
      podium: { width: spec.podiumWidth * scale, thickness: spec.podiumThickness * scale },
      stage,
      canvas: canvasBox(feet, canvasH, stage),
      topBar,
      hint: { x: feetX, y: feetY + stack.hint + extra, height: stack === WIDE_STACK.normal ? 30 : 28, centered: true },
      nameRow: {
        y: feetY + stack.name + extra,
        height: stack.nameH,
        plateWidth: Math.min(284, stage.width - 2 * (button + gap) - 16),
        button,
        gap,
      },
      cta: { x: feetX - ctaWidth / 2, y: H - stack.bottom - stack.ctaH, width: ctaWidth, height: stack.ctaH },
      panelWidth,
      sheet: null,
      compactBar: false,
    };
  }

  const side = W >= 600 || W > H;
  // 낮은 화면(< 640)은 위쪽 바·안내·이름판 줄을 조금씩 줄여 인형 자리를 늘린다.
  const short = H < 640;
  const topBar = H < 500 ? 52 : short ? 54 : side ? 64 : 60;
  // 안내 알약은 무대 왼쪽 위(위쪽 바 바로 아래)에 있으므로, 인형 머리는 그 아래에서 시작한다.
  const hintH = short ? 28 : 30;
  const hintY = topBar + (short ? 4 : 6);
  const topClear = hintY + hintH + (short ? 4 : 6);
  const button = 44;
  const gap = short ? 6 : 8;
  const nameH = short ? 46 : 50;
  const nameGap = short ? 14 : 18;

  if (side) {
    const sheetWidth = Math.round(Math.min(360, Math.max(260, W * 0.44)));
    const stage: Box = { x: 0, y: 0, width: W - sheetWidth, height: H };
    const feetX = stage.width / 2;
    // 받침대 아래에 이름판 줄만 있으면 된다. 큰 화면에서는 너무 내려가 그림을 키우지 않게 0.55H + 60에서 멈춘다.
    // 이름판은 신발 앞코 아래에 둔다(인형이 크면 더 띄운다).
    let gapBelow = nameGap;
    let feetY = 0;
    let placed = placeArt(spec, feetX, 1, 0, stage.width, H);
    let canvasH = 0;
    for (let pass = 0; pass < 3; pass++) {
      feetY = Math.min(H - (gapBelow + nameH + 16), 0.55 * H + 60);
      placed = placeArt(spec, feetX, feetY, 0, stage.width, H);
      canvasH = canvasHeight(placed.scale, spec, feetY, topClear, stage.width);
      if (belowFeet(canvasH) <= gapBelow) break;
      gapBelow = belowFeet(canvasH);
    }
    const { scale, bg } = placed;
    const feet = { x: feetX, y: feetY };
    return {
      mode: "side",
      art,
      scale,
      bg,
      feet,
      podium: { width: spec.podiumWidth * scale, thickness: spec.podiumThickness * scale },
      stage,
      canvas: canvasBox(feet, canvasH, stage),
      topBar,
      hint: { x: 16, y: hintY, height: hintH, centered: false },
      nameRow: { y: feetY + gapBelow, height: nameH, plateWidth: Math.min(236, stage.width - 2 * (button + gap) - 16), button, gap },
      cta: null,
      panelWidth: 0,
      sheet: { width: sheetWidth, rest: H, open: H },
      compactBar: stage.width < 420,
    };
  }

  const rest = Math.round(SHEET_REST * H);
  const open = Math.round(SHEET_OPEN * H);
  const sheetTop = H - rest;
  const stage: Box = { x: 0, y: 0, width: W, height: sheetTop };
  const feetX = W / 2;
  let gapBelow = nameGap;
  let feetY = 0;
  let placed = placeArt(spec, feetX, 1, 0, W, H);
  let canvasH = 0;
  for (let pass = 0; pass < 3; pass++) {
    feetY = sheetTop - (gapBelow + nameH + 10);
    placed = placeArt(spec, feetX, feetY, 0, W, H);
    canvasH = canvasHeight(placed.scale, spec, feetY, topClear, stage.width);
    if (belowFeet(canvasH) <= gapBelow) break;
    gapBelow = belowFeet(canvasH);
  }
  const { scale, bg } = placed;
  const feet = { x: feetX, y: feetY };
  return {
    mode: "phone",
    art,
    scale,
    bg,
    feet,
    podium: { width: spec.podiumWidth * scale, thickness: spec.podiumThickness * scale },
    stage,
    canvas: canvasBox(feet, canvasH, stage),
    topBar,
    hint: { x: 16, y: hintY, height: hintH, centered: false },
    nameRow: { y: feetY + gapBelow, height: nameH, plateWidth: Math.min(236, W - 2 * (button + gap) - 16), button, gap },
    cta: null,
    panelWidth: 0,
    sheet: { width: W, rest, open },
    compactBar: W < 360,
  };
}
