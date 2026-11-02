import { useMemo, useState } from "react";
import { ROOM_MAPS } from "@caysonverse/shared/school/roomMaps";
import type { ObjectKind } from "@caysonverse/shared/escape/messages";
import type { RoomId } from "@caysonverse/shared/escape/constants";
import { MapBoxes, collidersDebugOn } from "../game/MapBoxes";
import { useEscapeStore } from "../stores/escapeStore";
import { bindingFx, markerSlots } from "./placeholderFx";

/**
 * The TEMPORARY classroom (AI 학교 탈출, Task 17) until the room model (counsel.glb, Task 24) arrives:
 * the floor, the walls and props as plain boxes (`MapBoxes`, from the room's collision geometry),
 * a coloured pillar on every object's anchor, and — for each `VisualBinding` of the room — a small
 * marker above its anchor that imitates what the model's node will do when its flag is set: a part
 * that is `hide`n goes away, a `show`n one appears, an `open` one swings on its hinge, a `glow`ing
 * one lights up. The bindings and anchors are the room's real layout contract, so when the model
 * replaces this file nothing else in the scene changes.
 *
 * Flags change a few times per game, so this re-renders on a flag change only (the selector returns a
 * joined string) — never per frame, never for the clock.
 */

const PILLAR_WIDTH = 0.38;
const MARKER_SIZE = 0.3;
const MARKER_GAP = 0.38;
const PANEL = { w: 0.8, h: 0.5, d: 0.08 } as const;

/** A pillar's colour by what the object is (the room's public content says); grey until the content arrives. */
const KIND_COLOR: Record<ObjectKind, string> = {
  inspect: "#6EA8FE",
  switch: "#F29E4C",
  screen: "#8B5CF6",
  door: "#5BBF7A",
};
const NOTE_COLOR = "#F6E7A1";
const UNKNOWN_COLOR = "#B8B2C8";

/** A marker's colour by effect: dim until its flag, bright after. */
const EFFECT_COLOR = { hide: "#FFB84D", show: "#7BD88F", open: "#B08A5E", glow: "#9AA3FF" } as const;
const GLOW_COLOR = "#FFF27A";

const GROUND = { margin: 40, color: "#D9D2C6" } as const;
const FLOOR_COLOR = "#E8D5B5";

export function RoomPlaceholder({ roomId }: { roomId: RoomId }) {
  const map = ROOM_MAPS[roomId];
  // One string for all flags: a new flag array every second (the clock) must not re-render this.
  const flagKey = useEscapeStore((s) => (s.view ? s.view.flags.join("|") : ""));
  const content = useEscapeStore((s) => s.content);
  const [debugColliders] = useState(() => collidersDebugOn());

  const flags = useMemo(() => new Set(flagKey === "" ? [] : flagKey.split("|")), [flagKey]);
  const kinds = useMemo(() => {
    const m = new Map<string, ObjectKind>();
    for (const o of content?.objects ?? []) m.set(o.id, o.kind);
    return m;
  }, [content]);
  const anchorIds = useMemo(() => new Set((map?.anchors ?? []).map((a) => a.id)), [map]);
  const slots = useMemo(() => (map ? markerSlots(map.visuals, anchorIds) : []), [map, anchorIds]);

  if (!map) return null;
  const b = map.geometry.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const anchorById = new Map(map.anchors.map((a) => [a.id, a]));

  return (
    <group>
      {/* the ground around the building, so the camera never sees the void */}
      <mesh position={[cx, -0.02, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[b.maxX - b.minX + 2 * GROUND.margin, b.maxZ - b.minZ + 2 * GROUND.margin]} />
        <meshStandardMaterial color={GROUND.color} roughness={0.95} />
      </mesh>
      {/* the floor */}
      <mesh position={[cx, 0, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[b.maxX - b.minX, b.maxZ - b.minZ]} />
        <meshStandardMaterial color={FLOOR_COLOR} roughness={0.9} />
      </mesh>
      <MapBoxes geometry={map.geometry} />
      {debugColliders && <MapBoxes geometry={map.geometry} variant="wire" />}

      {map.anchors.map((a) => {
        const kind = kinds.get(a.id);
        const isNote = a.id.startsWith("note_");
        const color = isNote ? NOTE_COLOR : kind ? KIND_COLOR[kind] : UNKNOWN_COLOR;
        const h = Math.max(a.y, 0.3);
        return (
          <mesh key={a.id} position={[a.x, h / 2, a.z]} castShadow receiveShadow>
            <boxGeometry args={[PILLAR_WIDTH, h, PILLAR_WIDTH]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
        );
      })}

      {slots.map(({ binding, anchorId, slot }) => {
        const a = anchorById.get(anchorId);
        if (!a) return null;
        const fx = bindingFx(binding, flags);
        if (!fx.visible) return null;
        const y = Math.max(a.y, 0.3) + MARKER_SIZE / 2 + 0.05 + slot * MARKER_GAP;
        if (binding.effect === "open") {
          // A door-like panel: it swings on a hinge at its left edge.
          return (
            <group key={binding.node} position={[a.x - PANEL.w / 2, y, a.z]} rotation={[0, fx.open, 0]}>
              <mesh position={[PANEL.w / 2, 0, 0]} castShadow>
                <boxGeometry args={[PANEL.w, PANEL.h, PANEL.d]} />
                <meshStandardMaterial color={EFFECT_COLOR.open} roughness={0.75} />
              </mesh>
            </group>
          );
        }
        return (
          <mesh key={binding.node} position={[a.x, y, a.z]} castShadow>
            <boxGeometry args={[MARKER_SIZE, MARKER_SIZE, MARKER_SIZE]} />
            <meshStandardMaterial
              color={fx.glow ? GLOW_COLOR : EFFECT_COLOR[binding.effect]}
              emissive={fx.glow ? GLOW_COLOR : "#000000"}
              emissiveIntensity={fx.glow ? 0.9 : 0}
              roughness={0.6}
            />
          </mesh>
        );
      })}
    </group>
  );
}
