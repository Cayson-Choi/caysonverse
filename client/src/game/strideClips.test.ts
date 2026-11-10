import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AnimationMixer, Vector3, type AnimationClip, type Object3D, type SkinnedMesh } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MOVE_SPEED, RUN_SPEED } from "@caysonverse/shared/constants";
import { CHARACTER_MANIFEST } from "@caysonverse/shared/characterManifest";
import { CLIP } from "./constants";
import { LOOP_STRIDE, createLoopDriver, loopRate, stepLoop, type LoopStride } from "./stride";

/**
 * The stride table (stride.ts LOOP_STRIDE) re-measured from the shipped character.glb, so a re-export with longer or
 * shorter strides, or a retimed loop, fails here instead of quietly sliding the feet again. Same loader as
 * sitPose.test.ts: textures stripped (node has no image decoder), then three's own forward kinematics on the bare feet
 * (`body__feet`) — the clips are in place, so a sole on the ground sweeps backward under the body.
 *
 * Contact: a vertex of a foot is on the ground while it is within BAND of that foot's lowest point over the BASE loop
 * (Walking_A / Running_A). The skirt variants keep the base timing but not its feet (the short-skirt walk lifts the
 * stance foot, the long-skirt run never touches the ground), so they are judged over the base loop's contacts: what
 * their feet do while the base loop's feet are down. Their own lowest points are art defects, not steps (pinned
 * below: when the art is fixed those tests fail, and the variants should then be measured over their own contacts).
 *
 * Natural speed: with the loop's own warp, the ground speed at which those contacting sole points slide least (the
 * summed world path of every contacting vertex over one loop). A rolling foot's contact points never all move alike,
 * so some slip is left even there — the slip ratio (their mean slip speed / the ground speed) says how much.
 *
 * Warp: the rate that would hold the contacting soles still is (their mean backward speed / their backward speed at
 * that phase); the table's warp is its even second harmonic (one swing per step: both feet step alike).
 */

const GLB = fileURLToPath(new URL("../../public/models/character.glb", import.meta.url));

/** The GLB with its images, textures and texture references removed (same binary chunk). */
function withoutTextures(buf: Buffer): ArrayBuffer {
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  delete gltf.images;
  delete gltf.textures;
  delete gltf.samplers;
  for (const m of gltf.materials ?? []) {
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    delete m.extensions;
  }
  let json = Buffer.from(JSON.stringify(gltf), "utf8");
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const rest = buf.subarray(20 + jsonLen);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length + rest.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([header, json, rest]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/** Samples per loop. */
const N = 240;
/** A vertex within this (m) of its foot's lowest point is on the ground. */
const BAND = 0.008;

let gltf: GLTF;
let feet: SkinnedMesh;
/** Per vertex of `feet`: 0 left, 1 right, -1 neither (by the bone that weighs it most). */
let side: number[];

beforeAll(async () => {
  gltf = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(withoutTextures(readFileSync(GLB)), "", res, rej));
  gltf.scene.traverse((o: Object3D) => {
    if ((o as SkinnedMesh).isSkinnedMesh && o.name === "body__feet") feet = o as SkinnedMesh;
  });
  const si = feet.geometry.attributes.skinIndex;
  const sw = feet.geometry.attributes.skinWeight;
  side = [];
  for (let i = 0; i < si.count; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
    const bone = feet.skeleton.bones[si.getComponent(i, best)].name;
    side.push(bone.endsWith("l") ? 0 : bone.endsWith("r") ? 1 : -1);
  }
}, 30000);

function clipNamed(name: string): AnimationClip {
  const clip = gltf.animations.find((c) => c.name === name);
  if (!clip) throw new Error(`character.glb has no clip ${name}`);
  return clip;
}

/** Forward kinematics of `name` over one loop: every foot vertex's model-space position (+Z forward) per sample. */
function sampleFeet(name: string): { duration: number; pos: Float32Array[] } {
  const clip = clipNamed(name);
  const mixer = new AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip);
  action.play();
  const count = feet.geometry.attributes.position.count;
  const pos: Float32Array[] = [];
  const v = new Vector3();
  for (let k = 0; k < N; k++) {
    mixer.setTime((k / N) * clip.duration);
    gltf.scene.updateMatrixWorld(true);
    feet.skeleton.update();
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      feet.applyBoneTransform(i, v.fromBufferAttribute(feet.geometry.attributes.position, i)).applyMatrix4(feet.matrixWorld);
      p[i * 3] = v.x;
      p[i * 3 + 1] = v.y;
      p[i * 3 + 2] = v.z;
    }
    pos.push(p);
  }
  action.stop();
  mixer.uncacheRoot(gltf.scene);
  return { duration: clip.duration, pos };
}

/** One contacting vertex over one sample step (k-1 -> k): its model-space displacement. */
interface Contact {
  k: number;
  dz: number;
  dx: number;
}

interface Measured {
  /** With the TABLE's warp: the ground speed (m/s at mean rate 1) at which the contacting sole points slide least. */
  speed: number;
  /** Phase (0..1) of the base loop's left foot mid-contact. */
  leftContact: number;
  /** The even second harmonic of the rate that holds the contacting soles still: amplitude and peak phase (0..0.5). */
  warp: number;
  warpPeak: number;
  /** Mean slip speed of the contacting sole points / the ground speed, at ground speed `v` played at `rate(phase)`. */
  slip: (v: number, rate: (phase: number) => number) => number;
}

const measured = new Map<string, Measured>();
/** The base loop a clip takes its contacts from (variants keep the base timing). */
const baseOf = (name: string): string => (name.startsWith(CLIP.run) ? CLIP.run : CLIP.walk);
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function measure(name: string): Measured {
  const hit = measured.get(name);
  if (hit) return hit;
  const table = LOOP_STRIDE[name];
  const base = sampleFeet(baseOf(name));
  const clip = name === baseOf(name) ? base : sampleFeet(name);
  const count = side.length;
  const dt = clip.duration / N;
  const ground = [Infinity, Infinity];
  for (const p of base.pos) for (let i = 0; i < count; i++) if (side[i] >= 0) ground[side[i]] = Math.min(ground[side[i]], p[i * 3 + 1]);
  const contacts: Contact[] = [];
  const leftDown = new Float64Array(N);
  const backBySample: number[][] = Array.from({ length: N }, () => []);
  for (let k = 1; k <= N; k++) {
    const a = base.pos[(k - 1) % N];
    const b = base.pos[k % N];
    const ca = clip.pos[(k - 1) % N];
    const cb = clip.pos[k % N];
    for (let i = 0; i < count; i++) {
      const s = side[i];
      if (s < 0 || a[i * 3 + 1] - ground[s] > BAND || b[i * 3 + 1] - ground[s] > BAND) continue;
      const c = { k: k - 1, dz: cb[i * 3 + 2] - ca[i * 3 + 2], dx: cb[i * 3] - ca[i * 3] };
      contacts.push(c);
      backBySample[k - 1].push(-c.dz / dt);
      if (s === 0) leftDown[k % N] += 1;
    }
  }
  // World path of the contacting points over one loop: in a sample played at rate r the body goes v * dt / r.
  const path = (v: number, rate: (phase: number) => number): { path: number; ground: number } => {
    let sum = 0;
    let travel = 0;
    for (const c of contacts) {
      const g = (v * dt) / rate(c.k / N);
      sum += Math.hypot(c.dz + g, c.dx);
      travel += g;
    }
    return { path: sum, ground: travel };
  };
  const tableWarp = (phase: number) => 1 + table.warp * Math.cos(4 * Math.PI * (phase - table.warpPeak));
  // At mean rate 1 the body goes `v`; the path is convex in v: ternary search for its minimum.
  let lo = 0.05;
  let hi = 10;
  for (let it = 0; it < 80; it++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (path(m1, tableWarp).path < path(m2, tableWarp).path) hi = m2;
    else lo = m1;
  }
  // Left mid-contact: the circular mean of the left foot's contacts.
  let c = 0;
  let s = 0;
  for (let k = 0; k < N; k++) {
    c += leftDown[k] * Math.cos((2 * Math.PI * k) / N);
    s += leftDown[k] * Math.sin((2 * Math.PI * k) / N);
  }
  // The ideal warp (mean backward speed / backward speed) where the feet are down, and its even second harmonic.
  const ideal: [number, number][] = [];
  for (let k = 0; k < N; k++) if (backBySample[k].length) ideal.push([k / N, Math.max(0.1, median(backBySample[k]))]);
  const meanBack = ideal.reduce((t, [, u]) => t + u, 0) / ideal.length;
  const ys = ideal.map(([phase, u]) => [phase, meanBack / u] as const);
  const my = ys.reduce((t, [, y]) => t + y, 0) / ys.length;
  let hc = 0;
  let hs = 0;
  for (const [phase, y] of ys) {
    hc += (y - my) * Math.cos(4 * Math.PI * phase);
    hs += (y - my) * Math.sin(4 * Math.PI * phase);
  }
  hc *= 2 / ys.length;
  hs *= 2 / ys.length;
  const m: Measured = {
    speed: (lo + hi) / 2,
    leftContact: (Math.atan2(s, c) / (2 * Math.PI) + 1) % 1,
    warp: Math.hypot(hc, hs) / my,
    warpPeak: ((Math.atan2(hs, hc) / (4 * Math.PI)) % 0.5 + 0.5) % 0.5,
    slip: (v, rate) => {
      const r = path(v, rate);
      return r.path / r.ground;
    },
  };
  measured.set(name, m);
  return m;
}

/** Every walk / run clip an avatar can play: the base loops and each bottom's variants (manifest clipVariants). */
const VARIANTS: readonly Readonly<Record<string, string>>[] = Object.values(CHARACTER_MANIFEST.clipVariants);
const LOOP_NAMES: string[] = [
  ...new Set([CLIP.walk, CLIP.run, ...VARIANTS.flatMap((v) => [v[CLIP.walk], v[CLIP.run]])]),
].filter((n) => typeof n === "string");
const WALKS = LOOP_NAMES.filter((n) => baseOf(n) === CLIP.walk);
const RUNS = LOOP_NAMES.filter((n) => baseOf(n) === CLIP.run);

describe("the stride table (stride.ts) against character.glb", () => {
  it("lists every walk / run loop an avatar can play, and nothing else", () => {
    expect(new Set(Object.keys(LOOP_STRIDE))).toEqual(new Set(LOOP_NAMES));
    expect(LOOP_NAMES).toHaveLength(6);
  });

  it.each(LOOP_NAMES)("%s: its soles keep pace with the table's speed (within 10 percent)", (name) => {
    const m = measure(name);
    expect(m.speed / LOOP_STRIDE[name].speed).toBeGreaterThan(0.9);
    expect(m.speed / LOOP_STRIDE[name].speed).toBeLessThan(1.1);
  }, 30000);

  it.each(LOOP_NAMES)("%s: the left foot is mid-contact at the table's phase (±0.03 of the loop)", (name) => {
    const m = measure(name);
    const d = Math.abs(m.leftContact - LOOP_STRIDE[name].leftContact);
    expect(Math.min(d, 1 - d)).toBeLessThan(0.03);
  }, 30000);

  it.each(WALKS)("%s: its rate swings within each step as the table says (amplitude ±0.05, peak ±0.03)", (name) => {
    const m = measure(name);
    expect(Math.abs(m.warp - LOOP_STRIDE[name].warp)).toBeLessThan(0.05);
    const d = Math.abs(m.warpPeak - LOOP_STRIDE[name].warpPeak);
    expect(Math.min(d, 0.5 - d)).toBeLessThan(0.03);
  }, 30000);

  it.each(RUNS)("%s: plays at an even rate (its short contacts sweep back evenly)", (name) => {
    expect(LOOP_STRIDE[name].warp).toBe(0);
    expect(measure(name).warp).toBeLessThan(0.1);
  }, 30000);
});

/** Each bottom family's loops, through the same rules the avatars use. */
const FAMILIES: [string, string, string][] = [
  ["pants", CLIP.walk, CLIP.run],
  ["skirt / petal_skirt", "Walking_A_ShortSkirt", "Running_A_ShortSkirt"],
];
const LONG_WALK = "Walking_A_LongSkirt";
const LONG_RUN = "Running_A_LongSkirt";
const rateOf = (s: LoopStride, v: number) => (phase: number) => loopRate(s, v, phase);
const even = (scale: number) => () => scale;
/** The fastest ground speed (m/s, up to `v`) loop `name` plants its feet at: its rate ceiling's (the long skirt's). */
const plantedUpTo = (name: string, v: number) => Math.min(v, (LOOP_STRIDE[name].maxScale ?? Infinity) * LOOP_STRIDE[name].speed);

describe("feet that stay put at the game's speeds (what the avatars do with the table)", () => {
  it.each(FAMILIES)("%s: walking at MOVE_SPEED and running at RUN_SPEED, the soles on the ground barely slip", (_label, walk, run) => {
    expect(stepLoop(createLoopDriver(), "idle", true, MOVE_SPEED, 1 / 60)).toBe("walk");
    expect(stepLoop(createLoopDriver(), "idle", true, RUN_SPEED, 1 / 60)).toBe("run");
    // the walk's rolling foot keeps some slip (its contact points never all move alike); the run's is near none
    expect(measure(walk).slip(MOVE_SPEED, rateOf(LOOP_STRIDE[walk], MOVE_SPEED))).toBeLessThan(0.2);
    expect(measure(run).slip(RUN_SPEED, rateOf(LOOP_STRIDE[run], RUN_SPEED))).toBeLessThan(0.12);
  }, 30000);

  it.each(WALKS)("%s: the warp slips less than the best even rate could", (walk) => {
    const m = measure(walk);
    const v = plantedUpTo(walk, MOVE_SPEED);
    let best = Infinity;
    for (let scale = 0.5; scale <= 6; scale += 0.02) best = Math.min(best, m.slip(v, even(scale)));
    expect(m.slip(v, rateOf(LOOP_STRIDE[walk], v))).toBeLessThan(0.85 * best);
  }, 30000);

  // The bug: every loop played at rate 1 under the old 4 m/s walk and the 6.4 m/s run.
  it.each(FAMILIES)("%s: the old playback slipped over 2.5x as much", (_label, walk, run) => {
    expect(measure(walk).slip(4, even(1))).toBeGreaterThan(2.5 * measure(walk).slip(MOVE_SPEED, rateOf(LOOP_STRIDE[walk], MOVE_SPEED)));
    expect(measure(run).slip(RUN_SPEED, even(1))).toBeGreaterThan(2.5 * measure(run).slip(RUN_SPEED, rateOf(LOOP_STRIDE[run], RUN_SPEED)));
  }, 30000);

  // Review 2026-11-10: the long skirt's loops are capped to the other looks' pace (stride.ts LOOP_STRIDE), its feet
  // hidden under the hem. They are planted up to the cap's speed and slip some above it — still less than before.
  it("longskirt: planted up to its rate ceiling; capped at the game speeds, it slips some, less than the old playback", () => {
    for (const [name, v, old, slip] of [
      [LONG_WALK, MOVE_SPEED, 4, 0.2],
      [LONG_RUN, RUN_SPEED, RUN_SPEED, 0.12],
    ] as const) {
      const m = measure(name);
      const s = LOOP_STRIDE[name];
      expect(plantedUpTo(name, v)).toBeLessThan(v); // capped below the game speed
      expect(m.slip(plantedUpTo(name, v), rateOf(s, plantedUpTo(name, v)))).toBeLessThan(slip);
      const capped = m.slip(v, rateOf(s, v));
      expect(capped).toBeLessThan(0.5);
      expect(capped).toBeLessThan(m.slip(old, even(1)));
    }
  }, 30000);
});

/** Lowest point (m) of each foot of `name` per sample, above that foot's ground in the base loop. */
function heightOverBaseGround(name: string): { base: Float32Array[]; lift: number[][] } {
  const base = sampleFeet(baseOf(name));
  const clip = sampleFeet(name);
  const ground = [Infinity, Infinity];
  for (const p of base.pos) for (let i = 0; i < side.length; i++) if (side[i] >= 0) ground[side[i]] = Math.min(ground[side[i]], p[i * 3 + 1]);
  const lift = clip.pos.map((p) => {
    const low = [Infinity, Infinity];
    for (let i = 0; i < side.length; i++) if (side[i] >= 0) low[side[i]] = Math.min(low[side[i]], p[i * 3 + 1]);
    return [low[0] - ground[0], low[1] - ground[1]];
  });
  return { base: base.pos, lift };
}

/** Over the samples the base loop has foot `s` down (within BAND), the variant's lift of that foot (m). */
function liftWhileBaseDown(name: string): number[] {
  const { base, lift } = heightOverBaseGround(name);
  const baseLow = heightOverBaseGround(baseOf(name)).lift;
  const out: number[] = [];
  for (let k = 0; k < base.length; k++) for (const s of [0, 1]) if (baseLow[k][s] <= BAND) out.push(lift[k][s]);
  return out;
}

// Review 2026-11-10 (the fairy look): the skirt variants are judged over the BASE loop's contacts because their own
// feet do not meet the ground where steps would. These are art defects of character.glb, not something a playback rate
// can fix; they are pinned so a re-export that fixes them fails here, and the variants are then re-measured over
// their own contacts.
describe("the skirt variants' own feet (art; why the table judges them over the base loop's contacts)", () => {
  it("the short-skirt walk lifts its planted foot off the ground in mid-stance (about 5 cm)", () => {
    expect(Math.max(...liftWhileBaseDown("Walking_A_ShortSkirt"))).toBeGreaterThan(0.03);
  }, 30000);

  it("the long-skirt walk's feet hover over the base loop's ground while it is down", () => {
    expect(median(liftWhileBaseDown(LONG_WALK))).toBeGreaterThan(0.02);
  }, 30000);

  it("the short-skirt run's feet are lowest while swinging: its planted foot stays up, the swinging one scuffs below it", () => {
    const planted = median(liftWhileBaseDown("Running_A_ShortSkirt"));
    const { lift } = heightOverBaseGround("Running_A_ShortSkirt");
    expect(planted).toBeGreaterThan(0.015);
    expect(Math.min(...lift.flat())).toBeLessThan(planted - 0.015);
  }, 30000);

  it("the long-skirt run's feet never reach the ground", () => {
    const { lift } = heightOverBaseGround(LONG_RUN);
    expect(Math.min(...lift.flat())).toBeGreaterThan(0);
  }, 30000);
});
