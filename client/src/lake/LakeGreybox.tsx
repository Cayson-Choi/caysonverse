import { useEffect, useMemo } from "react";
import { BoxGeometry, MeshStandardMaterial, Path, Shape, ShapeGeometry, Vector2, type BufferGeometry } from "three";
import {
  LAKE_AREA,
  LAKE_BENCHES,
  LAKE_DECKS,
  LAKE_HUT_A,
  LAKE_HUT_B,
  LAKE_LAMPS,
  LAKE_PAVILION,
  LAKE_PICNIC,
  LAKE_PROPS,
  LAKE_SHOP,
  LAKE_SHORE,
  LAKE_WATER_Y,
  lakeSeats,
} from "@caysonverse/shared/village/lakeLayout";
import type { AABB } from "@caysonverse/shared/collision";
import type { LakeWater } from "./lakeWater";

/**
 * The lake's stand-in: boxes and a flat water sheet laid from lakeLayout.ts (the one source of every number), drawn while
 * `lake.glb` (chunk A: terrain and water, chunk B: facilities) is not there or failed to load. It is a placeholder, not the
 * art: it exists so the walk, the seats, the camera and the fishing can be tried today, and it is the "받지 못했어요" fallback
 * (design 10: a failed download leaves the village fine). Its parts are named like the real nodes (`lake_water`, `lake_ground`)
 * so the village patch and the water pass treat both the same.
 */

const mat = (color: string, rough = 0.9) => new MeshStandardMaterial({ color, roughness: rough, metalness: 0 });

/** A flat polygon in the xz plane at height y (a ShapeGeometry made in (x, -z) and laid down). */
function flatPolygon(points: readonly { x: number; z: number }[], holes?: readonly { x: number; z: number }[][]): BufferGeometry {
  const v = (p: { x: number; z: number }) => new Vector2(p.x, -p.z);
  const shape = new Shape(points.map(v));
  for (const h of holes ?? []) shape.holes.push(new Path(h.map(v)));
  const g = new ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}

function boxGeometry(b: AABB, h: number): BoxGeometry {
  const g = new BoxGeometry(b.maxX - b.minX, h, b.maxZ - b.minZ);
  g.translate((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  return g;
}

export function LakeGreybox({ water }: { water: LakeWater | null }) {
  const parts = useMemo(() => {
    const rect = [
      { x: LAKE_AREA.minX, z: LAKE_AREA.minZ },
      { x: LAKE_AREA.maxX, z: LAKE_AREA.minZ },
      { x: LAKE_AREA.maxX, z: LAKE_AREA.maxZ },
      { x: LAKE_AREA.minX, z: LAKE_AREA.maxZ },
    ];
    const ground = flatPolygon(rect, [LAKE_SHORE.map((p) => ({ x: p.x, z: p.z }))]);
    const surface = flatPolygon(LAKE_SHORE);
    const bed = flatPolygon(LAKE_SHORE);
    const seats = lakeSeats();
    const chairs = seats.filter((s) => s.kind === "fishing_chair");
    return { ground, surface, bed, chairs };
  }, []);
  const mats = useMemo(
    () => ({
      ground: mat("#6e8c4c"),
      bed: mat("#1d2418"),
      deck: mat("#8a6c4a"),
      hut: mat("#b8682e"),
      shop: mat("#cfc8b6"),
      roof: mat("#3f6fa6"),
      chair: mat("#2d5a3c"),
      wood: mat("#7a5a3a"),
      lamp: mat("#4a3a2a"),
      prop: mat("#5b7090"),
    }),
    [],
  );
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      parts.ground.dispose();
      parts.surface.dispose();
      parts.bed.dispose();
    },
    [mats, parts],
  );
  const shopH = 4;
  return (
    <group name="lake_greybox">
      {/* just under the village's own y = 0 ground so the two never fight where they overlap (x 95.5..) */}
      <mesh name="lake_ground" geometry={parts.ground} material={mats.ground} position={[0, -0.02, 0]} receiveShadow />
      <mesh geometry={parts.bed} material={mats.bed} position={[0, -1.7, 0]} />
      {water && <mesh name="lake_water" geometry={parts.surface} material={water.material} position={[0, LAKE_WATER_Y, 0]} renderOrder={2} />}
      {LAKE_DECKS.map((d) => (
        <mesh key={d.id} geometry={boxGeometry(d.box, 0.3)} material={mats.deck} position={[0, -0.15, 0]} castShadow receiveShadow />
      ))}
      {[LAKE_HUT_A, LAKE_HUT_B].map((b, i) => (
        <mesh key={i} geometry={boxGeometry(b, 2.6)} material={mats.hut} position={[0, 1.3, 0]} castShadow />
      ))}
      <mesh geometry={boxGeometry(LAKE_SHOP, shopH)} material={mats.shop} position={[0, shopH / 2, 0]} castShadow receiveShadow />
      <mesh geometry={boxGeometry({ minX: LAKE_SHOP.minX - 0.4, maxX: LAKE_SHOP.maxX + 0.4, minZ: LAKE_SHOP.minZ - 0.4, maxZ: LAKE_SHOP.maxZ + 0.4 }, 0.3)} material={mats.roof} position={[0, shopH + 0.15, 0]} castShadow />
      {LAKE_PROPS.map((p) => (
        <mesh key={p.id} geometry={boxGeometry(p.box, 1.4)} material={mats.prop} position={[0, 0.7, 0]} castShadow />
      ))}
      {parts.chairs.map((c) => (
        <group key={c.id} position={[c.x, 0, c.z]} rotation={[0, c.yaw, 0]}>
          <mesh material={mats.chair} position={[0, 0.4, 0]} castShadow>
            <boxGeometry args={[0.5, 0.08, 0.5]} />
          </mesh>
          <mesh material={mats.chair} position={[0, 0.7, -0.27]} castShadow>
            <boxGeometry args={[0.5, 0.55, 0.06]} />
          </mesh>
        </group>
      ))}
      {LAKE_BENCHES.map((b) => (
        <mesh key={b.id} material={mats.wood} position={[b.x, 0.25, b.z]} castShadow>
          <boxGeometry args={[0.6, 0.5, 1.86]} />
        </mesh>
      ))}
      {LAKE_PICNIC.map((t) => (
        <group key={t.id} position={[t.x, 0, t.z]}>
          <mesh material={mats.wood} position={[0, 0.75, 0]} castShadow>
            <boxGeometry args={[0.9, 0.06, 2.4]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} material={mats.wood} position={[s * 1.0, 0.45, 0]} castShadow>
              <boxGeometry args={[0.4, 0.06, 2.4]} />
            </mesh>
          ))}
        </group>
      ))}
      <group position={[LAKE_PAVILION.centre.x, 0, LAKE_PAVILION.centre.z]}>
        <mesh material={mats.wood} position={[0, 0.2, 0]} castShadow receiveShadow>
          <boxGeometry args={[LAKE_PAVILION.size, 0.4, LAKE_PAVILION.size]} />
        </mesh>
        {[
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ].map(([sx, sz], i) => (
          <mesh key={i} material={mats.wood} position={[sx! * (LAKE_PAVILION.size / 2 - 0.3), 1.6, sz! * (LAKE_PAVILION.size / 2 - 0.3)]} castShadow>
            <boxGeometry args={[0.25, 3.2, 0.25]} />
          </mesh>
        ))}
        <mesh material={mats.roof} position={[0, 3.4, 0]} castShadow>
          <boxGeometry args={[LAKE_PAVILION.size + 1, 0.3, LAKE_PAVILION.size + 1]} />
        </mesh>
      </group>
      {LAKE_LAMPS.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh material={mats.lamp} position={[0, 2.2, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 4.4, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
