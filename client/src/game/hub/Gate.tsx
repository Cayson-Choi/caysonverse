import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, type Group, type Mesh } from "three";
import { EAST_GATE } from "@caysonverse/shared/school/hubMap";
import { WALL_HEIGHT } from "@caysonverse/shared/worldMap";
import { GATE_OPEN_MS, gateTimeline, type GateFrame } from "./gateTimeline";

/**
 * The east gate between the central hall and the east corridor (AI 학교 탈출, Task 15): eight
 * wall-high bars across the 6 m doorway (EAST_GATE) standing on a glowing threshold strip. Shut
 * while the class waits; from the moment it starts (`open` turns true) the bars sink into the
 * threshold over GATE_OPEN_MS while a band of light sweeps across the doorway (gateTimeline.ts)
 * and the threshold flashes, then keeps a soft glow. Nothing is left ABOVE an open doorway: the
 * open map has no gate box, so the follow camera passes through the doorway at head height and
 * above, where a lintel would fill the screen. A gate
 * that is already open when the hall appears (joined mid-class, back from a classroom, a
 * reconnect) just stands open; when the class ends it shuts again at once.
 *
 * The collision truth is the active map (hubGeometry(open)), switched by the scene at the same
 * moment — this component only draws. Per frame it writes a few numbers into refs and a reused
 * `GateFrame`; once the opening is over it does nothing at all.
 */

const BAR_COUNT = 8;
/** Bar height (m): wall-high, like the gate's collision box. */
const GATE_H = WALL_HEIGHT;
const BAR_T = 0.12;
/** The threshold strip on the floor (m): as deep as the gate box, a hair above the floor. */
const SILL_Y = 0.02;
const X = (EAST_GATE.minX + EAST_GATE.maxX) / 2;
const SPAN = EAST_GATE.maxZ - EAST_GATE.minZ;
/** Width (m) of the light band that sweeps across the doorway. */
const BAND_W = 0.9;

const BAR_EMISSIVE_BASE = 0.15;
const BAR_EMISSIVE_GAIN = 1.6;

export function Gate({ open }: { open: boolean }) {
  const barsRef = useRef<Group>(null);
  const bandRef = useRef<Mesh>(null);
  const frame = useRef<GateFrame>({ bars: 1, sweep: 0, glow: 0 }).current;
  // When the opening started (performance.now ms); -Infinity = open since before we mounted.
  const startedAt = useRef(open ? -Infinity : Number.NaN);
  const wasOpen = useRef(open);
  // Done animating for the current state: the frame loop skips all work.
  const settled = useRef(false);

  // One material each for this gate (disposed with it): the bars and the threshold glow together.
  const mats = useRef<{ bar: MeshStandardMaterial; band: MeshBasicMaterial } | null>(null);
  if (mats.current === null) {
    mats.current = {
      bar: new MeshStandardMaterial({
        color: "#3A3F6B",
        emissive: "#9DB8FF",
        emissiveIntensity: BAR_EMISSIVE_BASE,
        metalness: 0.4,
        roughness: 0.45,
      }),
      band: new MeshBasicMaterial({
        color: "#CFE0FF",
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    };
  }
  const { bar, band } = mats.current;
  useEffect(
    () => () => {
      bar.dispose();
      band.dispose();
    },
    [bar, band],
  );

  // The class started (shut → open): run the opening from now. Ended (open → shut): shut at once.
  useEffect(() => {
    if (open && !wasOpen.current) startedAt.current = performance.now();
    if (!open) startedAt.current = Number.NaN;
    wasOpen.current = open;
    settled.current = false;
  }, [open]);

  useFrame(() => {
    if (settled.current) return;
    const bars = barsRef.current;
    const light = bandRef.current;
    if (!bars || !light) return;
    // Open since before this hall appeared: startedAt is -Infinity, so the timeline is at its
    // end (open, settled glow) — no show. Shut, or the opening not stamped yet: -1 (shut).
    const elapsed = open && !Number.isNaN(startedAt.current) ? performance.now() - startedAt.current : -1;
    gateTimeline(elapsed, frame);
    // The bars stand on the threshold: shrinking the group's height sinks them into it.
    bars.visible = frame.bars > 0.001;
    bars.scale.y = Math.max(frame.bars, 0.001);
    bar.emissiveIntensity = BAR_EMISSIVE_BASE + BAR_EMISSIVE_GAIN * frame.glow;
    // The light band crosses the doorway (north → south) and fades in and out on the way.
    const s = frame.sweep;
    light.visible = s > 0 && s < 1;
    light.position.z = EAST_GATE.minZ + s * SPAN;
    band.opacity = 0.85 * Math.sin(Math.PI * s);
    settled.current = !open || elapsed >= GATE_OPEN_MS;
  });

  return (
    <group>
      {/* The threshold strip across the doorway, on the floor. */}
      <mesh position={[X, SILL_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} material={bar} receiveShadow>
        <planeGeometry args={[EAST_GATE.maxX - EAST_GATE.minX, SPAN]} />
      </mesh>
      {/* The bars, standing UP from the threshold (group origin on the floor). */}
      <group ref={barsRef} position={[X, 0, 0]}>
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <mesh
            key={i}
            position={[0, GATE_H / 2, EAST_GATE.minZ + ((i + 0.5) * SPAN) / BAR_COUNT]}
            material={bar}
            castShadow
          >
            <boxGeometry args={[BAR_T, GATE_H, BAR_T]} />
          </mesh>
        ))}
      </group>
      {/* The sweeping band of light (a vertical sheet across the doorway's width). */}
      <mesh ref={bandRef} position={[X, GATE_H / 2, EAST_GATE.minZ]} rotation={[0, Math.PI / 2, 0]} material={band} visible={false}>
        <planeGeometry args={[BAND_W, GATE_H]} />
      </mesh>
    </group>
  );
}
