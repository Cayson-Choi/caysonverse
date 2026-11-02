import { beforeEach, describe, expect, it } from "vitest";
import { useHubUi } from "./hubUi";

beforeEach(() => useHubUi.getState().reset());

describe("hubUi (the hall's discrete UI state)", () => {
  it("the team panel opens and closes", () => {
    expect(useHubUi.getState().teamPanelOpen).toBe(false);
    useHubUi.getState().openTeamPanel();
    expect(useHubUi.getState().teamPanelOpen).toBe(true);
    useHubUi.getState().closeTeamPanel();
    expect(useHubUi.getState().teamPanelOpen).toBe(false);
  });

  it("setInfo stores the pad line and the same line again changes nothing (it is called 5 times a second)", () => {
    const seen: string[] = [];
    const off = useHubUi.subscribe((s) => seen.push(String(s.info)));
    useHubUi.getState().setInfo("먼저 중앙 홀에서 팀을 만들어요");
    useHubUi.getState().setInfo("먼저 중앙 홀에서 팀을 만들어요");
    useHubUi.getState().setInfo(null);
    useHubUi.getState().setInfo(null);
    off();
    expect(seen).toEqual(["먼저 중앙 홀에서 팀을 만들어요", "null"]);
  });

  it("reset forgets everything (a fresh hall scene starts clean)", () => {
    useHubUi.getState().openTeamPanel();
    useHubUi.getState().setInfo("x");
    useHubUi.getState().reset();
    expect(useHubUi.getState()).toMatchObject({ teamPanelOpen: false, info: null });
  });
});
