import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, ShaderLib, Texture, type WebGLProgramParametersWithUniforms } from "three";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { LIGHTING } from "../game/sceneLighting";
import { stateFor } from "./dayNightBlend";
import {
  BUS_LOOK,
  BUS_MATERIAL,
  BUS_MODEL_URL,
  applyBusDayNight,
  busEnvScale,
  busPlacement,
  disposeBus,
  prepareBus,
} from "./villageBusPrep";

/** A stand-in for village_bus.glb as GLTFLoader gives it: a node with one mesh per material (three primitives). */
function busFile() {
  const orm = new Texture();
  const body = new MeshStandardMaterial({ name: BUS_MATERIAL.body, map: new Texture(), roughnessMap: orm, metalnessMap: orm, emissiveMap: new Texture() });
  body.vertexColors = true;
  const glass = new MeshStandardMaterial({ name: BUS_MATERIAL.glass, transparent: true, opacity: 0.45 });
  const led = new MeshStandardMaterial({ name: BUS_MATERIAL.led, emissiveMap: new Texture() });
  const g = new BoxGeometry(1, 1, 1);
  const node = new Group();
  node.name = "village_bus";
  const meshes = [new Mesh(g, body), new Mesh(g, glass), new Mesh(g, led)];
  node.add(...meshes);
  const scene = new Group();
  scene.add(node);
  return { scene, body, glass, led, orm, meshes };
}

/** Run a material's onBeforeCompile on three's own physical shader (what the renderer would compile). */
function compiled(m: MeshStandardMaterial) {
  const lib = ShaderLib.physical;
  const shader = { uniforms: { ...lib.uniforms }, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as unknown as WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, undefined as never);
  return shader as unknown as { uniforms: Record<string, { value: unknown }>; fragmentShader: string };
}

const white: [number, number, number] = [1, 1, 1];
const DAY_STATE = stateFor(45, 180);
const NIGHT_STATE = stateFor(-25, 0);
const night = { lights: 1, hemiIntensity: 0.25 * LIGHTING.village.hemi[2], hemiSky: white };
const day = { lights: 0, hemiIntensity: LIGHTING.village.hemi[2], hemiSky: white };

describe("the village bus (village_bus.glb) dressed for the game", () => {
  it("stands at the layout's parked-bus box, nose north as modelled (the 9 m bus's box)", () => {
    expect(BUS_MODEL_URL).toBe("/models/village/village_bus.glb");
    expect(VILLAGE_LAYOUT.busStop.bus.size).toEqual({ x: 2.5, z: 9 });
    const at = busPlacement();
    expect(at).toEqual({ x: VILLAGE_LAYOUT.busStop.bus.centre.x, z: VILLAGE_LAYOUT.busStop.bus.centre.z, yaw: 0 });
    const f = busFile();
    const n = prepareBus(f.scene, "high");
    expect(n.root).not.toBe(f.scene); // a clone
    expect(n.root.position.toArray()).toEqual([at.x, 0, at.z]);
    expect(n.root.rotation.y).toBe(0);
    // static: matrices computed once
    let auto = 0;
    n.root.traverse((o) => void (auto += o.matrixAutoUpdate ? 1 : 0));
    expect(auto).toBe(0);
    expect(n.root.matrixWorld.elements[12]).toBeCloseTo(at.x);
    expect(n.root.matrixWorld.elements[14]).toBeCloseTo(at.z);
  });

  it("rich tier: clear-coated paint whose mask is the ORM map, glass that shows the cabin, lit signs; the loader's materials untouched", () => {
    const f = busFile();
    const n = prepareBus(f.scene, "high");
    expect(n.body).toBeInstanceOf(MeshPhysicalMaterial);
    const body = n.body as MeshPhysicalMaterial;
    expect(body.clearcoat).toBe(BUS_LOOK.clearcoat);
    expect(body.clearcoatMap).toBe(f.orm);
    expect(body.map).toBe(f.body.map);
    expect(body.roughnessMap).toBe(f.orm);
    expect(body.vertexColors).toBe(true); // the baked occlusion in COLOR_0
    expect(body.defines).toMatchObject({ STANDARD: "", PHYSICAL: "" });
    expect(body.envMap).toBeNull(); // no environment map (no PMREM pass): the sky is analytic
    expect(body.emissiveIntensity).toBe(0); // the night's glow is off until applyBusDayNight
    expect(n.glass!.transparent).toBe(true);
    expect(n.glass!.opacity).toBe(BUS_LOOK.glassOpacity);
    expect(n.glass!.depthWrite).toBe(false);
    expect(n.led!.emissiveIntensity).toBe(BUS_LOOK.ledDay);
    expect(n.own).toHaveLength(3);
    for (const m of [f.body, f.glass, f.led]) expect(n.own).not.toContain(m);
    expect(f.body.emissiveIntensity).toBe(1);
    expect(f.glass.opacity).toBe(0.45);
    expect(f.body.onBeforeCompile).not.toBe(body.onBeforeCompile);
  });

  it("the paint and glass reflect the analytic sky: added to the indirect specular (and the clear coat's), each with its own strength", () => {
    const n = prepareBus(busFile().scene, "high");
    for (const [m, strength] of [
      [n.body!, n.bodySky],
      [n.glass!, n.glassSky],
    ] as const) {
      const s = compiled(m);
      expect(s.fragmentShader).toContain("vec3 busSky(");
      expect(s.fragmentShader).toContain("radiance += busSky( geometryViewDir, geometryNormal, material.roughness );");
      expect(s.fragmentShader).toContain("clearcoatRadiance += busSky(");
      // after three's own IBL (empty without an environment map), before the lights are summed up
      expect(s.fragmentShader.indexOf("radiance += busSky(")).toBeGreaterThan(s.fragmentShader.indexOf("#include <lights_fragment_maps>"));
      expect(s.fragmentShader.indexOf("radiance += busSky(")).toBeLessThan(s.fragmentShader.indexOf("#include <lights_fragment_end>"));
      expect(s.uniforms.uBusSky).toBe(strength);
      expect(s.uniforms.uBusZenith).toBeDefined();
      expect(m.customProgramCacheKey()).toBe("village-bus-sky");
    }
    // the signs do not reflect it
    expect(compiled(n.led!).fragmentShader).not.toContain("busSky");
  });

  it("light tier: plain standard paint (no clear coat); shadows: none cast (the bake has its shadow), the avatars' taken on the rich tier only", () => {
    const low = prepareBus(busFile().scene, "low");
    expect(low.body).toBeInstanceOf(MeshStandardMaterial);
    expect(low.body).not.toBeInstanceOf(MeshPhysicalMaterial);
    expect(compiled(low.body!).fragmentShader).toContain("radiance += busSky(");
    const high = prepareBus(busFile().scene, "high");
    for (const [n, receive] of [
      [low, false],
      [high, true],
    ] as const) {
      n.root.traverse((o) => {
        if (!(o as Mesh).isMesh) return;
        expect(o.castShadow).toBe(false);
        expect(o.receiveShadow).toBe(receive);
      });
    }
  });

  it("the time of day: lamps and the cabin glow at night, the signs brighten, the reflected sky dims with the sky light", () => {
    const n = prepareBus(busFile().scene, "high");
    applyBusDayNight(n, day);
    expect(n.body!.emissiveIntensity).toBe(0);
    expect(n.led!.emissiveIntensity).toBeCloseTo(BUS_LOOK.ledDay);
    expect(n.bodySky.value).toBeCloseTo(BUS_LOOK.envIntensity);
    expect(n.glassSky.value).toBeCloseTo(BUS_LOOK.glassEnvIntensity);
    applyBusDayNight(n, night);
    expect(n.body!.emissiveIntensity).toBeCloseTo(BUS_LOOK.nightGlow);
    expect(n.led!.emissiveIntensity).toBeCloseTo(BUS_LOOK.ledNight);
    expect(n.bodySky.value).toBeCloseTo(BUS_LOOK.envIntensity * 0.25);
    expect(busEnvScale({ hemiIntensity: 0, hemiSky: white })).toBe(0.05);
    expect(busEnvScale({ hemiIntensity: 100, hemiSky: white })).toBe(1.2);
    // the village's own night: a dim blue sky light reflects about a tenth of the day's sky
    expect(busEnvScale(NIGHT_STATE)).toBeLessThan(0.15);
    expect(busEnvScale(DAY_STATE)).toBeCloseTo(1, 2);
  });

  it("dispose frees only its own materials", () => {
    const f = busFile();
    const n = prepareBus(f.scene, "low");
    const disposed = new Set<unknown>();
    for (const m of [...n.own, f.body, f.glass, f.led]) m.addEventListener("dispose", () => disposed.add(m));
    disposeBus(n);
    for (const m of n.own) expect(disposed.has(m)).toBe(true);
    for (const m of [f.body, f.glass, f.led]) expect(disposed.has(m)).toBe(false);
  });
});
