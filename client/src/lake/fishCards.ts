// The fish's pictures for the catch card and the 도감 (lake v2, owner 2026-11-16: "진짜 고기 같은 이미지"): one studio render of
// each species' 3D model in lake_fish.glb (the SAME model the game draws; art/lake/tools/render_fish_cards.py), packed 4 x 3 in
// fish_cards.webp (cells 384 x 192, in FISH_SPECIES order). A species not caught yet shows its own silhouette (the same picture,
// blacked out by CSS) — never one generic fish for all.

import { LAKE_FISH_IDS, type LakeFishId } from "@caysonverse/shared/village/lakeGear";

/** fish_cards.webp's sha256 (first 8): bump with the file. */
export const FISH_CARDS_HASH = "2de267ab";
export const FISH_CARDS_URL = `/models/lake/fish_cards.webp?v=${FISH_CARDS_HASH}`;
export const CARD_CELL = { w: 384, h: 192, cols: 4, rows: 3 } as const;

/** The CSS background of species `id`'s picture drawn `width` px wide. */
export function fishCardStyle(id: LakeFishId, width: number): { backgroundImage: string; backgroundSize: string; backgroundPosition: string; width: number; height: number } {
  const i = Math.max(0, LAKE_FISH_IDS.indexOf(id));
  const k = width / CARD_CELL.w;
  return {
    backgroundImage: `url(${FISH_CARDS_URL})`,
    backgroundSize: `${CARD_CELL.w * CARD_CELL.cols * k}px ${CARD_CELL.h * CARD_CELL.rows * k}px`,
    backgroundPosition: `${-(i % CARD_CELL.cols) * CARD_CELL.w * k}px ${-Math.floor(i / CARD_CELL.cols) * CARD_CELL.h * k}px`,
    width,
    height: Math.round(CARD_CELL.h * k),
  };
}

/** One line of real-world notes per species (the 도감's field-guide line). */
export const FISH_NOTES: Readonly<Record<LakeFishId, string>> = {
  crucian_carp: "우리 저수지 어디서나 사는 대표 민물고기예요. 30cm가 넘으면 '월척'이라 불러요.",
  bluegill: "북미에서 들어온 외래종이에요. 아가미 뚜껑 끝의 검은 점이 표시예요.",
  minnow: "맑은 물에 떼 지어 살아요. 번식기 수컷은 몸에 푸른빛·붉은빛 띠가 생겨요.",
  prussian_carp: "일본에서 들여온 붕어 무리예요. 붕어보다 몸이 높고 플랑크톤을 즐겨 먹어요.",
  bass: "북미 원산의 큰입배스예요. 입이 크고 작은 물고기를 잡아먹는 사냥꾼이에요.",
  carp: "입가에 수염이 두 쌍 있어요. 오래 살고 1m 가까이 자라기도 해요.",
  korean_bullhead: "노란 몸에 검은 무늬, 잡으면 '빠각빠각' 소리를 내서 빠가사리라고도 해요.",
  catfish: "넓적한 머리에 긴 수염, 주로 밤에 먹이를 찾아 다녀요.",
  mirror_carp: "비늘이 듬성듬성한 잉어 품종이에요. 이스라엘잉어라고도 불러요.",
  snakehead: "뱀 같은 무늬의 큰 포식자예요. 공기로 숨을 쉴 수 있어 진흙 속에서도 버텨요.",
  eel: "바다에서 태어나 강과 저수지로 올라와 자라요. 몸이 길고 미끈해요.",
};
