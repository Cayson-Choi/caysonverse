import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ leaveEscape: vi.fn(async () => undefined) }));
vi.mock("../net/connection", () => ({ leaveEscape: h.leaveEscape }));

import { leaveToHall } from "./leave";
import { useAppStore } from "../stores/appStore";
import { useClassStore } from "../stores/classStore";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";

beforeEach(() => {
  h.leaveEscape.mockClear();
  useClassStore.getState().reset();
  useAppStore.getState().enterHub(
    { nickname: "나래", appearance: DEFAULT_APPEARANCE, sessionId: "me", classCode: "AB2CDE" },
    false,
  );
  useAppStore.getState().enterEscape();
});

describe("leaveToHall", () => {
  it("leaves the classroom connection and puts the hall scene back, in one go", () => {
    expect(useAppStore.getState().screen).toBe("escape");
    leaveToHall();
    expect(h.leaveEscape).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().screen).toBe("hub");
  });

  it("a notice shows in the hall as a toast", () => {
    leaveToHall("교실 연결이 끊겨 복도로 돌아왔어요.");
    expect(useClassStore.getState().toast?.text).toBe("교실 연결이 끊겨 복도로 돌아왔어요.");
  });

  it("does not move the screen when the player is not in a classroom (a second tap)", () => {
    leaveToHall();
    leaveToHall();
    expect(useAppStore.getState().screen).toBe("hub");
    expect(h.leaveEscape).toHaveBeenCalledTimes(2); // harmless: leaveEscape on no room resolves at once
  });
});
