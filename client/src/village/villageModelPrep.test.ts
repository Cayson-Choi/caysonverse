import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
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
  GLOW_BOOST,
  GROUND_GRADE,
  GROUND_LAYER_OFFSET,
  LIGHT_LIFT,
  VILLAGE_CAMERA_PLANES,
  disposeVillage,
  drawCallBudget,
  fallsDown,
  fitSkyMapping,
  liftUniform,
  prepareVillage,
  tickVillage,
} from "./villageModelPrep";

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
  return { root, mats, textures };
}

const named = (root: Object3D, name: string) => root.getObjectByName(name) as Mesh;
const materialOf = (root: Object3D, name: string) => named(root, name).material as MeshBasicMaterial;

describe("prepareVillage: the model dressed for the game", () => {
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

  it("lifts the light of the light-mapped materials and of the village's own foliage (one shared uniform), not the backdrop's", () => {
    const f = fixture();
    const nodes = prepareVillage(f.root, new Texture(), "low");
    const patched = (m: MeshBasicMaterial) => m.customProgramCacheKey() === "village-lift";
    for (const m of [f.mats.LM_plaza, f.mats.LM_grass, f.mats.LM_wood, f.mats.M_leaf_green]) expect(patched(m), m.name).toBe(true);
    for (const m of [f.mats.M_window, f.mats.M_lamp, f.mats.M_glass, f.mats.M_backdrop]) expect(patched(m), m.name).toBe(false);
    expect(patched(materialOf(nodes.root, "inst__far_0_0"))).toBe(false);
    expect(liftUniform.value).toBe(LIGHT_LIFT);
    expect(LIGHT_LIFT).toBeGreaterThan(0);
    // Light-mapped: the lift joins the light map's light; vertex-lit: COLOR_0's light. Both before the albedo multiplies.
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: "void main() {\n#include <color_fragment>\n#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= diffuseColor.rgb;\n}",
      vertexShader: "",
    };
    f.mats.LM_grass.onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.uVillageLift).toBe(liftUniform);
    const fs = shader.fragmentShader;
    expect(fs.indexOf("vec3 villageAlbedo = diffuseColor.rgb;")).toBeLessThan(fs.indexOf("#include <color_fragment>"));
    expect(fs.indexOf("indirectDiffuse += vec3( uVillageLift )")).toBeLessThan(fs.indexOf("indirectDiffuse *= diffuseColor.rgb"));
    expect(fs).toContain("diffuseColor.rgb += villageAlbedo * uVillageLift;");
    // Patched once: a second dressing keeps the same hook.
    const hook = f.mats.LM_grass.onBeforeCompile;
    prepareVillage(f.root, new Texture(), "high");
    expect(f.mats.LM_grass.onBeforeCompile).toBe(hook);
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

  it("windows, lamps and glass stay as the model has them (Task 7A drives them at night)", () => {
    const f = fixture();
    const nodes = prepareVillage(f.root, new Texture(), "high");
    expect(materialOf(nodes.root, "village_fx_12")).toBe(f.mats.M_window);
    expect(materialOf(nodes.root, "village_fx_10")).toBe(f.mats.M_lamp);
    expect(materialOf(nodes.root, "village_glass")).toBe(f.mats.M_glass);
    expect(f.mats.M_glass.toneMapped).toBe(true);
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
});
