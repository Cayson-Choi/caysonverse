import { BoxGeometry, MeshBasicMaterial, MeshStandardMaterial } from "three";
import type { AABB } from "@caysonverse/shared/collision";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
import { WALL_HEIGHT } from "@caysonverse/shared/worldMap";

/**
 * A map's collision boxes, drawn (AI 학교 탈출, Task 15):
 *  - `variant="solid"` — the TEMPORARY stand-in for a map whose model (GLB) has not arrived:
 *    every obstacle as a box, walls (`geometry.cameraBoxes`) WALL_HEIGHT tall, props PROP_HEIGHT.
 *  - `variant="wire"` — the `?debug=colliders` overlay: the same boxes as translucent wireframe
 *    on top of whatever the map looks like, to check the collision truth against the model.
 *
 * One shared unit box geometry scaled per box and one material per look (module lifetime, like
 * WorldMap's wall materials) — a map's dozen boxes cost no geometry each.
 */

/** Height (m) a non-wall obstacle (desk, board, stand) is drawn at. */
export const PROP_HEIGHT = 1;

const UNIT_BOX = new BoxGeometry(1, 1, 1);
const WALL_SOLID = new MeshStandardMaterial({ color: "#EFE7DA", roughness: 0.92, metalness: 0 });
const PROP_SOLID = new MeshStandardMaterial({ color: "#C8B08C", roughness: 0.85, metalness: 0 });
const WIRE = new MeshBasicMaterial({
  color: "#FF3EA5",
  wireframe: true,
  transparent: true,
  opacity: 0.55,
  depthTest: false,
  depthWrite: false,
  fog: false,
});

/** True when the page was opened with `?debug=colliders`. */
export function collidersDebugOn(search: string = typeof window === "undefined" ? "" : window.location.search): boolean {
  return new URLSearchParams(search).get("debug") === "colliders";
}

interface MapBoxesProps {
  geometry: MapGeometry;
  /** Boxes another component draws itself (e.g. the east gate), matched by identity. */
  skip?: readonly AABB[];
  variant?: "solid" | "wire";
}

export function MapBoxes({ geometry, skip, variant = "solid" }: MapBoxesProps) {
  const walls = geometry.cameraBoxes;
  const solid = variant === "solid";
  return (
    <group>
      {geometry.obstacles.map((box, i) => {
        if (skip?.includes(box)) return null;
        const h = walls.includes(box) ? WALL_HEIGHT : PROP_HEIGHT;
        return (
          <mesh
            key={i}
            geometry={UNIT_BOX}
            material={solid ? (h === WALL_HEIGHT ? WALL_SOLID : PROP_SOLID) : WIRE}
            position={[(box.minX + box.maxX) / 2, h / 2, (box.minZ + box.maxZ) / 2]}
            scale={[box.maxX - box.minX, h, box.maxZ - box.minZ]}
            castShadow={solid}
            receiveShadow={solid}
            renderOrder={solid ? 0 : 10}
          />
        );
      })}
    </group>
  );
}
