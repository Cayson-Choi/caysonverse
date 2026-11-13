import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blurTextEntry, handleEscape, isTextEntry, openMenu, type FocusLike } from "./escape";
import { useUiStore } from "../stores/uiStore";
import { popOverlay, pushOverlay, resetOverlays, topOverlay } from "../ui/overlayStack";

/** A fake focused element with a blur spy. */
const el = (o: Partial<FocusLike>) => {
  const blur = vi.fn<() => void>();
  return { ...o, blur } satisfies FocusLike;
};

/** Pretend `focused` is `document.activeElement`. */
const focus = (focused: FocusLike | null) => vi.stubGlobal("document", { activeElement: focused });

beforeEach(() => {
  useUiStore.setState({ menuOpen: false, rosterOpen: false });
  resetOverlays();
  focus(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetOverlays();
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
    // Defensive: the menu normally closes the roster as it opens, but if it is somehow still open under it, Esc
    // still peels the topmost (the menu) first.
    useUiStore.setState({ menuOpen: true, rosterOpen: true });
    handleEscape();
    expect(useUiStore.getState()).toMatchObject({ menuOpen: false, rosterOpen: true });
  });

  it("with the menu closed: the roster first, then the menu opens", () => {
    useUiStore.setState({ menuOpen: false, rosterOpen: true });
    handleEscape();
    expect(useUiStore.getState()).toMatchObject({ menuOpen: false, rosterOpen: false });
    handleEscape();
    expect(useUiStore.getState().menuOpen).toBe(true);
  });
});

describe("handleEscape — overlays", () => {
  it("an open overlay closes first, whatever else is open — and nothing else changes", () => {
    const close = vi.fn<() => void>();
    pushOverlay("inspect", close);
    useUiStore.setState({ menuOpen: true, rosterOpen: true });

    handleEscape();

    expect(close).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState()).toMatchObject({ menuOpen: true, rosterOpen: true });
  });

  it("with nothing but an overlay open Esc closes it and does not open the menu", () => {
    let open = true;
    pushOverlay("inspect", () => {
      open = false;
      popOverlay("inspect");
    });
    handleEscape();
    expect(open).toBe(false);
    expect(useUiStore.getState().menuOpen).toBe(false);
    // The overlay is gone, so the next Esc is the ordinary one.
    handleEscape();
    expect(useUiStore.getState().menuOpen).toBe(true);
  });

  it("stacked overlays close one Esc at a time, the top one first", () => {
    const order: string[] = [];
    pushOverlay("inspect", () => {
      order.push("inspect");
      popOverlay("inspect");
    });
    pushOverlay("lock", () => {
      order.push("lock");
      popOverlay("lock");
    });
    handleEscape();
    expect(order).toEqual(["lock"]);
    expect(topOverlay()?.id).toBe("inspect");
    handleEscape();
    expect(order).toEqual(["lock", "inspect"]);
    expect(topOverlay()).toBeNull();
  });

  it("a focused field inside an overlay does not hold Esc back: one press closes the overlay", () => {
    const close = vi.fn<() => void>();
    pushOverlay("lock", close);
    const field = el({ tagName: "INPUT", type: "text" });
    focus(field);
    handleEscape();
    expect(close).toHaveBeenCalledTimes(1);
    expect(field.blur).not.toHaveBeenCalled();
  });
});

describe("openMenu — opening the menu clears what sits under it", () => {
  it("closes the roster as the menu opens", () => {
    useUiStore.setState({ menuOpen: false, rosterOpen: true });
    openMenu();
    expect(useUiStore.getState()).toMatchObject({ menuOpen: true, rosterOpen: false });
  });

  it("is what an Esc with nothing else open does, and it is idempotent", () => {
    handleEscape();
    expect(useUiStore.getState()).toMatchObject({ menuOpen: true, rosterOpen: false });
    openMenu();
    expect(useUiStore.getState().menuOpen).toBe(true);
  });
});
