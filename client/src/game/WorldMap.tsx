import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Group, Mesh, type Object3D } from "three";
import {
  FURNITURE,
  FURNITURE_MODELS,
  FURNITURE_SCALE,
  FURNITURE_URL_BASE,
  WALLS,
  WALL_HEIGHT,
  SCREEN,
  ZONES,
  type AABB,
} from "@caysonverse/shared/worldMap";
import { MazeWalls } from "./MazeWalls";

/** Ground colours per zone (lounge warm, lecture hall cool, maze dim). */
const LOUNGE_COLOR = "#463a52"; // warm mauve
const HALL_COLOR = "#36485e"; // cool slate-blue
const MAZE_COLOR = "#2c2a40"; // dim indigo — reads as a separate, cooler room
const WALL_COLOR = "#6a6390";
const SCREEN_BODY = "#0b0b14";
const SCREEN_FACE = "#7c8cff";

const MODEL_IDS = Object.keys(FURNITURE_MODELS) as (keyof typeof FURNITURE_MODELS)[];
const MODEL_URLS = MODEL_IDS.map((id) => `${FURNITURE_URL_BASE}${id}.glb`);
useGLTF.preload(MODEL_URLS);

/** Centre + size (X,Z) of an AABB, for placing a box mesh over it. */
function boxOf(a: AABB) {
  return {
    cx: (a.minX + a.maxX) / 2,
    cz: (a.minZ + a.maxZ) / 2,
    sx: a.maxX - a.minX,
    sz: a.maxZ - a.minZ,
  };
}

/** A flat ground plane covering one zone AABB. */
function ZoneFloor({ zone, color }: { zone: AABB; color: string }) {
  const { cx, cz, sx, sz } = boxOf(zone);
  return (
    <mesh position={[cx, 0, cz]} rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[sx, sz]} />
      <meshStandardMaterial color={color} roughness={1} metalness={0} />
    </mesh>
  );
}

/**
 * All furniture as one frozen group: each curated GLB is loaded once and its
 * scene is cloned per placement (clone(true) SHARES geometry + materials — never
 * a per-placement material). Each placement is re-centred so its footprint
 * centre lands on the map position, then scaled and rotated. Matrices are
 * computed once and `matrixAutoUpdate` is switched off, so furniture does zero
 * per-frame work.
 */
function Furniture() {
  const gltfs = useGLTF(MODEL_URLS);

  const root = useMemo(() => {
    const byId = new Map<string, Object3D>();
    MODEL_IDS.forEach((id, i) => byId.set(id, gltfs[i].scene));

    const group = new Group();
    for (const p of FURNITURE) {
      const m = FURNITURE_MODELS[p.model];
      const obj = byId.get(p.model)!.clone(true);
      obj.position.set(-m.cx * FURNITURE_SCALE, 0, -m.cz * FURNITURE_SCALE);
      obj.scale.setScalar(FURNITURE_SCALE);
      obj.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });

      const wrap = new Group();
      wrap.position.set(p.x, 0, p.z);
      wrap.rotation.y = p.rotY;
      wrap.add(obj);
      group.add(wrap);
    }

    // Compute every matrix once, then freeze (static scene — no per-frame TRS).
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      o.matrixAutoUpdate = false;
    });
    return group;
  }, [gltfs]);

  return <primitive object={root} />;
}

/** Walls, ground, big screen and all furniture. Purely static geometry. */
export function WorldMap() {
  const screenFaceX = SCREEN.x - SCREEN.depth / 2 - 0.02;

  return (
    <group>
      {/* Ground, one plane per zone (maze west, lounge centre, hall east). */}
      <ZoneFloor zone={ZONES.maze} color={MAZE_COLOR} />
      <ZoneFloor zone={ZONES.lounge} color={LOUNGE_COLOR} />
      <ZoneFloor zone={ZONES.lectureHall} color={HALL_COLOR} />

      {/* Maze: merged walls (1 draw call), goal tile, return portal, chamber light. */}
      <MazeWalls />

      {/* Walls: box meshes matching the collision AABBs exactly. */}
      {WALLS.map((w, i) => {
        const { cx, cz, sx, sz } = boxOf(w);
        return (
          <mesh key={i} position={[cx, WALL_HEIGHT / 2, cz]} castShadow receiveShadow>
            <boxGeometry args={[sx, WALL_HEIGHT, sz]} />
            <meshStandardMaterial color={WALL_COLOR} roughness={0.9} metalness={0} />
          </mesh>
        );
      })}

      {/* Lecture-hall big screen: dark body + slightly emissive front face. */}
      <group position={[SCREEN.x, SCREEN.y, SCREEN.z]}>
        <mesh castShadow>
          <boxGeometry args={[SCREEN.depth, SCREEN.height, SCREEN.width]} />
          <meshStandardMaterial color={SCREEN_BODY} roughness={0.5} metalness={0.1} />
        </mesh>
      </group>
      <mesh position={[screenFaceX, SCREEN.y, SCREEN.z]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[SCREEN.width * 0.94, SCREEN.height * 0.9]} />
        <meshStandardMaterial
          color={SCREEN_FACE}
          emissive={SCREEN_FACE}
          emissiveIntensity={0.45}
          roughness={0.4}
        />
      </mesh>

      <Furniture />
    </group>
  );
}
