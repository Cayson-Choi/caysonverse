import { Mesh, MeshBasicMaterial, NoColorSpace, RepeatWrapping, type Material, type Object3D, type ShaderMaterial, type Texture } from "three";
import { configureLightmap, isMesh, lightmapMaterial, materialsOf } from "../../game/hub/hubModelPrep";
import { capModelTextures, freeTexture, liftMaterial, type VillageTier } from "../villageModelPrep";
import { makeRippleTexture, type SkyMapping } from "../villageWater";
import {
  MAT,
  NODE,
  OLD_CARD_MATERIAL,
  OLD_CLIFF_NODE,
  fallsTierParams,
  type FallsTierParams,
} from "./fallsConfig";
import { createCascadeMaterial, createFoamMaterial, createPlungeMaterial, createPoolMaterial, rockMaterial } from "./fallsMaterials";
import { createSpray, type FallsSpray } from "./fallsSpray";
import { makeFlowTexture, makeMistAtlas, makePoolBase } from "./fallsTextures";

/**
 * Dress a falls model (the loaded `waterfall.glb`, or the DEV stand-in) for the graphics tier: the water meshes get
 * their shaders by node name (design §7.4), the rock and ground get the falls' light maps, the cliff's two LODs are
 * found, the spray, mist and rainbow are made. Everything made here is in `own` and freed by `disposeFalls`. The
 * model itself (geometry, the textures it carries) is the caller's to free as well: it is loaded for this component
 * alone, so `disposeFalls` frees it too.
 */

export interface FallsParts {
  root: Object3D;
  tier: VillageTier;
  params: FallsTierParams;
  lod0: Object3D[];
  lod1: Object3D[];
  /** The pool and outlet water (the time of day writes their tint and glint). */
  pools: ShaderMaterial[];
  spray: FallsSpray;
  /** Meshes drawn by the falls, counted by `stats`. */
  meshes: Mesh[];
  own: Array<{ dispose(): void }>;
  /** Whether the rock is light-mapped (the real model) or lit by the scene's lights (the stand-in). */
  baked: boolean;
}

export interface FallsPrepOptions {
  tier: VillageTier;
  sky: Texture | null;
  skyMapping: SkyMapping;
  lightmap: Texture | null;
  /** Lift the pool this much (the old pool disc in village.glb is still under it until the village rebuild). */
  poolLift: number;
}

const PLUNGE_INDEX = new RegExp(`^${NODE.plunge}(\\d+)`);

function dataTexture(t: Texture): Texture {
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** A texture of the model by its name (`T_falls_flow`, `T_mist_atlas`), or by the material that carries it. */
function findTexture(root: Object3D, textureName: string): Texture | null {
  let found: Texture | null = null;
  root.traverse((o) => {
    if (found || !isMesh(o)) return;
    for (const m of materialsOf(o)) {
      const map = (m as MeshBasicMaterial).map;
      if (map && (map.name === textureName || map.userData?.name === textureName)) found = map;
    }
  });
  return found;
}

/** Hide the old waterfall in village.glb (its cliff and the card sheets) until the village rebuild takes them out. Returns what it hid. */
export function hideOldFalls(villageRoot: Object3D): Object3D[] {
  const hidden: Object3D[] = [];
  villageRoot.traverse((o) => {
    if (o.name === OLD_CLIFF_NODE) {
      o.visible = false;
      hidden.push(o);
      return;
    }
    if (!isMesh(o)) return;
    if (materialsOf(o).some((m) => m.name === OLD_CARD_MATERIAL)) {
      o.visible = false;
      hidden.push(o);
    }
  });
  return hidden;
}

/** Whether village.glb still carries the old waterfall (the new pool then sits above the old disc). */
export function villageHasOldFalls(villageRoot: Object3D): boolean {
  let has = false;
  villageRoot.traverse((o) => {
    if (!has && isMesh(o) && materialsOf(o).some((m) => m.name === OLD_CARD_MATERIAL)) has = true;
  });
  return has;
}

export function prepareFalls(root: Object3D, o: FallsPrepOptions): FallsParts {
  const params = fallsTierParams(o.tier);
  const own: Array<{ dispose(): void }> = [];
  const lod0: Object3D[] = [];
  const lod1: Object3D[] = [];
  const pools: ShaderMaterial[] = [];
  const meshes: Mesh[] = [];

  if (o.lightmap) configureLightmap(o.lightmap);
  if (o.tier === "low") capModelTextures(root, params.maxTexture);

  const modelFlow = findTexture(root, "T_falls_flow");
  const flow = modelFlow ? dataTexture(modelFlow) : makeFlowTexture(params.maxTexture >= 1024 ? 256 : 128);
  if (!modelFlow) own.push(flow);
  const modelMist = findTexture(root, "T_mist_atlas");
  const atlas = modelMist ?? makeMistAtlas(params.maxTexture >= 1024 ? 48 : 32);
  if (!modelMist) own.push(atlas);

  const ripple = makeRippleTexture();
  const poolBase = makePoolBase();
  own.push(ripple, poolBase);

  const waterOpts = { flow, detail: params.detail };
  const plunge = createPlungeMaterial(waterOpts);
  const cascade = createCascadeMaterial(waterOpts);
  const foam = createFoamMaterial(waterOpts);
  const poolOpts = { sky: o.sky, skyMapping: o.skyMapping, ripple, base: poolBase, flow, detail: params.detail };
  const pool = createPoolMaterial(poolOpts);
  const outlet = createPoolMaterial({ ...poolOpts, outlet: true });
  pools.push(pool, outlet);
  own.push(plunge, cascade, foam, pool, outlet);

  let baked = false;
  const swapped = new Map<Material, Material>();
  const dress = (mesh: Mesh): void => {
    const name = mesh.name;
    const plungeAt = PLUNGE_INDEX.exec(name);
    if (plungeAt) {
      const i = Number(plungeAt[1]);
      mesh.material = plunge;
      mesh.renderOrder = 4 + i;
      if (i >= params.waterLayers) mesh.visible = false;
      return;
    }
    if (name.startsWith(NODE.cascade)) {
      mesh.material = cascade;
      mesh.renderOrder = 3;
      return;
    }
    if (name.startsWith(NODE.pool)) {
      mesh.material = pool;
      mesh.renderOrder = 2;
      mesh.position.y += o.poolLift;
      return;
    }
    if (name.startsWith(NODE.outlet)) {
      mesh.material = outlet;
      mesh.renderOrder = 2;
      mesh.position.y += o.poolLift;
      return;
    }
    if (name.startsWith(NODE.foam)) {
      // the light tier leaves the foam heap out (one draw call fewer): the pool's own foam shader shows the landing
      if (!params.detail) mesh.visible = false;
      mesh.material = foam;
      mesh.renderOrder = 7;
      mesh.position.y += o.poolLift;
      return;
    }
    // rock, ground, slabs, plants
    const dressMaterial = (m: Material): Material => {
      const seen = swapped.get(m);
      if (seen) return seen;
      let b = m as MeshBasicMaterial;
      const hasUv1 = !!mesh.geometry.getAttribute("uv1");
      if ((m as unknown as { isMeshLambertMaterial?: boolean }).isMeshLambertMaterial) {
        swapped.set(m, m);
        return m; // the stand-in: lit by the scene's lights
      }
      if (!b.isMeshBasicMaterial) {
        const std = m as MeshBasicMaterial;
        b = new MeshBasicMaterial({ name: m.name, map: std.map ?? null, color: std.color ?? undefined });
        own.push(b);
      }
      const rock = m.name === MAT.rock;
      if (o.lightmap && hasUv1) {
        lightmapMaterial(b, o.lightmap);
        rockMaterial(b, rock);
        baked = true;
      } else if (m.name === MAT.leaf) {
        liftMaterial(b);
      }
      if (rock) b.vertexColors = true;
      swapped.set(m, b);
      return b;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(dressMaterial) : dressMaterial(mesh.material);
    if (name === NODE.rockLod0) lod0.push(mesh);
    else if (name === NODE.rockLod1) lod1.push(mesh);
  };

  root.traverse((n) => {
    if (n.name.startsWith("col__")) {
      n.visible = false;
      return;
    }
    if (!isMesh(n)) return;
    dress(n);
    meshes.push(n);
  });
  // The cliff LODs are decided per frame; a model with only one of them shows that one.
  const useLod0 = params.lod0Within > 0;
  if (lod0.length && lod1.length) {
    lod0.forEach((m) => (m.visible = useLod0));
    lod1.forEach((m) => (m.visible = !useLod0));
  }

  const spray = createSpray({ droplets: params.spray, mist: params.mist, rainbow: params.rainbow, atlas });
  own.push(spray);
  root.add(spray.group);
  root.updateMatrixWorld(true);
  // The falls never move except in their shaders: no per-frame matrix work.
  root.traverse((n) => {
    n.matrixAutoUpdate = false;
  });

  return { root, tier: o.tier, params, lod0, lod1, pools, spray, meshes, own, baked };
}

/** Free everything `prepareFalls` made and the model's own geometry, materials and textures. */
export function disposeFalls(parts: FallsParts): void {
  const done = new Set<unknown>();
  const free = (r: { dispose(): void } | null | undefined): void => {
    if (!r || done.has(r)) return;
    done.add(r);
    if ((r as Texture).isTexture) freeTexture(r as Texture);
    else r.dispose();
  };
  parts.root.traverse((n) => {
    if (!isMesh(n)) return;
    free(n.geometry);
    for (const m of materialsOf(n)) {
      for (const key of ["map", "lightMap"] as const) free((m as MeshBasicMaterial)[key]);
      free(m);
    }
  });
  for (const r of parts.own) free(r);
}
