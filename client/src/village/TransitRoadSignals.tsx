import { signalAt, type SignalColor } from "@caysonverse/shared/village/transit";
import { useTransitState } from "../net/transitSync";

const SIGNAL_COLORS: Record<SignalColor, string> = {
  red: "#ef3340",
  amber: "#ffb000",
  green: "#32d74b",
};

function Crosswalk({ x, z, vertical }: { x: number; z: number; vertical: boolean }) {
  const stripes = Array.from({ length: 7 }, (_, i) => i - 3);
  return (
    <group position={[x, 0.035, z]}>
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

function SignalPost({ x, z, signal, flip = false }: { x: number; z: number; signal: SignalColor; flip?: boolean }) {
  const lights: SignalColor[] = ["red", "amber", "green"];
  return (
    <group position={[x, 0, z]} rotation-y={flip ? Math.PI : 0}>
      <mesh position={[0, 1.3, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 2.6, 8]} />
        <meshStandardMaterial color="#222936" roughness={0.55} metalness={0.35} />
      </mesh>
      <mesh position={[0, 2.63, 0]}>
        <boxGeometry args={[0.36, 0.88, 0.22]} />
        <meshStandardMaterial color="#10151d" roughness={0.45} metalness={0.2} />
      </mesh>
      {lights.map((color, i) => (
        <mesh key={color} position={[0, 2.9 - i * 0.27, -0.13]}>
          <sphereGeometry args={[0.075, 12, 8]} />
          <meshStandardMaterial
            color={SIGNAL_COLORS[color]}
            emissive={SIGNAL_COLORS[color]}
            emissiveIntensity={signal === color ? 2.5 : 0.08}
            roughness={0.35}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Lightweight in-layout road furniture driven by the same server signal snapshot as the bus. */
export function TransitRoadSignals() {
  const { snapshot } = useTransitState();
  const signal = snapshot?.signal ?? signalAt(Date.now()).color;
  return (
    <group name="village-transit-road-furniture">
      <Crosswalk x={34} z={0} vertical={false} />
      <SignalPost x={30.6} z={-3.1} signal={signal} />
      <SignalPost x={37.4} z={3.1} signal={signal} flip />
      <Crosswalk x={0} z={-34} vertical />
      <SignalPost x={-3.1} z={-30.6} signal={signal} />
      <SignalPost x={3.1} z={-37.4} signal={signal} flip />
    </group>
  );
}

