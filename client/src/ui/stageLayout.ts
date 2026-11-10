// 조립실 무대 배치(Task 7b, 순수): 화면 크기 → 배경 그림을 어디에 얼마나 크게 그리고, 3D 캔버스·이름판·안내·
// 입장 버튼·알림·시트를 어디에 둘지. 인형 발은 언제나 그림 속 받침대 윗면 가운데에 놓인다 — 카메라(PREVIEW_CAMERA)가
// 발을 캔버스 높이의 previewFrameY(0)에 그리므로 그만큼 캔버스를 옮긴다. React·three를 import 하지 않는다.

import { PREVIEW_CAMERA } from "./builderOptions";

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
    podiumWidth: 550,
    podiumThickness: 88,
    canvasPerScale: 580,
    avif: "/entry/bg-desktop.avif",
    webp: "/entry/bg-desktop.webp",
    lqip: "data:image/webp;base64,UklGRg4BAABXRUJQVlA4IAIBAAAwBgCdASogABIAPrVMn0mnJKKhMAgA4BaJZACdMoMn/BpKAhFNbgeSLNPh6VKlQm7Lfm1rmotRey0AAP7uIbHtwlaPShg7PXMvsTm8mz9jixrvuoEK8WxssoyTgojiYA4SABQvzP3ZdLuG6V9pPcJU6kh3gQWyVwkM7rHgP6RAkcdGFtgeX/uz5BwM+JjK3fCqozlJk+M+Q0Z9mQD42u8r9cwr4DvWUyLqp2zYxBw3z9ktQRuYqxBxGehBEF/yty96MQvHuEKAEaemfSKP0+GkIGFQf4LjpJcYh/guOknVC2bJnIDNRS6uV7P7r+YA8jJ3S3fYoIsc9SHy1boE9y4g0AA=",
  },
  phone: {
    width: 720,
    height: 1280,
    podiumX: 0.5,
    podiumY: 0.4414,
    podiumWidth: 485,
    podiumThickness: 75,
    canvasPerScale: 619,
    avif: "/entry/bg-phone.avif",
    webp: "/entry/bg-phone.webp",
    lqip: "data:image/webp;base64,UklGRggBAABXRUJQVlA4IPwAAADQBgCdASoSACAAPrVOoUwnJCMiKAqo4BaJaACdMxs6LKBz/7dWxQLYALtS9MR72y1dZ5vTdumviab2ukB4zAAA/tdx42bAPMd8qaRJ7QJUpX+865Hzn9u0H+mjHVYMuy2wUn5dQdWOJVsV+3OCc2JlHaagJh2Mybm6TTfl0A0Z7aykx875Nq/op6Pn7uSdeNs0Q3T3YSBXIdl9vuacJ37i6uplfmzk9VviT2OomO2b6hJuJaogHmYs8LU5tz33/83P9OTDt1U64Za6EZiEjo8bRys9TUz/w5uyn/GBpGYQN9tbWX7T5u7x455rISIEQBwy5n79LmQdVZZSAAA=",
  },
};

/** 가로가 세로 이상이면 넓은 그림, 아니면 세로 그림(index.html의 preload media와 같은 규칙). */
export function entryArtFor(width: number, height: number): EntryArt {
  return width >= height ? "desktop" : "phone";
}

/** 휴대폰 아래 시트의 높이(화면 높이에 대한 비율): 쉴 때와 손잡이로 펼쳤을 때. */
export const SHEET_REST = 0.47;
export const SHEET_OPEN = 0.88;
/**
 * 쉴 때 시트가 보여야 하는 높이(px): 손잡이 + 추천 캐릭터 줄 + 탭 + 색 줄 + 부품 카드 첫 줄이 모두 보이고 그 아래에
 * 입장 버튼(58 + 18)이 들어가는 높이. 시안(390×844)은 시트를 약 53 %에 두어 첫 줄을 다 보인다. 키 700 이상인
 * 휴대폰은 47 %와 이 값 중 큰 것(최대 56 %), 그보다 낮은 휴대폰은 인형 자리를 위해 47 %를 지킨다.
 */
export const SHEET_FIRST_ROW = 452;
const SHEET_REST_MAX = 0.56;
const SHEET_TALL_PHONE = 700;
/** 입장 버튼(시트 아래 고정) 윗변에서 화면 아래까지: 버튼 58 + 아래 18 + 알림과의 틈 14. */
const SHEET_CTA_ZONE = 90;

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
  /**
   * 알림(닉네임 오류, 강퇴·끊김 안내, role=alert): x는 가운데. 넓은 화면은 무대 위쪽(위쪽 바 아래)에 위 기준(y = 윗변),
   * 시트가 있는 화면은 시트 아래 입장 버튼 바로 위에 아래 기준(y = 아랫변). 이름판 줄·⟲ ⟳·입장 버튼을 덮지 않는다.
   */
  toast: { x: number; y: number; maxWidth: number; anchor: "top" | "bottom" };
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
 * - phone(세로로 긴 좁은 화면): 아래 시트(쉴 때 높이 47~56 %, SHEET_FIRST_ROW) 위의 무대에 인형과 이름판 줄.
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
    // 900~959 px 창은 무대가 좁다(약 290 px): ⟲ ⟳를 44 px로 줄여 이름판이 180 px 이상 남게 한다.
    const narrow = stage.width < 330;
    const button = narrow ? 44 : 48;
    const gap = narrow ? 8 : 10;
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
      toast: { x: feetX, y: topBar + 6, maxWidth: stage.width - 24, anchor: "top" },
      nameRow: {
        y: feetY + stack.name + extra,
        height: stack.nameH,
        plateWidth: Math.min(284, stage.width - 2 * (button + gap) - (narrow ? 4 : 16)),
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
      toast: { x: W - sheetWidth / 2, y: H - SHEET_CTA_ZONE, maxWidth: sheetWidth - 32, anchor: "bottom" },
      nameRow: { y: feetY + gapBelow, height: nameH, plateWidth: Math.min(236, stage.width - 2 * (button + gap) - 16), button, gap },
      cta: null,
      panelWidth: 0,
      sheet: { width: sheetWidth, rest: H, open: H },
      compactBar: stage.width < 420,
    };
  }

  const rest = Math.round(
    H >= SHEET_TALL_PHONE ? Math.min(Math.max(SHEET_REST * H, SHEET_FIRST_ROW), SHEET_REST_MAX * H) : SHEET_REST * H,
  );
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
    toast: { x: W / 2, y: H - SHEET_CTA_ZONE, maxWidth: W - 32, anchor: "bottom" },
    nameRow: { y: feetY + gapBelow, height: nameH, plateWidth: Math.min(236, W - 2 * (button + gap) - 16), button, gap },
    cta: null,
    panelWidth: 0,
    sheet: { width: W, rest, open },
    compactBar: W < 360,
  };
}
