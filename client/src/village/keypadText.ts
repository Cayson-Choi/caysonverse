import { GENERATED_HOUSE_NUMBERS } from "@caysonverse/shared/village/generated/houses";
import { houseNumberOf } from "@caysonverse/shared/village/houseAreas";

/** Every answer the house keypad shows (design 5.2): short, gentle Korean. */
export const KEYPAD_TEXT = {
  wrong: "번호가 맞지 않아요.",
  notReady: "이 집은 아직 준비 중이에요.",
  full: "집이 가득 찼어요.",
  tooFar: "번호키에서 조금 더 가까이 서 주세요.",
  busy: "앉아 있거나 버스를 탄 채로는 열 수 없어요.",
  invalid: "문을 열 수 없어요.",
  opening: "문이 열려요…",
} as const;

/** The countdown line while the keypad is locked (design 5.2 step 3). */
export function lockoutText(seconds: number): string {
  return `잠시 뒤 다시 눌러 주세요 (${Math.max(1, Math.ceil(seconds))}초)`;
}

/** The house's number from its building id, for the title: "3번 집 번호키". */
export function keypadTitle(buildingId: string): string {
  const n = houseNumberOf(buildingId);
  return n === null ? "집 번호키" : `${n}번 집 번호키`;
}

/** Whether the house has an interior the game can show (its generated files are in: houses 2–10 come with HA / HB). */
export function houseOpen(buildingId: string): boolean {
  const n = houseNumberOf(buildingId);
  return n !== null && (GENERATED_HOUSE_NUMBERS as readonly number[]).includes(n);
}
