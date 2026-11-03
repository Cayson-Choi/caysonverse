import { useEffect, useMemo } from "react";
import { MeshBasicMaterial } from "three";
import {
  VILLAGE_LAYOUT,
  greyboxColliders,
  hallWalls,
  segmentBand,
  type AreaId,
  type Disc,
  type Point2,
  type VillageLayout,
} from "@caysonverse/shared/village/villageLayout";
import { makeGeometry, type MapGeometry } from "@caysonverse/shared/school/geometry";
import { MapBoxes } from "../game/MapBoxes";
import { PlotMarkers } from "./PlotMarkers";

/**
 * The GREYBOX of 케이슨 마을 (Task 4): enough ground and boxes to walk the whole village and the hall before the
 * Blender model (village.glb, Task 7) replaces them. Only the area the local player is in is drawn: the
 * village's ground, ring road, lanes, creek and boxes (and the plots' markers) outside, a plain room inside the
 * memorial hall. Everything is flat colour; the boxes are the colliders (MapBoxes, the same ones the server uses
 * minus the invisible blockers between the two areas, which are never drawn).
 */

const layout: VillageLayout = VILLAGE_LAYOUT;

const COLOUR = {
  grass: "#8FCF7A",
  paving: "#DCD6C8",
  road: "#7A7D86",
  sidewalk: "#C9C3B6",
  lane: "#D6C7A3",
  water: "#6FB8E8",
  bridge: "#9A7B55",
  room: "#E9E1D2",
  ceiling: "#F2ECE0",
  doorPad: "#6D70F0",
} as const;

/** The boxes MapBoxes draws for each area: the village's colliders; the hall's four walls (and nothing else). */
const colliders = greyboxColliders(layout);
const VILLAGE_DRAW: MapGeometry = makeGeometry(
  "village",
  layout.areas.village,
  [],
  colliders.map((c) => c.box),
  colliders.filter((c) => c.camera).map((c) => c.box),
);
const HALL_DRAW: MapGeometry = makeGeometry("village", layout.areas.hall, hallWalls(layout), [], []);

/** A flat rectangle on the ground (a thin box, so shadows land on it), centred at (cx, cz). */
function Flat({
  cx,
  cz,
  sx,
  sz,
  y,
  color,
  rotY = 0,
}: {
  cx: number;
  cz: number;
  sx: number;
  sz: number;
  y: number;
  color: string;
  rotY?: number;
}) {
  return (
    <mesh position={[cx, y, cz]} rotation={[0, rotY, 0]} receiveShadow>
      <boxGeometry args={[sx, 0.02, sz]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}

/** A lane: a polyline `width` wide, one flat strip per stretch. */
function Lane({ points, width }: { points: readonly Point2[]; width: number }) {
  return (
    <>
      {points.slice(1).map((b, i) => {
        const a = points[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        // rotation about Y: a box long along +x turned by -atan2(dz, dx) lies along (dx, dz).
        return (
          <Flat
            key={i}
            cx={(a.x + b.x) / 2}
            cz={(a.z + b.z) / 2}
            sx={len + width * 0.5}
            sz={width}
            y={0.012}
            color={COLOUR.lane}
            rotY={-Math.atan2(b.z - a.z, b.x - a.x)}
          />
        );
      })}
    </>
  );
}

/** A glowing disc where a door is used: the pad (the button shows within it and a little past it). */
function DoorPad({ pad }: { pad: Disc }) {
  const material = useMemo(
    () => new MeshBasicMaterial({ color: COLOUR.doorPad, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, fog: false }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh position={[pad.centre.x, 0.05, pad.centre.z]} rotation-x={-Math.PI / 2} material={material} renderOrder={2}>
      <circleGeometry args={[pad.radius, 40]} />
    </mesh>
  );
}

function VillageGreybox() {
  const { areas, plaza, ringRoad, stream, bridge, lanes } = layout;
  const v = areas.village;
  const gap = stream.bridgeGap;
  // The water: each creek segment's band, on top of the 1 m bank boxes, with the bridge's gap left open.
  const water = stream.segments.flatMap((seg) => {
    const { minZ, maxZ } = segmentBand(stream, seg);
    const cuts: Array<[number, number]> =
      gap.minX >= seg.minX && gap.maxX <= seg.maxX
        ? [
            [seg.minX, gap.minX],
            [gap.maxX, seg.maxX],
          ]
        : [[seg.minX, seg.maxX]];
    return cuts.filter(([a, b]) => b > a).map(([a, b]) => ({ cx: (a + b) / 2, cz: (minZ + maxZ) / 2, sx: b - a, sz: maxZ - minZ }));
  });
  return (
    <group>
      <Flat cx={(v.minX + v.maxX) / 2} cz={(v.minZ + v.maxZ) / 2} sx={v.maxX - v.minX} sz={v.maxZ - v.minZ} y={-0.01} color={COLOUR.grass} />
      <mesh position={[plaza.paving.centre.x, 0.01, plaza.paving.centre.z]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[plaza.paving.radius, 64]} />
        <meshStandardMaterial color={COLOUR.paving} roughness={0.95} />
      </mesh>
      <mesh position={[ringRoad.centre.x, 0.015, ringRoad.centre.z]} rotation-x={-Math.PI / 2} receiveShadow>
        <ringGeometry args={[ringRoad.radius - ringRoad.width / 2, ringRoad.radius + ringRoad.width / 2, 96]} />
        <meshStandardMaterial color={COLOUR.road} roughness={0.95} />
      </mesh>
      <mesh position={[ringRoad.centre.x, 0.015, ringRoad.centre.z]} rotation-x={-Math.PI / 2} receiveShadow>
        <ringGeometry
          args={[ringRoad.radius + ringRoad.width / 2, ringRoad.radius + ringRoad.width / 2 + ringRoad.sidewalk.width, 96]}
        />
        <meshStandardMaterial color={COLOUR.sidewalk} roughness={0.95} />
      </mesh>
      {lanes.map((lane) => (
        <Lane key={lane.id} points={lane.points} width={lane.width} />
      ))}
      {water.map((w, i) => (
        <Flat key={i} cx={w.cx} cz={w.cz} sx={w.sx} sz={w.sz} y={1.02} color={COLOUR.water} />
      ))}
      <Flat
        cx={(bridge.minX + bridge.maxX) / 2}
        cz={(bridge.minZ + bridge.maxZ) / 2}
        sx={bridge.maxX - bridge.minX}
        sz={bridge.maxZ - bridge.minZ}
        y={0.04}
        color={COLOUR.bridge}
      />
      <DoorPad pad={layout.memorial.exterior.doorPad} />
      <MapBoxes geometry={VILLAGE_DRAW} />
      <PlotMarkers />
    </group>
  );
}

function HallRoom() {
  const { room, ceilingHeight } = layout.memorial.interior;
  const cx = (room.minX + room.maxX) / 2;
  const cz = (room.minZ + room.maxZ) / 2;
  return (
    <group>
      <Flat cx={cx} cz={cz} sx={room.maxX - room.minX} sz={room.maxZ - room.minZ} y={-0.01} color={COLOUR.room} />
      <DoorPad pad={layout.memorial.interior.doorPad} />
      <MapBoxes geometry={HALL_DRAW} />
      {/* The ceiling (Task 5): the roof seen from inside. The camera is held under it (indoorCamera.ts), so the
          player never sees the sky or the village through it. A plain slab until Task 9 dresses the room. */}
      <mesh position={[cx, ceilingHeight + 0.05, cz]}>
        <boxGeometry args={[room.maxX - room.minX + 1, 0.1, room.maxZ - room.minZ + 1]} />
        <meshStandardMaterial color={COLOUR.ceiling} emissive={COLOUR.ceiling} emissiveIntensity={0.35} roughness={1} />
      </mesh>
    </group>
  );
}

/** The area's greybox (and, outside, the plots' markers). Nothing of the other area is mounted. */
export function VillageGround({ area }: { area: AreaId }) {
  return area === "hall" ? <HallRoom /> : <VillageGreybox />;
}
