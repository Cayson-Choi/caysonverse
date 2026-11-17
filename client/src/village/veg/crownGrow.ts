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
import { BARK_STYLE, barkLight, simplifyTwig, twigBark } from "./barkGeometry";
import { DAY_SUN_DIRECTION } from "../dayNightBlend";
import type { Vec3 } from "./vegLod";
import type { Card } from "./vegCards";
import type { Bed } from "./flowerPlacement";
import { floraTransfers, layFlora, type FloraResult } from "./floraWork";

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
export type WorkerIn = { type: "init"; envs: Envelope[]; boxes: Box[] } | { type: "grow"; id: number; req: GrowRequest } | { type: "flora"; id: number; cards: Card[]; beds?: Bed[] };
export type WorkerOut = { type: "crown"; id: number; result: GrowResult } | { type: "flora"; id: number; result: FloraResult } | { type: "error"; id: number; message: string };

export { floraTransfers, layFlora };

/** Grows crowns off the page where it can: `grow` returns a promise; requests are served in the order they are made. */
export interface CrownGrower {
  /** The build's envelopes and houses (the keep-outs' data): before the first `grow`. */
  init(envs: Envelope[], boxes: Box[]): void;
  grow(req: GrowRequest): Promise<GrowResult>;
  /** The flowers' layout and soil (floraWork.ts). */
  flora(cards: Card[], beds?: readonly Bed[]): Promise<FloraResult>;
  /** Whether a worker does the growing (false: on the page, at `grow`). */
  readonly offPage: boolean;
  dispose(): void;
}

/** How many workers (each a thread of its own): at most 3 (the last also lays the flowers out), one fewer than the cores. */
function workerCount(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(3, cores - 1));
}

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
  let next = 1;
  let broken = false;
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      const fl = floras.get(m.id);
      if (fl) {
        floras.delete(m.id);
        fl.resolve(m.type === "flora" ? m.result : layFlora(fl.cards, false, fl.beds));
        return;
      }
      const job = waiting.get(m.id);
      if (!job) return;
      waiting.delete(m.id);
      // a crown the worker could not grow is grown here (the same result)
      job.resolve(m.type === "crown" ? m.result : growFrom(job.req, envs, boxes));
    };
    w.onerror = () => {
      // a worker that fails to load: everything still waiting, and all later requests, are grown on the page
      broken = true;
      for (const [id, job] of waiting) {
        waiting.delete(id);
        job.resolve(growFrom(job.req, envs, boxes));
      }
      for (const [id, fl] of floras) {
        floras.delete(id);
        fl.resolve(layFlora(fl.cards, false, fl.beds));
      }
    };
  }
  let rr = 0;
  return {
    offPage: true,
    init(e, b) {
      envs = e;
      boxes = b;
      for (const w of workers) w.postMessage({ type: "init", envs, boxes } satisfies WorkerIn);
    },
    flora(cards, beds) {
      if (broken) return Promise.resolve(layFlora(cards, false, beds));
      const id = next++;
      return new Promise((resolve) => {
        floras.set(id, { resolve, cards, beds });
        // the last worker: the first trees' crowns go to the others first
        workers[workers.length - 1]!.postMessage({ type: "flora", id, cards, beds: beds ? [...beds] : undefined } satisfies WorkerIn);
      });
    },
    grow(req) {
      if (broken) return Promise.resolve(growFrom(req, envs, boxes));
      const id = next++;
      return new Promise((resolve) => {
        waiting.set(id, { resolve, req });
        const crownWorkers = workers.length > 2 ? workers.length - 1 : workers.length;
        workers[rr++ % crownWorkers]!.postMessage({ type: "grow", id, req } satisfies WorkerIn);
      });
    },
    dispose() {
      for (const w of workers) w.terminate();
      waiting.clear();
      floras.clear();
    },
  };
}
