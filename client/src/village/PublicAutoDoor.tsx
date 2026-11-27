import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type ShaderMaterial } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CLOSED_AUTO_DOOR, PUBLIC_AUTO_DOOR, stepAutoDoor, type AutoDoorState } from "@caysonverse/shared/village/autoDoor";
import { VILLAGE_LAYOUT, type AreaId } from "@caysonverse/shared/village/villageLayout";
import type { Pose } from "../game/types";
import { forEachRemotePosition } from "../game/remoteStore";
import { doorObservation, stepShownOpening } from "./publicAutoDoorModel";
import { hallDoor } from "./hallDoor";
import { HALL_LEAF_MOUNT_Z, HALL_LEAF_SLIDE_M, entranceRig, hallDoorRig, type Box, type DoorRig } from "./autoDoorParts";
import { applyClearGlassDayNight, clearGlassMaterial } from "./portal/clearGlass";
import { dayNight } from "./dayNightDriver";

export { HALL_LEAF_SLIDE_M };

/**
 * The public auto doors (the memorial's entrance in the village, the hall's door inside), slid by the shared proximity state
 * machine while `UseDoor` stays the validated teleport. Where the parts are, and why there, is autoDoorParts.ts (owner
 * 2026-11-17: the hall's leaves slid across the tea corner and the hall map; doorClearance.test.ts sweeps every leaf).
 *
 *  - Inside the hall the model has its own glass leaves (`door__leaf_l` / `door__leaf_r`, hallDoor.ts): they are hung on the
 *    wall's outer face (`HALL_LEAF_MOUNT_Z`) and slide behind the wall; this adds the operator header and the sill track there.
 *  - In the village it is a whole storefront door across the memorial porch's mouth: two fixed glass side-lights, two
 *    bi-parting leaves running behind them, the operator header with its sensor, the floor track. Thin anodised aluminium,
 *    clear glass with a Fresnel sheen and a frosted safety band.
 *
 * Every avatar in the area (not only the local one) holds the door open, and the shown opening turns round where it is when
 * someone steps in while it closes, so a leaf never closes through anyone.
 */

/** Test hook (e2e/door-clearance.mjs): a number 0..1 holds every auto door at that opening; null runs the live state machine. */
export const autoDoorHold: { amount: number | null } = { amount: null };

const DOORWAY_M = 1.15;

export function PublicAutoDoor({ area, pose }: { area: AreaId; pose: Pose }) {
  const state = useRef<AutoDoorState>({ ...CLOSED_AUTO_DOOR });
  const shown = useRef(0);
  const lastMs = useRef<number | null>(null);
  const leafRefs = useRef<(Group | null)[]>([]);
  const sensor = useRef<Mesh>(null);
  const hall = area === "hall";
  const pad = hall ? VILLAGE_LAYOUT.memorial.interior.doorPad : VILLAGE_LAYOUT.memorial.exterior.doorPad;
  const rig = useMemo<DoorRig>(() => (hall ? hallDoorRig() : entranceRig()), [hall]);
  const mats = useDoorMaterials(hall);
  const boxes = useMemo(() => {
    if (hall) return null;
    const part = (name: string) => rig.parts.find((p) => p.name === name)!.box;
    return { leaves: rig.leaves.map((leaf, i) => panelBoxes(leaf.closed, i === 0 ? "max" : "min")), fixed: staticBoxes(part("header"), part("sensor"), part), sensor: part("sensor") };
  }, [hall, rig]);

  useFrame(({ clock }) => {
    applyClearGlassDayNight(dayNight.outdoor);
    const nowMs = clock.elapsedTime * 1000;
    const others: { x: number; z: number }[] = [];
    forEachRemotePosition((x, z, connected) => {
      if (connected) others.push({ x, z });
    });
    state.current = stepAutoDoor(
      state.current,
      nowMs,
      doorObservation(pad.centre, pose, others, DOORWAY_M),
      { ...PUBLIC_AUTO_DOOR, approachRadiusM: Math.max(PUBLIC_AUTO_DOOR.approachRadiusM, pad.radius + 0.75) },
    );
    const dt = lastMs.current === null ? 0 : nowMs - lastMs.current;
    lastMs.current = nowMs;
    shown.current = stepShownOpening(shown.current, state.current, dt, PUBLIC_AUTO_DOOR);
    const amount = autoDoorHold.amount ?? shown.current;
    if (hall) {
      const model = hallDoor.leaves;
      if (!model) return;
      // the model's leaves are authored closed on the room's face: hung on the outer face, each slides toward its own side
      model.left.position.set(-amount * HALL_LEAF_SLIDE_M, 0, HALL_LEAF_MOUNT_Z);
      model.right.position.set(amount * HALL_LEAF_SLIDE_M, 0, HALL_LEAF_MOUNT_Z);
      return;
    }
    rig.leaves.forEach((leaf, i) => {
      const g = leafRefs.current[i];
      if (g) g.position.x = amount * leaf.slideX;
    });
    if (sensor.current) (sensor.current.material as MeshStandardMaterial).emissiveIntensity = state.current.phase === "closed" ? 0.25 : 1.6;
  });

  if (hall) {
    return (
      <group name="public_auto_door__hall">
        {rig.parts.map((p) => (
          <BoxMesh key={p.name} name={`auto_door__${p.name}`} b={p.box} material={mats.alu} />
        ))}
      </group>
    );
  }
  const { leaves, fixed, sensor: sensorBox } = boxes!;
  return (
    <group name="public_auto_door__village">
      {rig.leaves.map((leaf, i) => (
        <group key={leaf.name} name={leaf.name} ref={(g) => void (leafRefs.current[i] = g)}>
          <MergedBoxes boxes={leaves[i]!} mats={mats} />
        </group>
      ))}
      {/* the fixed parts (side-lights, the operator header and its end caps, the sensor, the floor track): one mesh per material */}
      <MergedBoxes boxes={fixed} mats={mats} />
      <mesh ref={sensor} name="auto_door__status_light" position={[sensorBox.max[0] - 0.035, (sensorBox.min[1] + sensorBox.max[1]) / 2, sensorBox.max[2] + 0.004]}>
        <sphereGeometry args={[0.009, 10, 6]} />
        <meshStandardMaterial color="#9dffcf" emissive="#38e08e" emissiveIntensity={0.25} toneMapped={false} />
      </mesh>
    </group>
  );
}

type DoorMats = ReturnType<typeof useDoorMaterials>;
type MatKey = "alu" | "cap" | "seal" | "lens" | "band" | "glass";
interface KeyedBox {
  b: Box;
  m: MatKey;
}

/** The fixed parts' boxes: both side-lights' panels, the header with its shadow line and end caps, the sensor with its lens, the track and its guide channel. */
function staticBoxes(header: Box, sensorBox: Box, part: (name: string) => Box): KeyedBox[] {
  const track = part("track");
  return [
    ...panelBoxes(part("side_light_l")),
    ...panelBoxes(part("side_light_r")),
    { b: header, m: "alu" },
    // the cover's shadow line and its end caps: an extruded housing, not a plain block
    { b: { min: [header.min[0] + 0.02, header.min[1] + 0.2, header.max[2]], max: [header.max[0] - 0.02, header.min[1] + 0.208, header.max[2] + 0.002] }, m: "seal" },
    { b: { min: [header.min[0], header.min[1], header.min[2]], max: [header.min[0] + 0.012, header.max[1], header.max[2] + 0.004] }, m: "cap" },
    { b: { min: [header.max[0] - 0.012, header.min[1], header.min[2]], max: [header.max[0], header.max[1], header.max[2] + 0.004] }, m: "cap" },
    { b: sensorBox, m: "seal" },
    // its lens (the status light is its own mesh: its glow changes)
    { b: { min: [sensorBox.min[0] + 0.03, sensorBox.min[1] + 0.012, sensorBox.max[2]], max: [sensorBox.max[0] - 0.07, sensorBox.max[1] - 0.012, sensorBox.max[2] + 0.004] }, m: "lens" },
    { b: track, m: "cap" },
    // the guide channel the leaves' shoes run in
    { b: { min: [track.min[0], track.max[1], -52.215], max: [track.max[0], track.max[1] + 0.001, -52.195] }, m: "seal" },
  ];
}

/** Boxes merged into one mesh per material (perf/phone-village: the door was 43 draws for ~600 triangles). */
function MergedBoxes({ boxes, mats }: { boxes: KeyedBox[]; mats: DoorMats }) {
  const geos = useMemo(() => {
    const by = new Map<MatKey, BoxGeometry[]>();
    for (const { b, m } of boxes) {
      const g = new BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      (by.get(m) ?? by.set(m, []).get(m)!).push(g);
    }
    return [...by].map(([m, list]) => ({ m, geo: list.length === 1 ? list[0]! : mergeGeometries(list)! }));
  }, [boxes]);
  useEffect(() => () => geos.forEach(({ geo }) => geo.dispose()), [geos]);
  return (
    <>
      {geos.map(({ m, geo }) => (
        <mesh key={m} geometry={geo} material={mats[m]} castShadow={mats[m] instanceof MeshStandardMaterial} receiveShadow />
      ))}
    </>
  );
}

function BoxMesh({ b, material, name }: { b: Box; material: MeshStandardMaterial | ShaderMaterial; name?: string }) {
  const size: [number, number, number] = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const at: [number, number, number] = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  return (
    <mesh name={name} position={at} material={material} castShadow={material instanceof MeshStandardMaterial} receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  );
}

const STILE = 0.055;
const TOP_RAIL = 0.07;
const BOTTOM_RAIL = 0.11;

/** One aluminium-framed glass panel filling `b` (x wide, y tall, z deep): stiles, rails, the pane in their middle, a frosted band. */
function panelBoxes(b: Box, meetingEdge?: "min" | "max"): KeyedBox[] {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const zc = (z0 + z1) / 2;
  const pane = { x0: x0 + STILE, x1: x1 - STILE, y0: y0 + BOTTOM_RAIL, y1: y1 - TOP_RAIL };
  const out: KeyedBox[] = [
    { b: { min: [x0, y0, z0], max: [x0 + STILE, y1, z1] }, m: "alu" },
    { b: { min: [x1 - STILE, y0, z0], max: [x1, y1, z1] }, m: "alu" },
    { b: { min: [pane.x0, y1 - TOP_RAIL, z0], max: [pane.x1, y1, z1] }, m: "alu" },
    { b: { min: [pane.x0, y0, z0], max: [pane.x1, y0 + BOTTOM_RAIL, z1] }, m: "alu" },
    // the glazing beads either side of the pane
    { b: { min: [pane.x0, pane.y0, z0 + 0.008], max: [pane.x1, pane.y0 + 0.012, z1 - 0.008] }, m: "seal" },
    { b: { min: [pane.x0, pane.y1 - 0.012, z0 + 0.008], max: [pane.x1, pane.y1, z1 - 0.008] }, m: "seal" },
    { b: { min: [pane.x0, pane.y0 + 0.012, zc - 0.005], max: [pane.x1, pane.y1 - 0.012, zc + 0.005] }, m: "glass" },
    // the safety band printed on the glass at eye height (both faces)
    { b: { min: [pane.x0, 1.38, zc - 0.0062], max: [pane.x1, 1.46, zc + 0.0062] }, m: "band" },
  ];
  // the meeting stile's rubber seal
  if (meetingEdge) {
    out.push({
      b: meetingEdge === "max" ? { min: [x1 - 0.004, y0 + 0.02, z0 + 0.012], max: [x1, y1 - 0.02, z1 - 0.012] } : { min: [x0, y0 + 0.02, z0 + 0.012], max: [x0 + 0.004, y1 - 0.02, z1 - 0.012] },
      m: "seal",
    });
  }
  return out;
}

/** The doors' materials: anodised aluminium (the hall's door is white like its leaves), black gaskets, clear glass. */
function useDoorMaterials(hall: boolean) {
  return useMemo(() => {
    const alu = new MeshStandardMaterial({ color: hall ? "#e7e9e8" : "#3b3f45", metalness: 0.65, roughness: 0.34 });
    const cap = new MeshStandardMaterial({ color: hall ? "#d3d6d5" : "#2c3035", metalness: 0.7, roughness: 0.3 });
    const seal = new MeshStandardMaterial({ color: "#16181b", metalness: 0.1, roughness: 0.75 });
    const lens = new MeshStandardMaterial({ color: "#0b0d10", metalness: 0.4, roughness: 0.12 });
    const band = new MeshStandardMaterial({ color: "#eef2f2", roughness: 0.85, transparent: true, opacity: 0.4, depthWrite: false });
    // clear glass (owner 2026-11-21: "모든 유리창을 투명하게"; the old pane's sliding diagonal sheen read as a whitish streaked sheet in
    // front of the hall): the village's clear glass, always clear (the hall is drawn behind it, portal/MemorialShowcase.tsx)
    const clear = clearGlassMaterial("M_door_glass");
    clear.setShown([[-1e5, -1e5, 1e5, 1e5]]);
    return { alu, cap, seal, lens, band, glass: clear.material };
  }, [hall]);
}

