import { describe, expect, it } from "vitest";
import { SEATS, SEAT_REACH } from "@caysonverse/shared/worldMap";
import {
  interactionIcon,
  interactionLabel,
  interactionShortLabel,
  interactInputAt,
  holdEnded,
  interactNow,
  pickInteraction,
  sameInteraction,
  shouldClosePanel,
  type Interaction,
  type InteractInput,
  type InteractTarget,
} from "./interact";
import { NPCS, NPC_CLOSE_RADIUS, NPC_TALK_RADIUS } from "./npc";

const base: InteractInput = { seated: false, seat: null, npc: null, npcPanelOpen: false };
const free = () => false;

/** A hub target (Task 16); `over` changes whatever a test cares about. */
const t = (over: Partial<InteractTarget> = {}): InteractTarget => ({
  kind: "teamDesk",
  id: "teamDesk",
  dist: 1,
  icon: "👥",
  label: "팀 만들기",
  ...over,
});

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

describe("pickInteraction with hub targets (Task 16)", () => {
  it("pickInteraction: a nearer target beats a farther NPC; seated still stands", () => {
    expect(pickInteraction({ ...base, npc: { id: "hall", dist: 2 }, targets: [t({ dist: 1 })] })).toEqual({
      kind: "target",
      target: t({ dist: 1 }),
    });
    // The NPC is nearer → the NPC.
    expect(pickInteraction({ ...base, npc: { id: "hall", dist: 0.5 }, targets: [t({ dist: 1 })] })).toEqual({
      kind: "talk",
      npc: "hall",
    });
    // Seated: stand, whatever targets are around.
    expect(pickInteraction({ ...base, seated: true, targets: [t({ dist: 0.1 })] })).toEqual({ kind: "stand" });
  });

  it("a tie goes seat > 조교 > target", () => {
    const seat = { index: 2, dist: 1 };
    const npc = { id: "hall" as const, dist: 1 };
    expect(pickInteraction({ ...base, seat, npc, targets: [t({ dist: 1 })] })).toEqual({ kind: "sit", seatIndex: 2 });
    expect(pickInteraction({ ...base, npc, targets: [t({ dist: 1 })] })).toEqual({ kind: "talk", npc: "hall" });
    expect(pickInteraction({ ...base, targets: [t({ dist: 1 })] })).toEqual({ kind: "target", target: t({ dist: 1 }) });
  });

  it("the nearest of several targets wins; the first of equals", () => {
    const far = t({ id: "far", kind: "door", dist: 3 });
    const near = t({ id: "near", kind: "door", dist: 0.4 });
    const twin = t({ id: "twin", kind: "door", dist: 0.4 });
    expect(pickInteraction({ ...base, targets: [far, near, twin] })).toEqual({ kind: "target", target: near });
    expect(pickInteraction({ ...base, targets: [far] })).toEqual({ kind: "target", target: far });
  });

  it("a higher priority wins over a nearer target; among equals the nearest wins, then the first", () => {
    const note = t({ id: "note_1", kind: "object", dist: 1.0 });
    const key = t({ id: "safe_key_left", kind: "object", dist: 1.15, priority: 1 });
    const drawer = t({ id: "drawer_left", kind: "object", dist: 1.1 });
    expect(pickInteraction({ ...base, targets: [note, key, drawer] })).toEqual({ kind: "target", target: key });
    expect(pickInteraction({ ...base, targets: [key, note, drawer] })).toEqual({ kind: "target", target: key });
    // Two prioritised targets: the nearer; equal distances: the first.
    const key2 = t({ id: "safe_key_right", kind: "object", dist: 1.4, priority: 1 });
    expect(pickInteraction({ ...base, targets: [key2, note, key] })).toEqual({ kind: "target", target: key });
    const twin = t({ id: "twin", kind: "object", dist: 1.15, priority: 1 });
    expect(pickInteraction({ ...base, targets: [key, twin] })).toEqual({ kind: "target", target: key });
    // Without priorities nothing changed: the nearest wins.
    expect(pickInteraction({ ...base, targets: [drawer, note] })).toEqual({ kind: "target", target: note });
    // A priority does not beat a nearer seat or 조교 (those exist only in the legacy world).
    expect(pickInteraction({ ...base, npc: { id: "hall", dist: 0.5 }, targets: [key] })).toEqual({ kind: "talk", npc: "hall" });
  });

  it("an open 조교 panel hides the 조교 but not a target; no targets → as before", () => {
    expect(
      pickInteraction({ ...base, npc: { id: "hall", dist: 0.2 }, npcPanelOpen: true, targets: [t({ dist: 2 })] }),
    ).toEqual({ kind: "target", target: t({ dist: 2 }) });
    expect(pickInteraction({ ...base, targets: [] })).toBeNull();
    expect(pickInteraction({ ...base, targets: undefined })).toBeNull();
  });

  it("a target brings its own icon and label; the touch button uses `short` when there is one", () => {
    const enter = t({ kind: "door", id: "counsel", icon: "🚪", label: "입장 (팀원 2명)", short: "입장" });
    const it1: Interaction = { kind: "target", target: enter };
    expect(interactionIcon(it1)).toBe("🚪");
    expect(interactionLabel(it1)).toBe("입장 (팀원 2명)");
    expect(interactionShortLabel(it1)).toBe("입장");
    const desk: Interaction = { kind: "target", target: t() };
    expect(interactionShortLabel(desk)).toBe("팀 만들기");
  });

  it("sameInteraction tells targets apart by id and by what the button says", () => {
    const a: Interaction = { kind: "target", target: t({ kind: "door", id: "counsel", label: "입장 (팀원 2명)" }) };
    const same: Interaction = { kind: "target", target: t({ kind: "door", id: "counsel", label: "입장 (팀원 2명)", dist: 2 }) };
    const moreMembers: Interaction = { kind: "target", target: t({ kind: "door", id: "counsel", label: "입장 (팀원 3명)" }) };
    const other: Interaction = { kind: "target", target: t({ kind: "door", id: "library", label: "입장 (팀원 2명)" }) };
    expect(sameInteraction(a, same)).toBe(true); // the distance changes every step; the button does not
    expect(sameInteraction(a, moreMembers)).toBe(false);
    expect(sameInteraction(a, other)).toBe(false);
    expect(sameInteraction(a, { kind: "stand" })).toBe(false);
    expect(sameInteraction(a, null)).toBe(false);
  });

  it("interactInputAt carries the targets it is given", () => {
    const targets = [t()];
    expect(interactInputAt(500, 500, -1, free, false, targets).targets).toBe(targets);
    expect(interactInputAt(500, 500, -1, free, false).targets).toBeUndefined();
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

describe("holdEnded — a held target lets go when it is no longer the pick (Task 19)", () => {
  const key = (over: Partial<InteractTarget> = {}): InteractTarget =>
    t({ kind: "object", id: "safe_key_left", icon: "🔑", label: "3초 길게 누르기", hold: true, ...over });
  const pick = (target: InteractTarget): Interaction => ({ kind: "target", target });

  it("keeps holding while the same hold target is still the pick (its distance changes every step)", () => {
    expect(holdEnded(key(), pick(key({ dist: 1.7 })))).toBe(false);
  });

  it("lets go when the pick is nothing (walked out of reach, an overlay opened, the room paused)", () => {
    expect(holdEnded(key(), null)).toBe(true);
  });

  it("lets go when something else is nearer", () => {
    expect(holdEnded(key(), pick(key({ id: "safe_key_right" })))).toBe(true);
    expect(holdEnded(key(), { kind: "sit", seatIndex: 2 })).toBe(true);
  });

  it("lets go when the switch stopped being a hold (a teammate arrived: it is a two-person press now)", () => {
    expect(holdEnded(key(), pick(key({ hold: undefined, label: "열쇠 돌리기" })))).toBe(true);
  });

  it("with nothing held there is nothing to let go", () => {
    expect(holdEnded(null, null)).toBe(false);
    expect(holdEnded(null, pick(key()))).toBe(false);
  });
});
