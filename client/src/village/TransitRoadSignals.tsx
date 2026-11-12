import { pedestrianSignalAt, signalAt, type PedestrianSignalColor, type SignalColor } from "@caysonverse/shared/village/transit";
import { useTransitState } from "../net/transitSync";

const SIGNAL_COLORS: Record<SignalColor, string> = {
  red: "#ef3340",
  amber: "#ffb000",
  green: "#32d74b",
};

const PED_COLORS: Record<PedestrianSignalColor, string> = {
  walk: "#36d27a",
  flashing: "#ffb000",
  stop: "#ef3340",
};

function Crosswalk({ x, z, vertical }: { x: number; z: number; vertical: boolean }) {
  const stripes = Array.from({ length: 7 }, (_, i) => i - 3);
  return (
    <group position={[x, 0.035, z]}>
      <mesh position={[0, -0.012, vertical ? 0 : 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={vertical ? [4.5, 5.3] : [5.3, 4.5]} />
        <meshStandardMaterial color="#1c242d" roughness={0.96} />
      </mesh>
      {stripes.map((offset) => (
        <mesh
          key={offset}
          position={vertical ? [offset * 0.62, 0, 0] : [0, 0, offset * 0.62]}
          rotation-x={-Math.PI / 2}
        >
          <planeGeometry args={vertical ? [0.32, 4.3] : [4.3, 0.32]} />
          <meshStandardMaterial color="#f4f6f8" roughness={0.82} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}

function VehicleSignal({ x, z, signal, flip = false }: { x: number; z: number; signal: SignalColor; flip?: boolean }) {
  const lights: SignalColor[] = ["red", "amber", "green"];
  return (
    <group name="vehicle-signal" position={[x, 0, z]} rotation-y={flip ? Math.PI : 0}>
      <mesh position={[0, 1.3, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 2.6, 8]} />
        <meshStandardMaterial color="#222936" roughness={0.55} metalness={0.35} />
      </mesh>
      <mesh position={[flip ? -0.42 : 0.42, 2.64, 0]} rotation-z={Math.PI / 2}>
        <boxGeometry args={[0.08, 0.9, 0.08]} />
        <meshStandardMaterial color="#222936" metalness={0.35} roughness={0.55} />
      </mesh>
      <mesh position={[0, 2.63, 0]}>
        <boxGeometry args={[0.36, 0.88, 0.22]} />
        <meshStandardMaterial color="#10151d" roughness={0.45} metalness={0.2} />
      </mesh>
      {lights.map((color, i) => (
        <group key={color} position={[0, 2.9 - i * 0.27, -0.13]}>
          <mesh>
            <sphereGeometry args={[0.075, 12, 8]} />
            <meshStandardMaterial color={SIGNAL_COLORS[color]} emissive={SIGNAL_COLORS[color]} emissiveIntensity={signal === color ? 2.5 : 0.08} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0, -0.06]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.105, 0.105, 0.08, 12]} />
            <meshStandardMaterial color="#080b10" roughness={0.5} metalness={0.15} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function PedestrianSignal({ x, z, signal, flip = false }: { x: number; z: number; signal: PedestrianSignalColor; flip?: boolean }) {
  return (
    <group name="pedestrian-signal" position={[x, 0, z]} rotation-y={flip ? Math.PI : 0}>
      <mesh position={[0, 1.05, 0]}><cylinderGeometry args={[0.055, 0.07, 2.1, 8]} /><meshStandardMaterial color="#202934" metalness={0.35} roughness={0.58} /></mesh>
      <mesh position={[0, 2.12, -0.04]}><boxGeometry args={[0.3, 0.62, 0.2]} /><meshStandardMaterial color="#111820" metalness={0.15} roughness={0.42} /></mesh>
      {(["stop", "walk"] as const).map((phase, i) => (
        <group key={phase} position={[0, 2.28 - i * 0.25, -0.15]}>
          <mesh>
            <circleGeometry args={[0.07, 16]} />
            <meshStandardMaterial
              color={signal === "flashing" && phase === "walk" ? PED_COLORS.flashing : PED_COLORS[phase]}
              emissive={signal === "flashing" && phase === "walk" ? PED_COLORS.flashing : PED_COLORS[phase]}
              emissiveIntensity={signal === phase || (signal === "flashing" && phase === "walk") ? 2.8 : 0.06}
              roughness={0.42}
            />
          </mesh>
          <mesh position={[0, 0, 0.055]}>
            <torusGeometry args={[0.085, 0.015, 6, 16]} />
            <meshStandardMaterial color="#05080d" roughness={0.5} metalness={0.15} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 2.72, 0]}><boxGeometry args={[0.48, 0.08, 0.08]} /><meshStandardMaterial color="#27313c" /></mesh>
    </group>
  );
}

/** Lightweight in-layout road furniture driven by the same server signal snapshot as the bus. */
export function TransitRoadSignals() {
  const { snapshot } = useTransitState();
  const now = Date.now();
  const signal = snapshot?.signal ?? signalAt(now).color;
  const pedestrian = snapshot?.pedestrianSignal ?? pedestrianSignalAt(now).color;
  return (
    <group name="village-transit-road-furniture">
      <Crosswalk x={34} z={0} vertical={false} />
      <VehicleSignal x={30.6} z={-3.1} signal={signal} />
      <VehicleSignal x={37.4} z={3.1} signal={signal} flip />
      <PedestrianSignal x={31.3} z={3.0} signal={pedestrian} />
      <PedestrianSignal x={36.7} z={-3.0} signal={pedestrian} flip />
      <Crosswalk x={0} z={-34} vertical />
      <VehicleSignal x={-3.1} z={-30.6} signal={signal} />
      <VehicleSignal x={3.1} z={-37.4} signal={signal} flip />
      <PedestrianSignal x={3.0} z={-31.3} signal={pedestrian} />
      <PedestrianSignal x={-3.0} z={-36.7} signal={pedestrian} flip />
    </group>
  );
}

