import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide, MeshBasicMaterial, type Mesh } from "three";
import { EAST_GATE } from "@caysonverse/shared/school/hubMap";
import { WALL_HEIGHT } from "@caysonverse/shared/worldMap";
import { GATE_OPEN_MS, gateTimeline, type GateFrame } from "./gateTimeline";
import { useHubNodes } from "./HubModel";

/**
 * The east gate between the central hall and the east corridor (AI 학교 탈출, Task 15, driven from the model in
 * Task 23): the glowing bars and rails of hub.glb's `gate__east` across the 6 m doorway (EAST_GATE). Shut while the
 * class waits; from the moment it starts (`open` turns true) the bars sink into the floor over GATE_OPEN_MS while a
 * band of light sweeps across the doorway (gateTimeline.ts) and the metal flashes, then a soft glow stays on the
 * threshold. Nothing is left ABOVE an open doorway: the open map has no gate box, so the follow camera passes
 * through the doorway at head height and above, where a lintel would fill the screen — the whole `gate__east`
 * group (bars AND rails) sinks and is hidden. A gate that is already open when the hall appears (joined mid-class,
 * back from a classroom, a reconnect) just stands open; when the class ends it shuts again at once.
 *
 * The collision truth is the active map (hubGeometry(open)), switched by the scene at the same moment — this
 * component only draws. The model's group has its origin on the floor, so scaling its Y sinks the bars into it.
 * Per frame it writes a few numbers into the group, one material and a reused `GateFrame`; once the opening is
 * over it does nothing at all.
 */

/** Bar height (m): wall-high, like the gate's collision box. */
const GATE_H = WALL_HEIGHT;
const X = (EAST_GATE.minX + EAST_GATE.maxX) / 2;
const SPAN = EAST_GATE.maxZ - EAST_GATE.minZ;
/** Width (m) of the light band that sweeps across the doorway. */
const BAND_W = 0.9;
/** The glow strip on the threshold: it stays (at the timeline's OPEN_GLOW share) once the gate is open. */
const STRIP_Y = 0.025;
const STRIP_OPACITY = 0.55;
/** How much brighter than the model's own colour the bars and rails flash (1 + GAIN at the peak). */
const BAR_GLOW_GAIN = 0.9;

export function Gate({ open }: { open: boolean }) {
  const { gate } = useHubNodes();
  const bandRef = useRef<Mesh>(null);
  const frame = useRef<GateFrame>({ bars: 1, sweep: 0, glow: 0 }).current;
  // When the opening started (performance.now ms); -Infinity = open since before we mounted.
  const startedAt = useRef(open ? -Infinity : Number.NaN);
  const wasOpen = useRef(open);
  // Done animating for the current state: the frame loop skips all work.
  const settled = useRef(false);

  // The light band and the threshold glow (one material each, released with this gate).
  const fx = useMemo(() => {
    const additive = (color: string, fog: boolean): MeshBasicMaterial =>
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog,
      });
    return { band: additive("#CFE0FF", false), strip: additive("#BFD4FF", false) };
  }, []);
  useEffect(
    () => () => {
      fx.band.dispose();
      fx.strip.dispose();
    },
    [fx],
  );

  /** Put the gate where the timeline says it is `elapsed` ms after the start (-1 = shut). */
  const paint = (elapsed: number): void => {
    gateTimeline(elapsed, frame);
    if (gate) {
      // The bars stand on the floor: shrinking the group's height sinks them (and the rails) into it.
      gate.group.visible = frame.bars > 0.001;
      gate.group.scale.y = Math.max(frame.bars, 0.001);
      gate.material.color.setScalar(1 + BAR_GLOW_GAIN * frame.glow);
    }
    // The light band crosses the doorway (north → south) and fades in and out on the way.
    const light = bandRef.current;
    const s = frame.sweep;
    if (light) {
      light.visible = s > 0 && s < 1;
      light.position.z = EAST_GATE.minZ + s * SPAN;
    }
    fx.band.opacity = 0.85 * Math.sin(Math.PI * s);
    fx.strip.opacity = STRIP_OPACITY * frame.glow;
  };
  const elapsedNow = (): number => (open && !Number.isNaN(startedAt.current) ? performance.now() - startedAt.current : -1);

  // The class started (shut → open): run the opening from now. Ended (open → shut): shut at once.
  useLayoutEffect(() => {
    if (open && !wasOpen.current) startedAt.current = performance.now();
    if (!open) startedAt.current = Number.NaN;
    wasOpen.current = open;
    settled.current = false;
    // Open since before this hall appeared: startedAt is -Infinity, so the timeline is at its end (open, settled
    // glow) — no show. Painted here, before the first frame, so a shut or open gate never flashes the other state.
    paint(elapsedNow());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gate]);

  useFrame(() => {
    if (settled.current) return;
    const elapsed = elapsedNow();
    paint(elapsed);
    settled.current = !open || elapsed >= GATE_OPEN_MS;
  });

  return (
    <group>
      {/* The glow on the threshold, across the doorway, on the floor. */}
      <mesh position={[X, STRIP_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} material={fx.strip} renderOrder={4}>
        <planeGeometry args={[EAST_GATE.maxX - EAST_GATE.minX, SPAN]} />
      </mesh>
      {/* The sweeping band of light (a vertical sheet across the doorway's width). */}
      <mesh ref={bandRef} position={[X, GATE_H / 2, EAST_GATE.minZ]} rotation={[0, Math.PI / 2, 0]} material={fx.band} visible={false}>
        <planeGeometry args={[BAND_W, GATE_H]} />
      </mesh>
    </group>
  );
}
