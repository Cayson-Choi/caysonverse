import { describe, expect, it } from "vitest";
import { INSPECT_REACH } from "@caysonverse/shared/escape/constants";
import type { ObjectKind, RoomContent } from "@caysonverse/shared/escape/messages";
import { COUNSEL_ANCHORS, COUNSEL_VISUALS, type ObjectAnchor, type VisualBinding } from "@caysonverse/shared/school/counselMap";
import { escapeActionsLive, escapeTargets, objectKindOf } from "./escapeTargets";

const OBJECTS: { id: string; label: string; kind: ObjectKind }[] = [
  { id: "counsel_screen", label: "상담 화면", kind: "screen" },
  { id: "note_box", label: "쪽지 상자", kind: "inspect" },
  { id: "flashlight", label: "손전등", kind: "inspect" },
  { id: "cabinet", label: "캐비닛", kind: "inspect" },
  { id: "safe_key_left", label: "서쪽 열쇠", kind: "switch" },
  { id: "safe_key_right", label: "동쪽 열쇠", kind: "switch" },
  { id: "exit_door", label: "마지막 문", kind: "door" },
  { id: "note_1", label: "쪽지 1", kind: "inspect" },
];

function content(objects = OBJECTS): RoomContent {
  return { roomId: "counsel", title: "상담실", objects, items: [], locks: [], stages: [], lines: {}, introLines: [], finale: { claim: "", steps: [] } };
}

const near = (x: number, z: number, flags: string[] = [], solo = false, c = content()) =>
  escapeTargets(x, z, COUNSEL_ANCHORS, c, flags, COUNSEL_VISUALS, solo);
const ids = (ts: { id: string }[]) => ts.map((t) => t.id).sort();

describe("escapeTargets", () => {
  it("escapeTargets: only anchors in reach; picked objects hidden; switch becomes a 3 s hold when solo", () => {
    // Standing by the east shelf (the flashlight): only the flashlight is within reach.
    expect(ids(near(3.9, -2.0))).toEqual(["flashlight"]);
    // ...and nothing from across the room.
    expect(near(-4.4, -4.4)).toEqual([]);

    // Once the flashlight is in the bag its object is gone from the shelf (the `hide` binding).
    expect(near(3.9, -2.0, ["picked:flashlight"])).toEqual([]);

    // The west key: two members -> "열쇠 돌리기" (a tap), alone -> a 3 s hold.
    const [pair] = near(-4.6, 0, [], false).filter((t) => t.id === "safe_key_left");
    expect(pair).toMatchObject({ kind: "object", icon: "🔑", label: "열쇠 돌리기" });
    expect(pair.hold).toBeUndefined();
    const [alone] = near(-4.6, 0, [], true).filter((t) => t.id === "safe_key_left");
    expect(alone).toMatchObject({ kind: "object", icon: "🔑", label: "3초 길게 누르기", hold: true });
  });

  it("icons and labels by kind: inspect 🔍, screen 📺, door 🚪, switch 🔑", () => {
    expect(near(3.9, -2.0)[0]).toMatchObject({ id: "flashlight", icon: "🔍", label: "조사하기" });
    expect(near(0, -3.0)[0]).toMatchObject({ id: "counsel_screen", icon: "📺", label: "화면 보기" });
    expect(near(0, 3.6)[0]).toMatchObject({ id: "exit_door", icon: "🚪", label: "마지막 문" });
    // The touch button has a short word for each.
    for (const t of [...near(3.9, -2.0), ...near(0, -3.0), ...near(0, 3.6), ...near(-4.6, 0, [], true)]) {
      expect(t.short, t.id).toBeTruthy();
      expect(t.short!.length, t.id).toBeLessThanOrEqual(5);
    }
  });

  it("reports the distance to each target, and takes everything in reach (the button picks the nearest)", () => {
    // By the west wall: the key switch at (-5, 0) and note 1 at (-4, 1) are both close.
    const ts = near(-4.4, 0);
    expect(ids(ts)).toEqual(["note_1", "safe_key_left"]);
    const key = ts.find((t) => t.id === "safe_key_left")!;
    expect(key.dist).toBeCloseTo(0.6, 6);
    expect(ts.find((t) => t.id === "note_1")!.dist).toBeCloseTo(Math.hypot(0.4, 1), 6);
  });

  it("the reach edge is inclusive (the server's rule: distance squared <= reach squared)", () => {
    const anchors: ObjectAnchor[] = [{ id: "flashlight", x: 0, z: 0, y: 1 }];
    const at = (z: number) => escapeTargets(0, z, anchors, content(), [], [], false).map((t) => t.id);
    expect(at(INSPECT_REACH)).toEqual(["flashlight"]);
    expect(at(INSPECT_REACH + 0.01)).toEqual([]);
    expect(at(-INSPECT_REACH)).toEqual(["flashlight"]);
  });

  it("an anchor's own reach overrides the default", () => {
    const anchors: ObjectAnchor[] = [
      { id: "flashlight", x: 0, z: 0, y: 1, reach: 5 },
      { id: "cabinet", x: 10, z: 0, y: 1, reach: 0.5 },
    ];
    const at = (x: number) => escapeTargets(x, 0, anchors, content(), [], [], false).map((t) => t.id);
    expect(at(4.5)).toEqual(["flashlight"]); // 4.5 m is out of the default 2.2 but inside its own 5
    expect(at(5.1)).toEqual([]);
    expect(at(9.7)).toEqual(["cabinet"]); // 0.3 m <= 0.5
    expect(at(9.4)).toEqual([]); // 0.6 m > 0.5
  });

  it("an anchor with no object in the room's content offers nothing", () => {
    const only = content([{ id: "flashlight", label: "손전등", kind: "inspect" }]);
    expect(near(-4.6, 0, [], false, only)).toEqual([]);
    expect(near(3.9, -2.0, [], false, only).map((t) => t.id)).toEqual(["flashlight"]);
    expect(near(3.9, -2.0, [], false, content([]))).toEqual([]);
  });

  it("only a `hide` binding named after the object hides it: a taken PART leaves the whole piece usable", () => {
    // uv_film is a part of the note box; sort_cards is a part of the cabinet. Taking them hides the part, not the piece.
    expect(near(0, 0.9, ["picked:uv_film"]).map((t) => t.id)).toContain("note_box");
    expect(near(-4.4, 2.5, ["picked:sort_cards", "picked:uv_film"]).map((t) => t.id)).toContain("cabinet");
    // `open` / `glow` / `show` bindings never hide anything.
    const others: VisualBinding[] = [
      { node: "obj__cabinet", flag: "x", effect: "open", angle: 1 },
      { node: "obj__cabinet", flag: "x", effect: "glow" },
      { node: "obj__cabinet", flag: "x", effect: "show" },
    ];
    expect(escapeTargets(-4.4, 2.5, COUNSEL_ANCHORS, content(), ["x"], others, false).map((t) => t.id)).toContain("cabinet");
    // ...while a `hide` binding for it, with its flag on, does.
    const hide: VisualBinding[] = [{ node: "obj__cabinet", flag: "x", effect: "hide" }];
    expect(escapeTargets(-4.4, 2.5, COUNSEL_ANCHORS, content(), ["x"], hide, false).map((t) => t.id)).not.toContain("cabinet");
    expect(escapeTargets(-4.4, 2.5, COUNSEL_ANCHORS, content(), [], hide, false).map((t) => t.id)).toContain("cabinet");
    // A node that merely STARTS with the id (obj__cabinet_door, a part of the cabinet) is a different node, too.
    const part: VisualBinding[] = [{ node: "obj__cabinet_door", flag: "x", effect: "hide" }];
    expect(escapeTargets(-4.4, 2.5, COUNSEL_ANCHORS, content(), ["x"], part, false).map((t) => t.id)).toContain("cabinet");
    // A node that merely ENDS with the id (obj__x_cabinet) is a different node.
    const lookalike: VisualBinding[] = [{ node: "obj__x_cabinet", flag: "x", effect: "hide" }];
    expect(escapeTargets(-4.4, 2.5, COUNSEL_ANCHORS, content(), ["x"], lookalike, false).map((t) => t.id)).toContain("cabinet");
  });

  it("a shared empty list when nothing is in reach (no allocation on the common path)", () => {
    expect(near(-4.4, -4.4)).toBe(near(2.6, 2.7));
  });
});

describe("objectKindOf", () => {
  it("is the kind the room's content gave the object, or null", () => {
    const c = content();
    expect(objectKindOf(c, "safe_key_left")).toBe("switch");
    expect(objectKindOf(c, "exit_door")).toBe("door");
    expect(objectKindOf(c, "note_1")).toBe("inspect");
    expect(objectKindOf(c, "nothing")).toBeNull();
    expect(objectKindOf(null, "exit_door")).toBeNull();
  });
});

describe("escapeActionsLive", () => {
  it("objects can be used while the game is on (play, finale) and not paused — the server's rule", () => {
    expect(escapeActionsLive({ phase: "play", paused: false })).toBe(true);
    expect(escapeActionsLive({ phase: "finale", paused: false })).toBe(true);
    expect(escapeActionsLive({ phase: "play", paused: true })).toBe(false);
    for (const phase of ["intro", "timeup", "escaped", "ended"] as const)
      expect(escapeActionsLive({ phase, paused: false }), phase).toBe(false);
  });
});
