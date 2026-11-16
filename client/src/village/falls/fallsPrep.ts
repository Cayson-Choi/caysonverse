import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type ShaderMaterial,
  type Texture,
} from "three";
import { configureLightmap, isMesh, lightmapMaterial, materialsOf } from "../../game/hub/hubModelPrep";
import { capModelTextures, freeTexture, liftMaterial, type VillageTier } from "../villageModelPrep";
import { makeRippleTexture, type SkyMapping } from "../villageWater";
import { PICK_SOLID_KEY } from "../../game/clickPick";
import { MAT, NODE, fallsTierParams, type FallsTierParams } from "./fallsConfig";
import { makeFountainNoise } from "../fountainWater";
import {
  createCascadeMaterial,
  createFoamMaterial,
  createPlungeMaterial,
  createPoolMaterial,
  lampMaterial,
  rockMaterial,
  SEAM_MEAN,
  setFallsSky,
} from "./fallsMaterials";
import { createSpray, type FallsSpray } from "./fallsSpray";
import { makeMistAtlas, makePoolBase } from "./fallsTextures";

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

/** The slab granite's albedo factor (see the dressing). */
export const SLAB_ALBEDO = 0.7;

export interface FallsPrepOptions {
  tier: VillageTier;
  sky: Texture | null;
  skyMapping: SkyMapping;
  lightmap: Texture | null;
}

const PLUNGE_INDEX = new RegExp(`^${NODE.plunge}(\\d+)`);

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

export function prepareFalls(root: Object3D, o: FallsPrepOptions): FallsParts {
  const params = fallsTierParams(o.tier);
  const own: Array<{ dispose(): void }> = [];
  const lod0: Object3D[] = [];
  const lod1: Object3D[] = [];
  const pools: ShaderMaterial[] = [];
  const meshes: Mesh[] = [];

  if (o.lightmap) configureLightmap(o.lightmap);
  if (o.tier === "low") capModelTextures(root, params.maxTexture);

  // the falling water's grain is the fountain's noise (one look for all the village's moving water: 16 KB)
  const noise = makeFountainNoise();
  own.push(noise);
  setFallsSky(o.sky, o.skyMapping, noise);
  const modelMist = findTexture(root, "T_mist_atlas");
  const atlas = modelMist ?? makeMistAtlas(params.maxTexture >= 1024 ? 48 : 32);
  if (!modelMist) own.push(atlas);

  const ripple = makeRippleTexture();
  const poolBase = makePoolBase();
  own.push(ripple, poolBase);

  const waterOpts = { detail: params.detail };
  const plunge = createPlungeMaterial(waterOpts);
  const cascade = createCascadeMaterial(waterOpts);
  const foam = createFoamMaterial(waterOpts);
  const poolOpts = { sky: o.sky, skyMapping: o.skyMapping, ripple, base: poolBase, noise, detail: params.detail };
  const pool = createPoolMaterial(poolOpts);
  // a click on the pool lands on its water (the shore walk, ActiveMap.shore), not on its bed 2 m down (W6)
  pool.userData[PICK_SOLID_KEY] = true;
  const outlet = createPoolMaterial({ ...poolOpts, outlet: true });
  pools.push(pool, outlet);
  own.push(plunge, cascade, foam, pool, outlet);

  let baked = false;
  const swapped = new Map<Material, Material>();
  const isLow = o.tier === "low";
  // a node of several materials loads as a group of meshes (`name_1`, `name_2` ...): its name and extras are the group's
  const up = (o: Object3D, f: (n: Object3D) => boolean): Object3D | null => {
    for (let n: Object3D | null = o; n && n !== root.parent; n = n.parent) if (f(n)) return n;
    return null;
  };
  const dress = (mesh: Mesh): void => {
    const name = mesh.name; // the water meshes have one material each: their own names
    // the tier the art drew it for (extras): the rock's two LODs are picked by distance instead (below)
    const tierOf = (up(mesh, (n) => typeof n.userData?.tier === "string")?.userData.tier as string | undefined) ?? undefined;
    const lodNode = !!up(mesh, (n) => n.name === NODE.rockLod0 || n.name === NODE.rockLod1);
    if (!lodNode && ((tierOf === "high" && isLow) || (tierOf === "low" && !isLow))) {
      mesh.visible = false;
      return;
    }
    const water = name.startsWith("W_falls_");
    if (water && !mesh.geometry.getAttribute("normal")) mesh.geometry.computeVertexNormals();
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
      return;
    }
    if (name.startsWith(NODE.outlet)) {
      mesh.material = outlet;
      mesh.renderOrder = 2;
      return;
    }
    if (name.startsWith(NODE.foam)) {
      mesh.material = foam;
      mesh.renderOrder = 7;
      return;
    }
    // rock, ground, stones, plants, trees, lamps: by the kind W3 wrote on each material (extras `falls`)
    const hasLm = !!mesh.geometry.getAttribute("uv1");
    const hasColor = !!mesh.geometry.getAttribute("color");
    const dressMaterial = (m: Material): Material => {
      const seen = swapped.get(m);
      if (seen) return seen;
      if ((m as unknown as { isMeshLambertMaterial?: boolean }).isMeshLambertMaterial) {
        swapped.set(m, m);
        return m; // the stand-in: lit by the scene's lights
      }
      const std = m as MeshStandardMaterial;
      const kind = (m.userData?.falls as string | undefined) ?? (m.name === MAT.rock ? "stone" : m.name === MAT.leaf ? "card" : "plain");
      const b = new MeshBasicMaterial({ name: m.name, map: std.map ?? null, color: std.color ?? undefined });
      b.userData = { ...m.userData };
      own.push(b, m);
      if (std.emissiveMap) own.push(std.emissiveMap);
      if (kind === "card" || kind === "bark") {
        // vertex-lit like the village's foliage: COLOR_0 = baked light x tint (bake_waterfall.py), the clock's tint on it
        b.vertexColors = hasColor;
        if (kind === "card") {
          b.alphaTest = 0.5;
          b.side = DoubleSide;
          b.transparent = false;
        }
        liftMaterial(b);
      } else if (kind === "lamp") {
        lampMaterial(b);
      } else if (o.lightmap && hasLm) {
        lightmapMaterial(b, o.lightmap);
        b.vertexColors = hasColor && (kind === "stone" || kind === "tint");
        // the macro map rides in the emissive slot (bake_waterfall.py); data, not colour
        const macro = kind === "stone" ? (std.emissiveMap ?? null) : null;
        if (macro) {
          macro.colorSpace = NoColorSpace;
          macro.needsUpdate = true;
        }
        // the ground's materials fade to the village lawn where the lawn meets the site box (W6)
        const seam = m.name === MAT.ground ? SEAM_MEAN.ground : m.name === MAT.turf ? SEAM_MEAN.turf : 0;
        // the flat rocks, seats and cobbles (one granite): their scan albedo is near white and read as plates laid
        // on the gravel (W3 review); the photos' shore granite (12, 05) is mid grey
        if (m.name === MAT.slab) b.color.multiplyScalar(SLAB_ALBEDO);
        rockMaterial(b, kind === "stone" ? "stone" : kind === "tint" ? "tint" : "plain", macro, seam);
        baked = true;
      } else if (m.name === MAT.leaf) {
        liftMaterial(b);
      }
      swapped.set(m, b);
      return b;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(dressMaterial) : dressMaterial(mesh.material);
    if (up(mesh, (n) => n.name === NODE.rockLod0)) lod0.push(mesh);
    else if (up(mesh, (n) => n.name === NODE.rockLod1)) lod1.push(mesh);
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

  const spray = createSpray({ splash: params.spray, peel: params.peel, churn: params.churn, mist: params.mist, rainbow: params.rainbow, atlas });
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
