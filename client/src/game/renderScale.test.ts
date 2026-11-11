import { afterEach, describe, expect, it } from "vitest";
import { interactionPressureActive, noteInteraction, resetInteractionPressure } from "./renderScale";

describe("render-scale interaction pressure", () => {
  afterEach(() => resetInteractionPressure());

  it("keeps the next interaction window active without React state", () => {
    noteInteraction(1000);
    expect(interactionPressureActive(1000)).toBe(true);
    expect(interactionPressureActive(2199)).toBe(true);
    expect(interactionPressureActive(2200)).toBe(false);
  });

  it("extends the window for a burst instead of shortening it", () => {
    noteInteraction(1000);
    noteInteraction(1500);
    expect(interactionPressureActive(2600)).toBe(true);
    expect(interactionPressureActive(2700)).toBe(false);
  });
});
