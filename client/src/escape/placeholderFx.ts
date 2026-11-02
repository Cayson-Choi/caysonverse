/**
 * How the placeholder classroom (RoomPlaceholder) imitates the room model's moving parts, as pure
 * data: which anchor a visual binding sits on, where in the stack above it, and what a set flag
 * does to it (hide / show / open by an angle / glow). The real counsel.glb replaces all of this
 * with its `obj__*` nodes (Task 24); the bindings themselves (COUNSEL_VISUALS) are the contract.
 */

import type { VisualBinding } from "@caysonverse/shared/school/counselMap";

/** Node name prefix every bound node of the room model carries. */
const NODE_PREFIX = "obj__";

/**
 * The nodes that are a PART of a bigger piece and so sit on that piece's anchor (a node named after
 * an anchor needs no entry).
 */
export const NODE_ANCHOR: Readonly<Record<string, string>> = {
  uv_film: "note_box",
  cabinet_door: "cabinet",
  sort_cards: "cabinet",
  board_cover: "sort_board",
  board_cards: "sort_board",
  safe_door: "safe",
  screen_ari: "counsel_screen",
};

/** The anchor id a bound node sits on, or null for a node that is not `obj__…` or has no anchor. */
export function anchorForNode(node: string, anchorIds: ReadonlySet<string>): string | null {
  if (!node.startsWith(NODE_PREFIX)) return null;
  const name = node.slice(NODE_PREFIX.length);
  const mapped = Object.prototype.hasOwnProperty.call(NODE_ANCHOR, name) ? NODE_ANCHOR[name] : name;
  return mapped !== undefined && anchorIds.has(mapped) ? mapped : null;
}

export interface MarkerSlot {
  binding: VisualBinding;
  anchorId: string;
  /** 0 = the first marker above the anchor's pillar, 1 = the next one up … */
  slot: number;
}

/** Every binding with its anchor and its place in that anchor's stack (bindings without an anchor are left out). */
export function markerSlots(bindings: readonly VisualBinding[], anchorIds: ReadonlySet<string>): MarkerSlot[] {
  const used = new Map<string, number>();
  const out: MarkerSlot[] = [];
  for (const binding of bindings) {
    const anchorId = anchorForNode(binding.node, anchorIds);
    if (anchorId === null) continue;
    const slot = used.get(anchorId) ?? 0;
    used.set(anchorId, slot + 1);
    out.push({ binding, anchorId, slot });
  }
  return out;
}

export interface NodeFx {
  visible: boolean;
  /** Radians the part has swung about its hinge (0 = closed). */
  open: number;
  glow: boolean;
}

/** What `binding` looks like given the team's flags. */
export function bindingFx(binding: VisualBinding, flags: ReadonlySet<string>): NodeFx {
  const on = flags.has(binding.flag);
  switch (binding.effect) {
    case "hide":
      return { visible: !on, open: 0, glow: false };
    case "show":
      return { visible: on, open: 0, glow: false };
    case "open":
      return { visible: true, open: on ? (binding.angle ?? 0) : 0, glow: false };
    case "glow":
      return { visible: true, open: 0, glow: on };
  }
}
