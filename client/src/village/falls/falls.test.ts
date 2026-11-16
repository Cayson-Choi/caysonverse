import { describe, expect, it } from "vitest";
import { Mesh, ShaderMaterial, type InstancedBufferGeometry } from "three";
import { createWaterMaterial } from "../villageWater";
import { createFallsAudio, fallsGain, brownNoise, FALLS_PEAK } from "./fallsAudio";
import {
  FALLS,
  FALLS_FAR_M,
  NODE,
  fallsFxFrom,
  fallsModeFrom,
  fallsNear,
  fallsRuntimeFor,
  fallsTierFrom,
  fallsTierParams,
  fileBuilt,
  kstHours,
  nearFade,
  pickLod,
  plungeAt,
  plungeFallSeconds,
  rainbowAmount,
  soundLevelAt,
} from "./fallsConfig";
import { patchPool } from "./fallsMaterials";
import { disposeFalls, prepareFalls } from "./fallsPrep";
import { dropletSeeds, mistSeeds } from "./fallsSpray";
import { createFallsStub, stubFaceX } from "./fallsStub";
import { flowTextureData, mistAtlasData, MIST_ATLAS_TILES } from "./fallsTextures";
import { FLAT_SKY_MAPPING, makeRippleTexture } from "../villageWater";

describe("which falls are drawn (the DEV flag and the build)", () => {
  it("reads ?falls= only in DEV", () => {
    expect(fallsModeFrom("?falls=off", true)).toBe("off");
    expect(fallsModeFrom("?falls=old", true)).toBe("old");
    expect(fallsModeFrom("?falls=stub", true)).toBe("stub");
    expect(fallsModeFrom("?falls=off", false)).toBe("new");
    expect(fallsModeFrom("", true)).toBe("new");
    expect(fallsModeFrom("?waterfall=old", true)).toBe("old"); // the previous runtime's flag still works
  });

  it("draws the model when the build has it, the stand-in in DEV without it, and the old falls in production without it", () => {
    expect(fallsRuntimeFor("new", true, false)).toBe("model");
    expect(fallsRuntimeFor("new", true, true)).toBe("model");
    expect(fallsRuntimeFor("new", false, true)).toBe("stub");
    expect(fallsRuntimeFor("new", false, false)).toBe("old"); // production never loses its waterfall
    expect(fallsRuntimeFor("stub", true, true)).toBe("stub");
    expect(fallsRuntimeFor("stub", true, false)).toBe("old");
    expect(fallsRuntimeFor("off", true, true)).toBe("none");
    expect(fallsRuntimeFor("old", true, true)).toBe("old");
  });

  it("knows a file was built only when the client has its hash", () => {
    expect(fileBuilt("/models/village/waterfall.glb?v=abcdef1234")).toBe(true);
    expect(fileBuilt("/models/village/waterfall.glb")).toBe(false);
  });

  it("forces a tier and takes parts away only in DEV", () => {
    expect(fallsTierFrom("?fallsTier=low", true, "high")).toBe("low");
    expect(fallsTierFrom("?fallsTier=low", false, "high")).toBe("high");
    expect(fallsTierFrom("?fallsTier=x", true, "high")).toBe("high");
    expect(fallsFxFrom("?fallsFx=nospray,nosound", true)).toMatchObject({ spray: false, mist: true, sound: false, water: true });
    expect(fallsFxFrom("?fallsFx=nospray", false).spray).toBe(true);
    expect(fallsFxFrom("?rainbow=1", true).rainbow).toBe(true);
  });
});

describe("the graphics tiers", () => {
  it("high has 160 droplets, 28 mist puffs, all water layers and the rainbow; low has 48, 10, two layers and no rainbow", () => {
    const hi = fallsTierParams("high");
    const lo = fallsTierParams("low");
    expect([hi.spray, hi.mist, hi.waterLayers, hi.rainbow]).toEqual([160, 28, 3, true]);
    expect([lo.spray, lo.mist, lo.waterLayers, lo.rainbow]).toEqual([48, 10, 2, false]);
    expect(lo.maxTexture).toBeLessThan(hi.maxTexture);
    expect(lo.lod0Within).toBe(0); // the light tier never draws the heavy cliff
  });
});

describe("the sound's distance rule", () => {
  it("is 1 at the pool, 0.35 at 30 m, 0.08 at 80 m, 0 from the plaza", () => {
    expect(soundLevelAt(0)).toBe(1);
    expect(soundLevelAt(8)).toBe(1);
    expect(soundLevelAt(30)).toBeCloseTo(0.35, 6);
    expect(soundLevelAt(80)).toBeCloseTo(0.08, 6);
    expect(soundLevelAt(FALLS_FAR_M)).toBe(0);
    expect(soundLevelAt(500)).toBe(0);
  });
  it("never rises with distance", () => {
    let prev = 2;
    for (let d = 0; d <= 140; d += 1) {
      const l = soundLevelAt(d);
      expect(l).toBeLessThanOrEqual(prev + 1e-12);
      prev = l;
    }
  });
  it("is silent when the game's sound is off, in a hidden tab, and far away", () => {
    expect(fallsGain(8, false, false)).toBeCloseTo(FALLS_PEAK, 6);
    expect(fallsGain(8, true, false)).toBe(0);
    expect(fallsGain(8, false, true)).toBe(0);
    expect(fallsGain(150, false, false)).toBe(0);
    expect(fallsGain(Infinity, false, false)).toBe(0);
    expect(fallsGain(40, false, false)).toBeLessThan(fallsGain(10, false, false));
  });
  it("does nothing, and throws nothing, where there is no AudioContext", () => {
    const a = createFallsAudio();
    expect(() => a.update(5)).not.toThrow();
    expect(a.running).toBe(false);
    expect(a.target).toBeGreaterThan(0);
    a.dispose();
  });
  it("makes finite brown noise whose loop seam does not jump", () => {
    const n = brownNoise(48000);
    expect(n.length).toBeLessThan(48000);
    expect(n.every(Number.isFinite)).toBe(true);
    const step = Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(n[i + 1]! - n[i]!)));
    expect(Math.abs(n[n.length - 1]! - n[0]!)).toBeLessThan(Math.max(step * 8, 0.2));
  });
});

describe("mist and spray near the camera", () => {
  it("fades to nothing within 1.5 m and shows fully from 5 m", () => {
    expect(nearFade(0)).toBe(0);
    expect(nearFade(1.5)).toBe(0);
    expect(nearFade(5)).toBe(1);
    expect(nearFade(9)).toBe(1);
    expect(nearFade(3.2)).toBeGreaterThan(0);
    expect(nearFade(3.2)).toBeLessThan(1);
  });
  it("stops beyond 120 m", () => {
    expect(fallsNear(119)).toBe(true);
    expect(fallsNear(120)).toBe(false);
  });
});

describe("the morning rainbow", () => {
  const day = 1;
  it("shows 06:30-10:30 KST on the high tier only, fading at the ends", () => {
    expect(rainbowAmount(8.5, "high", day)).toBe(1);
    expect(rainbowAmount(6.5, "high", day)).toBe(0);
    expect(rainbowAmount(6.75, "high", day)).toBeCloseTo(0.5, 6);
    expect(rainbowAmount(10.5, "high", day)).toBe(0);
    expect(rainbowAmount(10.25, "high", day)).toBeCloseTo(0.5, 6);
    expect(rainbowAmount(6.0, "high", day)).toBe(0);
    expect(rainbowAmount(12.5, "high", day)).toBe(0);
    expect(rainbowAmount(21, "high", day)).toBe(0);
  });
  it("never shows on the low tier, and never at night", () => {
    expect(rainbowAmount(8.5, "low", day)).toBe(0);
    expect(rainbowAmount(8.5, "high", 0)).toBe(0);
    expect(rainbowAmount(8.5, "high", 0.4)).toBeCloseTo(0.4, 6);
  });
  it("reads Korean hours from a UTC instant", () => {
    expect(kstHours(Date.UTC(2026, 10, 3, 0, 30))).toBeCloseTo(9.5, 6); // 00:30 UTC = 09:30 KST
    expect(kstHours(Date.UTC(2026, 10, 3, 15, 0))).toBeCloseTo(0, 6);
    expect(kstHours(Date.UTC(2026, 10, 3, 12, 0))).toBeCloseTo(21, 6);
  });
});

describe("the cliff's LOD", () => {
  it("is always LOD1 on the light tier and switches with a 10 m band on the rich one", () => {
    expect(pickLod(1, 0, 0)).toBe(1);
    expect(pickLod(5, 90, 1)).toBe(0);
    expect(pickLod(95, 90, 1)).toBe(1); // not yet in
    expect(pickLod(95, 90, 0)).toBe(0); // already in: stays out to 100
    expect(pickLod(101, 90, 0)).toBe(1);
  });
});

describe("the plunge's parabola agrees with the layout", () => {
  it("leaves the lip and lands at the impact point", () => {
    expect(plungeAt(0)).toEqual({ x: FALLS.lip.x, y: FALLS.lip.y });
    const t = plungeFallSeconds();
    expect(t).toBeCloseTo(1.8753, 3);
    const end = plungeAt(t);
    expect(end.x).toBeCloseTo(FALLS.impact.x, 1);
    expect(end.y).toBeCloseTo(FALLS.impact.y, 2);
  });
});

describe("the stand-in textures and seeds", () => {
  it("makes deterministic flow texels in range with a clumped blue channel", () => {
    const a = flowTextureData(32);
    const b = flowTextureData(32);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a).toHaveLength(32 * 32 * 4);
    let foam = 0;
    for (let o = 0; o < a.length; o += 4) {
      expect(a[o + 3]).toBe(255);
      if (a[o + 2]! > 128) foam++;
    }
    expect(foam).toBeGreaterThan(30);
    expect(foam).toBeLessThan(32 * 32 * 0.7);
  });
  it("tiles seamlessly (the left edge continues the right one)", () => {
    const n = 32;
    const d = flowTextureData(n);
    const at = (i: number, j: number) => d[(j * n + ((i + n) % n)) * 4]!;
    let step = 0;
    let seam = 0;
    for (let j = 0; j < n; j++) {
      step = Math.max(step, Math.abs(at(1, j) - at(0, j)));
      seam = Math.max(seam, Math.abs(at(n, j) - at(n - 1, j)));
    }
    expect(seam).toBeLessThanOrEqual(Math.max(step * 2, 40));
  });
  it("makes an atlas of soft puffs that are empty at the corners", () => {
    const tile = 16;
    const d = mistAtlasData(tile);
    const n = tile * MIST_ATLAS_TILES;
    expect(d).toHaveLength(n * n * 4);
    for (let ty = 0; ty < MIST_ATLAS_TILES; ty++) {
      for (let tx = 0; tx < MIST_ATLAS_TILES; tx++) {
        expect(d[((ty * tile) * n + tx * tile) * 4 + 3]).toBe(0);
        let max = 0;
        for (let j = 0; j < tile; j++) for (let i = 0; i < tile; i++) max = Math.max(max, d[((ty * tile + j) * n + tx * tile + i) * 4 + 3]!);
        expect(max).toBeGreaterThan(80);
      }
    }
  });
  it("seeds droplets and mist the same way every time, in range", () => {
    const d = dropletSeeds(160);
    expect(Array.from(d.seeds)).toEqual(Array.from(dropletSeeds(160).seeds));
    expect(d.seeds).toHaveLength(640);
    const sheet = Array.from({ length: 160 }, (_, i) => d.extra[i * 4]!).filter((k) => k === 1).length;
    expect(sheet).toBeGreaterThan(20);
    expect(sheet).toBeLessThan(80);
    for (let i = 0; i < 160; i++) {
      expect(d.seeds[i * 4]).toBeGreaterThanOrEqual(0);
      expect(d.seeds[i * 4]).toBeLessThan(1.0001);
      expect(d.extra[i * 4 + 1]).toBeGreaterThan(0.03);
      expect(d.extra[i * 4 + 2]).toBeGreaterThan(0.7);
    }
    const m = mistSeeds(28);
    for (let i = 0; i < 28; i++) {
      expect(m.extra[i * 4]).toBeGreaterThanOrEqual(0);
      expect(m.extra[i * 4]).toBeLessThan(16);
      expect(m.extra[i * 4 + 3]).toBeGreaterThanOrEqual(3); // rises 3..6 m
      expect(m.extra[i * 4 + 3]).toBeLessThanOrEqual(6);
    }
  });
});

describe("the pool's shader patch", () => {
  const water = createWaterMaterial({ map: null, sky: null, skyMapping: FLAT_SKY_MAPPING, ripple: makeRippleTexture(8), detail: true, side: 2 });
  it("applies every replacement to the village water shader (and says so loudly when that shader moves)", () => {
    const pool = patchPool(water.vertexShader, water.fragmentShader, false);
    expect(pool.fragment).toContain("fallsEnv");
    expect(pool.fragment).toContain("fallsFoam");
    expect(pool.fragment).toContain("vFallsDepth");
    expect(pool.vertex).toContain("vFallsDepth = color.r");
    const outlet = patchPool(water.vertexShader, water.fragmentShader, true);
    expect(outlet.vertex).toContain("vFallsDepth = 0.3");
    expect(outlet.fragment).not.toContain("fallsFoam");
    expect(() => patchPool(water.vertexShader, "void main() {}", false)).toThrow(/no longer contains/);
  });
});

describe("the stand-in model and its dressing", () => {
  const names = (root: { traverse(f: (o: { name: string }) => void): void }) => {
    const out: string[] = [];
    root.traverse((o) => out.push(o.name));
    return out;
  };

  it("carries the nodes of the contract (design 7.4)", () => {
    const stub = createFallsStub();
    const n = names(stub);
    for (const want of [NODE.rockLod0, `${NODE.plunge}0`, `${NODE.plunge}1`, `${NODE.plunge}2`, NODE.cascade, NODE.pool, NODE.foam, NODE.outlet, NODE.impact, NODE.lip, "falls_slab_0"]) {
      expect(n).toContain(want);
    }
    const impact = stub.getObjectByName(NODE.impact)!;
    expect([impact.position.x, impact.position.y, impact.position.z]).toEqual([FALLS.impact.x, FALLS.impact.y, FALLS.impact.z]);
  });

  it("gives the plunge ribbons the vertex colours the shader reads (air and speed grow downward, v is metres fallen / 4)", () => {
    const g = (createFallsStub().getObjectByName(`${NODE.plunge}0`) as Mesh).geometry;
    const c = g.getAttribute("color");
    const uv = g.getAttribute("uv");
    const p = g.getAttribute("position");
    expect(c.getX(0)).toBeCloseTo(0, 6); // no air at the lip
    expect(c.getY(0)).toBeCloseTo(0, 6); // no speed at the lip
    const last = c.count - 1;
    expect(c.getX(last)).toBeGreaterThan(0.9); // aerated at the bottom
    expect(c.getY(last)).toBeGreaterThan(0.9);
    for (let i = 0; i < c.count; i++) {
      expect(uv.getY(i)).toBeCloseTo((FALLS.lip.y - p.getY(i)) / 4, 5);
    }
  });

  it("colours the pool by depth (rim 0, middle 1) and the cascade's flow downward with the ledges flagged", () => {
    const stub = createFallsStub();
    const pool = (stub.getObjectByName(NODE.pool) as Mesh).geometry.getAttribute("color");
    let min = 1;
    let max = 0;
    for (let i = 0; i < pool.count; i++) {
      min = Math.min(min, pool.getX(i));
      max = Math.max(max, pool.getX(i));
    }
    expect([min, max]).toEqual([0, 1]);
    const cascade = (stub.getObjectByName(NODE.cascade) as Mesh).geometry.getAttribute("color");
    let ledge = 0;
    for (let i = 0; i < cascade.count; i++) {
      expect(cascade.getX(i)).toBeCloseTo(0.5, 5); // du = 0
      expect(cascade.getY(i)).toBeCloseTo(1, 5); // dv = +1: down the stream
      if (cascade.getZ(i) > 0.8) ledge++;
    }
    expect(ledge).toBeGreaterThan(0);
  });

  it("leans the cliff back with height and keeps the channel above the ledge", () => {
    expect(stubFaceX(-78, 36)).toBeLessThan(stubFaceX(-78, 5) - 8);
    expect(stubFaceX(-78, 30)).toBeLessThan(stubFaceX(-70, 30)); // the notch is deeper than the flank beside it
  });

  it("dresses the high tier: shaders by node name, every layer, the cliff LOD0, the rainbow", () => {
    const parts = prepareFalls(createFallsStub(), { tier: "high", sky: null, skyMapping: FLAT_SKY_MAPPING, lightmap: null, poolLift: 0.5 });
    const mat = (name: string) => ((parts.root.getObjectByName(name) as Mesh).material as ShaderMaterial).name;
    expect(mat(`${NODE.plunge}0`)).toContain("M_falls_water");
    expect(mat(`${NODE.cascade}`)).toContain("M_falls_cascade");
    expect(mat(NODE.pool)).toContain("falls pool");
    expect(mat(NODE.outlet)).toContain("falls outlet");
    expect(mat(NODE.foam)).toContain("M_falls_foam");
    expect(parts.root.getObjectByName(`${NODE.plunge}2`)!.visible).toBe(true);
    expect((parts.spray.droplets.geometry as InstancedBufferGeometry).instanceCount).toBe(160);
    expect((parts.spray.mist.geometry as InstancedBufferGeometry).instanceCount).toBe(28);
    expect(parts.spray.rainbow).not.toBeNull();
    expect(parts.pools).toHaveLength(2);
    // lifted over the old pool disc, and not alpha-additive anywhere
    expect(parts.root.getObjectByName(NODE.pool)!.position.y).toBeCloseTo(0.5, 6);
    for (const m of parts.meshes) {
      const mm = m.material as ShaderMaterial;
      if (mm.isShaderMaterial) expect(mm.blending).not.toBe(2); // AdditiveBlending
    }
    disposeFalls(parts);
  });

  it("dresses the light tier: 48 droplets, 10 puffs, two water layers, no rainbow", () => {
    const parts = prepareFalls(createFallsStub(), { tier: "low", sky: null, skyMapping: FLAT_SKY_MAPPING, lightmap: null, poolLift: 0 });
    expect((parts.spray.droplets.geometry as InstancedBufferGeometry).instanceCount).toBe(48);
    expect((parts.spray.mist.geometry as InstancedBufferGeometry).instanceCount).toBe(10);
    expect(parts.spray.rainbow).toBeNull();
    expect(parts.root.getObjectByName(`${NODE.plunge}2`)!.visible).toBe(false);
    expect(parts.root.getObjectByName(`${NODE.plunge}1`)!.visible).toBe(true);
    disposeFalls(parts);
  });

  it("shares one clock between every water surface and the spray", async () => {
    const { fallsUniforms } = await import("./fallsMaterials");
    const parts = prepareFalls(createFallsStub(), { tier: "high", sky: null, skyMapping: FLAT_SKY_MAPPING, lightmap: null, poolLift: 0 });
    fallsUniforms.uTime.value = 12.5;
    for (const m of parts.meshes) {
      const mm = m.material as ShaderMaterial;
      if (mm.isShaderMaterial && mm.uniforms.uTime) expect(mm.uniforms.uTime.value).toBe(12.5);
    }
    expect((parts.spray.droplets.material as ShaderMaterial).uniforms.uTime!.value).toBe(12.5);
    expect((parts.spray.mist.material as ShaderMaterial).uniforms.uTime!.value).toBe(12.5);
    disposeFalls(parts);
  });
});
