/**
 * Everything the server and the client need to know about each escape room's SPACE, keyed by
 * room id: collision geometry, object anchors, flag-to-node bindings, spawn, label and model
 * path. (The puzzles themselves are server-only data and live elsewhere.) Phase 1 has the
 * counselling room only; a room without an entry here cannot be entered.
 */

import { ROOM_LABELS } from "../escape/constants";
import type { RoomId } from "../escape/constants";
import { COUNSEL_ANCHORS, COUNSEL_GEOMETRY, COUNSEL_SPAWN, COUNSEL_SPAWN_JITTER, COUNSEL_VISUALS } from "./counselMap";
import type { ObjectAnchor, VisualBinding } from "./counselMap";
import type { MapGeometry } from "./geometry";

export interface RoomMap {
  geometry: MapGeometry;
  anchors: readonly ObjectAnchor[];
  visuals: readonly VisualBinding[];
  spawn: { x: number; z: number };
  spawnJitter: number;
  /** Korean display name ("상담실"). */
  label: string;
  /** Public URL of the room model. */
  glb: string;
}

export const ROOM_MAPS: Partial<Record<RoomId, RoomMap>> = {
  counsel: {
    geometry: COUNSEL_GEOMETRY,
    anchors: COUNSEL_ANCHORS,
    visuals: COUNSEL_VISUALS,
    spawn: COUNSEL_SPAWN,
    spawnJitter: COUNSEL_SPAWN_JITTER,
    label: ROOM_LABELS.counsel,
    glb: "/models/school/counsel.glb",
  },
};
