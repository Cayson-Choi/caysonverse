/**
 * The ten core requirements of the Korean "AI 윤리기준" (Ministry of Science and ICT,
 * 2020), in the order the guideline lists them. The escape-room puzzles refer to them by
 * id; the labels are what students read. Browser-safe plain data.
 */

export type PrincipleId =
  | "human_rights"
  | "privacy"
  | "diversity"
  | "no_harm"
  | "public_good"
  | "solidarity"
  | "data_management"
  | "accountability"
  | "safety"
  | "transparency";

/** 인권 보장, 프라이버시 보호, 다양성 존중, 침해금지, 공공성, 연대성, 데이터 관리, 책임성, 안전성, 투명성 (in this order). */
export const PRINCIPLES: readonly { id: PrincipleId; label: string }[] = [
  { id: "human_rights", label: "인권 보장" },
  { id: "privacy", label: "프라이버시 보호" },
  { id: "diversity", label: "다양성 존중" },
  { id: "no_harm", label: "침해금지" },
  { id: "public_good", label: "공공성" },
  { id: "solidarity", label: "연대성" },
  { id: "data_management", label: "데이터 관리" },
  { id: "accountability", label: "책임성" },
  { id: "safety", label: "안전성" },
  { id: "transparency", label: "투명성" },
];

/** Where the list comes from (shown wherever the principles are shown). */
export const PRINCIPLE_SOURCE = "과학기술정보통신부 「인공지능(AI) 윤리기준」(2020)";
