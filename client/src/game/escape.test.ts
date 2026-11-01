import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blurTextEntry, handleEscape, isTextEntry, openMenu, type FocusLike } from "./escape";
import { useNpcStore } from "../stores/npcStore";
import { useUiStore } from "../stores/uiStore";

/** A fake focused element with a blur spy. */
const el = (o: Partial<FocusLike>) => {
  const blur = vi.fn<() => void>();
  return { ...o, blur } satisfies FocusLike;
};

/** Pretend `focused` is `document.activeElement`. */
const focus = (focused: FocusLike | null) => vi.stubGlobal("document", { activeElement: focused });

beforeEach(() => {
  useNpcStore.setState({ activeNpc: null, sending: false, histories: {} });
  useUiStore.setState({ menuOpen: false, rosterOpen: false });
  focus(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isTextEntry", () => {
  it("is true for text inputs, textareas and contenteditable", () => {
    expect(isTextEntry({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTextEntry({ tagName: "INPUT" })).toBe(true); // no type attribute = text
    expect(isTextEntry({ tagName: "input", type: "SEARCH" })).toBe(true);
    expect(isTextEntry({ tagName: "INPUT", type: "password" })).toBe(true);
    expect(isTextEntry({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntry({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is false for buttons, sliders, checkboxes and everything else", () => {
    for (const type of ["button", "checkbox", "radio", "range", "submit", "color", "file"])
      expect(isTextEntry({ tagName: "INPUT", type }), type).toBe(false);
    expect(isTextEntry({ tagName: "BUTTON" })).toBe(false);
    expect(isTextEntry({ tagName: "BODY" })).toBe(false);
    expect(isTextEntry({ tagName: "CANVAS" })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(undefined)).toBe(false);
  });
});

describe("blurTextEntry", () => {
  it("blurs a text field and says so; leaves a slider alone", () => {
    const field = el({ tagName: "INPUT", type: "text" });
    expect(blurTextEntry(field)).toBe(true);
    expect(field.blur).toHaveBeenCalledTimes(1);

    const slider = el({ tagName: "INPUT", type: "range" });
    expect(blurTextEntry(slider)).toBe(false);
    expect(slider.blur).not.toHaveBeenCalled();
    expect(blurTextEntry(null)).toBe(false);
  });
});

describe("handleEscape", () => {
  it("opens the menu when nothing is open, then closes it again", () => {
    handleEscape();
    expect(useUiStore.getState().menuOpen).toBe(true);
    handleEscape();
    expect(useUiStore.getState().menuOpen).toBe(false);
  });

  it("a focused text field only lets go — it neither opens nor closes the menu", () => {
    const field = el({ tagName: "TEXTAREA" });
    focus(field);
    handleEscape();
    expect(field.blur).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().menuOpen).toBe(false);

    // ...even with the menu already open: the field goes first, the menu stays.
    useUiStore.setState({ menuOpen: true });
    handleEscape();
    expect(field.blur).toHaveBeenCalledTimes(2);
    expect(useUiStore.getState().menuOpen).toBe(true);
  });

  it("a focused slider or button does not hold Esc: the menu still closes", () => {
    useUiStore.setState({ menuOpen: true });
    focus(el({ tagName: "INPUT", type: "range" }));
    handleEscape();
    expect(useUiStore.getState().menuOpen).toBe(false);
  });

  it("with the menu open Esc closes the MENU first — it is on top of everything", () => {
    // Defensive: the menu normally closes the roster / 조교 dialogue as it opens, but if
    // either is somehow still open under it, Esc still peels the topmost (the menu) first.
    useNpcStore.setState({ activeNpc: "lobby" });
    useUiStore.setState({ menuOpen: true, rosterOpen: true });
    handleEscape();
    expect(useUiStore.getState()).toMatchObject({ menuOpen: false, rosterOpen: true });
    expect(useNpcStore.getState().activeNpc).toBe("lobby");
  });

  it("with the menu closed: the 조교 dialogue first (even while typing in it), then the roster, then the menu opens", () => {
    useNpcStore.setState({ activeNpc: "lobby" });
    useUiStore.setState({ menuOpen: false, rosterOpen: true });
    const field = el({ tagName: "INPUT", type: "text" });
    focus(field);

    handleEscape();
    expect(useNpcStore.getState().activeNpc).toBeNull();
    expect(field.blur).not.toHaveBeenCalled(); // the dialogue unmounts with its field
    expect(useUiStore.getState()).toMatchObject({ menuOpen: false, rosterOpen: true });

    focus(null);
    handleEscape();
    expect(useUiStore.getState()).toMatchObject({ menuOpen: false, rosterOpen: false });
    handleEscape();
    expect(useUiStore.getState().menuOpen).toBe(true);
  });
});

describe("openMenu — opening the menu clears what sits under it", () => {
  it("closes the roster and the 조교 dialogue as the menu opens", () => {
    useNpcStore.setState({ activeNpc: "lobby" });
    useUiStore.setState({ menuOpen: false, rosterOpen: true });
    openMenu();
    expect(useUiStore.getState()).toMatchObject({ menuOpen: true, rosterOpen: false });
    expect(useNpcStore.getState().activeNpc).toBeNull();
  });

  it("is what an Esc with nothing else open does, and it is idempotent", () => {
    handleEscape();
    expect(useUiStore.getState()).toMatchObject({ menuOpen: true, rosterOpen: false });
    openMenu();
    expect(useUiStore.getState().menuOpen).toBe(true);
    expect(useNpcStore.getState().activeNpc).toBeNull();
  });
});
