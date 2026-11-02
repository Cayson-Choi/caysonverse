import { describe, expect, it } from "vitest";
import type { EscapeEventPayload, PublicItem } from "@caysonverse/shared/escape/messages";
import { bagChips, bagEventText, reconcileSelection, selectItem } from "./bag";

const ITEMS: PublicItem[] = [
  { id: "flashlight", label: "손전등", icon: "🔦" },
  { id: "uv_film", label: "보라색 필름", icon: "🟪" },
  { id: "uv_flashlight", label: "자외선 손전등", icon: "🔮" },
  { id: "sort_cards", label: "분류 카드 8장", icon: "🗂" },
  { id: "memory_chip", label: "아리의 마음 칩", icon: "💾" },
];
const MEMBERS = [
  { sid: "s1", nickname: "가람" },
  { sid: "s2", nickname: "다온" },
];

describe("selectItem", () => {
  it("selectItem: a then b requests [a, b]; a then a deselects", () => {
    const s1 = selectItem({ first: null }, "flashlight");
    expect(s1).toEqual({ sel: { first: "flashlight" }, combine: null });
    expect(selectItem(s1.sel, "uv_film").combine).toEqual(["flashlight", "uv_film"]);
    expect(selectItem(s1.sel, "flashlight")).toEqual({ sel: { first: null }, combine: null });
  });

  it("asking to combine clears the selection (the request is sent, the bag is not waiting on a second tap)", () => {
    const s1 = selectItem({ first: null }, "flashlight");
    expect(selectItem(s1.sel, "uv_film").sel).toEqual({ first: null });
  });

  it("does not change the selection it was given", () => {
    const sel = Object.freeze({ first: "flashlight" });
    expect(() => selectItem(sel, "uv_film")).not.toThrow();
    expect(sel.first).toBe("flashlight");
  });
});

describe("reconcileSelection", () => {
  it("keeps a selection whose item is still in the bag, drops one that left (it was combined away)", () => {
    expect(reconcileSelection({ first: "flashlight" }, ["flashlight", "uv_film"])).toEqual({ first: "flashlight" });
    expect(reconcileSelection({ first: "flashlight" }, ["uv_flashlight"])).toEqual({ first: null });
    expect(reconcileSelection({ first: null }, [])).toEqual({ first: null });
  });

  it("returns the very same object when nothing changes (no needless re-render)", () => {
    const sel = { first: "flashlight" };
    expect(reconcileSelection(sel, ["flashlight"])).toBe(sel);
    const none = { first: null };
    expect(reconcileSelection(none, [])).toBe(none);
  });
});

describe("bagChips", () => {
  it("lists the bag in order with the label and icon the room sent", () => {
    expect(bagChips(["uv_film", "flashlight"], ITEMS)).toEqual([
      { id: "uv_film", label: "보라색 필름", icon: "🟪" },
      { id: "flashlight", label: "손전등", icon: "🔦" },
    ]);
    expect(bagChips([], ITEMS)).toEqual([]);
  });

  it("an item the room did not describe still shows (by its id), never crashes", () => {
    expect(bagChips(["mystery"], ITEMS)).toEqual([{ id: "mystery", label: "mystery", icon: "🎒" }]);
  });
});

describe("bagEventText", () => {
  const text = (ev: EscapeEventPayload) => bagEventText(ev, ITEMS, MEMBERS);

  it("a combination tells everyone who made what", () => {
    expect(text({ e: "combined", out: "uv_flashlight", by: "s1" })).toBe("가람님이 자외선 손전등을 만들었어요");
    expect(text({ e: "combined", out: "sort_cards", by: "s2" })).toBe("다온님이 분류 카드 8장을 만들었어요");
  });

  it("a pickup tells everyone who put what in the bag", () => {
    expect(text({ e: "picked", item: "flashlight", by: "s2" })).toBe("다온님이 손전등을 가방에 넣었어요");
    expect(text({ e: "picked", item: "uv_film", by: "s1" })).toBe("가람님이 보라색 필름을 가방에 넣었어요");
  });

  it("picks 을 or 를 by the last sound of the item's name", () => {
    expect(text({ e: "picked", item: "memory_chip", by: "s1" })).toBe("가람님이 아리의 마음 칩을 가방에 넣었어요"); // ㅂ
    const items: PublicItem[] = [
      { id: "a", label: "열쇠", icon: "🔑" }, // no final sound
      { id: "b", label: "USB", icon: "💾" }, // not Hangul
    ];
    expect(bagEventText({ e: "picked", item: "a", by: "s1" }, items, MEMBERS)).toBe("가람님이 열쇠를 가방에 넣었어요");
    expect(bagEventText({ e: "picked", item: "b", by: "s1" }, items, MEMBERS)).toBe("가람님이 USB를 가방에 넣었어요");
  });

  it("someone who has left, or an item the room did not describe, still reads fine", () => {
    expect(text({ e: "combined", out: "uv_flashlight", by: "gone" })).toBe("팀원님이 자외선 손전등을 만들었어요");
    expect(text({ e: "picked", item: "mystery", by: "s1" })).toBe("가람님이 물건을 가방에 넣었어요");
  });

  it("every other event says nothing here", () => {
    const others: EscapeEventPayload[] = [
      { e: "solved", lockId: "cabinet_lock", by: "s1" },
      { e: "say", lineId: "x" },
      { e: "members" },
      { e: "votes" },
      { e: "hintMax" },
    ];
    for (const ev of others) expect(text(ev), ev.e).toBeNull();
  });
});
