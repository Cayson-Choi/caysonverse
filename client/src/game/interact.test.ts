import { describe, expect, it } from "vitest";
import { SEATS, SEAT_REACH } from "@caysonverse/shared/worldMap";
import {
  interactionIcon,
  interactionLabel,
  interactionShortLabel,
  interactInputAt,
  interactNow,
  pickInteraction,
  sameInteraction,
  shouldClosePanel,
  type Interaction,
  type InteractInput,
} from "./interact";
import { NPCS, NPC_CLOSE_RADIUS, NPC_TALK_RADIUS } from "./npc";

const base: InteractInput = { seated: false, seat: null, npc: null, npcPanelOpen: false };
const free = () => false;

describe("pickInteraction", () => {
  it("seated → stand, whatever is nearby", () => {
    expect(pickInteraction({ ...base, seated: true, npc: { id: "hall", dist: 1 } })).toEqual({
      kind: "stand",
    });
    // Even a free seat right under the player and an open panel change nothing.
    expect(
      pickInteraction({
        seated: true,
        seat: { index: 3, dist: 0 },
        npc: { id: "hall", dist: 0.5 },
        npcPanelOpen: true,
      }),
    ).toEqual({ kind: "stand" });
  });

  it("the nearer of seat and NPC wins; a tie goes to sit", () => {
    expect(
      pickInteraction({ ...base, seat: { index: 3, dist: 1.2 }, npc: { id: "hall", dist: 2.5 } }),
    ).toEqual({ kind: "sit", seatIndex: 3 });
    expect(
      pickInteraction({ ...base, seat: { index: 3, dist: 1.4 }, npc: { id: "hall", dist: 0.9 } }),
    ).toEqual({ kind: "talk", npc: "hall" });
    expect(
      pickInteraction({ ...base, seat: { index: 7, dist: 1.5 }, npc: { id: "lobby", dist: 1.5 } }),
    ).toEqual({ kind: "sit", seatIndex: 7 });
  });

  it("a lone seat sits and a lone NPC talks", () => {
    expect(pickInteraction({ ...base, seat: { index: 0, dist: 1.5 } })).toEqual({
      kind: "sit",
      seatIndex: 0,
    });
    expect(pickInteraction({ ...base, npc: { id: "maze", dist: 3 } })).toEqual({
      kind: "talk",
      npc: "maze",
    });
  });

  it("no talk while that panel is open; nothing nearby → null", () => {
    // The only target is the NPC whose panel is already open → nothing to offer.
    expect(pickInteraction({ ...base, npc: { id: "hall", dist: 1 }, npcPanelOpen: true })).toBeNull();
    // A seat still wins when the panel is open, even though the NPC is nearer.
    expect(
      pickInteraction({
        ...base,
        seat: { index: 5, dist: 1.4 },
        npc: { id: "hall", dist: 0.5 },
        npcPanelOpen: true,
      }),
    ).toEqual({ kind: "sit", seatIndex: 5 });
    expect(pickInteraction(base)).toBeNull();
    expect(pickInteraction({ ...base, npcPanelOpen: true })).toBeNull();
  });
});

describe("icons and labels", () => {
  it("icons and Korean labels", () => {
    expect(interactionIcon({ kind: "talk", npc: "hall" })).toBe("💬");
    expect(interactionIcon({ kind: "sit", seatIndex: 0 })).toBe("🪑");
    expect(interactionIcon({ kind: "stand" })).toBe("🪑");
    expect(interactionLabel({ kind: "stand" })).toBe("일어서기");
    expect(interactionLabel({ kind: "sit", seatIndex: 0 })).toBe("앉기");
    expect(interactionLabel({ kind: "talk", npc: "lobby" })).toBe("조교와 대화");
  });

  it("the round touch button gets a label short enough for 60 px", () => {
    expect(interactionShortLabel({ kind: "sit", seatIndex: 0 })).toBe("앉기");
    expect(interactionShortLabel({ kind: "stand" })).toBe("일어서기");
    expect(interactionShortLabel({ kind: "talk", npc: "gallery" })).toBe("대화");
  });
});

describe("sameInteraction", () => {
  it("compares kind and target, and treats null as equal to null", () => {
    expect(sameInteraction(null, null)).toBe(true);
    expect(sameInteraction(null, { kind: "stand" })).toBe(false);
    expect(sameInteraction({ kind: "stand" }, { kind: "stand" })).toBe(true);
    expect(sameInteraction({ kind: "sit", seatIndex: 1 }, { kind: "sit", seatIndex: 1 })).toBe(true);
    expect(sameInteraction({ kind: "sit", seatIndex: 1 }, { kind: "sit", seatIndex: 2 })).toBe(false);
    expect(sameInteraction({ kind: "talk", npc: "hall" }, { kind: "talk", npc: "lobby" })).toBe(false);
    expect(sameInteraction({ kind: "sit", seatIndex: 1 }, { kind: "talk", npc: "hall" })).toBe(false);
  });
});

describe("interactInputAt (world → InteractInput)", () => {
  const seat0 = SEATS[0];
  const hall = NPCS.find((n) => n.id === "hall")!;

  it("finds the nearest free seat within reach, with its real distance", () => {
    const input = interactInputAt(seat0.x + 0.5, seat0.z, -1, free, false);
    expect(input.seated).toBe(false);
    expect(input.seat?.index).toBe(0);
    expect(input.seat?.dist).toBeCloseTo(0.5, 6);
  });

  it("skips occupied seats and reports none beyond SEAT_REACH", () => {
    // Seats are 5-6 m apart, so with the only chair in reach taken there is no seat.
    expect(interactInputAt(seat0.x, seat0.z, -1, (i) => i === 0, false).seat).toBeNull();
    // Free, but just outside its reach → none; just inside → it.
    expect(interactInputAt(seat0.x, seat0.z - (SEAT_REACH + 0.2), -1, free, false).seat).toBeNull();
    expect(interactInputAt(seat0.x, seat0.z - (SEAT_REACH - 0.1), -1, free, false).seat?.index).toBe(0);
    // Far from every chair and every NPC.
    const far = interactInputAt(500, 500, -1, free, false);
    expect(far.seat).toBeNull();
    expect(far.npc).toBeNull();
  });

  it("seated: no seat target, seated flag set", () => {
    const input = interactInputAt(seat0.x, seat0.z, 4, free, false);
    expect(input.seated).toBe(true);
    expect(input.seat).toBeNull();
    expect(pickInteraction(input)).toEqual({ kind: "stand" });
  });

  it("finds an NPC inside NPC_TALK_RADIUS only, and carries the panel flag", () => {
    const near = interactInputAt(hall.pos.x + NPC_TALK_RADIUS - 0.1, hall.pos.z, -1, free, true);
    expect(near.npc?.id).toBe("hall");
    expect(near.npc?.dist).toBeCloseTo(NPC_TALK_RADIUS - 0.1, 6);
    expect(near.npcPanelOpen).toBe(true);
    const out = interactInputAt(hall.pos.x + NPC_TALK_RADIUS + 0.1, hall.pos.z, -1, free, false);
    expect(out.npc).toBeNull();
  });

  it("end to end: standing at a chair offers sit, seated offers stand", () => {
    const at = interactInputAt(seat0.x, seat0.z, -1, free, false);
    expect(pickInteraction(at)).toEqual({ kind: "sit", seatIndex: 0 });
  });
});

describe("shouldClosePanel — the 조교 chat ends when you walk away from its assistant", () => {
  const hall = NPCS.find((n) => n.id === "hall")!;
  const lobby = NPCS.find((n) => n.id === "lobby")!;

  it("never closes anything when no panel is open", () => {
    expect(shouldClosePanel(null, 500, 500)).toBe(false);
    expect(shouldClosePanel(null, hall.pos.x, hall.pos.z)).toBe(false);
  });

  it("stays open up to NPC_CLOSE_RADIUS and closes beyond it (strictly greater)", () => {
    expect(shouldClosePanel("hall", hall.pos.x, hall.pos.z)).toBe(false);
    expect(shouldClosePanel("hall", hall.pos.x + NPC_CLOSE_RADIUS - 0.1, hall.pos.z)).toBe(false);
    expect(shouldClosePanel("hall", hall.pos.x + NPC_CLOSE_RADIUS, hall.pos.z)).toBe(false);
    expect(shouldClosePanel("hall", hall.pos.x + NPC_CLOSE_RADIUS + 0.1, hall.pos.z)).toBe(true);
  });

  it("measures from the assistant you are talking to, not the nearest one", () => {
    // Standing at the lobby assistant while the hall one is open: far from hall → close.
    expect(shouldClosePanel("hall", lobby.pos.x, lobby.pos.z)).toBe(true);
    expect(shouldClosePanel("lobby", lobby.pos.x, lobby.pos.z)).toBe(false);
  });
});

describe("interactNow — a click acts on the FRESH target, not the one drawn up to 200 ms ago", () => {
  const sit3: Interaction = { kind: "sit", seatIndex: 3 };
  const sit4: Interaction = { kind: "sit", seatIndex: 4 };

  it("re-reads the world first and performs what that read says", () => {
    const calls: string[] = [];
    // The button was rendered for seat 3; by the click the nearest free seat is seat 4.
    const refresh = () => {
      calls.push("refresh");
      return sit4;
    };
    const perform = (it: Interaction) => calls.push("perform:" + JSON.stringify(it));
    interactNow(refresh, perform);
    expect(calls).toEqual(["refresh", "perform:" + JSON.stringify(sit4), "refresh"]);
    expect(calls).not.toContain("perform:" + JSON.stringify(sit3));
  });

  it("does nothing when the target has gone since the render (walked off, seat taken)", () => {
    const perform = (_: Interaction) => {
      throw new Error("must not act on a vanished target");
    };
    let reads = 0;
    interactNow(() => {
      reads++;
      return null;
    }, perform);
    expect(reads).toBe(2); // still re-read after, so the button disappears this tick
  });
});
