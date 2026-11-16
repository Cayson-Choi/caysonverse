import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Camera, DirectionalLight, Object3D, PCFShadowMap, type OrthographicCamera, type Texture, type WebGLRenderer, type Scene } from "three";
import { villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { useLightRig } from "../game/lightRig";
import { isTouchDevice } from "../device";
import { COLLIDER_PREFIX, isMesh, materialsOf } from "../game/hub/hubModelPrep";
import { dayNight } from "./dayNightDriver";
import { directionFrom, linearHex, type Vec3 } from "./dayNightBlend";
import { buildBakedSunMask, type BakedSunMask, type MaskArea } from "./bakedSunMask";
import {
  BAKE_SUN,
  CASTER_TOP,
  LIGHTMAP_SUN_LIVE,
  SHADOW_REACH,
  CHUNK_LAYER,
  SHADOW_TIER,
  STATIC_CASTER_LAYER,
  SUN_DIRECT_K,
  angleDeg,
  inRenderPass,
  nearBoxFor,
  shadowPlaceholder,
  shadowTierFor,
  orthoBoxFor,
  snapToTexels,
  sunShadowUniforms as U,
  type OrthoBox,
} from "./sunShadows";
import type { VillageNodes, VillageTier } from "./villageModelPrep";
import type { VillageVegetation } from "./veg/villageVegetation";
import { vegDepthMaterial, vegSunUniform } from "./veg/vegMaterial";

declare global {
  interface Window {
    /** Dev-only: the live sun shadows' state (sunShadows.ts): the maps, their boxes, the redraw counts, the mask's build. */
    __cvSunShadows?: () => SunShadowStats;
  }
}

export interface SunShadowStats {
  tier: VillageTier;
  mode: "baked" | "live";
  dir: Vec3;
  nearRenders: number;
  farRenders: number;
  /** Slices drawn of the far cascade's maps (`farChunks` per redraw). */
  farSlices: number;
  mask: BakedSunMask["stats"] | null;
  maskError: string | null;
  near: OrthoBox | null;
  far: OrthoBox | null;
  /** The longest frame's shadow drawing (ms) so far, and the last one's. */
  maxRenderMs: number;
  lastRenderMs: number;
}

/** Materials whose meshes cast the live shadows (the village's solid parts; not its sky, hills, water, glass or glows). */
const CASTS = (name: string): boolean =>
  name.startsWith("LM_") || name === "M_bark" || name === "M_moon" || name === "M_lamp" || name.startsWith("M_leaf_");
/** The runtime vegetation that casts (the trees and bushes, their far sprites too; not the flowers in the beds, nor the beds' soil: a flat skin on the bed). */
/** The runtime street furniture (street/StreetFurniture.tsx: the lamp posts and banner poles that replace the baked ones). */
const STREET_CASTS = (name: string): boolean => name === "M_street_metal";
/** The houses' model (집 외관 A8): the walls, roofs, trims, porches and the rooms behind the windows; not the glass, the screens or the lamps' lenses. */
const HOUSE_CASTS = (name: string): boolean => name.startsWith("LM_") || name === "M_window" || name === "M_leaf_flora";
const VEG_CASTS = (name: string): boolean => name.startsWith("M_veg_") && name !== "M_veg_flowers" && name !== "M_veg_soil";

/** The area the far cascade and the mask cover: the village's walk bounds and the land round them. */
export function villageShadowArea(margin = 40): MaskArea {
  const b = villageGeometry.bounds;
  return { minX: b.minX - margin, maxX: b.maxX + margin, minZ: b.minZ - margin, maxZ: b.maxZ + margin };
}

/**
 * Mark a tree's casters: castShadow, the static layer (the cached far cascade draws only it) and one of the far
 * cascade's slice layers, round robin. Returns the next slice index.
 */
function markCasters(
  root: Object3D,
  test: (name: string) => boolean,
  slices: Object3D[][],
  marked: WeakSet<Object3D>,
  everyFrame: boolean,
  next = 0,
): number {
  root.traverse((o) => {
    if (!isMesh(o) || o.name.startsWith(COLLIDER_PREFIX) || o.name.startsWith("inst__far_")) return;
    if (marked.has(o) || !materialsOf(o).some((m) => test(m.name))) return;
    marked.add(o);
    for (let k = 0; k < 8; k++) o.layers.disable(CHUNK_LAYER + k);
    // in the scene's own (every frame) shadow pass only where the near cascade holds the village
    o.castShadow = everyFrame;
    o.layers.enable(STATIC_CASTER_LAYER);
    const k = next++ % slices.length;
    o.layers.enable(CHUNK_LAYER + k);
    slices[k]!.push(o);
    const depth = vegDepthMaterial(materialsOf(o)[0]!);
    if (depth) o.customDepthMaterial = depth;
  });
  return next;
}

/** One of this component's own shadow lights (never in the scene: they light nothing, they only draw a depth map). */
function makeLight(size: number): DirectionalLight {
  const light = new DirectionalLight();
  light.target = new Object3D();
  light.castShadow = true;
  light.shadow.mapSize.set(size, size);
  light.shadow.autoUpdate = false;
  return light;
}

/** Aim a shadow light: centre, direction, box; its matrices updated (it is not in the scene). */
function aim(light: DirectionalLight, centre: Vec3, dir: Vec3, box: OrthoBox): void {
  const cam = light.shadow.camera as OrthographicCamera;
  cam.left = box.left;
  cam.right = box.right;
  cam.bottom = box.bottom;
  cam.top = box.top;
  cam.near = box.near;
  cam.far = box.far;
  cam.updateProjectionMatrix();
  light.target.position.set(centre[0], centre[1], centre[2]);
  light.position.set(centre[0] + dir[0] * SHADOW_REACH, centre[1] + dir[1] * SHADOW_REACH, centre[2] + dir[2] * SHADOW_REACH);
  light.target.updateMatrixWorld(true);
  light.updateMatrixWorld(true);
}

/**
 * Draw one slice of a cached map now (the casters on `layers`' layer), whatever the renderer's own shadow switch says.
 * Only the first slice clears the map (three's shadow pass clears it on every call: the others skip that).
 */
function drawSlice(gl: WebGLRenderer, light: DirectionalLight, scene: Scene, layers: Camera, clear: boolean, casters: Object3D[]): void {
  const was = casters.map((o) => o.castShadow);
  for (const o of casters) o.castShadow = true;
  inRenderPass(gl, () => {
    const enabled = gl.shadowMap.enabled;
    const clearFn = gl.clear;
    gl.shadowMap.enabled = true;
    // react-three-fiber sets the old soft PCF again whenever it configures the renderer with shadows off (the light
    // tier); three would warn and change the type back on this pass, recompiling every material: PCF before every pass
    if (gl.shadowMap.type !== PCFShadowMap) gl.shadowMap.type = PCFShadowMap;
    if (!clear) gl.clear = () => {};
    light.shadow.needsUpdate = true;
    try {
      gl.shadowMap.render([light], scene, layers);
    } finally {
      gl.shadowMap.enabled = enabled;
      gl.clear = clearFn;
    }
  });
  casters.forEach((o, i) => {
    o.castShadow = was[i]!;
  });
}

/** Depth bias (depth units) for a box: about a texel and a half of slope. */
function depthBias(box: OrthoBox, texel: number): number {
  return (texel * 1.5) / (box.far - box.near);
}

function freeMap(l: DirectionalLight): void {
  l.shadow.map?.depthTexture?.dispose();
  l.shadow.map?.dispose();
  l.shadow.map = null;
}

/**
 * 케이슨 마을's live sun and shadows (docs/designs/sun-shadows): the cascades' maps, aimed at the real sun (the moon at
 * night), and the village materials' shared uniforms (sunShadows.ts). Mounted with the village model.
 *  - high: the scene's own key light IS the near cascade (every frame, everything that casts: the village, its trees,
 *    the players, the bus), its box round what the camera looks at, snapped to its texels;
 *  - both: the far cascade over the whole village, cached: redrawn when the sun has moved `reaimDeg` into a second map,
 *    a slice of the casters a frame, and swapped in when done (no hitch, no half-drawn frame). On the light tier it is
 *    the only one (the players keep their blob shadows).
 *  - Before the next bake (`lightmapSun` not "live"), the baked sun's visibility mask (bakedSunMask.ts) is built once.
 */
export function LiveSunShadows({
  nodes,
  source,
  lightmap,
  tier,
  veg,
  lightmapSun,
}: {
  nodes: VillageNodes;
  source: Object3D;
  lightmap: Texture;
  tier: VillageTier;
  veg: VillageVegetation | null;
  lightmapSun: string | undefined;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const rig = useLightRig();
  const cfg = SHADOW_TIER[shadowTierFor(tier, isTouchDevice)];
  const live = lightmapSun === LIGHTMAP_SUN_LIVE;
  const area = useMemo(() => villageShadowArea(), []);

  const state = useRef({
    dir: null as Vec3 | null,
    near: null as OrthoBox | null,
    nearTexel: [0.03, 0.03] as [number, number],
    far: null as OrthoBox | null,
    farActive: 0,
    farJob: null as { k: number; box: OrthoBox } | null,
    farDirty: true,
    sinceVeg: 0,
    vegCheck: 0,
    slice: 0,
    nearRenders: 0,
    farRenders: 0,
    farSlices: 0,
    maxRenderMs: 0,
    lastRenderMs: 0,
    mask: null as BakedSunMask | null,
    maskTried: false,
    maskError: null as string | null,
  });

  const lights = useMemo(() => {
    const sliceCams = Array.from({ length: cfg.farChunks }, (_, k) => {
      const c = new Camera();
      c.layers.set(CHUNK_LAYER + k);
      return c;
    });
    const all = new Camera();
    all.layers.set(STATIC_CASTER_LAYER);
    const slices = Array.from({ length: cfg.farChunks }, () => [] as Object3D[]);
    return { far: [makeLight(cfg.farSize), makeLight(cfg.farSize)] as const, sliceCams, all, slices, marked: new WeakSet<Object3D>() };
  }, [cfg]);

  // The village's casters (the clone this scene shows).
  useEffect(() => {
    state.current.slice = markCasters(nodes.root, CASTS, lights.slices, lights.marked, cfg.nearStatic, state.current.slice);
    state.current.farDirty = true;
  }, [nodes, cfg, lights]);

  // The scene's key light: aimed here while the village is shown (high: it is the near cascade).
  useEffect(() => {
    const sun = rig?.sun.current;
    if (!rig || !sun) return;
    rig.aim.external = true;
    const prevSize = sun.shadow.mapSize.clone();
    const resize = (n: number) => {
      if (sun.shadow.mapSize.x === n) return;
      sun.shadow.mapSize.set(n, n);
      freeMap(sun);
    };
    if (cfg.near) resize(cfg.nearSize);
    const prevNormalBias = sun.shadow.normalBias;
    const prevBias = sun.shadow.bias;
    const cam = sun.shadow.camera as OrthographicCamera;
    const prevBox = { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom, near: cam.near, far: cam.far };
    const prevPos = sun.position.clone();
    const prevTarget = sun.target.position.clone();
    sun.shadow.normalBias = 0.02;
    sun.shadow.bias = -0.0002;
    return () => {
      rig.aim.external = false;
      resize(prevSize.x);
      sun.shadow.normalBias = prevNormalBias;
      sun.shadow.bias = prevBias;
      Object.assign(cam, prevBox);
      cam.updateProjectionMatrix();
      sun.position.copy(prevPos);
      sun.target.position.copy(prevTarget);
    };
  }, [rig, cfg]);

  // A tier's own lights go with it (the maps are drawn again for the next tier's).
  useEffect(() => {
    const st = state.current;
    st.farDirty = true;
    st.farJob = null;
    return () => {
      for (const l of lights.far) freeMap(l);
    };
  }, [lights]);
  // Everything off and freed with the village.
  useEffect(
    () => () => {
      U.uSsOn.value.set(0, 0, 0, 0);
      U.uSsSky.value = 1;
      U.uSsKeep.value = 1;
      U.uSsNearMap.value = shadowPlaceholder();
      U.uSsFarMap.value = shadowPlaceholder();
      U.uSsBakeMask.value = null;
      state.current.mask?.dispose();
      state.current.mask = null;
      state.current.maskTried = false;
      if (import.meta.env.DEV) delete window.__cvSunShadows;
    },
    [],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __cvSunDebug?: unknown }).__cvSunDebug = { U, lights, state, rig, gl };
    window.__cvSunShadows = () => {
      const st = state.current;
      return {
        tier,
        mode: live ? "live" : "baked",
        dir: st.dir ? [...st.dir] : [0, 1, 0],
        nearRenders: st.nearRenders,
        farRenders: st.farRenders,
        farSlices: st.farSlices,
        mask: st.mask?.stats ?? null,
        maskError: st.maskError,
        near: st.near,
        far: st.far,
        maxRenderMs: st.maxRenderMs,
        lastRenderMs: st.lastRenderMs,
      };
    };
  }, [tier, live, lights, rig, gl]);

  useFrame(({ camera }, delta) => {
    const st = state.current;
    const s = dayNight.applied;
    const t0 = performance.now();
    let drew = false;

    // The baked sun's mask, once (before the next bake only).
    if (!live && !st.maskTried) {
      st.maskTried = true;
      const size = (lightmap.image as { width?: number } | null)?.width ?? 2048;
      try {
        inRenderPass(gl, () => {
          st.mask = buildBakedSunMask(gl, source, size, directionFrom(BAKE_SUN.azimuthDeg, BAKE_SUN.elevationDeg), area);
        });
      } catch (e) {
        console.error("[sun] baked sun mask failed", e);
        st.mask = null;
        st.maskError = String(e instanceof Error ? e.stack ?? e.message : e).slice(0, 600);
      }
      drew = true;
    }

    // The direction: re-aimed in steps (the maps' shadows never crawl with the eased sun).
    const want = s.shadowDir;
    if (!st.dir || angleDeg(st.dir, want) > cfg.reaimDeg) {
      st.dir = [want[0], want[1], want[2]];
      st.near = nearBoxFor(st.dir, cfg.nearHalf);
      st.nearTexel = [(st.near.right - st.near.left) / cfg.nearSize, (st.near.top - st.near.bottom) / cfg.nearSize];
      st.farDirty = true;
    }
    const dir = st.dir;
    // The runtime trees grow in steps (and come back from the park): new ones are made casters once a second, and the
    // far cascade is redrawn half a second after the last change.
    st.sinceVeg += delta;
    st.vegCheck += delta;
    if (st.vegCheck > 1) {
      st.vegCheck = 0;
      const before = st.slice;
      if (veg) st.slice = markCasters(veg.group, VEG_CASTS, lights.slices, lights.marked, cfg.nearStatic, st.slice);
      // the street furniture's posts (mounted beside the model, not in it: the baked posts it replaces are trimmed out)
      for (const o of scene.children) {
        if (o === nodes.root) continue;
        // the houses' own model (집 외관 A8, houses/VillageHouses.tsx): its solid parts cast like the village's
        st.slice = markCasters(o, o.userData.cvHouses === true ? HOUSE_CASTS : STREET_CASTS, lights.slices, lights.marked, cfg.nearStatic, st.slice);
      }
      if (st.slice !== before) {
        st.farDirty = true;
        st.sinceVeg = 0;
      }
    }

    // The far cascade: a new aim starts a redraw into the spare map, a slice a frame, swapped in when it is whole.
    if (st.farDirty && st.sinceVeg > 0.5) {
      const centre: Vec3 = [(area.minX + area.maxX) / 2, 0, (area.minZ + area.maxZ) / 2];
      const box = orthoBoxFor(dir, centre, { ...area, top: CASTER_TOP });
      aim(lights.far[1 - st.farActive]!, centre, dir, box);
      st.farJob = { k: 0, box };
      st.farDirty = false;
    }
    const job = st.farJob;
    if (job) {
      const spare = lights.far[1 - st.farActive]!;
      drawSlice(gl, spare, scene, lights.sliceCams[job.k]!, job.k === 0, lights.slices[job.k]!);
      job.k++;
      st.farSlices++;
      drew = true;
      if (job.k >= cfg.farChunks) {
        st.farActive = 1 - st.farActive;
        st.far = job.box;
        st.farJob = null;
        st.farRenders++;
      }
    }

    // The near cascade's spot: what the camera looks at (half a box ahead of it), snapped to the box's texels.
    const near = st.near!;
    const fwdX = -camera.matrixWorld.elements[8];
    const fwdZ = -camera.matrixWorld.elements[10];
    const fl = Math.hypot(fwdX, fwdZ) || 1;
    const spot: Vec3 = [camera.position.x + (fwdX / fl) * cfg.nearHalf * 0.45, 0, camera.position.z + (fwdZ / fl) * cfg.nearHalf * 0.45];
    const sun = rig?.sun.current;
    if (sun) {
      const c = snapToTexels(spot, dir, st.nearTexel[0], st.nearTexel[1]);
      if (cfg.near) {
        // the scene's key light is the near cascade: three draws it with the frame
        const cam = sun.shadow.camera as OrthographicCamera;
        if (cam.left !== near.left || cam.right !== near.right || cam.top !== near.top || cam.bottom !== near.bottom || cam.far !== near.far || cam.near !== near.near) {
          cam.left = near.left;
          cam.right = near.right;
          cam.bottom = near.bottom;
          cam.top = near.top;
          cam.near = near.near;
          cam.far = near.far;
          cam.updateProjectionMatrix();
        }
        st.nearRenders++;
      }
      // (light tier: only aimed, so the players are lit from the sun's side)
      sun.target.position.set(c[0], c[1], c[2]);
      sun.position.set(c[0] + dir[0] * SHADOW_REACH, c[1] + dir[1] * SHADOW_REACH, c[2] + dir[2] * SHADOW_REACH);
    }
    if (drew) {
      st.lastRenderMs = performance.now() - t0;
      st.maxRenderMs = Math.max(st.maxRenderMs, st.lastRenderMs);
    }

    // The uniforms.
    const farLight = lights.far[st.farActive]!;
    const nearMap = cfg.near ? sun?.shadow.map?.depthTexture ?? null : null;
    const farMap = st.far ? farLight.shadow.map?.depthTexture ?? null : null;
    const none = shadowPlaceholder();
    U.uSsNearMap.value = nearMap ?? none;
    U.uSsFarMap.value = farMap ?? none;
    if (nearMap && sun) U.uSsNearMat.value = sun.shadow.matrix;
    U.uSsFarMat.value = farLight.shadow.matrix;
    const far = st.far;
    const farTexel = far ? Math.max(far.right - far.left, far.top - far.bottom) / cfg.farSize : 0.25;
    const nearTexel = Math.max(st.nearTexel[0], st.nearTexel[1]);
    U.uSsTexel.value.set(nearTexel, farTexel, depthBias(near, nearTexel), far ? depthBias(far, farTexel) : 0);
    U.uSsUv.value.set(1.15 / cfg.nearSize, 1.0 / cfg.farSize, 0, 0);
    U.uSsSunDir.value.set(dir[0], dir[1], dir[2]);
    U.uSsSun.value.set(s.sunDirect[0], s.sunDirect[1], s.sunDirect[2]);
    const sunShare = Math.min(1, s.sunDirect[0] / SUN_DIRECT_K);
    U.uSsSky.value = s.skyShare;
    U.uSsKeep.value = s.exposureKeep;
    U.uSsShade.value.set(s.moonShade, Math.min(0.45, 0.35 * sunShare) + s.moonShade, 0, Math.min(1, 0.85 * sunShare + s.moonShade));
    vegSunUniform.value.set(dir[0], dir[1], dir[2]);
    const mask = st.mask;
    U.uSsBakeMask.value = mask?.texture ?? null;
    U.uSsOn.value.set(nearMap ? 1 : 0, farMap ? 1 : 0, !live && mask ? 1 : 0, 1);
    if (import.meta.env.DEV) {
      const diag = (window as { __cvSunDiag?: { near?: boolean; far?: boolean; mask?: boolean; all?: boolean; debug?: number; bias?: number } }).__cvSunDiag;
      if (diag) {
        if (diag.near) U.uSsOn.value.x = 0;
        if (diag.far) U.uSsOn.value.y = 0;
        if (diag.mask) U.uSsOn.value.z = 0;
        if (diag.all) U.uSsOn.value.set(0, 0, 0, 0);
        U.uSsShade.value.z = diag.debug ?? 0;
        if (diag.bias !== undefined) {
          U.uSsTexel.value.z = diag.bias;
          U.uSsTexel.value.w = diag.bias;
        }
      }
    }
  });

  useMemo(() => {
    const d = directionFrom(BAKE_SUN.azimuthDeg, BAKE_SUN.elevationDeg);
    U.uSsBakeDir.value.set(d[0], d[1], d[2]);
    const c = linearHex(BAKE_SUN.colour);
    U.uSsBakeSun.value.set(SUN_DIRECT_K * c[0], SUN_DIRECT_K * c[1], SUN_DIRECT_K * c[2]);
  }, []);
  return null;
}
