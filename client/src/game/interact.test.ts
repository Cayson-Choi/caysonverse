import { describe, expect, it } from "vitest";
import { SEAT_REACH } from "@caysonverse/shared/worldMap";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import {
  interactionIcon,
  interactionLabel,
  interactionShortLabel,
  interactInputAt,
  holdEnded,
  interactNow,
  pickInteraction,
  sameInteraction,
  type Interaction,
  type InteractInput,
  type InteractTarget,
} from "./interact";

const base: InteractInput = { seated: false, seat: null };
const free = () => false;
const village = { seats: VILLAGE_SEATS };

/** A scene target; `over` changes whatever a test cares about. */
const t = (over: Partial<InteractTarget> = {}): InteractTarget => ({
  kind: "door",
  id: "memorial_door",
  dist: 1,
  icon: "🚪",
  label: "추모관 들어가기",
  ...over,
});

describe("pickInteraction", () => {
  it("seated → stand, whatever is nearby", () => {
    expect(pickInteraction({ ...base, seated: true, targets: [t({ dist: 0.1 })] })).toEqual({ kind: "stand" });
    // Even a free seat right under the player changes nothing.
    expect(pickInteraction({ seated: true, seat: { index: 3, dist: 0 } })).toEqual({ kind: "stand" });
  });

  it("a lone seat sits; nothing nearby → null", () => {
    expect(pickInteraction({ ...base, seat: { index: 0, dist: 1.5 } })).toEqual({ kind: "sit", seatIndex: 0 });
    expect(pickInteraction(base)).toBeNull();
  });
});

describe("pickInteraction with scene targets", () => {
  it("a nearer target beats a farther seat; a nearer seat beats a farther target", () => {
    expect(pickInteraction({ ...base, seat: { index: 3, dist: 2 }, targets: [t({ dist: 1 })] })).toEqual({
      kind: "target",
      target: t({ dist: 1 }),
    });
    expect(pickInteraction({ ...base, seat: { index: 3, dist: 0.5 }, targets: [t({ dist: 1 })] })).toEqual({
      kind: "sit",
      seatIndex: 3,
    });
  });

  it("a tie goes seat > target", () => {
    const seat = { index: 2, dist: 1 };
    expect(pickInteraction({ ...base, seat, targets: [t({ dist: 1 })] })).toEqual({ kind: "sit", seatIndex: 2 });
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
    const key = t({ id: "key_left", kind: "object", dist: 1.15, priority: 1 });
    const drawer = t({ id: "drawer_left", kind: "object", dist: 1.1 });
    expect(pickInteraction({ ...base, targets: [note, key, drawer] })).toEqual({ kind: "target", target: key });
    expect(pickInteraction({ ...base, targets: [key, note, drawer] })).toEqual({ kind: "target", target: key });
    // Two prioritised targets: the nearer; equal distances: the first.
    const key2 = t({ id: "key_right", kind: "object", dist: 1.4, priority: 1 });
    expect(pickInteraction({ ...base, targets: [key2, note, key] })).toEqual({ kind: "target", target: key });
    const twin = t({ id: "twin", kind: "object", dist: 1.15, priority: 1 });
    expect(pickInteraction({ ...base, targets: [key, twin] })).toEqual({ kind: "target", target: key });
    // Without priorities nothing changed: the nearest wins.
    expect(pickInteraction({ ...base, targets: [drawer, note] })).toEqual({ kind: "target", target: note });
    // A priority does not beat a nearer seat.
    expect(pickInteraction({ ...base, seat: { index: 1, dist: 0.5 }, targets: [key] })).toEqual({ kind: "sit", seatIndex: 1 });
  });

  it("no targets → as before", () => {
    expect(pickInteraction({ ...base, targets: [] })).toBeNull();
    expect(pickInteraction({ ...base, targets: undefined })).toBeNull();
  });

  it("a target brings its own icon and label; the touch button uses `short` when there is one", () => {
    const enter = t({ kind: "door", id: "memorial", icon: "🚪", label: "추모관 들어가기 (E)", short: "입장" });
    const it1: Interaction = { kind: "target", target: enter };
    expect(interactionIcon(it1)).toBe("🚪");
    expect(interactionLabel(it1)).toBe("추모관 들어가기 (E)");
    expect(interactionShortLabel(it1)).toBe("입장");
    const plain: Interaction = { kind: "target", target: t() };
    expect(interactionShortLabel(plain)).toBe("추모관 들어가기");
  });

  it("sameInteraction tells targets apart by id and by what the button says", () => {
    const a: Interaction = { kind: "target", target: t({ kind: "door", id: "memorial", label: "들어가기" }) };
    const same: Interaction = { kind: "target", target: t({ kind: "door", id: "memorial", label: "들어가기", dist: 2 }) };
    const otherLabel: Interaction = { kind: "target", target: t({ kind: "door", id: "memorial", label: "나가기" }) };
    const other: Interaction = { kind: "target", target: t({ kind: "door", id: "house", label: "들어가기" }) };
    expect(sameInteraction(a, same)).toBe(true); // the distance changes every step; the button does not
    expect(sameInteraction(a, otherLabel)).toBe(false);
    expect(sameInteraction(a, other)).toBe(false);
    expect(sameInteraction(a, { kind: "stand" })).toBe(false);
    expect(sameInteraction(a, null)).toBe(false);
  });

  it("interactInputAt carries the targets it is given", () => {
    const targets = [t()];
    expect(interactInputAt(500, 500, -1, free, targets, village).targets).toBe(targets);
    expect(interactInputAt(500, 500, -1, free, undefined, village).targets).toBeUndefined();
  });
});

describe("icons and labels", () => {
  it("icons and Korean labels", () => {
    expect(interactionIcon({ kind: "sit", seatIndex: 0 })).toBe("🪑");
    expect(interactionIcon({ kind: "stand" })).toBe("🪑");
    expect(interactionLabel({ kind: "stand" })).toBe("일어서기");
    expect(interactionLabel({ kind: "sit", seatIndex: 0 })).toBe("앉기");
  });

  it("the round touch button gets a label short enough for 60 px", () => {
    expect(interactionShortLabel({ kind: "sit", seatIndex: 0 })).toBe("앉기");
    expect(interactionShortLabel({ kind: "stand" })).toBe("일어서기");
  });
});

describe("sameInteraction", () => {
  it("compares kind and target, and treats null as equal to null", () => {
    expect(sameInteraction(null, null)).toBe(true);
    expect(sameInteraction(null, { kind: "stand" })).toBe(false);
    expect(sameInteraction({ kind: "stand" }, { kind: "stand" })).toBe(true);
    expect(sameInteraction({ kind: "sit", seatIndex: 1 }, { kind: "sit", seatIndex: 1 })).toBe(true);
    expect(sameInteraction({ kind: "sit", seatIndex: 1 }, { kind: "sit", seatIndex: 2 })).toBe(false);
    expect(sameInteraction({ kind: "sit", seatIndex: 1 }, { kind: "stand" })).toBe(false);
  });
});

describe("interactInputAt on 케이슨 마을's benches (the map's own seats)", () => {
  const s = VILLAGE_SEATS[6]!; // plaza_4
  const f = { x: Math.sin(s.yaw), z: Math.cos(s.yaw) };

  it("in front of a bench: sit on its nearest free seat (the village's index), the neighbour seat when it is taken", () => {
    const at = interactInputAt(s.standX, s.standZ, -1, free, undefined, village);
    expect(pickInteraction(at)).toEqual({ kind: "sit", seatIndex: 6 });
    expect(at.seat?.dist).toBeCloseTo(Math.hypot(s.standX - s.x, s.standZ - s.z), 6);
    const n = VILLAGE_SEATS[7]!;
    const mid = { x: (s.x + n.x) / 2 + f.x * 0.5, z: (s.z + n.z) / 2 + f.z * 0.5 };
    expect(interactInputAt(mid.x, mid.z, -1, (i) => i === 6, undefined, village).seat?.index).toBe(7);
  });

  it("behind the backrest, within reach: nothing to sit on (a bench is sat on from the front)", () => {
    const behind = interactInputAt(s.x - f.x * 1.2, s.z - f.z * 1.2, -1, free, undefined, village);
    expect(behind.seat).toBeNull();
  });

  it("skips occupied seats and reports none beyond SEAT_REACH", () => {
    expect(interactInputAt(s.standX, s.standZ, -1, free, undefined, village).seat?.index).toBe(6);
    // Far from every bench.
    expect(interactInputAt(5000, 5000, -1, free, undefined, village).seat).toBeNull();
    expect(SEAT_REACH).toBeGreaterThan(0);
  });

  it("seated on a bench: stand up", () => {
    expect(pickInteraction(interactInputAt(s.x, s.z, 6, free, undefined, village))).toEqual({ kind: "stand" });
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

describe("holdEnded — a held target lets go when it is no longer the pick", () => {
  const key = (over: Partial<InteractTarget> = {}): InteractTarget =>
    t({ kind: "object", id: "hold_key", icon: "🔑", label: "길게 누르기", hold: true, ...over });
  const pick = (target: InteractTarget): Interaction => ({ kind: "target", target });

  it("keeps holding while the same hold target is still the pick (its distance changes every step)", () => {
    expect(holdEnded(key(), pick(key({ dist: 1.7 })))).toBe(false);
  });

  it("lets go when the pick is nothing (walked out of reach, an overlay opened)", () => {
    expect(holdEnded(key(), null)).toBe(true);
  });

  it("lets go when something else is nearer", () => {
    expect(holdEnded(key(), pick(key({ id: "other_key" })))).toBe(true);
    expect(holdEnded(key(), { kind: "sit", seatIndex: 2 })).toBe(true);
  });

  it("lets go when the target stopped being a hold", () => {
    expect(holdEnded(key(), pick(key({ hold: undefined, label: "누르기" })))).toBe(true);
  });

  it("with nothing held there is nothing to let go", () => {
    expect(holdEnded(null, null)).toBe(false);
    expect(holdEnded(null, pick(key()))).toBe(false);
  });
});
