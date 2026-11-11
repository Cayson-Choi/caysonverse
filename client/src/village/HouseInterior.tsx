import { useMemo } from "react";
import type { VillageTier } from "./villageModelPrep";
import { houseInteriorLayout, type HouseFurniture } from "@caysonverse/shared/village/houseInterior";

const VARIANT_COLORS = {
  pink: { wall: "#f5d8df", trim: "#9b5268", accent: "#d889a2" },
  skyblue: { wall: "#d4e7f5", trim: "#477da1", accent: "#75b8dc" },
  yellow: { wall: "#f4e6bc", trim: "#9e762d", accent: "#d4ad52" },
  white: { wall: "#e8e9e4", trim: "#59636a", accent: "#9eaeb5" },
  mint: { wall: "#d2ebdf", trim: "#3e7c68", accent: "#76bca2" },
} as const;

function Furniture({ item, colors }: { item: HouseFurniture; colors: (typeof VARIANT_COLORS)[keyof typeof VARIANT_COLORS] }) {
  const { kind, x, z, yaw, width, depth, height } = item;
  if (kind === "sofa") {
    return (
      <group position={[x, 0, z]} rotation-y={yaw}>
        <mesh position={[0, height / 2, 0]} castShadow><boxGeometry args={[width, height, depth]} /><meshStandardMaterial color={colors.accent} roughness={0.82} /></mesh>
        <mesh position={[0, height + 0.34, -depth * 0.35]} castShadow><boxGeometry args={[width, 0.68, depth * 0.28]} /><meshStandardMaterial color={colors.accent} roughness={0.84} /></mesh>
        <mesh position={[-width * 0.38, height + 0.02, 0]}><boxGeometry args={[0.12, 0.12, depth * 0.72]} /><meshStandardMaterial color={colors.trim} /></mesh>
        <mesh position={[width * 0.38, height + 0.02, 0]}><boxGeometry args={[0.12, 0.12, depth * 0.72]} /><meshStandardMaterial color={colors.trim} /></mesh>
      </group>
    );
  }
  if (kind === "table" || kind === "desk") {
    return (
      <group position={[x, 0, z]} rotation-y={yaw}>
        <mesh position={[0, height, 0]} castShadow><boxGeometry args={[width, 0.14, depth]} /><meshStandardMaterial color={kind === "desk" ? colors.trim : "#8b5b3a"} roughness={0.65} /></mesh>
        {[-1, 1].map((side) => <mesh key={side} position={[side * (width * 0.38), height / 2, 0]}><boxGeometry args={[0.12, height, 0.12]} /><meshStandardMaterial color="#51372b" /></mesh>)}
      </group>
    );
  }
  if (kind === "bed") {
    return (
      <group position={[x, 0, z]} rotation-y={yaw}>
        <mesh position={[0, height / 2, 0]} castShadow><boxGeometry args={[width, height, depth]} /><meshStandardMaterial color="#765b52" roughness={0.78} /></mesh>
        <mesh position={[0, height + 0.12, 0.08]}><boxGeometry args={[width * 0.94, 0.18, depth * 0.92]} /><meshStandardMaterial color={colors.wall} roughness={0.92} /></mesh>
        <mesh position={[0, height + 0.36, -depth * 0.3]}><boxGeometry args={[width * 0.92, 0.5, 0.16]} /><meshStandardMaterial color={colors.accent} roughness={0.86} /></mesh>
      </group>
    );
  }
  if (kind === "wardrobe") {
    return <mesh position={[x, height / 2, z]} rotation-y={yaw} castShadow><boxGeometry args={[width, height, depth]} /><meshStandardMaterial color={colors.trim} roughness={0.62} /></mesh>;
  }
  if (kind === "plant") {
    return (
      <group position={[x, 0, z]}>
        <mesh position={[0, 0.18, 0]}><cylinderGeometry args={[0.2, 0.24, 0.36, 10]} /><meshStandardMaterial color="#b76b4d" roughness={0.9} /></mesh>
        <mesh position={[0, height * 0.65, 0]}><sphereGeometry args={[0.42, 10, 8]} /><meshStandardMaterial color="#4f8b5e" roughness={0.92} /></mesh>
      </group>
    );
  }
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, height * 0.5, 0]}><cylinderGeometry args={[0.04, 0.05, height, 8]} /><meshStandardMaterial color="#493e3a" /></mesh>
      <mesh position={[0, height, 0]}><sphereGeometry args={[0.18, 10, 8]} /><meshStandardMaterial color="#ffcf72" emissive="#ff9e3b" emissiveIntensity={0.35} /></mesh>
    </group>
  );
}

/** Procedural private-house interior. Positions are local so the server can place each house in its own area. */
export function HouseInterior({ buildingId, origin = [0, 0, 0], tier = "high" }: { buildingId: string; origin?: [number, number, number]; tier?: VillageTier }) {
  const layout = useMemo(() => houseInteriorLayout(buildingId), [buildingId]);
  const colors = VARIANT_COLORS[layout.variant];
  const detail = tier === "low" ? 6 : 10;
  const wall = layout.width / 2;
  const depth = layout.depth / 2;
  const stepCount = 8;
  return (
    <group name={`house-interior-${layout.buildingId}`} position={origin}>
      <mesh position={[0, -0.08, 0]} receiveShadow><boxGeometry args={[layout.width, 0.16, layout.depth]} /><meshStandardMaterial color="#a7a9a5" roughness={0.9} /></mesh>
      <mesh position={[0, layout.wallHeight + 0.08, 0]}><boxGeometry args={[layout.width, 0.16, layout.depth]} /><meshStandardMaterial color={colors.wall} roughness={1} /></mesh>
      <mesh position={[-wall, layout.wallHeight / 2, 0]} castShadow><boxGeometry args={[0.18, layout.wallHeight, layout.depth]} /><meshStandardMaterial color={colors.wall} roughness={0.94} /></mesh>
      <mesh position={[wall, layout.wallHeight / 2, 0]} castShadow><boxGeometry args={[0.18, layout.wallHeight, layout.depth]} /><meshStandardMaterial color={colors.wall} roughness={0.94} /></mesh>
      <mesh position={[0, layout.wallHeight / 2, -depth]} castShadow><boxGeometry args={[layout.width, layout.wallHeight, 0.18]} /><meshStandardMaterial color={colors.wall} roughness={0.94} /></mesh>
      <mesh position={[0, layout.wallHeight / 2, depth]} castShadow><boxGeometry args={[layout.width, layout.wallHeight, 0.18]} /><meshStandardMaterial color={colors.wall} roughness={0.94} /></mesh>
      <mesh position={[0, 1.65, -depth - 0.02]}><boxGeometry args={[2.2, 1.15, 0.04]} /><meshStandardMaterial color="#7dc9e8" emissive="#385f76" emissiveIntensity={0.12} roughness={0.2} /></mesh>
      <mesh position={[0, 0.08, -depth + 0.18]}><boxGeometry args={[layout.width * 0.88, 0.06, 0.05]} /><meshStandardMaterial color={colors.trim} /></mesh>
      {Array.from({ length: stepCount }, (_, i) => {
        const t = i / stepCount;
        return <mesh key={i} position={[layout.stairX, 0.16 + t * layout.secondFloorY, layout.stairZ + (i - stepCount / 2) * 0.34]} castShadow><boxGeometry args={[1.15, 0.18, 0.5]} /><meshStandardMaterial color="#795642" roughness={0.82} /></mesh>;
      })}
      <mesh position={[layout.stairX, layout.secondFloorY * 0.5, layout.stairZ - 1.5]}><boxGeometry args={[0.08, layout.secondFloorY, 0.08]} /><meshStandardMaterial color={colors.trim} /></mesh>
      <mesh position={[layout.stairX, layout.secondFloorY * 0.5, layout.stairZ + 1.5]}><boxGeometry args={[0.08, layout.secondFloorY, 0.08]} /><meshStandardMaterial color={colors.trim} /></mesh>
      {layout.furniture.map((item, index) => <Furniture key={`${item.kind}-${index}`} item={item} colors={colors} />)}
      <mesh position={[layout.stairX, layout.secondFloorY + 0.02, layout.stairZ]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.18, detail]} /><meshStandardMaterial color={colors.accent} emissive={colors.accent} emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

