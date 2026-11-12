import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  PointsMaterial,
  SRGBColorSpace,
  ShaderLib,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector3,
} from "three";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { CAMERA_FAR } from "../game/constants";
import { LIGHTMAP_CHANNEL, LIGHTMAP_INTENSITY } from "../game/hub/hubModelPrep";
import { overviewFar } from "../game/overview";
import {
  FALLS_SPEED,
  FOUNTAIN_GLOW_STRENGTH,
  GLOW_BOOST,
  GROUND_GRADE,
  GROUND_GRADE_NIGHT,
  GROUND_LAYER_OFFSET,
  LIGHT_LIFT,
  LIT,
  MOON_GLAZE_FROM,
  MOON_LIGHT_FROM,
  MOON_PROBE,
  moonMaterial,
  moonProbe,
  STAR_COUNT,
  STAR_RADIUS,
  STAR_SIZE,
  VILLAGE_CAMERA_PLANES,
  VILLAGE_GROUND_DECAL,
  applyDayNight,
  cherryTintUniform,
  liftMaterial,
  dayTintUniform,
  disposeVillage,
  disposeVillageSource,
  foliageTintUniform,
  drawCallBudget,
  fallsDown,
  fitSkyMapping,
  liftTintUniform,
  liftUniform,
  litUniform,
  makeStars,
  moonTintUniform,
  nightBlendUniform,
  nightMapUniform,
  prepareVillage,
  setNightLightmap,
  tickVillage,
  LIGHT_TIER_MAX_TEXTURE,
  capModelTextures,
  capTextureSize,
  configureModelTextureFiltering,
  type CanvasLike,
  FOLIAGE_NEAR_FADE,
  nearFadeUniform,
} from "./villageModelPrep";
import { NEAR_FADE_KEY } from "../game/clickPick";
import { DAY_LIFT, NIGHT_LOOK, dayNightAt, indoorState, type DayNightState } from "./dayNightBlend";
import { parseKstTime } from "@caysonverse/shared/village/sunClock";
import { HALL_ACTIVE_MAP, VILLAGE_ACTIVE_MAP, VILLAGE_CAMERA_PAD } from "../game/activeMap";
import { DEFAULT_DECAL_Y } from "../game/groundDecal";
import { setRenderScale } from "../game/renderScale";

/**
 * A node tree with the names and materials the village.glb contract promises (Task 6 report): the same shape the
 * GLTFLoader hands over (unlit MeshBasicMaterials, GPU instances as InstancedMeshes), built by hand so no loader,
 * Draco decoder or WebGL is needed.
 */

function mat(name: string, extra: Partial<MeshBasicMaterial> = {}): MeshBasicMaterial {
  const m = new MeshBasicMaterial();
  m.name = name;
  Object.assign(m, extra);
  return m;
}

function mesh(name: string, material: MeshBasicMaterial, geometry: BufferGeometry = new BoxGeometry(1, 1, 1)): Mesh {
  const m = new Mesh(geometry, material);
  m.name = name;
  return m;
}

/** The model's dome: a 1,400 m sphere cap centred 60 m below the ground, reaching 10° under the horizon. */
const DOME = { radius: 1400, centreY: -60, belowHorizonDeg: 10 } as const;
/** How the model lays its sky texture on directions (measured from village.glb's dome): u = fract(-az/2π + 0.5), v = 0.9 - 0.573 el. */
const DOME_MAP = { uSign: -1, uOffset: 0.5, vScale: -0.573, vOffset: 0.9 } as const;

function domeGeometry(): BufferGeometry {
  const g = new SphereGeometry(DOME.radius, 48, 24, 0, Math.PI * 2, 0, ((90 + DOME.belowHorizonDeg) * Math.PI) / 180);
  const pos = g.getAttribute("position");
  const uv = new Float32Array(pos.count * 2);
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const az = Math.atan2(p.x, p.z);
    const el = Math.asin(Math.max(-1, Math.min(1, p.y / DOME.radius)));
    uv[i * 2] = (((DOME_MAP.uSign * az) / (2 * Math.PI) + DOME_MAP.uOffset) % 1 + 1) % 1;
    uv[i * 2 + 1] = DOME_MAP.vScale * el + DOME_MAP.vOffset;
  }
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.translate(0, DOME.centreY, 0);
  return g;
}

/** A waterfall sheet standing in the XY plane, 10 m tall; `vDown`: v grows as the sheet goes down. */
function fallsGeometry(vDown: boolean): BufferGeometry {
  const g = new PlaneGeometry(4, 10);
  if (vDown) {
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  }
  return g;
}

interface Fixture {
  root: Object3D;
  mats: Record<string, MeshBasicMaterial>;
  textures: Record<string, Texture>;
  /** The fountain's crescent: unlit, no light map, as GLTFLoader makes it for `M_moon` (KHR_materials_unlit). */
  moon: MeshBasicMaterial;
}

function fixture(): Fixture {
  const textures = { water: new Texture(), sky: new Texture(), falls: new Texture(), leaf: new Texture() };
  const mats = {
    LM_plaza: mat("LM_plaza"),
    LM_grass: mat("LM_grass"),
    LM_lawn: mat("LM_lawn"),
    LM_concrete: mat("LM_concrete"),
    LM_wood: mat("LM_wood"),
    M_sky: mat("M_sky", { map: textures.sky }),
    M_backdrop: mat("M_backdrop"),
    M_glow_plot: mat("M_glow_plot"),
    M_water: mat("M_water", { map: textures.water, transparent: true, depthWrite: false }),
    M_waterfall: mat("M_waterfall", { map: textures.falls, transparent: true }),
    M_leaf_green: mat("M_leaf_green", { map: textures.leaf, alphaTest: 0.5 }),
    M_window: mat("M_window"),
    M_lamp: mat("M_lamp"),
    M_glass: mat("M_glass", { transparent: true }),
  };
  mats.M_glow_plot.color.setRGB(0.016, 0.65, 1);
  const root = new Object3D();
  const lm = new Mesh(new BoxGeometry(1, 1, 1), [mats.LM_plaza, mats.LM_grass, mats.LM_lawn, mats.LM_concrete, mats.LM_wood]);
  lm.name = "village_lm_11";
  root.add(lm);
  root.add(mesh("village_fx_11", mats.M_glow_plot), mesh("village_fx_12", mats.M_window), mesh("village_fx_10", mats.M_lamp));
  root.add(mesh("village_glass", mats.M_glass));
  const pool = mesh("village_water_11", mats.M_water, new PlaneGeometry(12, 12).rotateX(-Math.PI / 2));
  root.add(pool, mesh("village_water_12", mats.M_water, new PlaneGeometry(6, 40).rotateX(-Math.PI / 2)));
  const falls = mesh("village_water_-10", mats.M_waterfall, fallsGeometry(true));
  falls.position.set(-118, 18, -78);
  root.add(falls);
  root.add(mesh("village_sky", mats.M_sky, domeGeometry()));
  root.add(mesh("village_backdrop", mats.M_backdrop));
  root.add(mesh("village_leaf_10", mats.M_leaf_green));
  const far = new InstancedMesh(new PlaneGeometry(1, 1), mats.M_leaf_green, 2334);
  far.name = "inst__far_0_0";
  const street = new InstancedMesh(new PlaneGeometry(1, 1), mats.M_leaf_green, 19);
  street.name = "inst__street_green_1";
  root.add(far, street);
  root.add(mesh("col__house_1", mats.LM_wood), mesh("col__tree_1", mats.LM_wood), mesh("col__stream_bank_1", mats.LM_wood));
  const moon = mat("M_moon", { map: new Texture() });
  const moonMesh = new Mesh(new SphereGeometry(1, 8, 6), moon);
  moonMesh.name = "fountain_moon";
  root.add(moonMesh);
  return { root, mats, textures, moon };
}

const named = (root: Object3D, name: string) => root.getObjectByName(name) as Mesh;
const materialOf = (root: Object3D, name: string) => named(root, name).material as MeshBasicMaterial;

describe("prepareVillage: the model dressed for the game", () => {
  it("raises anisotropic filtering on oblique model textures without touching the source tree", () => {
    const f = fixture();
    expect(configureModelTextureFiltering(f.root, 8)).toBeGreaterThan(0);
    expect(f.textures.leaf.anisotropy).toBe(8);
    expect(configureModelTextureFiltering(f.root, 4)).toBe(0);
  });

  it("works on a clone and hides every col__ box (and nothing else)", () => {
    const f = fixture();
    const nodes = prepareVillage(f.root, new Texture(), "high");
    expect(nodes.root).not.toBe(f.root);
    for (const n of ["col__house_1", "col__tree_1", "col__stream_bank_1"]) {
      expect(nodes.root.getObjectByName(n)!.visible, n).toBe(false);
      expect(f.root.getObjectByName(n)!.visible, `${n} in the source`).toBe(true);
    }
    for (const n of ["village_lm_11", "village_sky", "village_water_11", "inst__far_0_0"]) expect(nodes.root.getObjectByName(n)!.visible, n).toBe(true);
  });

  it("puts the light map on every LM_ material (the hub's recipe) and on nothing else", () => {
    const f = fixture();
    const lightmap = new Texture();
    lightmap.flipY = true;
    prepareVillage(f.root, lightmap, "low");
    for (const m of [f.mats.LM_plaza, f.mats.LM_grass, f.mats.LM_lawn, f.mats.LM_concrete, f.mats.LM_wood]) {
      expect(m.lightMap, m.name).toBe(lightmap);
      expect(m.lightMapIntensity, m.name).toBeCloseTo(LIGHTMAP_INTENSITY, 9);
    }
    expect(lightmap.channel).toBe(LIGHTMAP_CHANNEL);
    expect(lightmap.flipY).toBe(false);
    expect(lightmap.colorSpace).toBe(SRGBColorSpace);
    for (const m of [f.mats.M_sky, f.mats.M_backdrop, f.mats.M_glow_plot, f.mats.M_window, f.mats.M_lamp, f.mats.M_leaf_green]) expect(m.lightMap, m.name).toBeNull();
  });

  it("the ground's thin layers get a polygon offset (the upper layer wins); the base grass gets none", () => {
    const f = fixture();
    prepareVillage(f.root, new Texture(), "high");
    for (const [name, units] of Object.entries(GROUND_LAYER_OFFSET)) {
      const m = (f.mats as Record<string, MeshBasicMaterial>)[name];
      if (!m) continue;
      expect(m.polygonOffset, name).toBe(true);
      expect(m.polygonOffsetUnits, name).toBe(units);
      expect(m.polygonOffsetFactor, name).toBe(-1);
    }
    expect(GROUND_LAYER_OFFSET.LM_concrete).toBeLessThan(GROUND_LAYER_OFFSET.LM_lawn!); // the lanes run over the plot lawns
    expect(f.mats.LM_grass.polygonOffset).toBe(false);
    expect(f.mats.LM_wood.polygonOffset).toBe(false);
  });

  it("grades the ground: the lawns brighter and sunnier, the pale plaza a little darker; the rest as the model has it", () => {
    const f = fixture();
    prepareVillage(f.root, new Texture(), "high");
    prepareVillage(f.root, new Texture(), "high"); // idempotent: set, not multiplied
    for (const [name, rgb] of Object.entries(GROUND_GRADE)) {
      const m = (f.mats as Record<string, MeshBasicMaterial>)[name]!;
      expect(m.color.toArray(), name).toEqual([...rgb]);
    }
    expect(GROUND_GRADE.LM_grass![1]).toBeGreaterThan(1);
    expect(GROUND_GRADE.LM_plaza![0]).toBeLessThan(1);
    expect(f.mats.LM_wood.color.toArray()).toEqual([1, 1, 1]);
  });

  it("the plaza's grade is about 0.7: under exposure 1.4 its pale paving stays below the neutral curve's shoulder, so a live shadow reads (T7 review m8)", () => {
    for (const c of GROUND_GRADE.LM_plaza!) {
      expect(c).toBeGreaterThanOrEqual(0.65);
      expect(c).toBeLessThanOrEqual(0.72);
    }
  });

  it("the plot outlines glow: a copy pushed past white (×GLOW_BOOST) and seen through the fog; the shared one is untouched", () => {
    const f = fixture();
    const nodes = prepareVillage(f.root, new Texture(), "high");
    const glow = materialOf(nodes.root, "village_fx_11");
    expect(glow).not.toBe(f.mats.M_glow_plot);
    expect(nodes.own).toContain(glow);
    expect(glow.color.b).toBeCloseTo(GLOW_BOOST, 6);
    expect(glow.color.g).toBeCloseTo(0.65 * GLOW_BOOST, 6);
    expect(Math.max(glow.color.r, glow.color.g, glow.color.b)).toBeGreaterThan(1);
    expect(glow.fog).toBe(false);
    // A second dressing starts again from the model's colour.
    const again = prepareVillage(f.root, new Texture(), "high");
    expect(materialOf(again.root, "village_fx_11").color.b).toBeCloseTo(GLOW_BOOST, 6);
    expect(f.mats.M_glow_plot.color.b).toBe(1);
  });

  it("keeps the backdrop fog-free: the hills and range (M_backdrop) and the forest cards on them; the village's own trees stay in the fog", () => {
    const f = fixture();
    const nodes = prepareVillage(f.root, new Texture(), "high");
    expect(materialOf(nodes.root, "village_backdrop").fog).toBe(false);
    const forest = materialOf(nodes.root, "inst__far_0_0");
    expect(forest.fog).toBe(false);
    expect(forest).not.toBe(f.mats.M_leaf_green);
    expect(forest.alphaTest).toBe(0.5); // still the leaf cards' cut-out
    expect(forest.map).toBe(f.textures.leaf);
    expect(materialOf(nodes.root, "village_leaf_10")).toBe(f.mats.M_leaf_green);
    expect(materialOf(nodes.root, "inst__street_green_1")).toBe(f.mats.M_leaf_green);
    expect(f.mats.M_leaf_green.fog).toBe(true);
  });

  it("the sky dome: no fog, never tone-mapped; the rich tier pre-distorts it by the inverse tone curve, the light tier does not", () => {
    const f = fixture();
    const high = prepareVillage(f.root, new Texture(), "high");
    const low = prepareVillage(f.root, new Texture(), "low");
    for (const n of [high, low]) {
      const sky = materialOf(n.root, "village_sky");
      expect(sky).toBe(n.sky);
      expect(sky.fog).toBe(false);
      expect(sky.toneMapped).toBe(false);
      expect(sky.map).toBe(f.textures.sky);
    }
    expect(high.sky!.userData.inverseTone).toBeDefined();
    expect(high.sky!.customProgramCacheKey()).toBe("village-sky-inverse-neutral");
    expect(low.sky!.userData.inverseTone).toBeUndefined();
    // The shader hook adds the scene's inverse curve before the tone-mapping chunk.
    const compile = (curve: "aces" | "neutral") => {
      const n = prepareVillage(fixture().root, new Texture(), "high", curve);
      const shader = { uniforms: {}, fragmentShader: "void main() {\n#include <tonemapping_fragment>\n}", vertexShader: "" };
      n.sky!.onBeforeCompile(shader as never, null as never);
      return { shader, key: n.sky!.customProgramCacheKey() };
    };
    const neutral = compile("neutral");
    expect(neutral.shader.fragmentShader).toMatch(/villageInverseTone\( gl_FragColor\.rgb \);\n#include <tonemapping_fragment>/);
    expect(neutral.shader.fragmentShader).toContain("#define VILLAGE_INVERSE_NEUTRAL");
    expect(neutral.shader.uniforms).toHaveProperty("uExposure");
    const aces = compile("aces");
    expect(aces.shader.fragmentShader).not.toContain("#define VILLAGE_INVERSE_NEUTRAL");
    expect(aces.key).toBe("village-sky-inverse-aces");
  });

  it("gives the light-mapped materials and the village's own foliage the time of day's light (shared uniforms), not the backdrop", () => {
    const f = fixture();
    const nodes = prepareVillage(f.root, new Texture(), "low");
    const patched = (m: MeshBasicMaterial) => m.customProgramCacheKey().startsWith("village-light");
    for (const m of [f.mats.LM_plaza, f.mats.LM_grass, f.mats.LM_wood, f.mats.M_leaf_green]) expect(patched(m), m.name).toBe(true);
    for (const m of [f.mats.M_window, f.mats.M_lamp, f.mats.M_glass, f.mats.M_backdrop]) expect(patched(m), m.name).toBe(false);
    expect(patched(materialOf(nodes.root, "inst__far_0_0"))).toBe(false);
    expect(liftUniform.value).toBe(LIGHT_LIFT);
    expect(LIGHT_LIFT).toBe(DAY_LIFT);
    expect(LIGHT_LIFT).toBeGreaterThan(0);
    // The hook (fed a minimal fragment shader of three's shape): the light map's texel is the day map x the dusk tint
    // blended with the night map; the lift joins the light before the albedo multiplies; vertex-lit: COLOR_0 x tint + lift.
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: [
        "void main() {",
        "#include <color_fragment>",
        "#ifdef USE_LIGHTMAP",
        "  vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );",
        "  reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;",
        "#endif",
        "#include <aomap_fragment>",
        "reflectedLight.indirectDiffuse *= diffuseColor.rgb;",
        "}",
      ].join("\n"),
      vertexShader: "",
    };
    f.mats.LM_grass.onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.uVillageLift).toBe(liftUniform);
    expect(shader.uniforms.uVillageLiftTint).toBe(liftTintUniform);
    expect(shader.uniforms.uVillageDayTint).toBe(dayTintUniform);
    expect(shader.uniforms.uVillageFoliageTint).toBe(foliageTintUniform);
    expect(shader.uniforms.uVillageNight).toBe(nightBlendUniform);
    expect(shader.uniforms.uVillageNightMap).toBe(nightMapUniform);
    const fs = shader.fragmentShader;
    expect(fs).toContain("uniform sampler2D uVillageNightMap;");
    expect(fs.indexOf("vec3 villageAlbedo = diffuseColor.rgb;")).toBeLessThan(fs.indexOf("#include <color_fragment>"));
    // Both maps are read only while they count.
    expect(fs).toContain("if ( uVillageNight < 0.999 ) lightMapTexel.rgb = texture2D( lightMap, vLightMapUv ).rgb * uVillageDayTint * ( 1.0 - uVillageNight );");
    expect(fs).toContain("vec3 villageNightLight = texture2D( uVillageNightMap, vLightMapUv ).rgb;");
    expect(fs).toContain("lightMapTexel.rgb += villageNightLight * uVillageNight;");
    expect(shader.uniforms.uVillageMoonTint).toBe(moonTintUniform);
    expect(fs).not.toContain("vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );");
    expect(fs.indexOf("indirectDiffuse += uVillageLift * uVillageLiftTint")).toBeLessThan(fs.indexOf("indirectDiffuse *= diffuseColor.rgb"));
    expect(fs).toContain("diffuseColor.rgb = ( diffuseColor.rgb + villageAlbedo * uVillageLift ) * uVillageFoliageTint;");
    // Patched once: a second dressing keeps the same hook.
    const hook = f.mats.LM_grass.onBeforeCompile;
    prepareVillage(f.root, new Texture(), "high");
    expect(f.mats.LM_grass.onBeforeCompile).toBe(hook);
  });

  it("the village's own leaves and trunks fade out near the camera (the camera in a street tree's crown); the ground does not", () => {
    const f = fixture();
    prepareVillage(f.root, new Texture(), "low");
    const compileOf = (m: MeshBasicMaterial) => {
      const shader = { uniforms: {} as Record<string, unknown>, fragmentShader: "void main() {\n#include <color_fragment>\n}", vertexShader: "" };
      m.onBeforeCompile(shader as never, null as never);
      return shader;
    };
    const leaf = compileOf(f.mats.M_leaf_green);
    expect(leaf.uniforms.uVillageNearFade).toBe(nearFadeUniform);
    expect(nearFadeUniform.value.toArray()).toEqual([...FOLIAGE_NEAR_FADE]);
    expect(leaf.fragmentShader).toContain("float villageDepth = 1.0 / gl_FragCoord.w;");
    expect(leaf.fragmentShader).toContain("if ( villageKeep < villageNoise ) discard;");
    // the fade runs first in main(), before anything is shaded
    expect(leaf.fragmentShader.indexOf("discard")).toBeLessThan(leaf.fragmentShader.indexOf("#include <color_fragment>"));
    expect(f.mats.M_leaf_green.customProgramCacheKey()).toBe("village-light-foliage");
    // the click pick skips these leaves nearer than the fade's middle (clickPick.ts)
    expect(f.mats.M_leaf_green.userData[NEAR_FADE_KEY]).toBeCloseTo((FOLIAGE_NEAR_FADE[0] + FOLIAGE_NEAR_FADE[1]) / 2, 9);
    const ground = compileOf(f.mats.LM_grass);
    expect(ground.uniforms).not.toHaveProperty("uVillageNearFade");
    expect(ground.fragmentShader).not.toContain("discard");
    expect(f.mats.LM_grass.customProgramCacheKey()).toBe("village-light");
    expect(f.mats.LM_grass.userData[NEAR_FADE_KEY]).toBeUndefined();
    expect(FOLIAGE_NEAR_FADE[0]).toBeGreaterThan(VILLAGE_CAMERA_PLANES.near);
  });

  it("the cherry blossoms take their own foliage tint (darker at night); every other foliage the shared one; noon is white for both", () => {
    const cherry = mat("M_leaf_cherry");
    const green = mat("M_leaf_green");
    liftMaterial(cherry);
    liftMaterial(green);
    const hook = (m: MeshBasicMaterial) => {
      const shader = { uniforms: {} as Record<string, unknown>, fragmentShader: "void main() {}", vertexShader: "" };
      m.onBeforeCompile(shader as never, null as never);
      return shader.uniforms;
    };
    expect(hook(cherry).uVillageFoliageTint).toBe(cherryTintUniform);
    expect(hook(green).uVillageFoliageTint).toBe(foliageTintUniform);
    const nodes = prepareVillage(fixture().root, new Texture(), "low");
    applyDayNight(nodes, dayNightAt(parseKstTime("2026-06-21T12:30")!));
    expect(cherryTintUniform.value.toArray()).toEqual([1, 1, 1]);
  });

  it("the night light map: configured like the day one (same UV set), shared with every patched material; none = no map", () => {
    const f = fixture();
    const day = new Texture();
    const night = new Texture();
    night.flipY = true;
    prepareVillage(f.root, day, "low", "neutral", night);
    expect(nightMapUniform.value).toBe(night);
    expect(night.channel).toBe(LIGHTMAP_CHANNEL);
    expect(night.flipY).toBe(false);
    expect(night.colorSpace).toBe(SRGBColorSpace);
    for (const m of [f.mats.LM_plaza, f.mats.LM_grass, f.mats.LM_wood]) expect(m.lightMap, m.name).toBe(day);
    // Left out (the night map loads on its own when night is near, final fix I2b): the current one stays.
    prepareVillage(f.root, day, "low");
    expect(nightMapUniform.value).toBe(night);
    prepareVillage(f.root, day, "low", "neutral", null);
    expect(nightMapUniform.value).toBeNull();
  });

  it("no night map yet: the night blend stays 0 (the day map alone, never a black lightmap); with it, the clock's weight", () => {
    const nodes = prepareVillage(fixture().root, new Texture(), "low");
    const night = dayNightAt(parseKstTime("2026-11-03T23:30")!);
    expect(night.night).toBeGreaterThan(0.9);
    setNightLightmap(null);
    applyDayNight(nodes, night);
    expect(nightBlendUniform.value).toBe(0);
    setNightLightmap(new Texture());
    applyDayNight(nodes, night);
    expect(nightBlendUniform.value).toBeCloseTo(night.night, 6);
    setNightLightmap(null);
  });

  it("the light tier caps oversized model textures at 2048 px; the rich tier leaves them", () => {
    const big = () => {
      const t = new Texture();
    t.image = { width: 4096, height: 2048 };
      return t;
    };
    const drawn: Array<[number, number]> = [];
    const canvas = (): CanvasLike => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: (_i: never, _x: number, _y: number, w: number, h: number) => void drawn.push([w, h]) }),
    });
    const t = big();
    const v0 = t.version;
    expect(capTextureSize(t, LIGHT_TIER_MAX_TEXTURE, canvas)).toBe(true);
    expect(drawn).toEqual([[2048, 1024]]);
    expect((t.image as CanvasLike).width).toBe(2048);
    expect((t.image as CanvasLike).height).toBe(1024);
    expect(t.version).toBeGreaterThan(v0);
    expect(capTextureSize(t, LIGHT_TIER_MAX_TEXTURE, canvas)).toBe(false); // once
    const small = new Texture();
    small.image = { width: 2048, height: 2048 };
    expect(capTextureSize(small, LIGHT_TIER_MAX_TEXTURE, canvas)).toBe(false);
    expect(capTextureSize(big(), LIGHT_TIER_MAX_TEXTURE, () => null)).toBe(false); // no canvas: left as it is
    let closed = false;
    const bitmap = new Texture();
    bitmap.image = { width: 4096, height: 4096, close: () => void (closed = true) };
    expect(capTextureSize(bitmap, LIGHT_TIER_MAX_TEXTURE, canvas)).toBe(true);
    expect(closed).toBe(true);
    // A texture already on the GPU (the graphics setting changed mid-visit) keeps its image: its storage is immutable.
    const uploaded = big();
    expect(capTextureSize(uploaded, LIGHT_TIER_MAX_TEXTURE, canvas, () => true)).toBe(false);
    expect((uploaded.image as { width: number }).width).toBe(4096);
    expect(capTextureSize(uploaded, LIGHT_TIER_MAX_TEXTURE, canvas, () => false)).toBe(true);
    const onGpu = big();
    const root2 = new Object3D();
    root2.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map: onGpu })));
    expect(capModelTextures(root2, LIGHT_TIER_MAX_TEXTURE, canvas, (t) => t === onGpu)).toBe(0);
    // The model: every material map once (shared maps counted once), the light map never.
    const root = new Object3D();
    const shared = big();
    const lm = big();
    const m1 = new MeshBasicMaterial({ map: shared });
    m1.lightMap = lm;
    root.add(new Mesh(new BoxGeometry(), m1), new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map: shared })));
    expect(capModelTextures(root, LIGHT_TIER_MAX_TEXTURE, canvas)).toBe(1);
    expect((lm.image as { width: number }).width).toBe(4096);
  });

  it("the water: one runtime water material on every M_water surface, reflecting the dome as it is laid on the sky", () => {
    const f = fixture();
    const high = prepareVillage(f.root, new Texture(), "high");
    const low = prepareVillage(f.root, new Texture(), "low");
    for (const [n, detail] of [
      [high, true],
      [low, false],
    ] as const) {
      const w = named(n.root, "village_water_11").material as ShaderMaterial;
      expect(w).toBe(n.water);
      expect(named(n.root, "village_water_12").material).toBe(w);
      expect(w).toBeInstanceOf(ShaderMaterial);
      expect(w.transparent).toBe(true);
      expect(w.depthWrite).toBe(false);
      expect(w.fog).toBe(true);
      expect(w.uniforms.uMap!.value).toBe(f.textures.water);
      expect(w.uniforms.uSky!.value).toBe(f.textures.sky);
      expect("WATER_DETAIL" in w.defines).toBe(detail);
      expect(n.own).toContain(w);
      expect(n.own).toContain(w.uniforms.uRipple!.value);
    }
    const map = high.skyMapping;
    expect(map.uSign).toBe(DOME_MAP.uSign);
    expect(map.uOffset).toBeCloseTo(DOME_MAP.uOffset, 3);
    expect(map.vScale).toBeCloseTo(DOME_MAP.vScale, 3);
    expect(map.vOffset).toBeCloseTo(DOME_MAP.vOffset, 3);
    expect((high.water!.uniforms.uSkyMap!.value as { x: number }).x).toBe(DOME_MAP.uSign);
  });

  it("the waterfall slides down its sheet: a copy of its material and map, moved every frame", () => {
    const f = fixture();
    const nodes = prepareVillage(f.root, new Texture(), "low");
    const falls = materialOf(nodes.root, "village_water_-10");
    expect(falls).not.toBe(f.mats.M_waterfall);
    expect(falls.map).toBe(nodes.falls!.map);
    expect(falls.map).not.toBe(f.textures.falls);
    expect(nodes.falls!.down).toBe(1);
    tickVillage(nodes, 1, 1);
    expect(nodes.falls!.map.offset.y).toBeCloseTo(-FALLS_SPEED, 9);
    expect(f.textures.falls.offset.y).toBe(0);
    tickVillage(nodes, 2.5, 1.15);
    expect(nodes.water!.uniforms.uTime!.value).toBe(2.5);
  });

  it("tickVillage keeps the rich tier's dome in step with the renderer's exposure", () => {
    const nodes = prepareVillage(fixture().root, new Texture(), "high");
    tickVillage(nodes, 0, 1.3);
    expect(nodes.sky!.userData.inverseTone.uExposure.value).toBe(1.3);
  });

  it("windows and lamps are copies that glow warm and past white once lit; the glass stays as the model has it (not emissive)", () => {
    const f = fixture();
    const nodes = prepareVillage(f.root, new Texture(), "high");
    const window = materialOf(nodes.root, "village_fx_12");
    const lamp = materialOf(nodes.root, "village_fx_10");
    expect(window).not.toBe(f.mats.M_window);
    expect(lamp).not.toBe(f.mats.M_lamp);
    expect(window.name).toBe("M_window");
    expect(lamp.name).toBe("M_lamp");
    expect(nodes.own).toContain(window);
    expect(nodes.own).toContain(lamp);
    expect(materialOf(nodes.root, "village_glass")).toBe(f.mats.M_glass);
    expect(f.mats.M_glass.toneMapped).toBe(true);
    expect(f.mats.M_glass.customProgramCacheKey()).not.toBe("village-lit");
    // The hook: map_fragment is followed by the glow, mixed by the shared lit weight.
    const compile = (m: MeshBasicMaterial) => {
      const shader = {
        uniforms: {} as Record<string, { value: unknown }>,
        fragmentShader: "void main() {\n#include <map_fragment>\n#include <color_fragment>\n}",
        vertexShader: "",
      };
      m.onBeforeCompile(shader as never, null as never);
      return shader;
    };
    const w = compile(window);
    expect(w.uniforms.uVillageLit).toBe(litUniform);
    expect((w.uniforms.uVillageLitBoost!.value as number)).toBe(LIT.window.boost);
    expect((w.uniforms.uVillageLitColor!.value as Vector3).toArray()).toEqual([...LIT.window.color]);
    expect(w.fragmentShader).toMatch(/#include <map_fragment>\nfloat villageGlowLuma/);
    expect(w.fragmentShader).toContain("uniform float uVillageLit;");
    expect(w.fragmentShader.indexOf("villageGlowLuma")).toBeLessThan(w.fragmentShader.indexOf("#include <color_fragment>"));
    expect((compile(lamp).uniforms.uVillageLitBoost!.value as number)).toBe(LIT.lamp.boost);
    expect(window.customProgramCacheKey()).toBe("village-lit");
    // Glowing means past white: the boosted glow colour exceeds 1, so the rich tier's bloom (threshold 1.6) takes it.
    expect(Math.max(...LIT.window.color) * LIT.window.boost).toBeGreaterThan(1.6);
    expect(Math.max(...LIT.lamp.color) * LIT.lamp.boost).toBeGreaterThan(1.6);
  });

  it("the fountain's crescent (M_moon) gets the bake's light as a probe: never light-mapped, lifted or graded, patched once", () => {
    const f = fixture();
    prepareVillage(f.root, new Texture(), "high");
    expect(f.moon.lightMap).toBeNull();
    expect(f.moon.customProgramCacheKey()).toBe("village-moon");
    expect(f.moon.color.toArray()).toEqual([1, 1, 1]);
    const patch = f.moon.onBeforeCompile;
    prepareVillage(f.root, new Texture(), "low"); // a second dressing (another tier) patches it once
    expect(f.moon.onBeforeCompile).toBe(patch);
    expect(named(f.root, "fountain_moon").material).toBe(f.moon); // the shared material, not a copy
  });

  it("disposeVillage releases its own copies and nothing of the loader's cache", () => {
    const f = fixture();
    const nodes = prepareVillage(f.root, new Texture(), "high");
    const disposed = new Set<unknown>();
    for (const r of nodes.own) r.addEventListener("dispose", () => disposed.add(r));
    const shared = [...Object.values(f.mats), ...Object.values(f.textures)];
    for (const r of shared) r.addEventListener("dispose", () => disposed.add(r));
    disposeVillage(nodes);
    for (const r of nodes.own) expect(disposed.has(r)).toBe(true);
    for (const r of shared) expect(disposed.has(r), (r as { name?: string }).name).toBe(false);
  });

  it("disposeVillage frees the clone's own instance buffers (InstancedMesh.dispose), never the loader's (T7 review I1)", () => {
    const f = fixture();
    const instanced = (root: Object3D) => {
      const out: InstancedMesh[] = [];
      root.traverse((o) => {
        if ((o as InstancedMesh).isInstancedMesh) out.push(o as InstancedMesh);
      });
      return out;
    };
    const source = instanced(f.root);
    const nodes = prepareVillage(f.root, new Texture(), "low");
    const clone = instanced(nodes.root);
    expect(clone).toHaveLength(2);
    for (const m of clone) expect(source).not.toContain(m);
    // The clone's instanceMatrix is its own buffer (InstancedMesh.copy), the one the renderer frees on "dispose".
    for (let i = 0; i < clone.length; i++) expect(clone[i]!.instanceMatrix).not.toBe(source[i]!.instanceMatrix);
    const disposed = new Set<unknown>();
    for (const m of [...clone, ...source]) m.addEventListener("dispose", () => disposed.add(m));
    disposeVillage(nodes);
    for (const m of clone) expect(disposed.has(m)).toBe(true);
    for (const m of source) expect(disposed.has(m)).toBe(false);
  });

  it("disposeVillageSource frees the loaded model itself: geometry, materials, their maps and light maps, instance buffers (once each)", () => {
    const f = fixture();
    const lightmap = new Texture();
    prepareVillage(f.root, lightmap, "low");
    const seen = new Map<unknown, number>();
    const watch = (r: { addEventListener(t: "dispose", l: () => void): void }) =>
      r.addEventListener("dispose", () => seen.set(r, (seen.get(r) ?? 0) + 1));
    const all: Array<{ addEventListener(t: "dispose", l: () => void): void }> = [lightmap, ...Object.values(f.mats), ...Object.values(f.textures)];
    f.root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) all.push(m.geometry);
      if ((o as InstancedMesh).isInstancedMesh) all.push(o as InstancedMesh);
    });
    const unique = [...new Set(all)];
    for (const r of unique) watch(r);
    disposeVillageSource(f.root);
    for (const r of unique) expect(seen.get(r), (r as { name?: string }).name ?? String(r)).toBe(1);
  });

  it("the dressed village is frozen in place: no node's matrix is recomputed per frame, and each keeps its world matrix", () => {
    const f = fixture();
    const placed = f.root.getObjectByName("village_lm_11")!;
    placed.position.set(3, 1, -7);
    placed.updateMatrix();
    const nodes = prepareVillage(f.root, new Texture(), "high");
    let n = 0;
    nodes.root.traverse((o) => {
      n++;
      expect(o.matrixAutoUpdate, o.name).toBe(false);
      expect(o.matrixWorldAutoUpdate, o.name).toBe(false);
    });
    expect(n).toBeGreaterThan(5);
    const mesh = nodes.root.getObjectByName("village_lm_11")!;
    expect(new Vector3().setFromMatrixPosition(mesh.matrixWorld).toArray()).toEqual([3, 1, -7]);
    // a scene's per-frame matrix walk leaves it where it is (the root sits at the origin)
    const scene = new Object3D();
    scene.add(nodes.root);
    mesh.position.set(100, 100, 100); // even a stray write is not picked up
    scene.updateMatrixWorld();
    expect(new Vector3().setFromMatrixPosition(mesh.matrixWorld).toArray()).toEqual([3, 1, -7]);
    // the source (the loader's cached scene) is left as it was
    expect(f.root.getObjectByName("village_lm_11")!.matrixAutoUpdate).toBe(true);
  });

  it("an InstancedMesh is one draw call whatever its count (the 7,000 far cards are one call)", () => {
    const nodes = prepareVillage(fixture().root, new Texture(), "low");
    const b = drawCallBudget(nodes.root);
    expect(b.instanced).toBe(2);
    expect(b.instances).toBe(2334 + 19);
    expect(b.meshes).toBeLessThan(20);
  });
});

describe("fitSkyMapping / fallsDown: read from the model's own geometry", () => {
  it("recovers how the dome lays its texture, wherever the u seam falls", () => {
    const m = fitSkyMapping(domeGeometry());
    expect(m.uSign).toBe(-1);
    expect(m.uOffset).toBeCloseTo(0.5, 3);
    expect(m.vScale).toBeCloseTo(-0.573, 3);
    expect(m.vOffset).toBeCloseTo(0.9, 3);
  });

  it("a geometry without UVs reads as a flat sky", () => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    expect(fitSkyMapping(g).vScale).toBe(0);
  });

  it("knows which way along v the sheet falls", () => {
    const sheet = (vDown: boolean) => {
      const m = new Mesh(fallsGeometry(vDown));
      m.updateMatrixWorld(true);
      return m;
    };
    expect(fallsDown([sheet(true)])).toBe(1);
    expect(fallsDown([sheet(false)])).toBe(-1);
    expect(fallsDown([])).toBe(1);
  });
});

describe("the far plane (the dome is 1.4 km out, the school's CAMERA_FAR is 200 m)", () => {
  /** The farthest point of the model's dome from a camera at `c`. */
  function farthestDomePoint(c: Vector3): number {
    const g = domeGeometry();
    const pos = g.getAttribute("position");
    const p = new Vector3();
    let max = 0;
    for (let i = 0; i < pos.count; i++) max = Math.max(max, p.fromBufferAttribute(pos, i).distanceTo(c));
    return max;
  }

  it("is past every dome point from anywhere a follow camera can be over the village (corners, centre, up to 40 m high)", () => {
    expect(VILLAGE_CAMERA_PLANES.far).toBeGreaterThan(CAMERA_FAR);
    const w = VILLAGE_LAYOUT.walkBounds;
    for (const x of [w.minX, 0, w.maxX]) {
      for (const z of [w.minZ, 0, w.maxZ]) {
        for (const y of [0.5, 1.6, 20, 40]) {
          const d = farthestDomePoint(new Vector3(x, y, z));
          expect(d, `camera at ${x}, ${y}, ${z}`).toBeLessThan(VILLAGE_CAMERA_PLANES.far);
        }
      }
    }
  });

  it("and from the overview's height (the far plane rides with it: overviewFar)", () => {
    for (const h of [60, 150, 260, 400]) {
      const far = overviewFar(VILLAGE_CAMERA_PLANES.far, h, 1);
      expect(farthestDomePoint(new Vector3(0, h, 0)), `overview ${h} m`).toBeLessThan(far);
    }
  });

  it("the near plane is still close enough for a camera pulled in front of a wall (spring arm) and a first-person eye", () => {
    expect(VILLAGE_CAMERA_PLANES.near).toBeLessThanOrEqual(0.25);
    expect(VILLAGE_CAMERA_PLANES.near).toBeGreaterThan(0.1);
  });

  it("the village's spring arm stops 0.3 m in front of a wall: wider than the near plane, in the village and in the hall (T7 review m5)", () => {
    expect(VILLAGE_CAMERA_PAD).toBe(0.3);
    expect(VILLAGE_CAMERA_PAD).toBeGreaterThan(VILLAGE_CAMERA_PLANES.near);
    expect(VILLAGE_ACTIVE_MAP.cameraPad).toBe(VILLAGE_CAMERA_PAD);
    expect(HALL_ACTIVE_MAP.cameraPad).toBe(VILLAGE_CAMERA_PAD);
  });

  it("the ground decals lie above every offset ground layer: 5 cm up (the forecourt's top is 3 cm) and a stronger offset (T7 review I2)", () => {
    expect(VILLAGE_GROUND_DECAL.y).toBeCloseTo(0.05, 6);
    expect(VILLAGE_GROUND_DECAL.y).toBeGreaterThan(0.03);
    expect(VILLAGE_GROUND_DECAL.y).toBeGreaterThan(DEFAULT_DECAL_Y);
    expect(VILLAGE_GROUND_DECAL.polygonOffsetFactor).toBe(-2);
    expect(VILLAGE_GROUND_DECAL.polygonOffsetUnits).toBe(-8);
    // More negative than every ground layer, on both terms (the ground's factor is -1).
    for (const units of Object.values(GROUND_LAYER_OFFSET)) expect(VILLAGE_GROUND_DECAL.polygonOffsetUnits).toBeLessThan(units);
    expect(VILLAGE_GROUND_DECAL.polygonOffsetFactor).toBeLessThan(-1);
  });
});

describe("applyDayNight: the clock's numbers into the model (Task 7A)", () => {
  // The night light map is loaded (it loads when night is near; without it the blend stays 0, tested above).
  beforeEach(() => setNightLightmap(new Texture()));
  afterEach(() => setNightLightmap(null));
  const at = (kst: string): DayNightState => dayNightAt(parseKstTime(kst)!);

  it("noon: the day light map alone, nothing lit, no tint, the day's lift; the water and the stars at rest", () => {
    const f = fixture();
    const nodes = prepareVillage(f.root, new Texture(), "high");
    applyDayNight(nodes, at("2026-06-21T12:30"));
    for (const [name, rgb] of Object.entries(GROUND_GRADE)) expect((f.mats as Record<string, MeshBasicMaterial>)[name]!.color.toArray(), name).toEqual([...rgb]);
    expect(nightBlendUniform.value).toBe(0);
    expect(litUniform.value).toBe(0);
    expect(liftUniform.value).toBeCloseTo(DAY_LIFT, 9);
    expect(dayTintUniform.value.toArray()).toEqual([1, 1, 1]);
    expect(foliageTintUniform.value.toArray()).toEqual([1, 1, 1]);
    expect(liftTintUniform.value.toArray()).toEqual([1, 1, 1]);
    expect(nodes.sky!.color.toArray()).toEqual([1, 1, 1]);
    for (const m of nodes.hazed) expect(m.color.toArray(), m.name).toEqual([1, 1, 1]);
    expect(nodes.water!.uniforms.uTint!.value.toArray()).toEqual([1, 1, 1]);
    expect(nodes.water!.uniforms.uFountain!.value.w).toBe(0);
    expect(nodes.stars!.visible).toBe(false);
  });

  it("midnight: the night light map alone, windows, lamps and the fountain lit, the foliage, sky and hills dark blue, the stars out", () => {
    const f = fixture();
    const nodes = prepareVillage(f.root, new Texture(), "high");
    applyDayNight(nodes, at("2026-06-21T23:30"));
    expect(nightBlendUniform.value).toBe(1);
    expect(litUniform.value).toBe(1);
    expect(liftUniform.value).toBeCloseTo(NIGHT_LOOK.lift, 9);
    expect(foliageTintUniform.value.toArray()).toEqual([...NIGHT_LOOK.foliageTint].map((v) => expect.closeTo(v, 5)));
    // The cherry blossoms darker still (Task 7A review m-g).
    expect(cherryTintUniform.value.toArray()).toEqual([0.05, 0.07, 0.15].map((v) => expect.closeTo(v, 5)));
    for (let k = 0; k < 3; k++) expect(NIGHT_LOOK.cherryTint[k]).toBeLessThan(NIGHT_LOOK.foliageTint[k]!);
    expect(dayTintUniform.value.toArray()).toEqual([1, 1, 1]); // the day light map has no weight at night: no extra darkening
    expect(nodes.sky!.color.toArray()).toEqual([...NIGHT_LOOK.domeTint].map((v) => expect.closeTo(v, 5)));
    expect(nodes.sky!.color.b).toBeGreaterThan(nodes.sky!.color.r); // blue
    // The far hills' shared material, the forest copies' and the falls' copy: all in the haze tint.
    expect(nodes.hazed.length).toBeGreaterThanOrEqual(3);
    expect(nodes.hazed).toContain(f.mats.M_backdrop);
    for (const m of nodes.hazed) expect(m.color.b, m.name).toBeCloseTo(NIGHT_LOOK.hazeTint[2], 5);
    expect((nodes.water!.uniforms.uTint!.value.z as number)).toBeLessThan(0.5);
    expect(nodes.water!.uniforms.uFountain!.value.w).toBe(FOUNTAIN_GLOW_STRENGTH);
    expect(nodes.stars!.visible).toBe(true);
    expect((nodes.stars!.material as { opacity: number }).opacity).toBe(1);
    // The lawns move to the night's grade (cool, dark); the neutral plaza keeps its own.
    for (const [name, rgb] of Object.entries(GROUND_GRADE_NIGHT)) {
      expect(nodes.graded.some((g) => g.material.name === name), name).toBe(true);
      const c = (f.mats as Record<string, MeshBasicMaterial>)[name]!.color;
      expect(c.toArray(), name).toEqual([...rgb].map((v) => expect.closeTo(v, 6)));
      expect(c.b).toBeGreaterThan(c.r);
    }
    expect(f.mats.LM_plaza.color.toArray()).toEqual([...GROUND_GRADE.LM_plaza!]);
  });

  it("the crescent turns with the light maps: it reads the same shared weights and tints, so no write of its own", () => {
    const f = fixture();
    prepareVillage(f.root, new Texture(), "high");
    const shader = { uniforms: {} as Record<string, unknown>, fragmentShader: "void main() {", vertexShader: "void main() {" };
    f.moon.onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.uVillageNight).toBe(nightBlendUniform);
    expect(shader.uniforms.uVillageDayTint).toBe(dayTintUniform);
    expect(shader.uniforms.uVillageMoonTint).toBe(moonTintUniform);
    expect(shader.uniforms.uVillageLift).toBe(liftUniform);
    expect(shader.uniforms.uVillageLiftTint).toBe(liftTintUniform);
    const c = VILLAGE_LAYOUT.plaza.fountain.centre;
    expect((shader.uniforms.uMoonFountain as { value: { x: number; y: number } }).value).toMatchObject({ x: c.x, y: c.z });
  });

  it("the crescent's probe is the old bake's light: bluish sky on its face, the sun on its back, dim below, never negative", () => {
    const yaw = (-25 * Math.PI) / 180;
    const front = [Math.sin(yaw), 0, Math.cos(yaw)] as const; // the face the spawn sees (build_village.py: yaw -25 deg)
    const back = [-front[0], 0, -front[2]] as const;
    const luma = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const day = (n: readonly [number, number, number]) => moonProbe(MOON_PROBE.day, n);
    // The old crescent's texels facing the spawn (n . front > 0.7) averaged (0.36, 0.44, 0.59) and those facing away
    // (< -0.7) (0.93, 0.92, 0.92): the probe's value straight on is within 0.12 of each.
    day(front).forEach((v, k) => expect(Math.abs(v - [0.36, 0.44, 0.59][k]!)).toBeLessThan(0.12));
    day(back).forEach((v, k) => expect(Math.abs(v - [0.93, 0.92, 0.92][k]!)).toBeLessThan(0.12));
    expect(day(front)[2]).toBeGreaterThan(day(front)[0] + 0.15); // the sky's blue
    expect(luma(day([0, 1, 0]))).toBeGreaterThan(luma(day([0, -1, 0])) + 0.4);
    // Over every direction: never negative, at most a hair past the map's clip at 1 (the shader clips).
    let lo = Infinity;
    let hi = -Infinity;
    let nightLo = Infinity;
    for (let i = 0; i < 2000; i++) {
      const z = 1 - (2 * (i + 0.5)) / 2000;
      const r = Math.sqrt(1 - z * z);
      const a = i * 2.399963;
      const n = [r * Math.cos(a), r * Math.sin(a), z] as const;
      for (const v of day(n)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      for (const v of moonProbe(MOON_PROBE.night, n)) nightLo = Math.min(nightLo, v);
    }
    expect(lo).toBeGreaterThan(0.03);
    expect(hi).toBeLessThan(1.1);
    expect(nightLo).toBeGreaterThan(0);
    // The night bake's fountain lights in the map's units: 50 W gives 50 / 8 pi^2 (Cycles' P / 4 pi^2, the map stores half).
    expect(MOON_PROBE.uplight.gain).toBeCloseTo(50 / (8 * Math.PI * Math.PI), 4);
  });

  it("the weights follow the sun through dusk: the night map's weight rises, the lamps come on past 0.3, the golden hour tints the day side", () => {
    const nodes = prepareVillage(fixture().root, new Texture(), "low");
    const seen: Array<{ night: number; lit: number; r: number; b: number }> = [];
    for (const t of ["19:00", "19:30", "19:40", "19:44", "19:47", "19:50", "20:10", "20:30", "21:00"]) {
      applyDayNight(nodes, at(`2026-06-21T${t}`));
      seen.push({ night: nightBlendUniform.value, lit: litUniform.value, r: dayTintUniform.value.x, b: dayTintUniform.value.z });
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.night).toBeGreaterThanOrEqual(seen[i - 1]!.night);
    expect(seen[0]!.night).toBeLessThan(0.1); // 19:00 is still day
    expect(seen[seen.length - 1]!.night).toBeGreaterThan(0.99); // 21:00 is night
    for (const v of seen) expect(v.lit === 0 || v.night > 0.3, JSON.stringify(v)).toBe(true); // never lit before night 0.3
    expect(seen.some((v) => v.lit > 0 && v.lit < 1)).toBe(true); // a ramp, not a cliff
    expect(seen.some((v) => v.r > 1.0 && v.b < 1.0)).toBe(true); // the warm tint of the golden hour (red up, blue down)
  });

  it("every night/day number of every frame is finite (no NaN reaches a uniform)", () => {
    const nodes = prepareVillage(fixture().root, new Texture(), "high");
    for (let h = 0; h < 24; h += 0.5) {
      applyDayNight(nodes, at(`2026-12-21T${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`));
      for (const v of [nightBlendUniform.value, litUniform.value, liftUniform.value, ...dayTintUniform.value.toArray(), ...nodes.sky!.color.toArray()]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("the hall's indoor state never lights the night: no night weight, day light map, nothing lit", () => {
    const nodes = prepareVillage(fixture().root, new Texture(), "low");
    applyDayNight(nodes, indoorState());
    expect(nightBlendUniform.value).toBe(0);
    expect(litUniform.value).toBe(0);
  });

  it("the stars: a seeded sky above the horizon, inside the dome, dark until the night fades them in", () => {
    const a = makeStars();
    const b = makeStars();
    expect(a.geometry.getAttribute("position").array).toEqual(b.geometry.getAttribute("position").array);
    const pos = a.geometry.getAttribute("position");
    expect(pos.count).toBe(STAR_COUNT);
    const p = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      p.y += 60; // from the dome's centre
      expect(p.length()).toBeCloseTo(STAR_RADIUS, 2);
      expect(p.y).toBeGreaterThan(0.1 * STAR_RADIUS - 1); // 8 degrees up at least (sin 8 = 0.139)
    }
    expect(STAR_RADIUS).toBeLessThan(1400); // in front of the dome
    expect(a.visible).toBe(false);
  });

  it("a star keeps its size on screen when the scene is drawn at a lower render scale and stretched (renderScale.ts)", () => {
    const stars = makeStars(4);
    const m = stars.material as PointsMaterial;
    const draw = () => stars.onBeforeRender(null as never, null as never, null as never, null as never, m, null as never);
    draw();
    expect(m.size).toBe(STAR_SIZE);
    setRenderScale(1 / 1.5);
    try {
      draw();
      expect(m.size).toBeCloseTo(STAR_SIZE / 1.5, 12);
    } finally {
      setRenderScale(1);
    }
    draw();
    expect(m.size).toBe(STAR_SIZE);
  });
});


describe("the shader patches against three's own MeshBasicMaterial shader (T7 review m1)", () => {
  const BASIC = ShaderLib.basic.fragmentShader;
  const count = (text: string, sub: string) => text.split(sub).length - 1;
  const compile = (m: MeshBasicMaterial) => {
    const shader = { uniforms: {} as Record<string, unknown>, fragmentShader: BASIC, vertexShader: ShaderLib.basic.vertexShader };
    m.onBeforeCompile(shader as never, null as never);
    return shader.fragmentShader;
  };

  it("every anchor the patches replace occurs exactly once in three's basic fragment shader", () => {
    for (const anchor of [
      "void main() {",
      "#include <color_fragment>",
      "#include <aomap_fragment>",
      "#include <map_fragment>",
      "#include <tonemapping_fragment>",
      "vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );",
    ]) {
      expect(count(BASIC, anchor), anchor).toBe(1);
    }
  });

  it("the light (lift, day/night light maps, tints): every replacement lands in the real shader", () => {
    const f = fixture();
    prepareVillage(f.root, new Texture(), "low", "neutral", new Texture());
    const fs = compile(f.mats.LM_grass);
    expect(count(fs, "uniform float uVillageLift;")).toBe(1);
    expect(count(fs, "uniform sampler2D uVillageNightMap;")).toBe(1);
    expect(count(fs, "void main() {")).toBe(1);
    expect(fs).not.toContain("vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );");
    expect(count(fs, "texture2D( uVillageNightMap, vLightMapUv )")).toBe(1);
    expect(count(fs, "vec3 villageAlbedo = diffuseColor.rgb;")).toBe(1);
    expect(fs.indexOf("vec3 villageAlbedo = diffuseColor.rgb;")).toBeLessThan(fs.indexOf("#include <color_fragment>"));
    expect(count(fs, "reflectedLight.indirectDiffuse += uVillageLift * uVillageLiftTint;")).toBe(1);
    expect(fs.indexOf("uVillageLift * uVillageLiftTint")).toBeLessThan(fs.indexOf("#include <aomap_fragment>"));
    // The night map is blended where three reads the light map, before it is added to the light.
    expect(fs.indexOf("lightMapTexel.rgb += villageNightLight * uVillageNight;")).toBeLessThan(
      fs.indexOf("reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity"),
    );
  });

  it("the windows' and lamps' glow lands after the texture is read", () => {
    const f = fixture();
    const nodes = prepareVillage(f.root, new Texture(), "low");
    const lit = nodes.own.filter((r): r is MeshBasicMaterial => (r as MeshBasicMaterial).isMeshBasicMaterial && (r as MeshBasicMaterial).customProgramCacheKey() === "village-lit");
    expect(lit.length).toBe(2);
    for (const m of lit) {
      const fs = compile(m);
      expect(count(fs, "uniform float uVillageLit;")).toBe(1);
      expect(count(fs, "float villageGlowLuma")).toBe(1);
      expect(fs.indexOf("#include <map_fragment>")).toBeLessThan(fs.indexOf("float villageGlowLuma"));
    }
  });

  it("the crescent's probe light and glaze land in three's own MeshBasicMaterial shader, as the light maps' light does", () => {
    const BASIC_VS = ShaderLib.basic.vertexShader;
    for (const [text, anchor] of [
      [BASIC_VS, "void main() {"],
      [BASIC_VS, "#include <project_vertex>"],
      [BASIC, "void main() {"],
      [BASIC, MOON_LIGHT_FROM],
      [BASIC, MOON_GLAZE_FROM],
    ] as const) {
      expect(count(text, anchor), anchor).toBe(1);
    }
    const m = mat("M_moon");
    moonMaterial(m);
    const shader = { uniforms: {} as Record<string, unknown>, fragmentShader: BASIC, vertexShader: BASIC_VS };
    m.onBeforeCompile(shader as never, null as never);
    const vs = shader.vertexShader;
    const fs = shader.fragmentShader;
    expect(count(vs, "varying vec3 vMoonNormal;")).toBe(1);
    expect(vs.indexOf("#include <project_vertex>")).toBeLessThan(vs.indexOf("vMoonWorld = ( modelMatrix"));
    expect(vs).toContain("* normal );"); // the normal attribute itself: the basic shader has no objectNormal without an env map
    expect(count(fs, "varying vec3 vMoonNormal;")).toBe(1);
    expect(count(fs, "void main() {")).toBe(1);
    expect(fs).not.toContain(MOON_LIGHT_FROM); // never the unlit 1.0
    // The probe's light where three adds an unlit material's, before the albedo multiplies it; the glaze on top after.
    const light = fs.indexOf("reflectedLight.indirectDiffuse += moonLight(");
    expect(light).toBeGreaterThan(fs.indexOf("#ifdef USE_LIGHTMAP"));
    expect(light).toBeLessThan(fs.indexOf("reflectedLight.indirectDiffuse *= diffuseColor.rgb;"));
    const glaze = fs.indexOf("outgoingLight += moonLight( reflect(");
    expect(glaze).toBeGreaterThan(fs.indexOf(MOON_GLAZE_FROM));
    expect(glaze).toBeLessThan(fs.indexOf("#include <tonemapping_fragment>"));
    // The coefficients, and the night blend as the light maps have it.
    expect(fs).toContain(`const vec3 MOON_DAY[ 9 ] = vec3[ 9 ](\n\tvec3( ${MOON_PROBE.day[0].map((v) => v.toFixed(4)).join(", ")} )`);
    expect(fs).toContain(`#define MOON_UPLIGHTS ${MOON_PROBE.uplight.count}`);
    expect(fs).toContain(`#define MOON_LIGHTMAP_SCALE ${(LIGHTMAP_INTENSITY / Math.PI).toFixed(4)}`);
    const cast = "mix( uVillageMoonTint, vec3( 1.0 ), smoothstep( 0.04, 0.22, dot( villageNightLight, vec3( 0.2126, 0.7152, 0.0722 ) ) ) )";
    expect(count(fs, cast)).toBe(1);
    const lm = mat("LM_test");
    liftMaterial(lm);
    expect(count(compile(lm), cast)).toBe(1); // the same cast as every light-mapped surface's
  });

  it("the dome's inverse tone curve lands right before three's tone mapping (rich tier)", () => {
    const nodes = prepareVillage(fixture().root, new Texture(), "high", "neutral");
    const fs = compile(nodes.sky!);
    expect(count(fs, "gl_FragColor.rgb = villageInverseTone( gl_FragColor.rgb );\n#include <tonemapping_fragment>")).toBe(1);
    expect(fs).toContain("#define VILLAGE_INVERSE_NEUTRAL");
    expect(count(fs, "void main() {")).toBe(1);
  });
});
