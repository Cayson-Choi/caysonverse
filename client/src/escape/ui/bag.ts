/**
 * The team bag's pure parts (AI 학교 탈출, Task 18): what a tap on an item does (select, combine,
 * deselect), the chips the panel draws, and the toast words for a pickup or a combination.
 * The bag is the TEAM's — everyone sees the same items, and any member may combine.
 */

import type { EscapeEventPayload, PublicItem } from "@caysonverse/shared/escape/messages";

export interface BagSelection {
  first: string | null;
}

/**
 * One tap on an item. Nothing selected → it becomes the first. A different item while one is selected →
 * ask the server to combine the two (and the selection is cleared: the answer is an event, not a
 * second tap). The same item again → deselect. While the room is not live (`live` false: paused, time up,
 * not started) nothing is selected and nothing is asked — the server would refuse it anyway.
 */
export function selectItem(
  sel: BagSelection,
  item: string,
  live = true,
): { sel: BagSelection; combine: [string, string] | null } {
  if (!live) return { sel: { first: null }, combine: null };
  if (sel.first === null) return { sel: { first: item }, combine: null };
  if (sel.first === item) return { sel: { first: null }, combine: null };
  return { sel: { first: null }, combine: [sel.first, item] };
}

/** Drop a selection whose item is no longer in the bag (it was combined away). The same object when nothing changes. */
export function reconcileSelection(sel: BagSelection, bag: readonly string[]): BagSelection {
  return sel.first !== null && !bag.includes(sel.first) ? { first: null } : sel;
}

export interface BagChip {
  id: string;
  label: string;
  icon: string;
}

/** The bag in order, each item with the label and icon the room sent. An item the room did not describe shows by its id. */
export function bagChips(bag: readonly string[], items: readonly PublicItem[]): BagChip[] {
  return bag.map((id) => {
    const item = items.find((i) => i.id === id);
    return item ? { id, label: item.label, icon: item.icon } : { id, label: id, icon: "🎒" };
  });
}

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;

/** The object particle for a word: 을 after a final consonant, 를 after a vowel (or a letter that is not Hangul). */
export function eulReul(word: string): "을" | "를" {
  const code = word.charCodeAt(word.length - 1);
  if (code < HANGUL_FIRST || code > HANGUL_LAST) return "를";
  return (code - HANGUL_FIRST) % 28 === 0 ? "를" : "을";
}

/**
 * The toast the whole team reads when an item goes into the bag or two become one — "○○님이 자외선
 * 손전등을 만들었어요" — or null for an event that is not about the bag. `by` is the acting classroom
 * session id; someone who has left reads as 팀원.
 */
export function bagEventText(
  ev: EscapeEventPayload,
  items: readonly PublicItem[],
  members: readonly { sid: string; nickname: string }[],
): string | null {
  if (ev.e !== "combined" && ev.e !== "picked") return null;
  const who = members.find((m) => m.sid === ev.by)?.nickname ?? "팀원";
  const id = ev.e === "combined" ? ev.out : ev.item;
  const label = items.find((i) => i.id === id)?.label ?? "물건";
  return ev.e === "combined"
    ? `${who}님이 ${label}${eulReul(label)} 만들었어요`
    : `${who}님이 ${label}${eulReul(label)} 가방에 넣었어요`;
}
