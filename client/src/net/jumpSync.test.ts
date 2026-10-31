import { afterEach, describe, expect, it, vi } from "vitest";
import type { Room } from "@colyseus/sdk";
import type { WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import type { JumpBroadcast } from "@caysonverse/shared/messages";
import { jumpRegistry } from "../game/jump";
import { startJumpSync } from "./jumpSync";

/** A room stand-in that records handlers and lets the test deliver a broadcast. */
function fakeRoom() {
  const handlers = new Map<string, (m: JumpBroadcast) => void>();
  const off = vi.fn();
  const room = {
    onMessage(type: string, cb: (m: JumpBroadcast) => void) {
      handlers.set(type, cb);
      return off;
    },
  } as unknown as Room<WorldState>;
  return {
    room,
    off,
    deliver: (m: JumpBroadcast) => handlers.get(MessageType.Jump)?.(m),
    registered: () => handlers.has(MessageType.Jump),
  };
}

describe("startJumpSync", () => {
  afterEach(() => jumpRegistry.clear());

  it("registers a Jump handler and starts a remote player's hop on its broadcast", () => {
    const f = fakeRoom();
    const stop = startJumpSync(f.room, "me");
    expect(f.registered()).toBe(true);

    f.deliver({ sid: "bob" });
    const now = performance.now();
    const entry = jumpRegistry.get("bob", now);
    expect(entry).not.toBeNull();
    expect(entry?.sid).toBe("bob");
    expect(entry?.startedAt).toBeLessThanOrEqual(now);
    stop();
  });

  it("ignores the echo of our own jump (it already plays locally)", () => {
    const f = fakeRoom();
    const stop = startJumpSync(f.room, "me");
    f.deliver({ sid: "me" });
    expect(jumpRegistry.get("me", performance.now())).toBeNull();
    stop();
  });

  it("a second hop from the same remote bumps seq so the avatar replays it", () => {
    const f = fakeRoom();
    const stop = startJumpSync(f.room, "me");
    f.deliver({ sid: "bob" });
    const first = jumpRegistry.get("bob", performance.now())!;
    f.deliver({ sid: "bob" });
    const second = jumpRegistry.get("bob", performance.now())!;
    expect(second.seq).toBeGreaterThan(first.seq);
    stop();
  });

  it("teardown unregisters the handler and clears every pending hop", () => {
    const f = fakeRoom();
    const stop = startJumpSync(f.room, "me");
    f.deliver({ sid: "bob" });
    f.deliver({ sid: "eve" });
    stop();
    expect(f.off).toHaveBeenCalledTimes(1);
    expect(jumpRegistry.get("bob", performance.now())).toBeNull();
    expect(jumpRegistry.get("eve", performance.now())).toBeNull();
  });
});
