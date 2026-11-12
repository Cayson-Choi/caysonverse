import { describe, expect, it } from "vitest";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Texture,
  Vector3,
  Vector4,
  type WebGLRenderer,
} from "three";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import {
  ARC_BREAK,
  ARC_LAND_R,
  FOUNTAIN,
  G,
  PARTICLE_BUDGET,
  PARTICLE_CAP,
  PARTICLE_KIND,
  PARTICLE_LOD,
  TIME_WRAP,
  arcBreakup,
  arcJet,
  ballistic,
  buildParticles,
  curtainFlow,
  curtainPoint,
  fountainLights,
  landingTime,
  particleCountAt,
  surfaceY,
  uprightJet,
  wrapOmega,
  wrapPeriod,
  wrapTime,
} from "./fountainLayout";
import {
  CURTAIN_SEGMENTS,
  FOUNTAIN_RENDER_ORDER,
  NOISE_SIZE,
  RIBBON_SEGMENTS,
  WHITE_WATER_LIGHT,
  buildCurtainGeometry,
  buildParticleGeometry,
  buildRibbonGeometry,
  createFountainWater,
  findFountainWater,
  fountainDayNight,
  fountainNoiseData,
  fountainPoolGeometry,
  tickFountain,
} from "./fountainWater";
import { FLAT_SKY_MAPPING } from "./villageWater";
import { stateFor } from "./dayNightBlend";
import { applyDayNight, prepareVillage, tickVillage } from "./villageModelPrep";

const close = (a: number, b: number, eps: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(eps);

// The model's water (art/village/tools/build_village.py build_fountain), rebuilt here as plain triangles.
function quadBezier(p0: number[], p1: number[], p2: number[], t: number): number[] {
  return [0, 1, 2].map((i) => (1 - t) ** 2 * p0[i]! + 2 * (1 - t) * t * p1[i]! + t * t * p2[i]!);
}

/** The model's fountain water: three pool discs, two falling sheets, 16 arc tubes, 8 upright tubes, 16 splash rings. */
function modelFountainWater(): { geometry: BufferGeometry; poolTriangles: number } {
  const tris: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => tris.push(...a, ...b, ...c);
  const disc = (r: number, y: number, segs: number) => {
    for (let i = 0; i < segs; i++) {
      const a0 = (2 * Math.PI * i) / segs;
      const a1 = (2 * Math.PI * (i + 1)) / segs;
      tri([0, y, 0], [r * Math.cos(a0), y, r * Math.sin(a0)], [r * Math.cos(a1), y, r * Math.sin(a1)]);
    }
  };
  disc(5.41, 0.4, 96);
  disc(2.06, 0.8, 48);
  disc(1.52, 1.6, 32);
  const sheet = (rt: number, yt: number, rb: number, yb: number, segs: number) => {
    for (let i = 0; i < segs; i++) {
      const a0 = (2 * Math.PI * i) / segs;
      const a1 = (2 * Math.PI * (i + 1)) / segs;
      const p = (r: number, y: number, a: number) => [r * Math.cos(a), y, r * Math.sin(a)];
      tri(p(rt, yt, a0), p(rt, yt, a1), p(rb, yb, a1));
      tri(p(rt, yt, a0), p(rb, yb, a1), p(rb, yb, a0));
    }
  };
  sheet(1.64, 1.62, 1.85, 0.82, 48);
  sheet(2.52, 0.8, 2.75, 0.4, 48);
  for (let k = 0; k < 16; k++) {
    const a = (2 * Math.PI * k) / 16;
    const p0 = [5.1 * Math.cos(a), 0.42, 5.1 * Math.sin(a)];
    const p2 = [2.9 * Math.cos(a), 0.45, 2.9 * Math.sin(a)];
    const p1 = [(p0[0]! + p2[0]!) / 2, (p0[1]! + p2[1]!) / 2 + 2.6, (p0[2]! + p2[2]!) / 2];
    for (let i = 0; i < 11; i++) {
      const q0 = quadBezier(p0, p1, p2, i / 11);
      const q1 = quadBezier(p0, p1, p2, (i + 1) / 11);
      for (let j = 0; j < 6; j++) {
        const o0 = [0.05 * Math.cos((2 * Math.PI * j) / 6), 0.05 * Math.sin((2 * Math.PI * j) / 6)];
        tri([q0[0]! + o0[0]!, q0[1]! + o0[1]!, q0[2]!], [q1[0]! + o0[0]!, q1[1]! + o0[1]!, q1[2]!], [q1[0]!, q1[1]! + 0.05, q1[2]! + 0.05]);
      }
    }
    // Its splash ring: a flat octagon at 0.42 (not a pool height).
    const cx = 2.9 * Math.cos(a);
    const cz = 2.9 * Math.sin(a);
    for (let i = 0; i < 6; i++) {
      const b0 = (2 * Math.PI * i) / 8;
      const b1 = (2 * Math.PI * (i + 1)) / 8;
      tri([cx, 0.42, cz], [cx + 0.35 * Math.cos(b0), 0.42, cz + 0.35 * Math.sin(b0)], [cx + 0.35 * Math.cos(b1), 0.42, cz + 0.35 * Math.sin(b1)]);
    }
  }
  for (let k = 0; k < 8; k++) {
    const a = (2 * Math.PI * k) / 8 + 0.2;
    const x = 1.9 * Math.cos(a);
    const z = 1.9 * Math.sin(a);
    for (const [h0, h1] of [[0, 0.9], [0.9, 1.8], [1.8, 2.5], [2.5, 2.9]] as const) {
      tri([x, 0.8 + h0, z], [x + 0.04, 0.8 + h0, z], [x + 0.04, 0.8 + h1, z]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(tris, 3));
  g.setAttribute("normal", new Float32BufferAttribute(new Array(tris.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute("uv", new Float32BufferAttribute(new Array((tris.length / 3) * 2).fill(0.3), 2));
  return { geometry: g, poolTriangles: 96 + 48 + 32 };
}

describe("fountainLayout: the water's paths match the model", () => {
  it("the arcs: from the inner nozzle (r 2.9, y 0.45) over the model's apex (1.735) out to the basin at r 5.1", () => {
    for (let k = 0; k < FOUNTAIN.arcs.count; k++) {
      const j = arcJet(k);
      close(Math.hypot(j.origin[0], j.origin[2]), FOUNTAIN.arcs.nozzleR, 1e-9);
      close(j.origin[1], FOUNTAIN.arcs.nozzleY, 1e-9);
      const apexT = j.velocity[1] / G;
      close(ballistic(j.origin, j.velocity, apexT)[1], FOUNTAIN.arcs.apexY, 1e-4);
      const end = ballistic(j.origin, j.velocity, j.flight);
      close(end[1], FOUNTAIN.pool.y, 1e-9);
      // The water comes down at the model's outer landing ring (its Bezier ends at r 5.1, y 0.42): within 3 cm.
      close(Math.hypot(end[0], end[2]), FOUNTAIN.arcs.endR, 0.03);
      close(Math.hypot(end[0], end[2]), ARC_LAND_R, 1e-9);
      close(landingTime(j.origin, j.velocity), j.flight, 1e-6);
    }
    // The physics: 5.0 m/s up, 2.1 m/s out, about a second in the air.
    const j = arcJet(0);
    expect(j.origin[0] * j.velocity[0] + j.origin[2] * j.velocity[2]).toBeGreaterThan(0);
    close(j.velocity[1], 5.02, 0.01);
    close(Math.hypot(j.velocity[0], j.velocity[2]), 2.14, 0.01);
    close(j.flight, 1.04, 0.01);
  });

  it("the arcs trace the model's own curve: every point of its Bezier lies on the parabola (±1 mm)", () => {
    const j = arcJet(3);
    const a = j.angle;
    const p0 = [FOUNTAIN.arcs.nozzleR * Math.cos(a), FOUNTAIN.arcs.nozzleY, FOUNTAIN.arcs.nozzleR * Math.sin(a)];
    const p2 = [FOUNTAIN.arcs.endR * Math.cos(a), FOUNTAIN.arcs.endY, FOUNTAIN.arcs.endR * Math.sin(a)];
    const p1 = [(p0[0]! + p2[0]!) / 2, (p0[1]! + p2[1]!) / 2 + FOUNTAIN.arcs.lift, (p0[2]! + p2[2]!) / 2];
    for (let i = 0; i <= 10; i++) {
      const q = quadBezier(p0, p1, p2, i / 10);
      // The parabola's height at the same distance from the centre.
      const r = Math.hypot(q[0]!, q[2]!);
      const radialSpeed = Math.hypot(j.velocity[0], j.velocity[2]);
      const t = (r - FOUNTAIN.arcs.nozzleR) / radialSpeed;
      close(ballistic(j.origin, j.velocity, t)[1], q[1]!, 0.001);
    }
  });

  it("the upright jets: 8 on r 1.9 (the model's lights) rising from the pedestal's pool to 3.70", () => {
    const lights = fountainLights().filter((l) => l.kind === "upright");
    expect(lights).toHaveLength(8);
    for (let k = 0; k < FOUNTAIN.uprights.count; k++) {
      const j = uprightJet(k);
      close(Math.hypot(j.origin[0], j.origin[2]), 1.9, 1e-9);
      close(j.angle, (2 * Math.PI * k) / 8 + 0.2, 1e-9);
      close(ballistic(j.origin, j.velocity, j.flight)[1], 3.7, 1e-9);
      close(lights[k]!.x, j.origin[0], 1e-9);
    }
    close(uprightJet(0).velocity[1], 7.54, 0.01);
  });

  it("the curtains land where the model's sheets did: (1.85, 0.80) and (2.75, 0.40)", () => {
    for (let i = 0; i < 2; i++) {
      const c = FOUNTAIN.curtains[i]!;
      const f = curtainFlow(i);
      const end = curtainPoint(i, f.fall);
      close(end.r, c.landR, 1e-9);
      close(end.y, c.landY, 1e-9);
      expect(curtainPoint(i, 0)).toEqual({ r: c.lipR, y: c.lipY });
    }
    close(curtainFlow(0).fall, 0.409, 0.002);
    close(curtainFlow(1).fall, 0.286, 0.002);
  });

  it("surfaceY: the bowl inside its lip, the pedestal's pool inside its lip, the basin beyond", () => {
    expect(surfaceY(0.5)).toBe(1.6);
    expect(surfaceY(1.61)).toBe(1.6);
    expect(surfaceY(1.9)).toBe(0.8);
    expect(surfaceY(2.49)).toBe(0.8);
    expect(surfaceY(2.9)).toBe(0.4);
    expect(surfaceY(5.3)).toBe(0.4);
  });

  it("landingTime: a drop over the bowl lands in it, one over the pedestal's pool there, the rest in the basin", () => {
    // Dropped from 3 m at r 1.0 (the bowl), r 2.0 (the pedestal's pool) and r 4.0 (the basin).
    for (const [r, h] of [[1.0, 1.6], [2.0, 0.8], [4.0, 0.4]] as const) {
      const t = landingTime([r, 3, 0], [0, 0, 0]);
      close(ballistic([r, 3, 0], [0, 0, 0], t)[1], h, 1e-9);
    }
  });

  it("breakup: clear glass up to 30 % of an arc's flight, broken from 62 %", () => {
    expect(arcBreakup(0)).toBe(0);
    expect(arcBreakup(ARC_BREAK.start)).toBe(0);
    expect(arcBreakup(ARC_BREAK.full)).toBe(1);
    expect(arcBreakup(0.46)).toBeGreaterThan(0.3);
  });
});

describe("fountainLayout: the clock wraps without a jump", () => {
  it("wrapTime keeps 0..600 s", () => {
    expect(wrapTime(0)).toBe(0);
    close(wrapTime(601.5), 1.5, 1e-9);
    close(wrapTime(1e6 + 0.25), (1e6 + 0.25) % TIME_WRAP, 1e-6);
    expect(wrapTime(-1)).toBe(599);
  });
  it("periods and frequencies repeat a whole number of times in the wrap", () => {
    for (const p of [0.37, 1.03, 1.54, 4.7]) {
      const w = wrapPeriod(p);
      close(TIME_WRAP / w, Math.round(TIME_WRAP / w), 1e-9);
      close(w, p, p * 0.01);
    }
    for (const o of [1.7, 4.3, 2.9]) {
      const w = wrapOmega(o);
      close((w * TIME_WRAP) / (2 * Math.PI), Math.round((w * TIME_WRAP) / (2 * Math.PI)), 1e-6);
    }
    // The pool's rings (villageWater.ts FP_W: 8 cm at 0.35 m/s) too.
    close(((2 * Math.PI) / 0.08) * 0.35 * TIME_WRAP / (2 * Math.PI), 2625, 1e-9);
  });
});

describe("fountainLayout: the particle pools", () => {
  for (const tier of ["high", "low"] as const) {
    it(`${tier}: within the cap, far class first, every cycle a whole number of times in the wrap`, () => {
      const { particles, farCount } = buildParticles(tier);
      expect(particles.length).toBeLessThanOrEqual(PARTICLE_CAP[tier]);
      expect(farCount).toBeGreaterThan(0);
      expect(particles.slice(0, farCount).every((p) => p.far === 1)).toBe(true);
      expect(particles.slice(farCount).every((p) => p.far === 0)).toBe(true);
      for (const p of particles) {
        close(TIME_WRAP / p.life, Math.round(TIME_WRAP / p.life), 1e-6);
        expect(p.phase).toBeGreaterThanOrEqual(0);
        expect(p.phase).toBeLessThan(1);
        expect(p.size).toBeGreaterThan(0);
      }
      const B = PARTICLE_BUDGET[tier];
      const count = (k: number) => particles.filter((p) => p.kind === k).length;
      expect(count(PARTICLE_KIND.arcDrop)).toBe(B.arcDrop * 16);
      expect(count(PARTICLE_KIND.crown)).toBe(B.crown * 8);
      expect(count(PARTICLE_KIND.mist)).toBe(B.mist);
      expect(count(PARTICLE_KIND.head)).toBe(B.head * 8);
      // Deterministic: every client draws the same fountain.
      expect(buildParticles(tier)).toEqual({ particles, farCount });
    });
  }

  it("the light tier: no splashes, no mist, within its 512-particle cap", () => {
    const { particles } = buildParticles("low");
    expect(particles.some((p) => p.kind === PARTICLE_KIND.splash || p.kind === PARTICLE_KIND.mist)).toBe(false);
    expect(particles.length).toBeLessThanOrEqual(PARTICLE_CAP.low);
  });

  it("each drop's cycle ends at the water (or the stone) it falls on", () => {
    const { particles } = buildParticles("high");
    for (const p of particles.filter((q) => q.kind <= PARTICLE_KIND.curtainDrop)) {
      const dt = Math.max(0, p.life - p.kickAt);
      const end = ballistic([p.origin[0] + p.kick[0] * dt, p.origin[1], p.origin[2] + p.kick[1] * dt], p.velocity, p.life);
      const r = Math.hypot(end[0], end[2]);
      // On one of the three surfaces (the cycle is rounded to the wrap: within 2 cm), and inside that surface's lip.
      const h = [FOUNTAIN.bowl.y, FOUNTAIN.tier.y, FOUNTAIN.pool.y].find((y) => Math.abs(end[1] - y) < 0.02);
      expect(h, `kind ${p.kind} ends at y ${end[1]}`).toBeDefined();
      if (h === FOUNTAIN.bowl.y) expect(r).toBeLessThan(FOUNTAIN.bowl.lipR);
      if (h === FOUNTAIN.tier.y) expect(r).toBeLessThan(FOUNTAIN.tier.lipR);
      expect(r).toBeLessThan(FOUNTAIN.pool.r);
    }
  });

  it("LOD: everything near, the far half to 60 m, nothing beyond", () => {
    expect(particleCountAt(10, 2000, 900)).toBe(2000);
    expect(particleCountAt(PARTICLE_LOD.near + 1, 2000, 900)).toBe(900);
    expect(particleCountAt(PARTICLE_LOD.far + 1, 2000, 900)).toBe(0);
  });
});

describe("fountainWater: the model's water cut down to its pools", () => {
  it("keeps exactly the 176 pool triangles (not the tubes, sheets or splash rings), in the mesh's own space", () => {
    const { geometry, poolTriangles } = modelFountainWater();
    const pool = fountainPoolGeometry(geometry, new Matrix4())!;
    expect(pool.getAttribute("position").count / 3).toBe(poolTriangles);
    const pos = pool.getAttribute("position");
    for (let i = 0; i < pos.count; i++) expect([0.4, 0.8, 1.6].some((h) => Math.abs(pos.getY(i) - h) < 1e-6)).toBe(true);
    expect(pool.getAttribute("uv").count).toBe(pos.count);
    // The source is untouched (it is the loader's).
    expect(geometry.getAttribute("position").count).toBeGreaterThan(pos.count);
  });

  it("judges heights in world space: a node moved up 1 m keeps nothing; the same lifted geometry put back keeps it all", () => {
    const { geometry, poolTriangles } = modelFountainWater();
    expect(fountainPoolGeometry(geometry, new Matrix4().makeTranslation(0, 1, 0))).toBeNull();
    const lifted = geometry.clone().translate(0, 1, 0);
    expect(fountainPoolGeometry(lifted, new Matrix4().makeTranslation(0, -1, 0))!.getAttribute("position").count / 3).toBe(poolTriangles);
  });

  it("finds the fountain's water: near the centre and reaching above 1 m (not the creek, not a flat pond)", () => {
    const water = new MeshBasicMaterial({ name: "M_water" });
    const creek = new Mesh(new BufferGeometry().setAttribute("position", new Float32BufferAttribute([30, 0, 30, 40, 0, 30, 40, 0, 40], 3)), water);
    const flat = new Mesh(new BufferGeometry().setAttribute("position", new Float32BufferAttribute([-5, 0.4, 0, 5, 0.4, 0, 0, 0.4, 5], 3)), water);
    const fountain = new Mesh(modelFountainWater().geometry, water);
    for (const m of [creek, flat, fountain]) m.updateMatrixWorld();
    expect(findFountainWater([creek, flat, fountain], { x: 0, z: 0 })).toBe(fountain);
    expect(findFountainWater([creek, flat], { x: 0, z: 0 })).toBeNull();
  });
});

describe("fountainWater: geometry and the system", () => {
  it("one ribbon per jet (16 arcs, 8 upright), 2 vertices a step, a fixed bounding sphere round the fountain", () => {
    for (const tier of ["high", "low"] as const) {
      const g = buildRibbonGeometry(tier);
      const s = RIBBON_SEGMENTS[tier];
      expect(g.getAttribute("position").count).toBe(16 * (s.arc + 1) * 2 + 8 * (s.upright + 1) * 2);
      expect(g.index!.count / 3).toBe(16 * s.arc * 2 + 8 * s.upright * 2);
      expect(g.boundingSphere!.radius).toBeGreaterThan(6);
    }
    // The nominal positions are on the parabolas (the shader adds the sway and turns them to the camera).
    const g = buildRibbonGeometry("high");
    const pos = g.getAttribute("position");
    const last = RIBBON_SEGMENTS.high.arc * 2;
    close(Math.hypot(pos.getX(last), pos.getZ(last)), FOUNTAIN.arcs.endR, 0.03);
    close(pos.getY(last), 0.4, 1e-4);
    close(Math.hypot(pos.getX(last), pos.getZ(last)), ARC_LAND_R, 1e-4);
  });

  it("the curtains: two rings from lip to water, the model's landing radii at the bottom", () => {
    for (const tier of ["high", "low"] as const) {
      const g = buildCurtainGeometry(tier);
      const c = CURTAIN_SEGMENTS[tier];
      expect(g.index!.count / 3).toBe(2 * c.around * c.down * 2);
      const pos = g.getAttribute("position");
      let minY = 9;
      let maxR = 0;
      for (let i = 0; i < pos.count; i++) {
        minY = Math.min(minY, pos.getY(i));
        maxR = Math.max(maxR, Math.hypot(pos.getX(i), pos.getZ(i)));
      }
      close(minY, 0.4, 1e-6);
      close(maxR, 2.75, 1e-6);
    }
  });

  it("the particles: one instanced quad, the far class first", () => {
    const { geometry, total, farCount } = buildParticleGeometry("high");
    expect(geometry.instanceCount).toBe(total);
    expect(total).toBeLessThanOrEqual(PARTICLE_CAP.high);
    expect(geometry.getAttribute("aKind").getY(0)).toBe(1);
    expect(geometry.getAttribute("aKind").getY(farCount)).toBe(0);
    expect(geometry.index!.count).toBe(6);
  });

  it("the noise tiles: 64 x 64 RGBA, every channel in use", () => {
    const d = fountainNoiseData();
    expect(d.length).toBe(NOISE_SIZE * NOISE_SIZE * 4);
    for (let c = 0; c < 4; c++) {
      let lo = 255;
      let hi = 0;
      for (let i = c; i < d.length; i += 4) {
        lo = Math.min(lo, d[i]!);
        hi = Math.max(hi, d[i]!);
      }
      expect(hi - lo, `channel ${c}`).toBeGreaterThan(100);
    }
    expect(fountainNoiseData()).toEqual(d);
  });

  it("createFountainWater: four transparent draws in a fixed order, sharing one set of uniforms; LOD by the camera's distance", () => {
    const f = createFountainWater({ tier: "high", centre: { x: 0, z: 0 }, sky: null, skyMapping: FLAT_SKY_MAPPING });
    const meshes = f.group.children as Mesh[];
    expect(meshes).toHaveLength(4);
    const orders = meshes.map((m) => m.renderOrder);
    expect(orders).toEqual([FOUNTAIN_RENDER_ORDER.curtainBack, FOUNTAIN_RENDER_ORDER.curtainFront, FOUNTAIN_RENDER_ORDER.ribbons, FOUNTAIN_RENDER_ORDER.particles]);
    const mats = meshes.map((m) => m.material as ShaderMaterial);
    for (const m of mats) {
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.fog).toBe(true);
      expect(m.uniforms.uTime).toBe(f.uniforms.uTime);
      expect(m.uniforms.uGlow).toBe(f.uniforms.uGlow);
    }
    // The particle draw's onBeforeRender: the viewport and how many to draw from where the camera is.
    const renderer = { getCurrentViewport: (v: Vector4) => v.set(0, 0, 2560, 1290) } as unknown as WebGLRenderer;
    const cam = new PerspectiveCamera();
    const drops = f.particles.mesh;
    const geometry = drops.geometry as BufferGeometry & { instanceCount: number };
    for (const [d, want] of [[10, f.particles.total], [40, f.particles.farCount], [80, 0]] as const) {
      cam.position.set(0, 2, d);
      drops.onBeforeRender(renderer, new Scene(), cam, geometry, drops.material as ShaderMaterial, null as never);
      expect(geometry.instanceCount).toBe(want);
    }
    expect((f.uniforms.uViewport!.value as { y: number }).y).toBe(1290);
    expect(tickFountain(f, 600 + 12.5)).toBeCloseTo(12.5, 9);
    expect(f.uniforms.uTime!.value).toBeCloseTo(12.5, 9);
    for (const r of f.own) r.dispose();
  });

  it("the time of day: no lights by day and white water under the bloom; the lights on at night", () => {
    const f = createFountainWater({ tier: "low", centre: { x: 0, z: 0 }, sky: null, skyMapping: FLAT_SKY_MAPPING });
    const noon = stateFor(60, 180);
    fountainDayNight(f, noon);
    expect((f.uniforms.uGlow!.value as Vector3).length()).toBe(0);
    // The brightest white water (backlit, the forward scatter capped at 3): keep the noon luminance below 1.0 so a phone
    // screenshot retains the stream's grain instead of clipping to a white bloom.
    const amb = f.uniforms.uAmbient!.value as Vector3;
    const key = f.uniforms.uKeyColor!.value as Vector3;
    const lum = (v: Vector3) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
    expect(lum(amb) + lum(key) * (0.4 + 0.6 * 3)).toBeLessThan(1.0);
    expect(lum(amb)).toBeCloseTo(lum(new Vector3(...noon.hemiSky)) * noon.hemiIntensity * WHITE_WATER_LIGHT.ambient, 9);
    const night = stateFor(-30, 0);
    fountainDayNight(f, night);
    expect(night.lights).toBe(1);
    expect((f.uniforms.uGlow!.value as Vector3).length()).toBeGreaterThan(0.5);
    expect(lum(f.uniforms.uAmbient!.value as Vector3)).toBeLessThan(0.15);
    for (const r of f.own) r.dispose();
  });
});

describe("prepareVillage: the fountain", () => {
  function village(): Group {
    const root = new Group();
    const water = new MeshBasicMaterial({ name: "M_water", map: new Texture(), transparent: true });
    const fountain = new Mesh(modelFountainWater().geometry, water);
    fountain.name = "village_water_11";
    const creek = new Mesh(new BufferGeometry().setAttribute("position", new Float32BufferAttribute([30, 0, 30, 40, 0, 30, 40, 0, 40], 3)), water);
    creek.name = "village_water_12";
    root.add(fountain, creek);
    return root;
  }

  it("new (default): the model's fountain water becomes its pools with their own water; the streams, curtains and drops are added", () => {
    const source = village();
    const sourceGeometry = (source.getObjectByName("village_water_11") as Mesh).geometry;
    const nodes = prepareVillage(source, new Texture(), "high");
    expect(nodes.fountain).not.toBeNull();
    const pool = nodes.root.getObjectByName("village_water_11") as Mesh;
    expect(pool.geometry).not.toBe(sourceGeometry);
    expect(pool.geometry.getAttribute("position").count / 3).toBe(176);
    expect(pool.material).toBe(nodes.fountain!.pool);
    expect(nodes.fountain!.pool).not.toBe(nodes.water);
    expect(nodes.fountain!.pool.defines.FOUNTAIN_POOL).toBe("");
    expect(nodes.water!.defines.FOUNTAIN_POOL).toBeUndefined();
    expect((nodes.root.getObjectByName("village_water_12") as Mesh).material).toBe(nodes.water);
    expect(nodes.root.getObjectByName("fountain_water")).toBe(nodes.fountain!.water.group);
    // The pool and the streams know where the fountain is.
    const c = VILLAGE_LAYOUT.plaza.fountain.centre;
    expect((nodes.fountain!.pool.uniforms.uFountain!.value as Vector4).x).toBe(c.x);
    // Everything made here is released with the scene.
    for (const r of [pool.geometry, nodes.fountain!.pool, ...nodes.fountain!.water.own]) expect(nodes.own).toContain(r);
    // The source scene is untouched.
    expect((source.getObjectByName("village_water_11") as Mesh).geometry).toBe(sourceGeometry);
  });

  it("the clock reaches the pool and the streams: the wrapped time, the lights at night", () => {
    const nodes = prepareVillage(village(), new Texture(), "low");
    tickVillage(nodes, 1234.5, 1);
    expect(nodes.fountain!.pool.uniforms.uTime!.value).toBe(1234.5);
    expect(nodes.fountain!.pool.uniforms.uFTime!.value).toBeCloseTo(34.5, 9);
    expect(nodes.fountain!.water.uniforms.uTime!.value).toBeCloseTo(34.5, 9);
    applyDayNight(nodes, stateFor(-30, 0));
    expect((nodes.fountain!.pool.uniforms.uFountain!.value as Vector4).w).toBeGreaterThan(0);
    expect((nodes.fountain!.water.uniforms.uGlow!.value as Vector3).length()).toBeGreaterThan(0);
    applyDayNight(nodes, stateFor(60, 180));
    expect((nodes.fountain!.pool.uniforms.uFountain!.value as Vector4).w).toBe(0);
  });

  it("old (?water=old): the model's water as it was, no runtime fountain", () => {
    const source = village();
    const sourceGeometry = (source.getObjectByName("village_water_11") as Mesh).geometry;
    const nodes = prepareVillage(source, new Texture(), "high", "neutral", undefined, undefined, 1, { fountain: "old" });
    expect(nodes.fountain).toBeNull();
    const m = nodes.root.getObjectByName("village_water_11") as Mesh;
    expect(m.geometry).toBe(sourceGeometry);
    expect(m.material).toBe(nodes.water);
    expect(nodes.root.getObjectByName("fountain_water")).toBeUndefined();
  });
});
