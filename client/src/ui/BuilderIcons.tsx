// 조립실 아이콘(Task 7b): 탭 7개·회전·목소리·열쇠와 작은 표시들. 인라인 SVG라 따로 받을 파일이 없다.
// 모두 장식이다(aria-hidden): 버튼의 이름은 늘 그 버튼의 글자나 aria-label이다. 선은 currentColor를 따른다.

import type { ReactNode } from "react";
import type { CharacterSlot } from "@caysonverse/shared/characterManifest";

const PATHS = {
  hat: (
    <>
      <path d="M5 14c0-4.4 3.1-8 7-8s7 3.6 7 8" />
      <path d="M2.5 14.5h19c0 1.9-4.3 3.5-9.5 3.5s-9.5-1.6-9.5-3.5z" />
      <path d="M9 10.5c.8-1.4 1.8-2.2 3-2.4" />
    </>
  ),
  hair: (
    <>
      <circle cx="12" cy="13" r="7.5" />
      <path className="f" d="M4.6 11.8C5.4 7.6 8.4 5 12 5s6.6 2.6 7.4 6.8c-2.9.4-5.6-.9-7.4-3.6-1.8 2.7-4.5 4-7.4 3.6z" />
    </>
  ),
  face: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle className="f" cx="8.8" cy="10.5" r="1.25" />
      <circle className="f" cx="15.2" cy="10.5" r="1.25" />
      <path d="M8.5 14.6c1 1.3 2.2 1.9 3.5 1.9s2.5-.6 3.5-1.9" />
    </>
  ),
  top: <path d="M8.5 3.5 4 5.8 2.5 10l3.2 1.2.8-1.6v10.9h11V9.6l.8 1.6 3.2-1.2L20 5.8l-4.5-2.3c-.6 1.6-1.9 2.5-3.5 2.5s-2.9-.9-3.5-2.5z" />,
  bottom: (
    <>
      <path d="M6 3.5h12l1.2 17h-5.4L12 10.5l-1.8 10H4.8z" />
      <path d="M6.2 7h11.6" />
    </>
  ),
  shoes: (
    <>
      <path d="M2.5 16.5V9h5l1.6 2.2c1.9 1.4 4.6 1.9 7.9 2.3 2.4.3 4.5 1.2 4.5 3z" />
      <path d="M2.5 16.5h19V18a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18z" />
      <path d="M10.5 12.5l1-1.4M13 13.3l1-1.4" />
    </>
  ),
  item: (
    <>
      <path d="M4 20 13.5 10.5" />
      <path d="M17 2.8l1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4z" />
      <path d="M5 6.5v2M4 7.5h2M19.5 15v2M18.5 16h2" />
    </>
  ),
  rotateLeft: (
    <>
      <path d="M4.5 12.5a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 3.8v4.6h4.6" />
    </>
  ),
  rotateRight: (
    <>
      <path d="M19.5 12.5a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 3.8v4.6h-4.6" />
    </>
  ),
  voice: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
      <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4.5" />
      <path d="M11.3 11.7 19.5 3.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2" />
    </>
  ),
  swap: (
    <>
      <path d="M7 8 3 12l4 4" />
      <path d="M17 8l4 4-4 4" />
      <path d="M3 12h18" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z" />
      <path d="M13.5 7l3 3" />
    </>
  ),
  go: (
    <>
      <path d="M5 12h13" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  none: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 18 18 6" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
} satisfies Record<string, ReactNode>;

export type BuilderIconName = keyof typeof PATHS;

/** 슬롯 탭의 아이콘. */
export const SLOT_ICONS: Readonly<Record<CharacterSlot, BuilderIconName>> = {
  hat: "hat",
  hair: "hair",
  face: "face",
  top: "top",
  bottom: "bottom",
  shoes: "shoes",
  item: "item",
};

export function BuilderIcon({ name, className }: { name: BuilderIconName; className?: string }) {
  return (
    <svg className={className ? `cv-icon ${className}` : "cv-icon"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
