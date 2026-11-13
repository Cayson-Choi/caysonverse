import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./appStore";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";

const enterVillage = () =>
  useAppStore.getState().enterVillage({ nickname: "주민", appearance: DEFAULT_APPEARANCE, sessionId: "s0" });

describe("appStore — village screen and reconnect", () => {
  beforeEach(() => {
    useAppStore.setState({
      screen: "entry",
      identity: null,
      notice: null,
      reconnecting: false,
      connectionEpoch: 0,
    });
  });

  it("enterVillage moves to the village with the identity and clears any notice", () => {
    useAppStore.setState({ notice: "이전 안내" });
    enterVillage();
    const s = useAppStore.getState();
    expect(s.screen).toBe("village");
    expect(s.identity?.sessionId).toBe("s0");
    expect(s.notice).toBeNull();
  });

  it("reconnected adopts the new session, bumps the epoch and clears the overlay", () => {
    enterVillage();
    useAppStore.getState().setReconnecting(true);
    useAppStore.getState().reconnected("s1");
    const s = useAppStore.getState();
    expect(s.identity?.sessionId).toBe("s1");
    expect(s.connectionEpoch).toBe(1);
    expect(s.reconnecting).toBe(false);
  });

  it("leaveToEntry returns to the entry with the notice and forgets the identity", () => {
    enterVillage();
    useAppStore.getState().leaveToEntry("연결이 끊어졌어요");
    const s = useAppStore.getState();
    expect(s.screen).toBe("entry");
    expect(s.identity).toBeNull();
    expect(s.notice).toBe("연결이 끊어졌어요");
  });
});
