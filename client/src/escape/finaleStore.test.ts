import { beforeEach, describe, expect, it } from "vitest";
import { useFinaleStore } from "./finaleStore";

const FIRST = "pick_principle";

beforeEach(() => {
  useFinaleStore.getState().reset();
});

describe("finaleStore", () => {
  it("starts closed, with nothing wrong and nothing seen", () => {
    expect(useFinaleStore.getState()).toMatchObject({
      open: false,
      wrong: null,
      rightSeq: 0,
      firstTry: { seen: false, wrongOnFirstStep: 0 },
    });
  });

  it("opens and closes the last-door panel", () => {
    useFinaleStore.getState().setOpen(true);
    expect(useFinaleStore.getState().open).toBe(true);
    useFinaleStore.getState().setOpen(false);
    expect(useFinaleStore.getState().open).toBe(false);
  });

  it("the last door starting is seen but does not open the panel (the scene waits for the story box)", () => {
    useFinaleStore.getState().onEvent({ e: "finale", step: 0 }, FIRST);
    expect(useFinaleStore.getState().open).toBe(false);
    expect(useFinaleStore.getState().firstTry.seen).toBe(true);
  });

  it("a wrong card shows its explanation, opens the panel for everyone and counts against the first try", () => {
    const s = useFinaleStore.getState();
    s.onEvent({ e: "finale", step: 0 }, FIRST);
    s.onEvent({ e: "finaleWrong", stepId: FIRST, optionId: "transparency", explain: "투명성은 설명이에요." }, FIRST);
    expect(useFinaleStore.getState()).toMatchObject({
      open: true,
      wrong: { stepId: FIRST, optionId: "transparency", explain: "투명성은 설명이에요." },
      firstTry: { seen: true, wrongOnFirstStep: 1 },
    });
  });

  it("a right card moves to the next step: the explanation goes, the 'right' note is counted and the panel opens", () => {
    const s = useFinaleStore.getState();
    s.onEvent({ e: "finaleWrong", stepId: FIRST, optionId: "x", explain: "..." }, FIRST);
    s.setOpen(false);
    s.onEvent({ e: "finale", step: 1 }, FIRST);
    expect(useFinaleStore.getState()).toMatchObject({ open: true, wrong: null, rightSeq: 1 });
    s.onEvent({ e: "finale", step: 2 }, FIRST);
    expect(useFinaleStore.getState().rightSeq).toBe(2);
  });

  it("the escape closes the panel and clears the explanation; other events change nothing", () => {
    const s = useFinaleStore.getState();
    s.onEvent({ e: "finaleWrong", stepId: FIRST, optionId: "x", explain: "..." }, FIRST);
    const before = useFinaleStore.getState();
    s.onEvent({ e: "votes" }, FIRST);
    s.onEvent({ e: "members" }, FIRST);
    expect(useFinaleStore.getState()).toBe(before);
    s.onEvent({ e: "escaped", lines: [], stars: 3, elapsedS: 10, summary: { lines: [], question: "", source: "" } }, FIRST);
    expect(useFinaleStore.getState()).toMatchObject({ open: false, wrong: null });
  });

  it("reset forgets everything, the first try too", () => {
    const s = useFinaleStore.getState();
    s.onEvent({ e: "finale", step: 0 }, FIRST);
    s.onEvent({ e: "finaleWrong", stepId: FIRST, optionId: "x", explain: "." }, FIRST);
    s.reset();
    expect(useFinaleStore.getState()).toMatchObject({ open: false, wrong: null, rightSeq: 0, firstTry: { seen: false, wrongOnFirstStep: 0 } });
  });
});
