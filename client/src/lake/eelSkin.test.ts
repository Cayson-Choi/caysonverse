import { describe, expect, it } from "vitest";
import { EEL_CELL, EEL_SKIN_URL, isEelKind } from "./eelSkin";
import { LAKE_FISH_IDS } from "@caysonverse/shared/village/lakeGear";

describe("eel skin", () => {
  it("maps the shared atlas' eel cell (the 11th, column 2 row 2 of 4 x 3) onto its own file", () => {
    expect(LAKE_FISH_IDS?.indexOf("eel")).toBe(EEL_CELL.row * EEL_CELL.cols + EEL_CELL.col);
    expect(EEL_SKIN_URL).toContain("lake_eel_skin.webp");
  });
  it("only the eel", () => {
    expect(isEelKind("eel")).toBe(true);
    expect(isEelKind("carp")).toBe(false);
  });
});
