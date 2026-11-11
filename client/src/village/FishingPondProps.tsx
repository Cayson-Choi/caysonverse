import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Shape, ShapeGeometry } from "three";
import { Text } from "@react-three/drei";
import { makeRippleTexture } from "./villageWater";

/** Lakeside rental kiosk, dock and irregular rippled water surface for the fishing route. */
export function FishingPondProps() {
  const ripple = useMemo(() => makeRippleTexture(64), []);
  const lakeGeometry = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(-25, -31); shape.bezierCurveTo(-12, -38, 14, -36, 26, -24);
    shape.bezierCurveTo(31, -12, 29, 13, 21, 29); shape.bezierCurveTo(8, 37, -17, 34, -27, 21);
    shape.bezierCurveTo(-32, 7, -31, -18, -25, -31); shape.closePath();
    return new ShapeGeometry(shape);
  }, []);
  useEffect(() => () => { ripple.dispose(); lakeGeometry.dispose(); }, [ripple, lakeGeometry]);
  useFrame(({ clock }) => {
    ripple.offset.set(clock.elapsedTime * 0.012, clock.elapsedTime * -0.008);
  });
  return (
    <group name="fishing-pond-props">
      <mesh geometry={lakeGeometry} position={[130, 0.04, -15]} rotation-x={-Math.PI / 2} receiveShadow>
        <meshStandardMaterial color="#1e7180" roughness={0.18} metalness={0.12} transparent opacity={0.82} normalMap={ripple} normalScale={[0.32, 0.32]} />
      </mesh>
      {[[-8, -4, 2.8], [3, 7, 1.9], [13, -11, 2.4], [-17, 14, 1.4]].map(([x, z, r]) => (
        <mesh key={`${x}-${z}`} position={[130 + x, 0.09, -15 + z]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[r * 0.72, r, 32]} />
          <meshBasicMaterial color="#82c9c1" transparent opacity={0.28} />
        </mesh>
      ))}
      <group name="fishing-dock" position={[99, 0.18, -15]}>
        {Array.from({ length: 8 }, (_, i) => <mesh key={i} position={[i * 0.9 - 3.15, 0, 0]} castShadow><boxGeometry args={[0.82, 0.18, 2.2]} /><meshStandardMaterial color="#795033" roughness={0.78} /></mesh>)}
        {[-0.85, 0.85].map((z) => <mesh key={z} position={[0, -0.25, z]}><boxGeometry args={[7.2, 0.5, 0.12]} /><meshStandardMaterial color="#463226" roughness={0.84} /></mesh>)}
      </group>
      <group name="fishing-rental-kiosk" position={[86, 0, -15]}>
        <mesh position={[0, 1.15, 0]} castShadow><boxGeometry args={[2.3, 2.3, 1.65]} /><meshStandardMaterial color="#c9824c" roughness={0.75} /></mesh>
        <mesh position={[0, 2.45, 0]} rotation-y={Math.PI / 4} castShadow><coneGeometry args={[1.65, 1.0, 4]} /><meshStandardMaterial color="#3d6f68" roughness={0.8} /></mesh>
        <mesh position={[0, 1.25, -0.84]}><boxGeometry args={[1.55, 0.65, 0.04]} /><meshStandardMaterial color="#f2e6c7" roughness={0.7} /></mesh>
        <mesh position={[0, 0.62, -0.88]}><boxGeometry args={[1.8, 0.08, 0.08]} /><meshStandardMaterial color="#5b3627" /></mesh>
        {[[-0.62, 0.58], [0.62, 0.58]].map(([x, z]) => <mesh key={x} position={[x, z, -0.95]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.025, 0.025, 1.5, 8]} /><meshStandardMaterial color="#263442" metalness={0.42} /></mesh>)}
        <mesh position={[0, 3.38, 0]}><boxGeometry args={[2.35, 0.52, 0.16]} /><meshStandardMaterial color="#116d8f" roughness={0.45} metalness={0.2} /></mesh>
      </group>
      <mesh name="fishing-rental-sign" position={[86, 3.38, -15.1]}><boxGeometry args={[1.75, 0.3, 0.03]} /><meshBasicMaterial color="#f4f2e6" toneMapped={false} /></mesh>
      <Text position={[86, 3.38, -15.18]} rotation={[0, Math.PI, 0]} fontSize={0.16} color="#153d4f" anchorX="center" anchorY="middle">낚싯대 대여</Text>
    </group>
  );
}
