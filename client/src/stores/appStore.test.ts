import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./appStore";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { useClassStore } from "./classStore";

const enterAsAdmin = () =>
  useAppStore.getState().enterWorld(
    { nickname: "강사", appearance: DEFAULT_APPEARANCE, sessionId: "s0" },
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
      { nickname: "학생", appearance: DEFAULT_APPEARANCE, sessionId: "s0" },
      false,
    );
    useAppStore.getState().reconnected("s4", false);
    expect(useAppStore.getState().isAdmin).toBe(false);
  });
});

describe("appStore — class screens (AI 학교 탈출, Task 13)", () => {
  const me = { nickname: "가람", appearance: DEFAULT_APPEARANCE, sessionId: "c1", classCode: "AB2CDE" };

  beforeEach(() => {
    useAppStore.setState({
      screen: "entry",
      identity: null,
      isAdmin: false,
      notice: null,
      reconnecting: false,
      mainReconnecting: false,
      escapeReconnecting: false,
      connectionEpoch: 0,
      escapeEpoch: 0,
    });
    useClassStore.getState().reset();
  });

  it("enterHub shows the hall; a teacher pass makes the instructor flag true", () => {
    useAppStore.getState().enterHub(me, true);
    const s = useAppStore.getState();
    expect(s.screen).toBe("hub");
    expect(s.identity?.classCode).toBe("AB2CDE");
    expect(s.isAdmin).toBe(true);
    useAppStore.getState().enterHub(me);
    expect(useAppStore.getState().isAdmin).toBe(false);
  });

  it("enterEscape bumps the classroom epoch every time; exitEscape returns to the hall with a toast", () => {
    useAppStore.getState().enterHub(me);
    useAppStore.getState().enterEscape();
    expect(useAppStore.getState().screen).toBe("escape");
    expect(useAppStore.getState().escapeEpoch).toBe(1);
    useAppStore.getState().enterEscape(); // a restored classroom connection remounts the scene
    expect(useAppStore.getState().escapeEpoch).toBe(2);
    useAppStore.getState().exitEscape("교실 연결이 끊겨 복도로 돌아왔어요.");
    expect(useAppStore.getState().screen).toBe("hub");
    expect(useClassStore.getState().toast?.text).toBe("교실 연결이 끊겨 복도로 돌아왔어요.");
  });

  it("a classroom never opens outside a class, and exitEscape outside a classroom does nothing", () => {
    useAppStore.getState().enterEscape(); // on the entry screen: ignored
    expect(useAppStore.getState().screen).toBe("entry");
    useAppStore.getState().enterWorld(me);
    useAppStore.getState().enterEscape();
    expect(useAppStore.getState().screen).toBe("world");
    useAppStore.getState().exitEscape("x");
    expect(useAppStore.getState().screen).toBe("world");
    expect(useClassStore.getState().toast).toBeNull();
  });

  it("the overlay shows while EITHER connection recovers and hides only when both are back", () => {
    useAppStore.getState().enterHub(me);
    useAppStore.getState().enterEscape();
    useAppStore.getState().setReconnecting(true);
    useAppStore.getState().setEscapeReconnecting(true);
    useAppStore.getState().reconnected("c2"); // the class is back, the classroom is not yet
    expect(useAppStore.getState().reconnecting).toBe(true);
    useAppStore.getState().enterEscape(); // the classroom is back too
    expect(useAppStore.getState().reconnecting).toBe(false);

    useAppStore.getState().setEscapeReconnecting(true);
    useAppStore.getState().setReconnecting(true);
    useAppStore.getState().setEscapeReconnecting(false);
    expect(useAppStore.getState().reconnecting).toBe(true); // the class still recovers
    useAppStore.getState().leaveToEntry("수업이 끝났어요. 함께해 줘서 고마워요!");
    const s = useAppStore.getState();
    expect([s.reconnecting, s.mainReconnecting, s.escapeReconnecting]).toEqual([false, false, false]);
  });
});

describe("appStore — 케이슨 마을", () => {
  const me = { nickname: "가람", appearance: DEFAULT_APPEARANCE, sessionId: "v1" };

  beforeEach(() => {
    useAppStore.setState({
      screen: "entry",
      identity: null,
      isAdmin: true, // a stale flag from an earlier session must not leak in
      notice: "이전 안내",
      reconnecting: true,
      mainReconnecting: true,
      escapeReconnecting: false,
      connectionEpoch: 0,
      escapeEpoch: 0,
    });
  });

  it("enterVillage shows the village for the joined identity, never as an admin, with the notice and overlay cleared", () => {
    useAppStore.getState().enterVillage(me);
    const s = useAppStore.getState();
    expect(s.screen).toBe("village");
    expect(s.identity).toEqual(me);
    expect(s.isAdmin).toBe(false);
    expect(s.notice).toBeNull();
    expect(s.reconnecting).toBe(false);
    expect(s.mainReconnecting).toBe(false);
  });

  it("a reconnect keeps the village screen and bumps the epoch; leaving returns to the entry with a notice", () => {
    useAppStore.getState().enterVillage(me);
    useAppStore.getState().reconnected("v2", false);
    let s = useAppStore.getState();
    expect(s.screen).toBe("village");
    expect(s.identity?.sessionId).toBe("v2");
    expect(s.connectionEpoch).toBe(1);

    useAppStore.getState().leaveToEntry("연결이 끊겼어요");
    s = useAppStore.getState();
    expect(s.screen).toBe("entry");
    expect(s.identity).toBeNull();
    expect(s.notice).toBe("연결이 끊겼어요");
  });

  it("the classroom transitions ignore the village (enterEscape only works from a class)", () => {
    useAppStore.getState().enterVillage(me);
    useAppStore.getState().enterEscape();
    expect(useAppStore.getState().screen).toBe("village");
    useAppStore.getState().exitEscape();
    expect(useAppStore.getState().screen).toBe("village");
  });
});
