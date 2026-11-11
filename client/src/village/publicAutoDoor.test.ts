import { describe, expect, it } from "vitest";
import { CLOSED_AUTO_DOOR, PUBLIC_AUTO_DOOR, stepAutoDoor } from "@caysonverse/shared/village/autoDoor";
import { autoDoorOpenAmount } from "./publicAutoDoorModel";

const near = { playerDistancesM: [1.2], doorwayOccupied: false };
const away = { playerDistancesM: [8], doorwayOccupied: false };

describe("public auto-door visual bridge", () => {
  it("opens as a player approaches, reaches fully open, then waits before closing", () => {
    const opening = stepAutoDoor(CLOSED_AUTO_DOOR, 0, near);
    expect(opening.phase).toBe("opening");
    expect(autoDoorOpenAmount(opening, 210, PUBLIC_AUTO_DOOR)).toBeCloseTo(0.5, 6);
    const open = stepAutoDoor(opening, PUBLIC_AUTO_DOOR.openingMs, near);
    expect(open.phase).toBe("open");
    expect(autoDoorOpenAmount(open, PUBLIC_AUTO_DOOR.openingMs, PUBLIC_AUTO_DOOR)).toBe(1);
    const clear = stepAutoDoor(open, PUBLIC_AUTO_DOOR.openingMs + 100, away);
    expect(clear.phase).toBe("open");
    expect(clear.clearSinceMs).toBe(PUBLIC_AUTO_DOOR.openingMs + 100);
  });

  it("keeps a doorway occupied during the closing sweep and reverses when approached again", () => {
    const opening = stepAutoDoor(CLOSED_AUTO_DOOR, 0, near);
    const open = stepAutoDoor(opening, PUBLIC_AUTO_DOOR.openingMs, near);
    const clear = stepAutoDoor(open, 2_000, away);
    const closing = stepAutoDoor(clear, 2_000 + PUBLIC_AUTO_DOOR.closeDelayMs, away);
    expect(closing.phase).toBe("closing");
    expect(autoDoorOpenAmount(closing, 2_000 + PUBLIC_AUTO_DOOR.closeDelayMs + 310, PUBLIC_AUTO_DOOR)).toBeCloseTo(0.5, 6);
    const reversed = stepAutoDoor(closing, 2_000 + PUBLIC_AUTO_DOOR.closeDelayMs + 311, { playerDistancesM: [1], doorwayOccupied: true });
    expect(reversed.phase).toBe("opening");
    expect(autoDoorOpenAmount(reversed, 2_000 + PUBLIC_AUTO_DOOR.closeDelayMs + 311, PUBLIC_AUTO_DOOR)).toBe(0);
  });
});
