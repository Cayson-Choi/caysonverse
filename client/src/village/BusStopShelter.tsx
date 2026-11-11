import { DoubleSide } from "three";

/** Runtime 3D bus shelter: roof, transparent glass, bench, and route information sign. */
export function BusStopShelter() {
  return (
    <group name="bus-stop-shelter" position={[38, 0, -5.5]}>
      <mesh position={[0, 2.65, 0]} castShadow receiveShadow><boxGeometry args={[2.25, 0.18, 5.55]} /><meshStandardMaterial color="#e7edf3" roughness={0.72} metalness={0.16} /></mesh>
      <mesh position={[0, 2.52, 0]}><boxGeometry args={[2.05, 0.06, 5.32]} /><meshStandardMaterial color="#b7c5d0" roughness={0.56} metalness={0.32} /></mesh>
      {[[-0.92, -2.42], [0.92, -2.42], [-0.92, 2.42], [0.92, 2.42]].map(([x, z]) => <mesh key={`${x}-${z}`} position={[x, 1.28, z]} castShadow><cylinderGeometry args={[0.075, 0.09, 2.56, 10]} /><meshStandardMaterial color="#263442" roughness={0.48} metalness={0.68} /></mesh>)}
      <mesh position={[0.78, 1.3, 0]}><boxGeometry args={[0.045, 2.3, 4.85]} /><meshPhysicalMaterial color="#bfe5f2" transparent opacity={0.28} roughness={0.12} transmission={0.08} side={DoubleSide} /></mesh>
      {[-2.42, 2.42].map((z) => <mesh key={z} position={[0, 1.3, z]} rotation-y={Math.PI / 2}><boxGeometry args={[0.045, 2.3, 1.75]} /><meshPhysicalMaterial color="#bfe5f2" transparent opacity={0.22} roughness={0.12} transmission={0.08} side={DoubleSide} /></mesh>)}
      <group position={[-0.28, 0, 0]}>
        <mesh position={[0, 0.52, 0]} castShadow><boxGeometry args={[0.52, 0.16, 3.25]} /><meshStandardMaterial color="#795033" roughness={0.72} /></mesh>
        <mesh position={[0.21, 0.92, 0]}><boxGeometry args={[0.1, 0.68, 3.25]} /><meshStandardMaterial color="#795033" roughness={0.72} /></mesh>
        {[-1.22, 1.22].flatMap((z) => [-0.18, 0.18].map((x) => <mesh key={`${x}-${z}`} position={[x, 0.25, z]}><boxGeometry args={[0.08, 0.5, 0.08]} /><meshStandardMaterial color="#263442" metalness={0.48} roughness={0.55} /></mesh>))}
      </group>
      <group position={[1.1, 0, -2.04]}>
        <mesh position={[0, 1.45, 0]}><cylinderGeometry args={[0.045, 0.06, 2.9, 10]} /><meshStandardMaterial color="#263442" metalness={0.6} roughness={0.48} /></mesh>
        <mesh position={[0, 2.5, 0]} rotation-y={Math.PI / 2} castShadow><boxGeometry args={[0.78, 0.48, 0.12]} /><meshStandardMaterial color="#1174a8" roughness={0.4} metalness={0.24} /></mesh>
        <mesh position={[-0.06, 2.5, -0.075]} rotation-y={Math.PI / 2}><planeGeometry args={[0.62, 0.3]} /><meshBasicMaterial color="#eff7fb" toneMapped={false} /></mesh>
      </group>
    </group>
  );
}
