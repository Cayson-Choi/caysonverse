import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./appStore";

const enterAsAdmin = () =>
  useAppStore.getState().enterWorld(
    { nickname: "강사", character: 0, tint: 0, sessionId: "s0" },
    true,
  );

describe("appStore.reconnected — admin status on reconnect (F5)", () => {
  beforeEach(() => {
    useAppStore.setState({
      screen: "entry",
      identity: null,
      isAdmin: false,
      notice: null,
      reconnecting: false,
      connectionEpoch: 0,
    });
  });

  it("PRESERVES admin when no flag is passed (Phase-1 token reconnect keeps userData)", () => {
    enterAsAdmin();
    useAppStore.getState().reconnected("s1"); // token reconnect: server kept isAdmin
    const s = useAppStore.getState();
    expect(s.isAdmin).toBe(true);
    expect(s.identity?.sessionId).toBe("s1");
    expect(s.connectionEpoch).toBe(1);
    expect(s.reconnecting).toBe(false);
  });

  it("RESETS admin to false when a Phase-2 fresh join did not re-authenticate", () => {
    enterAsAdmin();
    useAppStore.getState().reconnected("s2", false); // fresh join with no/dropped admin code
    expect(useAppStore.getState().isAdmin).toBe(false);
  });

  it("KEEPS admin when a Phase-2 fresh join re-sent a valid admin code", () => {
    enterAsAdmin();
    useAppStore.getState().reconnected("s3", true); // fresh join re-authenticated
    const s = useAppStore.getState();
    expect(s.isAdmin).toBe(true);
    expect(s.identity?.sessionId).toBe("s3");
  });

  it("does not grant admin to a non-admin on a fresh join", () => {
    useAppStore.getState().enterWorld(
      { nickname: "학생", character: 0, tint: 0, sessionId: "s0" },
      false,
    );
    useAppStore.getState().reconnected("s4", false);
    expect(useAppStore.getState().isAdmin).toBe(false);
  });
});
