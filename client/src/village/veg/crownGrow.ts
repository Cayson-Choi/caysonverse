/**
 * The trees' crowns grown from plain data (perf/no-hitch, 2026-11-17): what a crown job of villageVegetation.ts asks for,
 * in a form that can cross to a Web Worker (crownWorker.ts) — the skeleton, the growth options, and the keep-out as data
 * (which envelope is the crown's own, the instance matrix that carries an instance's keep-out to its origin) instead of
 * a closure. The same function runs in the worker and, where there is none (tests, an old browser), on the page.
 */
import type { BufferGeometry } from "three";
import type { Connection, KeepOut, Envelope } from "./crownGrowth";
import { crownKeepOut, type Box } from "./crownSpace";
import { growBroadleaf, growWillow, leafConnection, type BroadleafOptions, type LeafCrown, type LeafKind } from "./treeCrown";
import { cherryConnection, growCherry, type CherryCrown, type GrowOptions } from "./cherryTree";
import type { TreeSkeleton } from "./treeSkeleton";
import { BARK_STYLE, barkLight, barkPixels, simplifyTwig, twigBark, type BarkPattern } from "./barkGeometry";
import { DAY_SUN_DIRECTION } from "../dayNightBlend";
import type { Vec3 } from "./vegLod";
import type { Card } from "./vegCards";
import type { Bed } from "./flowerPlacement";
import { floraTransfers, layFlora, type FloraResult } from "./floraWork";
import { plantAtlasPixels } from "./vegPlantAtlas";

/** A crown's keep-out as data: `own` indexes the build's envelopes; `xf` (16 numbers, column-major) maps local to world. */
export interface KeepOutSpec {
  own: number;
  xf?: number[];
}

/** The crown's twig bark, made with it (villageVegetation.ts twigGeo): the light tier simplifies; the finest twig radius; round near tips. */
export interface TwigSpec {
  low: boolean;
  minR: number;
  near: boolean;
}

export type GrowRequest = (
  | { kind: "broadleaf"; sk: TreeSkeleton; o: BroadleafOptions; leaf: LeafKind; ko?: KeepOutSpec }
  | { kind: "cherry"; sk: TreeSkeleton; o: Omit<GrowOptions, "keepOut">; ko?: KeepOutSpec }
  | { kind: "willow"; sk: TreeSkeleton }
) & { twig?: TwigSpec };

export type Crown = LeafCrown | CherryCrown;

type Arr = ArrayLike<number> & { buffer: ArrayBufferLike };

/** A geometry as plain arrays (what crosses from the worker; the arrays are transferred, not copied). */
export interface GeoData {
  attrs: Record<string, { array: Arr; itemSize: number; normalized: boolean }>;
  index: Arr | null;
}

/** What one request gives back: the crown, its connection (the dev hook's measure) and its twig bark, when asked. */
export interface GrowResult {
  crown: Crown;
  conn: Connection;
  twig: GeoData | null;
  /** The twig bark as a geometry (grown on the page, no worker). */
  geo?: BufferGeometry;
}

/** The bark's light on a tree (its crown's shade, the foot in the grass, the first fork). */
export const barkLightOf = (sk: TreeSkeleton) => barkLight(sk.crownC, sk.R, sk.base[1], DAY_SUN_DIRECTION as Vec3, { p: sk.trunk.pts[3]!, r: sk.trunk.radii[3]! });

/** A crown's twig bark (the same call villageVegetation.ts made on the page). */
export function twigGeometry(crown: Crown, t: TwigSpec): BufferGeometry {
  const sk = crown.skeleton;
  return twigBark(crown.twigs, BARK_STYLE[sk.kind], t.low, barkLightOf(sk), t.low ? simplifyTwig : undefined, t.minR, t.near);
}

export function geoData(g: BufferGeometry): GeoData {
  const attrs: GeoData["attrs"] = {};
  for (const [name, a] of Object.entries(g.attributes)) {
    const attr = a as unknown as { array: Arr; itemSize: number; normalized: boolean };
    attrs[name] = { array: attr.array, itemSize: attr.itemSize, normalized: attr.normalized };
  }
  return { attrs, index: (g.index?.array as Arr | undefined) ?? null };
}

/** The buffers to transfer with a result. */
export function transfersOf(r: GrowResult): ArrayBuffer[] {
  if (!r.twig) return [];
  const out = Object.values(r.twig.attrs).map((a) => a.array.buffer as ArrayBuffer);
  if (r.twig.index) out.push(r.twig.index.buffer as ArrayBuffer);
  return out;
}

/** The keep-out a spec stands for, against the build's envelopes and houses (crownSpace.crownKeepOut). */
export function keepOutFrom(spec: KeepOutSpec | undefined, envs: readonly Envelope[], boxes: readonly Box[]): KeepOut | undefined {
  if (!spec) return undefined;
  const world = crownKeepOut(envs[spec.own]!, envs, boxes);
  if (!world || !spec.xf) return world;
  const e = spec.xf;
  return (p) => world([e[0]! * p[0] + e[4]! * p[1] + e[8]! * p[2] + e[12]!, e[1]! * p[0] + e[5]! * p[1] + e[9]! * p[2] + e[13]!, e[2]! * p[0] + e[6]! * p[1] + e[10]! * p[2] + e[14]!]);
}

/** Grow one crown. */
export function growCrown(req: GrowRequest, envs: readonly Envelope[], boxes: readonly Box[]): Crown {
  if (req.kind === "willow") return growWillow(req.sk);
  const keepOut = keepOutFrom(req.ko, envs, boxes);
  if (req.kind === "broadleaf") return growBroadleaf(req.sk, req.o, req.leaf, keepOut);
  return growCherry(req.sk, { ...req.o, keepOut });
}

/** Grow one crown, measure it and (`req.twig`) make its twig bark: as arrays (`asData`, to cross to the page) or a geometry. */
export function growFrom(req: GrowRequest, envs: readonly Envelope[], boxes: readonly Box[], asData = false): GrowResult {
  const crown = growCrown(req, envs, boxes);
  const conn = "bunches" in crown ? cherryConnection(crown) : leafConnection(crown);
  if (!req.twig) return { crown, conn, twig: null };
  const geo = twigGeometry(crown, req.twig);
  return asData ? { crown, conn, twig: geoData(geo) } : { crown, conn, twig: null, geo };
}

/** Messages between the page and the worker. */
export type WorkerIn = { type: "init"; envs: Envelope[]; boxes: Box[] } | { type: "grow"; id: number; req: GrowRequest } | { type: "flora"; id: number; cards: Card[]; beds?: Bed[] } | { type: "atlas"; id: number; drawPlant: boolean };
export type WorkerOut = { type: "crown"; id: number; result: GrowResult } | { type: "flora"; id: number; result: FloraResult } | { type: "atlas"; id: number; result: Textures | null } | { type: "error"; id: number; message: string };

export { floraTransfers, layFlora, plantAtlasPixels };

/** The plant atlas's pixels (vegPlantAtlas.ts). */
export type AtlasPixels = { data: Uint8Array; width: number; height: number };

/** The kinds of bark the build draws (villageVegetation.ts). */
export const BARK_PATTERNS: readonly BarkPattern[] = ["cherry", "plates", "willow", "smooth", "plum"];

/** The textures drawn in code, made off the page: the plant atlas (null: no OffscreenCanvas there) and every bark. */
export interface Textures {
  atlas: AtlasPixels | null;
  bark: Partial<Record<BarkPattern, Uint8Array>>;
}

/** Make them (in the worker). */
export function makeTextures(drawPlant: boolean): Textures {
  let atlas: AtlasPixels | null = null;
  try {
    atlas = drawPlant && typeof OffscreenCanvas !== "undefined" ? plantAtlasPixels() : null;
  } catch {
    atlas = null;
  }
  const bark: Textures["bark"] = {};
  for (const p of BARK_PATTERNS) bark[p] = barkPixels(p);
  return { atlas, bark };
}

export function textureTransfers(t: Textures): ArrayBuffer[] {
  const out = Object.values(t.bark).map((a) => a!.buffer as ArrayBuffer);
  if (t.atlas) out.push(t.atlas.data.buffer as ArrayBuffer);
  return out;
}

/** Grows crowns off the page where it can: `grow` returns a promise; requests are served in the order they are made. */
export interface CrownGrower {
  /** The build's envelopes and houses (the keep-outs' data): before the first `grow`. */
  init(envs: Envelope[], boxes: Box[]): void;
  grow(req: GrowRequest): Promise<GrowResult>;
  /** The flowers' layout and soil (floraWork.ts). */
  flora(cards: Card[], beds?: readonly Bed[]): Promise<FloraResult>;
  /** The textures drawn in code (the plant atlas, the barks), made off the page (null: make them here). */
  atlas(drawPlant: boolean): Promise<Textures | null>;
  /** Whether a worker does the growing (false: on the page, at `grow`). */
  readonly offPage: boolean;
  dispose(): void;
}

/** How many workers (each a thread of its own): at most 4, one fewer than the device's cores. */
function workerCount(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(4, cores - 1));
}

/** Crowns a worker holds at a time (one growing, one waiting: it never idles for a round trip). */
const CROWNS_IN_FLIGHT = 2;

/**
 * The workers start loading at once (made at the build's start, they are ready by the time the crowns are asked for);
 * `init` hands them the envelopes and houses once the build knows them.
 */
export function createCrownGrower(makeWorker?: () => Worker): CrownGrower {
  let envs: Envelope[] = [];
  let boxes: Box[] = [];
  const inline: CrownGrower = {
    init: (e, b) => {
      envs = e;
      boxes = b;
    },
    grow: (req) => Promise.resolve(growFrom(req, envs, boxes)),
    flora: (cards, beds) => Promise.resolve(layFlora(cards, false, beds)),
    atlas: () => Promise.resolve(null),
    offPage: false,
    dispose: () => {},
  };
  if (!makeWorker || typeof Worker === "undefined") return inline;
  let workers: Worker[];
  try {
    workers = Array.from({ length: workerCount() }, makeWorker);
  } catch {
    return inline;
  }
  const waiting = new Map<number, { resolve: (r: GrowResult) => void; req: GrowRequest }>();
  const floras = new Map<number, { resolve: (r: FloraResult) => void; cards: Card[]; beds?: readonly Bed[] }>();
  const atlases = new Map<number, (r: Textures | null) => void>();
  let next = 1;
  let broken = false;
  // the crowns wait here, nearest first; each worker is handed the next one as it finishes (the one that laid the
  // flowers out joins in when it is done)
  const queue: Array<{ id: number; req: GrowRequest }> = [];
  const load = new Map<Worker, number>(workers.map((w) => [w, 0]));
  const owner = new Map<number, Worker>();
  const give = (w: Worker, id: number, msg: WorkerIn, weight: number) => {
    owner.set(id, w);
    load.set(w, load.get(w)! + weight);
    w.postMessage(msg);
  };
  const pump = () => {
    for (const w of workers) {
      while (queue.length && load.get(w)! < CROWNS_IN_FLIGHT) {
        const job = queue.shift()!;
        give(w, job.id, { type: "grow", id: job.id, req: job.req }, 1);
      }
    }
  };
  const done = (id: number, weight: number) => {
    const w = owner.get(id);
    owner.delete(id);
    if (w) load.set(w, Math.max(0, load.get(w)! - weight));
    pump();
  };
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      const at = atlases.get(m.id);
      if (at) {
        atlases.delete(m.id);
        done(m.id, CROWNS_IN_FLIGHT);
        at(m.type === "atlas" ? m.result : null);
        return;
      }
      const fl = floras.get(m.id);
      if (fl) {
        floras.delete(m.id);
        done(m.id, CROWNS_IN_FLIGHT);
        fl.resolve(m.type === "flora" ? m.result : layFlora(fl.cards, false, fl.beds));
        return;
      }
      const job = waiting.get(m.id);
      if (!job) return;
      waiting.delete(m.id);
      done(m.id, 1);
      // a crown the worker could not grow is grown here (the same result)
      job.resolve(m.type === "crown" ? m.result : growFrom(job.req, envs, boxes));
    };
    w.onerror = () => {
      // a worker that fails to load: everything still waiting, and all later requests, are grown on the page
      broken = true;
      for (const q of queue.splice(0)) {
        const job = waiting.get(q.id);
        waiting.delete(q.id);
        job?.resolve(growFrom(q.req, envs, boxes));
      }
      for (const [id, job] of waiting) {
        waiting.delete(id);
        job.resolve(growFrom(job.req, envs, boxes));
      }
      for (const [id, fl] of floras) {
        floras.delete(id);
        fl.resolve(layFlora(fl.cards, false, fl.beds));
      }
      for (const [id, at] of atlases) {
        atlases.delete(id);
        at(null);
      }
    };
  }
  return {
    offPage: true,
    init(e, b) {
      envs = e;
      boxes = b;
      for (const w of workers) w.postMessage({ type: "init", envs, boxes } satisfies WorkerIn);
    },
    atlas(drawPlant) {
      if (broken) return Promise.resolve(null);
      const id = next++;
      return new Promise((resolve) => {
        atlases.set(id, resolve);
        // the first worker: done long before the crowns are asked for
        give(workers[0]!, id, { type: "atlas", id, drawPlant }, CROWNS_IN_FLIGHT);
      });
    },
    flora(cards, beds) {
      if (broken) return Promise.resolve(layFlora(cards, false, beds));
      const id = next++;
      return new Promise((resolve) => {
        floras.set(id, { resolve, cards, beds });
        // the last worker (busy with it: the crowns go to the others until it is done)
        give(workers[workers.length - 1]!, id, { type: "flora", id, cards, beds: beds ? [...beds] : undefined }, CROWNS_IN_FLIGHT);
      });
    },
    grow(req) {
      if (broken) return Promise.resolve(growFrom(req, envs, boxes));
      const id = next++;
      return new Promise((resolve) => {
        waiting.set(id, { resolve, req });
        queue.push({ id, req });
        pump();
      });
    },
    dispose() {
      for (const w of workers) w.terminate();
      queue.length = 0;
      waiting.clear();
      floras.clear();
      // Another vegetation build may be awaiting this worker's shared plant pixels.
      for (const resolve of atlases.values()) resolve(null);
      atlases.clear();
    },
  };
}
