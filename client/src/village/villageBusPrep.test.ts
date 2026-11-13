import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderChunk,
  ShaderLib,
  Texture,
  Float32BufferAttribute,
  Vector3,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { LIGHTING } from "../game/sceneLighting";
import { linearHex, stateFor } from "./dayNightBlend";
import { VILLAGE_GROUND_DECAL } from "./villageModelPrep";
import {
  BUS_LOOK,
  BUS_MATERIAL,
  BUS_MODEL_URL,
  BUS_SIGN_SLOTS,
  BUS_SKY,
  GROUND_OUT,
  applyBusDayNight,
  busDisplay,
  busEnvScale,
  busOverSign,
  busPlacement,
  busPoolAdds,
  disposeBus,
  prepareBus,
  setBusAnisotropy,
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
    expect(BUS_MODEL_URL).toMatch(/^\/models\/village\/village_bus\.glb\?v=[0-9a-f]{10}$/);
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
    const at = s.fragmentShader.indexOf("float busF = busF0");
    expect(s.fragmentShader).toContain("float busF0 = uBusGlassF0;");
    expect(at).toBeGreaterThan(s.fragmentShader.indexOf("#include <lights_fragment_end>"));
    expect(at).toBeLessThan(s.fragmentShader.indexOf("#include <opaque_fragment>"));
    expect(s.fragmentShader).toContain("diffuseColor.a = busA;");
    expect(s.uniforms.uBusSky).toBe(n.glassSky);
    expect((s.uniforms.uBusGlassF0 as { value: number }).value).toBe(BUS_LOOK.glassF0);
    expect(n.glass!.customProgramCacheKey()).toBe("village-bus-sky-glass-cover"); // clear in front of the signs (below)
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
      // the light tier blends in sRGB on the canvas, after its tone curve (whose exposure it follows): it adds the pool
      // as busPoolAdds works it out (the intent is checked below, "the two tiers' pool ...")
      expect(s.uniforms.uBusExposure).toBe(n.groundExposure);
      expect(g.defines?.BUS_SRGB_CANVAS !== undefined).toBe(tier === "low");
      expect(g.customProgramCacheKey()).toBe(`village-bus-ground-${tier === "high" ? "linear" : "srgb"}`);
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
    expect(n.groundExposure.value).toBe(1);
    applyBusDayNight(n, night, 1.95); // the renderer's exposure (the night's 1.95 × the brightness)
    expect(n.groundExposure.value).toBe(1.95);
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

// ───────────────────────── bus review r4 polish: the two tiers' signs and pool, the anisotropy ─────────────────────────

/** A triangle pair for a quad, wound so that its face looks along `facing` (three's front face: counter-clockwise). */
function quad(corners: [number, number, number][], facing: Vector3): number[] {
  const [a, b, c, d] = corners.map((p) => new Vector3(...p)) as [Vector3, Vector3, Vector3, Vector3];
  const n = b.clone().sub(a).cross(c.clone().sub(a));
  const tri = (p: Vector3, q: Vector3, r: Vector3) => [p, q, r].flatMap((v) => v.toArray());
  return n.dot(facing) > 0 ? [...tri(a, b, c), ...tri(a, c, d)] : [...tri(a, c, b), ...tri(a, d, c)];
}

/**
 * The bus's three signs as build_bus.py makes them (the file's frame: nose -z, doors +x): the front one under the
 * windscreen facing forward, the kerb-side one behind the first window aft of the front door, the rear one behind the
 * rear window. Bus-local metres.
 */
function signedBusFile() {
  const f = busFile();
  const front = quad([[-0.85, 2.33, -4.45], [0.85, 2.33, -4.45], [0.85, 2.53, -4.45], [-0.85, 2.53, -4.45]], new Vector3(0, 0, -1));
  const side = quad([[1.17, 2.25, -2.95], [1.17, 2.25, -2.05], [1.17, 2.43, -2.05], [1.17, 2.43, -2.95]], new Vector3(1, 0, 0));
  const rear = quad([[-0.35, 2.33, 4.38], [0.35, 2.33, 4.38], [0.35, 2.53, 4.38], [-0.35, 2.53, 4.38]], new Vector3(0, 0, 1));
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([...front, ...side, ...rear], 3));
  (f.meshes[2] as Mesh).geometry = g;
  return f;
}

const luma = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const mixRgb = (a: readonly number[], b: readonly number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t);
const scale = (a: readonly number[], k: number) => a.map((v) => v * k);
const add = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v + b[i]!);

describe("the signs behind glass: lit amber dots on both tiers, none brighter than the front (bus review r4, P2)", () => {
  const LIT = linearHex("#FFB347"); // a lit dot in bus_led.png (make_bus_textures.py AMBER)
  const BG = linearHex("#070707"); // the sign's dark ground between the dots
  const SKY = [0, 1, 2].map((i) => (BUS_SKY.zenith[i]! + BUS_SKY.horizon[i]! + BUS_SKY.groundFar[i]!) / 3);
  const F = BUS_LOOK.glassF0; // head-on: the glass
  const FS = BUS_LOOK.signGlassF0; // head-on: the clear pane in front of a sign
  const TIMES = [
    { name: "day", exposure: DAY_STATE.exposure, env: 1, led: BUS_LOOK.ledDay, opacity: BUS_LOOK.glassOpacity },
    { name: "night", exposure: NIGHT_STATE.exposure, env: 0.1, led: BUS_LOOK.ledNight, opacity: BUS_LOOK.glassNightOpacity },
  ];
  /**
   * What reaches the eye from a sign texel head-on (GLASS_ADD's blend: dst × (1 - a') + sky F + tint, a' = mix(a, 1, F);
   * the glass's own dark tint left out): the front sign as it is; the rich tier in linear light, then its tone curve:
   * through the r4 glass, and through the glass clear in front of the sign (a = 0: a clean pane's Fresnel reflection
   * kept, or the glass's own 12 %); the light tier's tone curve first, the glass blended in sRGB after: with the r4
   * glass, and with the glass clear.
   */
  function seen(texel: readonly number[], t: (typeof TIMES)[number]) {
    const led = scale(texel, t.led);
    const sky = scale(SKY, t.env);
    const a2 = t.opacity + (1 - t.opacity) * F;
    return {
      front: busDisplay(led, t.exposure),
      richR4: busDisplay(add(scale(sky, F), scale(led, (1 - t.opacity) * (1 - F))), t.exposure),
      rich: busDisplay(add(scale(sky, FS), scale(led, 1 - FS)), t.exposure),
      richF12: busDisplay(add(scale(sky, F), scale(led, 1 - F)), t.exposure),
      lowR4: mixRgb(busDisplay(led, t.exposure), busDisplay(scale(sky, F / a2), t.exposure), a2),
      low: mixRgb(busDisplay(led, t.exposure), busDisplay(sky, t.exposure), FS),
    };
  }
  const amber = (c: readonly number[]) => c[0]! > c[1]! && c[1]! > c[2]! && c[0]! - c[2]! > 0.25;

  for (const t of TIMES) {
    it(`${t.name}: a lit dot reads amber on dark on both tiers, as the front's (r4 left the light tier's grey, the rich tier's dim)`, () => {
      const lit = seen(LIT, t);
      const bg = seen(BG, t);
      for (const tier of ["front", "rich", "low"] as const) {
        expect(amber(lit[tier]), `${tier} ${lit[tier].map((v) => v.toFixed(2))}`).toBe(true);
        expect(luma(lit[tier]) - luma(bg[tier]), tier).toBeGreaterThan(0.4); // lit dots on a dark sign
        expect(luma(lit[tier]) - luma(bg[tier]), tier).toBeLessThanOrEqual(luma(lit.front) - luma(bg.front) + 1e-9); // none brighter
        // the sign shows its LEDs as the front does (only the glass's thin reflection over them)
        expect(luma(lit[tier]), tier).toBeGreaterThan(0.85 * luma(lit.front));
      }
      // what r4 drew on the light tier: the dots dimmed to a fifth in sRGB, under a grey reflection: no amber, little contrast
      expect(luma(lit.lowR4)).toBeLessThan(0.5 * luma(lit.front));
      expect(lit.lowR4[0]! - lit.lowR4[2]!).toBeLessThan(0.2);
      // and on the rich tier, by day, a dot seen from a few metres (a third of it lit, its dark round it): a fifth of
      // its light through the tint under the sky's reflection, beige on grey (in game, at 15:30 on a PC, the kerb-side
      // sign's top dots measured sRGB 0.63/0.54/0.43 beside the front's 0.97/0.80/0.58; polish visual r1)
      const far = seen(mixRgb(BG, LIT, 1 / 3), t);
      const farBg = seen(BG, t);
      for (const tier of ["front", "rich", "low"] as const) {
        expect(amber(far[tier]), `${tier} at a few metres ${far[tier].map((v) => v.toFixed(2))}`).toBe(true);
        expect(luma(far[tier]) - luma(farBg[tier]), tier).toBeGreaterThan(0.3);
      }
      if (t.name === "day") {
        // the sign's dark plate under the clear pane, by day: near the front's; with the glass's own 12 % the rich
        // tier's linear blend laid a grey plate over it (in game, PC 15:30, sRGB 0.24 against the front's 0.11; now 0.15)
        // (head-on, a plate of the dots' own dark ground only; lifts over the front's: 0.10 against 0.26, the light
        // tier's 0.03)
        expect(luma(bg.rich) - luma(bg.front)).toBeLessThan(0.45 * (luma(bg.richF12) - luma(bg.front)));
        expect(luma(bg.low)).toBeLessThanOrEqual(luma(bg.rich));
        expect(far.richR4[0]! - far.richR4[2]!).toBeLessThan(0.3); // beige
        expect(luma(far.richR4)).toBeLessThan(0.65 * luma(far.rich));
        expect(luma(far.richR4) - luma(farBg.richR4)).toBeLessThan(0.6 * (luma(far.front) - luma(farBg.front)));
      }
    });
  }

  it("the signs behind glass are found from the sign material's own faces: the kerb side's and the rear's, not the front's", () => {
    const n = prepareBus(signedBusFile().scene, "low");
    const at = busPlacement();
    expect(n.signs).toHaveLength(2);
    const side = n.signs.find((s) => s.normal.x === 1)!;
    const rear = n.signs.find((s) => s.normal.z === 1)!;
    const m = BUS_LOOK.signCoverMargin;
    const close = (got: Vector3, want: number[]) => want.forEach((v, i) => expect(got.getComponent(i)).toBeCloseTo(v, 5));
    close(side.lo, [at.x + 1.17 - m, 2.25 - m, at.z - 2.95 - m]);
    close(side.hi, [at.x + 1.17 + m, 2.43 + m, at.z - 2.05 + m]);
    close(rear.lo, [at.x - 0.35 - m, 2.33 - m, at.z + 4.38 - m]);
    expect(n.signs.some((s) => s.normal.z === -1)).toBe(false); // the front sign has no pane in front of it
    // the same on the rich tier
    expect(prepareBus(signedBusFile().scene, "high").signs.map((s) => s.normal.toArray())).toEqual(n.signs.map((s) => s.normal.toArray()));
  });

  it("a face turned into the cabin (a sign's back) is never taken for a sign behind glass, however large (polish tech r1)", () => {
    // build_bus.py could give the kerb-side sign a back facing the cabin (-x, at the kerb side's x): larger than the
    // rear sign, it took the rear sign's slot, and through the far side's windows the glass would clear at it
    const f = signedBusFile();
    const led = (f.meshes[2] as Mesh).geometry;
    const back = quad([[1.15, 2.2, -3.0], [1.15, 2.2, -1.9], [1.15, 2.48, -1.9], [1.15, 2.48, -3.0]], new Vector3(-1, 0, 0));
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([...Array.from(led.attributes.position!.array as Float32Array), ...back], 3));
    (f.meshes[2] as Mesh).geometry = g;
    for (const tier of ["low", "high"] as const) {
      const n = prepareBus(f.scene, tier);
      expect(n.signs.map((s) => s.normal.toArray()).sort()).toEqual([[0, 0, 1], [1, 0, 0]].sort());
    }
    // the rule is the way a face looks out of the body, not its axis: a sign on the far side, facing out, would count
    const far = signedBusFile();
    const farG = new BufferGeometry();
    const farQuad = quad([[-1.17, 2.25, -2.95], [-1.17, 2.25, -2.05], [-1.17, 2.43, -2.05], [-1.17, 2.43, -2.95]], new Vector3(-1, 0, 0));
    const pos = Array.from((far.meshes[2] as Mesh).geometry.attributes.position!.array as Float32Array);
    farG.setAttribute("position", new Float32BufferAttribute([...pos, ...farQuad], 3));
    (far.meshes[2] as Mesh).geometry = farG;
    expect(prepareBus(far.scene, "low").signs.some((s) => s.normal.x === -1)).toBe(true);
  });

  it("the glass is clear exactly where it is in front of a sign, seen from that sign's side", () => {
    const n = prepareBus(signedBusFile().scene, "low");
    const { x, z } = busPlacement();
    const v = (dx: number, y: number, dz: number) => new Vector3(x + dx, y, z + dz);
    // from the kerb, through the window in front of the kerb-side sign: clear; through a lower pane or another window: tinted
    expect(busOverSign(v(6, 1.6, -2.5), v(1.21, 2.34, -2.5), n.signs)).toBe(true);
    expect(busOverSign(v(3, 1.6, -6), v(1.21, 2.34, -2.8), n.signs)).toBe(true); // at an angle
    expect(busOverSign(v(6, 1.6, -2.5), v(1.21, 1.7, -2.5), n.signs)).toBe(false);
    expect(busOverSign(v(6, 1.6, -2.5), v(1.21, 2.34, 1.0), n.signs)).toBe(false);
    // from behind, through the rear window at the rear sign: clear
    expect(busOverSign(v(0, 1.6, 10), v(0, 2.43, 4.42), n.signs)).toBe(true);
    // from the far side, across the cabin at the sign's back, or from the front at the front sign: tinted
    expect(busOverSign(v(-6, 2.4, -2.5), v(-1.21, 2.34, -2.5), n.signs)).toBe(false);
    expect(busOverSign(v(0, 1.6, -10), v(0, 2.4, -4.4), n.signs)).toBe(false);
  });

  it("the glass's shader runs that test on the signs found (their boxes in its uniforms), on both tiers", () => {
    for (const tier of ["low", "high"] as const) {
      const n = prepareBus(signedBusFile().scene, tier);
      const s = compiled(n.glass!) as ReturnType<typeof compiled> & { vertexShader: string };
      // in front of a sign: no tint (alpha 0) and a clean pane's Fresnel (signGlassF0), before the glass's mix
      expect(s.fragmentShader.replace(/\s+/g, " "), tier).toContain("if ( busOverSign() ) { diffuseColor.a = 0.0; busF0 = uBusSignF0; }");
      expect(s.fragmentShader.indexOf("float busF0 = uBusGlassF0;")).toBeLessThan(s.fragmentShader.indexOf("if ( busOverSign() )"));
      expect(s.fragmentShader.indexOf("if ( busOverSign() )")).toBeLessThan(s.fragmentShader.indexOf("float busF = busF0"));
      expect((s.uniforms.uBusSignF0 as { value: number }).value).toBe(BUS_LOOK.signGlassF0);
      expect(s.vertexShader).toContain("vBusWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
      const lo = (s.uniforms.uBusSignLo as { value: Vector3[] }).value;
      const nn = (s.uniforms.uBusSignN as { value: Vector3[] }).value;
      expect(lo).toHaveLength(BUS_SIGN_SLOTS);
      expect(n.signs).toHaveLength(2);
      n.signs.forEach((sg, i) => {
        expect(lo[i]!.equals(sg.lo)).toBe(true);
        expect(nn[i]!.equals(sg.normal)).toBe(true);
      });
      expect(n.glass!.customProgramCacheKey()).toBe("village-bus-sky-glass-cover");
    }
  });
});

describe("the low beams' pool: the same on both tiers (bus review r4, P4)", () => {
  const exposure = NIGHT_STATE.exposure; // the night's (× the brightness 1.0)
  const A = BUS_LOOK.nightAsphalt;
  const pool = (k: number) => scale(linearHex(BUS_LOOK.groundGlowColor), BUS_LOOK.groundGlow * k); // the map's green k
  /** On asphalt `asphalt` (linear, before the tone curve): what each tier shows with the pool's light `light`. */
  const shown = (asphalt: readonly number[], light: readonly number[]) => ({
    rich: busDisplay(add(asphalt, busPoolAdds("high", light, exposure)), exposure),
    low: add(busDisplay(asphalt, exposure), busPoolAdds("low", light, exposure)),
    lowR4: add(busDisplay(asphalt, exposure), light.map((v) => Math.pow(v, 1 / 2.2))), // r4: light^(1/2.2)
  });

  /**
   * three's NeutralToneMapping and sRGB transfer, written here from three's GLSL (tonemapping_pars_fragment,
   * colorspace_pars_fragment): a reference for what each tier shows that owes nothing to busDisplay.
   */
  function threeDisplay(rgb: readonly number[], exp: number): number[] {
    const StartCompression = 0.8 - 0.04;
    const Desaturation = 0.15;
    let c = rgb.map((v) => v * exp);
    const x = Math.min(...c);
    const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    c = c.map((v) => v - offset);
    const peak = Math.max(...c);
    if (peak >= StartCompression) {
      const d = 1 - StartCompression;
      const newPeak = 1 - (d * d) / (peak + d - StartCompression);
      c = c.map((v) => (v * newPeak) / peak);
      const g = 1 - 1 / (Desaturation * (peak - newPeak) + 1);
      c = c.map((v) => v + (newPeak - v) * g);
    }
    return c.map((v) => Math.max(0, v)).map((v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 0.41666) - 0.055));
  }

  it("on the night's asphalt in front of the bus the light tier shows the rich tier's pool, across the pool's falloff", () => {
    // the rich tier: its tone curve over asphalt + light; the light tier: the asphalt as its tone curve shows it, plus
    // busPoolAdds on its 8-bit canvas (a fragment's colour is clamped to 0..1 before the blend: it cannot take away)
    const bare = threeDisplay(A, exposure);
    let edge = 0;
    for (const k of [0.02, 0.05, 0.1, 0.153, 0.25, 0.35, 0.5, 0.75, 1]) {
      const adds = busPoolAdds("low", pool(k), exposure);
      for (const v of adds) expect(v).toBeGreaterThanOrEqual(0); // what the canvas can take
      const rich = threeDisplay(add(A, pool(k)), exposure);
      const low = add(bare, adds);
      const exact = rich.every((v, i) => v >= bare[i]!);
      if (k >= 0.5) expect(exact, `k ${k}`).toBe(true); // the edge is the pool's faint part only
      if (exact) {
        for (let i = 0; i < 3; i++) expect(low[i], `k ${k}, channel ${i}`).toBeCloseTo(rich[i]!, 4); // (three's 0.41666 for 1/2.4)
      } else {
        // the faint edge: the toe's offset grows with the light and the rich tier's sum loses a little blue; the light
        // tier keeps the asphalt's (polish tech r1: in game, k = 0.153 added 6/1/0 of 255)
        edge++;
        for (let i = 0; i < 3; i++) {
          expect(low[i]! - rich[i]!, `k ${k}, channel ${i}`).toBeGreaterThanOrEqual(-1e-5);
          expect(low[i]! - rich[i]!, `k ${k}, channel ${i}`).toBeLessThan(2.5 / 255);
        }
      }
    }
    expect(edge).toBeGreaterThan(0); // the edge case is among the samples
  });

  it("on darker or brighter asphalt nearby (the asphalt's grain, the lamps' baked light) it stays within 5/255", () => {
    // 4.5/255 at worst: the pool's faint edge on asphalt half as bright, where the rich tier's sum loses a little blue
    // that the light tier's canvas cannot take away (polish tech r1); elsewhere within 4/255
    let worst = 0;
    for (const k of [0.5, 0.75, 1.5, 2, 3]) {
      for (const m of [0.05, 0.1, 0.15, 0.25, 0.5, 0.75, 1]) {
        const s = shown(scale(A, k), pool(m));
        for (let i = 0; i < 3; i++) {
          const d = Math.abs(s.low[i]! - s.rich[i]!);
          expect(d, `asphalt x${k}, pool ${m}, channel ${i}`).toBeLessThan(5 / 255);
          if (m >= 0.5) expect(d, `asphalt x${k}, pool ${m}, channel ${i}`).toBeLessThan(4 / 255);
          worst = Math.max(worst, d);
        }
      }
    }
    expect(worst).toBeGreaterThan(4 / 255); // (the bound is not slack)
  });

  it("warm and modest on both tiers; r4's light tier was brighter and blue-grey", () => {
    const bare = busDisplay(A, exposure);
    const s = shown(A, pool(1));
    for (const tier of ["rich", "low"] as const) {
      const lift = s[tier].map((v, i) => v - bare[i]!);
      expect(lift[0]).toBeGreaterThan(lift[1]!); // warm: red lifted most, blue least
      expect(lift[1]).toBeGreaterThan(lift[2]!);
      expect(luma(s[tier])).toBeLessThan(0.35); // modest: a lit patch of asphalt, not a white sheet
    }
    const r4 = s.lowR4.map((v, i) => v - bare[i]!);
    const rich = s.rich.map((v, i) => v - bare[i]!);
    expect(r4[2]).toBeGreaterThan(1.6 * rich[2]!); // r4: twice as much blue: a grey pool
    expect(luma(s.lowR4)).toBeGreaterThan(luma(s.rich));
  });

  it("the ground shader's tone curve is three's NeutralToneMapping word for word (but for its exposure); it adds busPoolAdds, clamped", () => {
    const chunk = ShaderChunk.tonemapping_pars_fragment;
    const from = chunk.indexOf("vec3 NeutralToneMapping(");
    const to = chunk.indexOf("}", chunk.indexOf("return mix( color, vec3( newPeak ), g );", from));
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const words = (s: string) => s.replace(/\s+/g, " ").trim();
    const three = words(chunk.slice(from, to + 1)).replace("vec3 NeutralToneMapping(", "vec3 busNeutral(").replace("toneMappingExposure", "uBusExposure");
    expect(three).toContain("uBusExposure");
    const s = words(compiled(prepareBus(busFile().scene, "low").ground!, "basic").fragmentShader);
    expect(s).toContain(three);
    expect(s).toContain("sRGBTransferOETF( vec4( max( busNeutral( c ), 0.0 ), 1.0 ) ).rgb");
    expect(s).toContain("busLight = max( busDisplay( uBusAsphalt + busLight ) - busDisplay( uBusAsphalt ), 0.0 );");
    // the numbers the GPU draws from it are held to busPoolAdds by e2e/village-bus-look.mjs (pool)
  });

  it("by day the pool is off on both tiers (nothing added)", () => {
    for (const tier of ["high", "low"] as const) {
      for (const v of busPoolAdds(tier, [0, 0, 0], DAY_STATE.exposure)) expect(v).toBeCloseTo(0, 9);
    }
  });
});

describe("the bus's drawn detail gets a modest anisotropic filter (bus review r4, P3)", () => {
  it("the paint's atlas and the signs' dots: min(4, the GPU's), each set once; the ORM, glow and ground maps left alone", () => {
    const f = busFile();
    const n = prepareBus(f.scene, "high");
    const maps = [f.body.map!, f.led.emissiveMap!];
    const versions = maps.map((t) => t.version);
    expect(setBusAnisotropy(n, 16)).toBe(BUS_LOOK.anisotropy);
    for (const t of maps) expect(t.anisotropy).toBe(4);
    maps.forEach((t, i) => expect(t.version).toBe(versions[i]! + 1)); // uploaded with it
    for (const t of [f.orm, f.body.emissiveMap!, f.shadow]) expect(t.anisotropy).toBe(1); // no fine detail: plain filtering
    // a re-dress (a tier switch) with the same filter: nothing to upload again
    const again = prepareBus(f.scene, "low");
    setBusAnisotropy(again, 16);
    maps.forEach((t, i) => expect(t.version).toBe(versions[i]! + 1));
    // a GPU that offers less: what it offers
    expect(setBusAnisotropy(prepareBus(busFile().scene, "low"), 2)).toBe(2);
    expect(setBusAnisotropy(prepareBus(busFile().scene, "low"), 0)).toBe(1);
  });
});
