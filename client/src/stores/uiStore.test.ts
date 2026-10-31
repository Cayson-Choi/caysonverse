import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./uiStore";

beforeEach(() => {
  useUiStore.setState({ menuOpen: false, rosterOpen: false });
});

describe("uiStore", () => {
  it("starts with nothing open", () => {
    const s = useUiStore.getState();
    expect(s.menuOpen).toBe(false);
    expect(s.rosterOpen).toBe(false);
  });

  it("opens, closes and toggles the menu independently of the roster", () => {
    useUiStore.getState().setMenuOpen(true);
    expect(useUiStore.getState()).toMatchObject({ menuOpen: true, rosterOpen: false });
    useUiStore.getState().toggleMenu();
    expect(useUiStore.getState().menuOpen).toBe(false);
    useUiStore.getState().toggleMenu();
    expect(useUiStore.getState().menuOpen).toBe(true);
    useUiStore.getState().setRosterOpen(true);
    expect(useUiStore.getState()).toMatchObject({ menuOpen: true, rosterOpen: true });
  });

  it("resetPanels closes everything (a fresh world starts clean)", () => {
    useUiStore.setState({ menuOpen: true, rosterOpen: true });
    useUiStore.getState().resetPanels();
    expect(useUiStore.getState()).toMatchObject({ menuOpen: false, rosterOpen: false });
  });
});
