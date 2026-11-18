import { compileSafely } from "../../game/compileSafely";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, Uint32BufferAttribute, Vector3, type InstancedMesh, type Material, type Object3D, type ShaderMaterial, type Scene } from "three";
import { compileSafely } from "../../game/compileSafely";
import { getPbrSet } from "../pbr/pbrLibrary";
import { groundGrainTexture } from "../groundDetail";
import { makeFountainNoise } from "../fountainWater";
import { createDepthWater } from "../creek/depthWater";
import { bankMaterial, rockMaterial } from "../creek/creekMaterials";
import { mergeStones } from "../creek/creekStones";
import { bedTexture, newBedGrid, rasterBed } from "../waterBed";
import { plantGeometry, plantMaterial } from "../waterPlants";
import type { VillageNodes, VillageTier } from "../villageModelPrep";
import { POND_FLOOR_Y, POND_RECT, POND_WATER_Y, planPond } from "./pondPlan";

/**
 * The temple's lotus pond (owner 2026-11-18, "연못이 물이 없고 형광 초록 평면"): the lot file's pond is a basin (`LM_temple_wall`, 0.55 m
 * deep), a dark glass plane at -0.12 m and a few flat instanced leaves. Here the glass plane wears the depth-aware water (the creek's
 * shader: see-through shallows over the real bed), the basin wears a wet gravel bed with pebbles lying on it, and the flat leaves and
 * flowers give way to lotus leaves (floating and raised on stalks), blooms and buds. Granite rim and bridge stay the model's. Three
 * draws; the lot file is untouched, its meshes are found by material and place (they are named by index) and put back on release.
 */

const CENTRE = { x: -46, z: -44 };

function isMesh(o: Object3D): o is Mesh {
  return (o as Mesh).isMesh === true;
}
const matOf = (m: Material | Material[]): Material => (Array.isArray(m) ? m[0]! : m);
const box = new Box3();

/** World-space box of a mesh's geometry. */
function worldBox(m: Mesh): Box3 {
  m.updateWorldMatrix(true, false);
  if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
  return box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
}

interface Found {
  glass: Mesh;
  flowers: InstancedMesh[];
  leaves: InstancedMesh[];
}

/** The glass plane's triangles, in world space, flat at height `level`. */
function flatOf(glass: Mesh, level: number): BufferGeometry {
  glass.updateWorldMatrix(true, false);
  const g = new BufferGeometry();
  const pos = glass.geometry.getAttribute("position");
  const arr = new Float32Array(pos.count * 3);
  const e = glass.matrixWorld.elements;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    arr[i * 3] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
    arr[i * 3 + 1] = level;
    arr[i * 3 + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
  }
  g.setAttribute("position", new Float32BufferAttribute(arr, 3));
  const idx = glass.geometry.getIndex();
  if (idx) g.setIndex(new Uint32BufferAttribute(Array.from(idx.array as ArrayLike<number>), 1));
  g.computeVertexNormals();
  return g;
}

function find(scene: Scene): Found | null {
  let glass: Mesh | null = null;
  const flowers: InstancedMesh[] = [];
  const leaves: InstancedMesh[] = [];
  scene.traverse((o) => {
    if (!isMesh(o)) return;
    const inst = (o as InstancedMesh).isInstancedMesh === true;
    const name = matOf(o.material).name;
    if (inst) {
      if (/lotus_flower/.test(o.name)) flowers.push(o as InstancedMesh);
      else if (/lotus_leaf/.test(o.name)) leaves.push(o as InstancedMesh);
      return;
    }
    if (name !== "M_glass" && name !== "M_pond_water (runtime)") return;
    if (!/lot_temple/.test(o.name) && !/lot_temple/.test(o.parent?.name ?? "")) return;
    const b = worldBox(o);
    const c = b.getCenter(new Vector3());
    if (Math.abs(c.x - CENTRE.x) > 1.5 || Math.abs(c.z - CENTRE.z) > 1.5) return;
    if (b.max.x - b.min.x < 3 || b.max.x - b.min.x > 6) return;
    glass = o;
  });
  if (!glass) return null;
  return { glass, flowers, leaves };
}

function instancePoints(ms: readonly InstancedMesh[]): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const v = new Vector3();
  for (const im of ms) {
    im.updateWorldMatrix(true, false);
    const arr = im.instanceMatrix.array;
    for (let i = 0; i < im.count; i++) {
      v.set(arr[i * 16 + 12]!, arr[i * 16 + 13]!, arr[i * 16 + 14]!).applyMatrix4(im.matrixWorld);
      if (Math.abs(v.x - CENTRE.x) < 3 && Math.abs(v.z - CENTRE.z) < 3) out.push({ x: v.x, z: v.z });
    }
  }
  return out;
}

interface Built {
  group: Group;
  found: Found;
  water: ShaderMaterial;
  stats: Record<string, number>;
  release(): void;
}

export function TemplePond({ nodes, tier }: { nodes: VillageNodes; tier: VillageTier }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const state = useRef<{ built: Built | null; busy: boolean; last: number; dead: boolean }>({ built: null, busy: false, last: -10, dead: false });
  useEffect(() => {
    const st = state.current;
    st.dead = false;
    return () => {
      st.dead = true;
      st.built?.release();
      st.built = null;
    };
  }, [nodes, tier]);

  const make = async (found: Found): Promise<void> => {
    const st = state.current;
    st.busy = true;
    try {
      const pbr = tier === "high" ? "2k" : "1k";
      const [gravel, dirt, rock] = await Promise.all([getPbrSet("gravel", pbr, gl), getPbrSet("dirt_path", pbr, gl), getPbrSet("rock", pbr, gl)]);
      if (st.dead || !nodes.water) return;
      const low = tier === "low";
      const own: { dispose(): void }[] = [];
      const undo: (() => void)[] = [];
      // the floor: the basin has only walls (the lawn showed through its bottom, the "neon green"), so the water's own outline is
      // dropped to the bed's level and drawn as a floor
      const floorG = flatOf(found.glass, POND_FLOOR_Y);
      own.push(floorG);
      const grid = newBedGrid({ x0: POND_RECT.x0, z0: POND_RECT.z0, x1: POND_RECT.x1, z1: POND_RECT.z1 }, 0.05);
      const floorPos = floorG.getAttribute("position");
      rasterBed(grid, { position: floorPos.array as Float32Array, index: floorG.getIndex() ? (floorG.getIndex()!.array as ArrayLike<number>) : null });
      const range = [-0.8, 0.4] as const;
      const map = bedTexture(grid, range, 0.4);
      const noise = makeFountainNoise();
      own.push(map, noise);
      const water = createDepthWater(nodes.water, { map, rect: POND_RECT, noise, range, detail: tier === "high" });
      water.name = "M_pond_water (runtime)";
      own.push(water);
      // the old glass plane (sunk under the lawn) is hidden; the water is its outline at the new level
      const waterG = flatOf(found.glass, POND_WATER_Y);
      own.push(waterG);
      const wasGlass = found.glass.visible;
      found.glass.visible = false;
      undo.push(() => {
        found.glass.visible = wasGlass;
      });
      // the bed: the creek's bank material at the pond's own level, opaque all the way up (fade far above)
      const bed = bankMaterial(gravel, dirt, { noise: groundGrainTexture() }, low, { level: POND_WATER_Y, fade: [3, 4], gravel: [0.12, 0.5], tint: [1.1, 1.0, 0.82] });
      bed.name = "M_pond_bed";
      bed.side = DoubleSide;
      bed.transparent = false;
      bed.depthWrite = true;
      bed.polygonOffset = false;
      own.push(bed);
      // the plan: leaves and blooms where the model drew its flat ones, pebbles on the bed
      const plan = planPond(grid, instancePoints(found.flowers), instancePoints(found.leaves), low);
      const group = new Group();
      group.name = "temple_pond";
      const floor = new Mesh(floorG, bed);
      floor.name = "pond_floor";
      floor.frustumCulled = false;
      group.add(floor);
      const surface = new Mesh(waterG, water);
      surface.name = "pond_water";
      surface.frustumCulled = false;
      surface.renderOrder = 2;
      group.add(surface);
      const pebG = mergeStones(plan.pebbles);
      if (pebG) {
        const m = rockMaterial(rock, { noise: groundGrainTexture() });
        const mesh = new Mesh(pebG, m);
        mesh.name = "pond_pebbles";
        mesh.frustumCulled = false;
        group.add(mesh);
        own.push(pebG, m);
      }
      const plantG = plantGeometry(plan.leaves, plan.flowers);
      if (plantG) {
        const m = plantMaterial("pond_lotus");
        const mesh = new Mesh(plantG, m);
        mesh.name = "pond_lotus";
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        group.add(mesh);
        own.push(plantG, m);
      }
      // the model's flat leaves and flowers go (they are instanced: hidden, put back on release)
      for (const im of [...found.flowers, ...found.leaves]) {
        const was = im.visible;
        im.visible = false;
        undo.push(() => {
          im.visible = was;
        });
      }
      st.built = {
        group,
        found,
        water,
        stats: { leaves: plan.leaves.length, flowers: plan.flowers.length, pebbles: plan.pebbles.length },
        release() {
          for (const u of undo) u();
          group.removeFromParent();
          for (const d of own) d.dispose();
        },
      };
      scene.add(group);
      if (import.meta.env.DEV) (window as unknown as { __cvPond?: () => unknown }).__cvPond = () => st.built?.stats ?? null;
      void compileSafely(gl, scene, camera).catch(() => console.warn("[pond] precompile failed"));
    } catch (e) {
      console.error("[pond] build failed", e);
    } finally {
      st.busy = false;
    }
  };

  useFrame(({ clock }) => {
    const st = state.current;
    const t = clock.elapsedTime;
    if (st.built) {
      st.built.water.uniforms.uTime!.value = t;
      // the lot's own level of detail hides the pond with its detail group: the plants follow it
      let vis = true;
      for (let o: Object3D | null = st.built.found.glass.parent; o; o = o.parent) if (!o.visible) vis = false;
      st.built.group.visible = vis;
      return;
    }
    // looking for the lot's meshes walks the scene: only now and then, and only while the player is anywhere near the temple
    if (st.busy || t - st.last < 3) return;
    st.last = t;
    if (Math.hypot(camera.position.x - CENTRE.x, camera.position.z - CENTRE.z) > 170) return;
    const found = find(scene);
    if (found) void make(found);
  });
  return null;
}
