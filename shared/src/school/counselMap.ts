/**
 * The counselling room (상담실), the phase-1 escape room: a sealed 12 x 10 m box with the
 * puzzle objects' positions (anchors) and the bindings from puzzle flags to scene nodes
 * (visuals). Single source of truth read by the server (is the player close enough to the
 * object?) and the client (what to highlight, which node to hide/open/glow).
 *
 * Browser-safe and data-driven: plain numbers plus the shared collision types. North is -z.
 * The coordinates are the layout contract with the 3D model (counsel.glb): the model is built
 * around these anchors, and its `col__*` boxes arrive through generated/counselColliders.ts.
 */

import type { AABB } from "../collision";
import { COUNSEL_PROP_COLLIDERS } from "./generated/counselColliders";
import { makeGeometry, wallsAround } from "./geometry";
import type { MapGeometry } from "./geometry";

/** The floor of the room; the walls sit just outside it. */
export const COUNSEL_ROOM: AABB = { minX: -6, maxX: 6, minZ: -5, maxZ: 5 };

/** Where a team appears (plus a random offset of up to `COUNSEL_SPAWN_JITTER` m). */
export const COUNSEL_SPAWN = { x: 0, z: 2.8 } as const;
export const COUNSEL_SPAWN_JITTER = 1;

/**
 * A puzzle object's place: ground position (x, z) for the distance check, height `y` for the
 * marker and the camera focus. `reach` overrides the default INSPECT_REACH for this object.
 */
export interface ObjectAnchor {
  id: string;
  x: number;
  z: number;
  y: number;
  reach?: number;
}

export const COUNSEL_ANCHORS: readonly ObjectAnchor[] = [
  { id: "counsel_screen", x: 0, z: -3.6, y: 1.6 }, // 북쪽 벽 상담 화면(아리)
  { id: "note_box", x: 0, z: 0.9, y: 0.6 }, // 가운데 낮은 탁자 위 쪽지 상자
  { id: "flashlight", x: 3.9, z: -2.5, y: 1.2 }, // 동쪽 책장의 손전등
  { id: "cabinet", x: -4.4, z: 2.5, y: 1.0 }, // 서쪽 상담 기록 캐비닛
  { id: "drawer_left", x: -3.5, z: -1.1, y: 0.7 }, // 서쪽 책상 서랍
  { id: "drawer_right", x: 3.9, z: 1.5, y: 0.7 }, // 동쪽 책장 아래 서랍
  { id: "sort_board", x: -2.6, z: -3.8, y: 1.4 }, // 북쪽 벽 분류판
  { id: "safe", x: 3.0, z: -3.8, y: 0.8 }, // 북동쪽 금고
  { id: "safe_key_left", x: -5.0, z: 0, y: 1.1 }, // 서쪽 벽 열쇠 스위치
  { id: "safe_key_right", x: 5.0, z: 0, y: 1.1 }, // 동쪽 벽 열쇠 스위치
  { id: "exit_door", x: 0, z: 4.0, y: 1.2 }, // 남쪽 마지막 문
  // 흩어진 고민 쪽지 8장
  { id: "note_1", x: -4.0, z: 1.0, y: 0.5 },
  { id: "note_2", x: -1.8, z: 3.0, y: 0.5 },
  { id: "note_3", x: 2.0, z: 3.0, y: 0.5 },
  { id: "note_4", x: 4.2, z: -1.0, y: 0.5 },
  { id: "note_5", x: -1.2, z: -0.6, y: 0.5 },
  { id: "note_6", x: 1.4, z: -0.8, y: 0.5 },
  { id: "note_7", x: -3.8, z: -2.6, y: 0.5 },
  { id: "note_8", x: 1.2, z: -3.6, y: 0.5 },
];

/** What a scene node does when its flag turns on. */
export type VisualEffect = "hide" | "show" | "open" | "glow";

/**
 * Ties one node of the room model to one puzzle flag: when `flag` is set the client applies
 * `effect` to the node called `node` ("open" swings it by `angle` radians about its hinge).
 * Node names all start with `obj__` so the model and this table cannot drift apart silently.
 */
export interface VisualBinding {
  node: string;
  flag: string;
  effect: VisualEffect;
  angle?: number;
}

export const COUNSEL_VISUALS: readonly VisualBinding[] = [
  { node: "obj__flashlight", flag: "picked:flashlight", effect: "hide" },
  { node: "obj__uv_film", flag: "picked:uv_film", effect: "hide" },
  { node: "obj__cabinet_door", flag: "solved:cabinet_lock", effect: "open", angle: -1.75 },
  { node: "obj__sort_cards", flag: "picked:sort_cards", effect: "hide" },
  { node: "obj__board_cover", flag: "solved:cover_lock", effect: "open", angle: 1.6 },
  { node: "obj__board_cards", flag: "solved:board_lock", effect: "glow" },
  { node: "obj__safe_door", flag: "safe_open", effect: "open", angle: -1.9 },
  { node: "obj__screen_ari", flag: "finale_ready", effect: "glow" },
  { node: "obj__exit_door", flag: "escaped", effect: "open", angle: 1.6 },
];

/** Walls around the room (no openings: the room is sealed), plus the generated prop boxes. */
export const COUNSEL_GEOMETRY: MapGeometry = makeGeometry(
  "counsel",
  COUNSEL_ROOM,
  wallsAround(COUNSEL_ROOM),
  COUNSEL_PROP_COLLIDERS,
);

const ANCHORS_BY_ID: ReadonlyMap<string, ObjectAnchor> = new Map(COUNSEL_ANCHORS.map((a) => [a.id, a]));

/** The anchor with this id, or undefined. */
export function anchorById(id: string): ObjectAnchor | undefined {
  return ANCHORS_BY_ID.get(id);
}
