/**
 * The 7 principles (7대 원칙) of 「대한민국 인공지능 윤리원칙」 (관계부처 합동, 과학기술정보통신부·KISDI,
 * 제정·공표 2026-08-21 under 「인공지능 발전과 신뢰 기반 조성 등에 관한 기본법」 제27조), in the order the
 * document lists them. It succeeds the 2020 「인공지능(AI) 윤리기준」 (10대 핵심요건). The escape-room
 * puzzles refer to them by id; the labels are what students read. Browser-safe plain data.
 *
 * Verified (plain HTTP, 2026-11-02):
 * - https://www.korea.kr/news/policyNewsView.do?newsId=148970529 (정책브리핑, 2026-08-24)
 * - https://ai.kisdi.re.kr/aieth/main/contents.do?menuNo=400058 (KISDI 인공지능 윤리 소통채널: 3대 가치·7대 원칙 본문)
 */

export type PrincipleId =
  | "human_centered"
  | "privacy"
  | "fairness"
  | "accountability"
  | "safety"
  | "reliability"
  | "transparency";

/** 인간중심성, 프라이버시 보호, 공정성·포용성, 책임성, 안전성, 신뢰성, 투명성 (in this order). */
export const PRINCIPLES: readonly { id: PrincipleId; label: string }[] = [
  { id: "human_centered", label: "인간중심성" },
  { id: "privacy", label: "프라이버시 보호" },
  { id: "fairness", label: "공정성·포용성" },
  { id: "accountability", label: "책임성" },
  { id: "safety", label: "안전성" },
  { id: "reliability", label: "신뢰성" },
  { id: "transparency", label: "투명성" },
];

/** Where the list comes from (shown wherever the principles are shown). */
export const PRINCIPLE_SOURCE = "과학기술정보통신부 「대한민국 인공지능 윤리원칙」(2026)";
