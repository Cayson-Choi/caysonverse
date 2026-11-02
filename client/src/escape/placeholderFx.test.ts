import { describe, it, expect } from "vitest";
import { COUNSEL_ANCHORS, COUNSEL_VISUALS } from "@caysonverse/shared/school/counselMap";
import { anchorForNode, bindingFx, markerSlots } from "./placeholderFx";

const ANCHOR_IDS: ReadonlySet<string> = new Set(COUNSEL_ANCHORS.map((a) => a.id));
const byNode = (node: string) => {
  const b = COUNSEL_VISUALS.find((v) => v.node === node);
  if (!b) throw new Error(`no binding ${node}`);
  return b;
};

describe("bindingFx", () => {
  it("a hide node is there until its flag is set", () => {
    const b = byNode("obj__flashlight");
    expect(bindingFx(b, new Set()).visible).toBe(true);
    expect(bindingFx(b, new Set(["picked:flashlight"])).visible).toBe(false);
  });

  it("a show node appears when its flag is set", () => {
    const b = { node: "obj__x", flag: "f", effect: "show" as const };
    expect(bindingFx(b, new Set()).visible).toBe(false);
    expect(bindingFx(b, new Set(["f"])).visible).toBe(true);
  });

  it("an open node swings by its angle when its flag is set, and stays visible", () => {
    const b = byNode("obj__cabinet_door");
    expect(bindingFx(b, new Set())).toMatchObject({ visible: true, open: 0, glow: false });
    expect(bindingFx(b, new Set(["solved:cabinet_lock"]))).toMatchObject({ visible: true, open: -1.75 });
  });

  it("a glow node lights when its flag is set", () => {
    const b = byNode("obj__screen_ari");
    expect(bindingFx(b, new Set()).glow).toBe(false);
    expect(bindingFx(b, new Set(["finale_ready"])).glow).toBe(true);
  });

  it("another flag changes nothing", () => {
    const b = byNode("obj__safe_door");
    expect(bindingFx(b, new Set(["solved:cabinet_lock"])).open).toBe(0);
  });
});

describe("anchorForNode", () => {
  it("a node named after an anchor sits on it", () => {
    expect(anchorForNode("obj__flashlight", ANCHOR_IDS)).toBe("flashlight");
    expect(anchorForNode("obj__exit_door", ANCHOR_IDS)).toBe("exit_door");
  });

  it("the nodes that belong to a bigger piece sit on that piece's anchor", () => {
    expect(anchorForNode("obj__cabinet_door", ANCHOR_IDS)).toBe("cabinet");
    expect(anchorForNode("obj__safe_door", ANCHOR_IDS)).toBe("safe");
    expect(anchorForNode("obj__screen_ari", ANCHOR_IDS)).toBe("counsel_screen");
    expect(anchorForNode("obj__uv_film", ANCHOR_IDS)).toBe("note_box");
  });

  it("every counsel visual finds an anchor (the table cannot drift from the room)", () => {
    for (const v of COUNSEL_VISUALS) expect(anchorForNode(v.node, ANCHOR_IDS), v.node).not.toBeNull();
  });

  it("a name that is not obj__ or not known has no anchor", () => {
    expect(anchorForNode("flashlight", ANCHOR_IDS)).toBeNull();
    expect(anchorForNode("obj__nothing", ANCHOR_IDS)).toBeNull();
  });
});

describe("markerSlots", () => {
  it("gives each binding its anchor and a stack slot, so two on one anchor do not overlap", () => {
    const slots = markerSlots(COUNSEL_VISUALS, ANCHOR_IDS);
    expect(slots).toHaveLength(COUNSEL_VISUALS.length);
    const cabinet = slots.filter((s) => s.anchorId === "cabinet");
    expect(cabinet.map((s) => s.binding.node)).toEqual(["obj__cabinet_door", "obj__sort_cards"]);
    expect(cabinet.map((s) => s.slot)).toEqual([0, 1]);
    const board = slots.filter((s) => s.anchorId === "sort_board");
    expect(board.map((s) => s.slot)).toEqual([0, 1]);
    // A lone binding sits in slot 0.
    expect(slots.find((s) => s.binding.node === "obj__flashlight")?.slot).toBe(0);
  });

  it("leaves out a binding whose anchor is unknown", () => {
    const slots = markerSlots([{ node: "obj__ghost", flag: "x", effect: "hide" }], ANCHOR_IDS);
    expect(slots).toEqual([]);
  });
});
