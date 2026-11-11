import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  CustomBlending,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderLib,
  Texture,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { LIGHTING } from "../game/sceneLighting";
import { stateFor } from "./dayNightBlend";
import { VILLAGE_GROUND_DECAL } from "./villageModelPrep";
import {
  BUS_LOOK,
  BUS_MATERIAL,
  BUS_MODEL_URL,
  GROUND_OUT,
  applyBusDayNight,
  busEnvScale,
  busPlacement,
  disposeBus,
  prepareBus,
} from "./villageBusPrep";

/** A stand-in for village_bus.glb as GLTFLoader gives it: a node with one mesh per material (four primitives). */
function busFile() {
  const orm = new Texture();
  const body = new MeshStandardMaterial({ name: BUS_MATERIAL.body, map: new Texture(), roughnessMap: orm, metalnessMap: orm, emissiveMap: new Texture() });
  body.vertexColors = true;
  const glass = new MeshStandardMaterial({ name: BUS_MATERIAL.glass, transparent: true, opacity: 0.45 });
  const led = new MeshStandardMaterial({ name: BUS_MATERIAL.led, emissiveMap: new Texture() });
  const shadow = new Texture();
  const ground = new MeshStandardMaterial({ name: BUS_MATERIAL.ground, map: shadow, transparent: true });
  const g = new BoxGeometry(1, 1, 1);
  const node = new Group();
  node.name = "village_bus";
  const meshes = [new Mesh(g, body), new Mesh(g, glass), new Mesh(g, led), new Mesh(g, ground)];
  node.add(...meshes);
  const scene = new Group();
  scene.add(node);
  return { scene, body, glass, led, ground, shadow, orm, meshes };
}

/** Run a material's onBeforeCompile on three's own shader for it (what the renderer would compile). */
function compiled(m: Material, kind: "physical" | "basic" = "physical") {
  const lib = ShaderLib[kind];
  const shader = { uniforms: { ...lib.uniforms }, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as unknown as WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, undefined as never);
  return shader as unknown as { uniforms: Record<string, { value: unknown }>; fragmentShader: string };
}

const white: [number, number, number] = [1, 1, 1];
const DAY_STATE = stateFor(45, 180);
const NIGHT_STATE = stateFor(-25, 0);
const night = { day: 0, lights: 1, hemiIntensity: 0.25 * LIGHTING.village.hemi[2], hemiSky: white };
const day = { day: 1, lights: 0, hemiIntensity: LIGHTING.village.hemi[2], hemiSky: white };

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
    expect(n.own).toHaveLength(4);
    for (const m of [f.body, f.glass, f.led, f.ground]) expect(n.own).not.toContain(m);
    expect(f.body.emissiveIntensity).toBe(1);
    expect(f.glass.opacity).toBe(0.45);
    expect(f.body.onBeforeCompile).not.toBe(body.onBeforeCompile);
  });

  it("the paint reflects the analytic sky through the indirect specular (and the clear coat's)", () => {
    const n = prepareBus(busFile().scene, "high");
    const s = compiled(n.body!);
    expect(s.fragmentShader).toContain("vec3 busSky(");
    // plain (bus review r4): no band of tree tops, no hard horizon line
    expect(s.fragmentShader).not.toContain("uBusTreeline");
    expect(s.fragmentShader).not.toContain("atan(");
    expect(s.fragmentShader).toContain("smoothstep( - 0.25, 0.25, r.y )");
    expect(s.fragmentShader).toContain("radiance += busSky( geometryViewDir, geometryNormal, material.roughness );");
    expect(s.fragmentShader).toContain("clearcoatRadiance += busSky(");
    // after three's own IBL (empty without an environment map), before the lights are summed up
    expect(s.fragmentShader.indexOf("radiance += busSky(")).toBeGreaterThan(s.fragmentShader.indexOf("#include <lights_fragment_maps>"));
    expect(s.fragmentShader.indexOf("radiance += busSky(")).toBeLessThan(s.fragmentShader.indexOf("#include <lights_fragment_end>"));
    expect(s.fragmentShader).not.toContain("busF");
    expect(s.uniforms.uBusSky).toBe(n.bodySky);
    expect(s.uniforms.uBusZenith).toBeDefined();
    expect(n.body!.customProgramCacheKey()).toBe("village-bus-sky-paint");
    // the signs do not reflect it
    expect(compiled(n.led!).fragmentShader).not.toContain("busSky");
  });

  it("the glass mirrors one even sky colour by its own Fresnel over the tint and the cabin, in one pass", () => {
    const n = prepareBus(busFile().scene, "high");
    const s = compiled(n.glass!);
    expect(s.fragmentShader).not.toContain("radiance += busSky(");
    // plain, even glass like the houses' windows (bus review r4): the sky's average, whatever the direction
    expect(s.fragmentShader).toContain("uBusSkyAverage * uBusSky * busF");
    expect(s.fragmentShader).not.toContain("busSky( geometryViewDir");
    // the mix happens on the lit colour, just before it is written out (alpha raised toward 1 at grazing angles)
    const at = s.fragmentShader.indexOf("float busF = uBusGlassF0");
    expect(at).toBeGreaterThan(s.fragmentShader.indexOf("#include <lights_fragment_end>"));
    expect(at).toBeLessThan(s.fragmentShader.indexOf("#include <opaque_fragment>"));
    expect(s.fragmentShader).toContain("diffuseColor.a = busA;");
    expect(s.uniforms.uBusSky).toBe(n.glassSky);
    expect((s.uniforms.uBusGlassF0 as { value: number }).value).toBe(BUS_LOOK.glassF0);
    expect(n.glass!.customProgramCacheKey()).toBe("village-bus-sky-glass");
    // double-sided (the far windows) but drawn once, not back faces then front faces
    expect(n.glass!.side).toBe(DoubleSide);
    expect(n.glass!.forceSinglePass).toBe(true);
  });

  it("the ground quad: the baked darkness and the night's light by channel, over the road, under the glass", () => {
    const f = busFile();
    for (const tier of ["high", "low"] as const) {
      const n = prepareBus(f.scene, tier);
      const g = n.ground!;
      expect(g).toBeInstanceOf(MeshBasicMaterial);
      expect(g.map).toBe(f.shadow);
      expect(g.alphaMap).toBeNull();
      expect(g.transparent).toBe(true);
      expect(g.depthWrite).toBe(false);
      expect(g.fog).toBe(false);
      expect(g.opacity).toBe(BUS_LOOK.groundShadow);
      // dst x (1 - darkness) + light (premultiplied): written after the tone mapping, so none on it
      expect(g.blending).toBe(CustomBlending);
      expect(g.blendSrc).toBe(OneFactor);
      expect(g.blendDst).toBe(OneMinusSrcAlphaFactor);
      expect(g.toneMapped).toBe(false);
      // the village's decal offset, stronger than the road layer's (bus review r3: the quad lay under the road)
      expect(g.polygonOffset).toBe(true);
      expect(g.polygonOffsetFactor).toBe(VILLAGE_GROUND_DECAL.polygonOffsetFactor);
      expect(g.polygonOffsetUnits).toBe(VILLAGE_GROUND_DECAL.polygonOffsetUnits);
      const s = compiled(g, "basic");
      expect(s.fragmentShader).toContain(GROUND_OUT);
      // written last: after the tone mapping, colour space and fog steps
      expect(s.fragmentShader.indexOf(GROUND_OUT)).toBeGreaterThan(s.fragmentShader.indexOf("#include <colorspace_fragment>"));
      expect(s.fragmentShader.indexOf(GROUND_OUT)).toBeGreaterThan(s.fragmentShader.indexOf("#include <fog_fragment>"));
      expect(s.fragmentShader).not.toContain("#include <dithering_fragment>");
      expect(s.fragmentShader).toContain("uniform float uBusGlow;");
      expect(s.uniforms.uBusGlow).toBe(n.groundGlow);
      // the contact shadow alone (bus review r4): no sun's shadow channel any more
      expect(s.uniforms.uBusSun).toBeUndefined();
      expect(s.fragmentShader).not.toContain("busG.b");
      // the light tier blends in sRGB on the canvas: its factors are the rich tier's to the 1/2.2
      expect(s.uniforms.uBusGamma).toBe(n.groundGamma);
      expect(n.groundGamma.value).toBeCloseTo(tier === "high" ? 1 : 1 / 2.2);
      expect(g.customProgramCacheKey()).toBe("village-bus-ground");
      let mesh: Mesh | null = null;
      n.root.traverse((o) => {
        if ((o as Mesh).isMesh && (o as Mesh).material === g) mesh = o as Mesh;
      });
      expect(mesh).not.toBeNull();
      expect(mesh!.renderOrder).toBe(-1);
      expect(mesh!.receiveShadow).toBe(false);
      expect(mesh!.castShadow).toBe(false);
    }
  });

  it("light tier: plain standard paint (no clear coat); shadows: none cast (baked in its ground quad), the avatars' taken on the rich tier only", () => {
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
        expect(o.receiveShadow).toBe(receive && (o as Mesh).material !== n.ground);
      });
    }
  });

  it("the time of day: lamps and the cabin glow at night, the signs stay lit, the reflected sky dims with the sky light", () => {
    const n = prepareBus(busFile().scene, "high");
    applyBusDayNight(n, day);
    expect(n.body!.emissiveIntensity).toBe(0);
    expect(n.led!.emissiveIntensity).toBeCloseTo(BUS_LOOK.ledDay);
    expect(n.glass!.opacity).toBeCloseTo(BUS_LOOK.glassOpacity);
    expect(n.groundGlow.value).toBe(0); // no light pool by day
    expect(n.bodySky.value).toBeCloseTo(BUS_LOOK.envIntensity);
    expect(n.glassSky.value).toBeCloseTo(BUS_LOOK.glassEnvIntensity);
    applyBusDayNight(n, night);
    expect(n.body!.emissiveIntensity).toBeCloseTo(BUS_LOOK.nightGlow);
    expect(n.led!.emissiveIntensity).toBeCloseTo(BUS_LOOK.ledNight);
    // the lit cabin shows through clearer glass; the low beams light the road ahead
    expect(n.glass!.opacity).toBeCloseTo(BUS_LOOK.glassNightOpacity);
    expect(BUS_LOOK.glassNightOpacity).toBeLessThan(BUS_LOOK.glassOpacity);
    expect(n.groundGlow.value).toBeCloseTo(BUS_LOOK.groundGlow);
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
    for (const m of [...n.own, f.body, f.glass, f.led, f.ground]) m.addEventListener("dispose", () => disposed.add(m));
    disposeBus(n);
    for (const m of n.own) expect(disposed.has(m)).toBe(true);
    for (const m of [f.body, f.glass, f.led, f.ground]) expect(disposed.has(m)).toBe(false);
  });
});
