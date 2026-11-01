import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { useGLTF } from "@react-three/drei";
import { CHARACTER_GLB_HASH } from "@caysonverse/shared/characterManifest";
import { CHARACTER_MODEL_URL } from "./useAvatar";
import {
  MODEL_RETRY_DELAYS_MS,
  createModelGate,
  gltfCache,
  isModelLoadError,
  type SuspenseCache,
} from "./characterModel";

/** suspend-react의 한 항목처럼 구는 가짜 캐시: 받는 중엔 promise, 실패면 캐시된 오류, 지우기 전엔 다시 받지 않는다. */
function fakeCache() {
  let entry: { promise: Promise<void>; response?: unknown; error?: unknown } | null = null;
  let finish: ((outcome: { ok: true } | { ok: false; error: unknown }) => void) | null = null;
  const log: string[] = [];
  const start = () => {
    log.push("load");
    const e: NonNullable<typeof entry> = { promise: Promise.resolve() };
    e.promise = new Promise<void>((resolve) => {
      finish = (outcome) => {
        if (outcome.ok) e.response = { scene: "model" };
        else e.error = outcome.error;
        resolve();
      };
    });
    entry = e;
  };
  const cache: SuspenseCache = {
    read() {
      if (!entry) start();
      if (entry!.error !== undefined) throw entry!.error;
      if (entry!.response !== undefined) return entry!.response;
      throw entry!.promise;
    },
    clear() {
      log.push("clear");
      entry = null;
    },
    preload() {
      if (!entry) start();
    },
  };
  return {
    cache,
    log,
    succeed: () => finish!({ ok: true }),
    fail: (error: unknown = new Error("Could not load /m.glb: 503")) => finish!({ ok: false, error }),
  };
}

describe("createModelGate", () => {
  it("reads loading → ready, and settle() resolves true", async () => {
    const f = fakeCache();
    const gate = createModelGate(f.cache);
    expect(gate.state()).toBe("loading");
    const settled = gate.settle();
    f.succeed();
    await expect(settled).resolves.toBe(true);
    expect(gate.state()).toBe("ready");
    expect(f.log).toEqual(["load"]);
  });

  it("keeps a failure cached (no new download) until retry() clears it", async () => {
    const f = fakeCache();
    const gate = createModelGate(f.cache);
    const settled = gate.settle();
    f.fail();
    await expect(settled).resolves.toBe(false);
    expect(gate.state()).toBe("failed");
    expect(gate.state()).toBe("failed");
    expect(f.log).toEqual(["load"]);

    gate.retry();
    expect(f.log).toEqual(["load", "clear", "load"]);
    expect(gate.state()).toBe("loading");
  });

  it("retry() never throws away a loaded or loading model", async () => {
    const f = fakeCache();
    const gate = createModelGate(f.cache);
    gate.retry(); // nothing cached yet: just starts the download
    gate.retry(); // loading: left alone
    expect(f.log).toEqual(["load"]);
    f.succeed();
    await gate.settle();
    gate.retry(); // ready: left alone
    expect(f.log).toEqual(["load"]);
    expect(gate.state()).toBe("ready");
  });

  it("reload() clears a failure and reports the new download's outcome", async () => {
    const f = fakeCache();
    const gate = createModelGate(f.cache);
    let settled = gate.settle();
    f.fail();
    await settled;

    settled = gate.reload();
    f.fail();
    await expect(settled).resolves.toBe(false);

    settled = gate.reload();
    f.succeed();
    await expect(settled).resolves.toBe(true);
    expect(f.log).toEqual(["load", "clear", "load", "clear", "load"]);
  });
});

describe("CHARACTER_MODEL_URL", () => {
  it("is the public GLB versioned by its content hash (one URL = one loader cache key)", () => {
    expect(CHARACTER_MODEL_URL).toBe(`/models/character.glb?v=${CHARACTER_GLB_HASH}`);
    expect(CHARACTER_GLB_HASH).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("MODEL_RETRY_DELAYS_MS / isModelLoadError", () => {
  it("retries 3 times, 1.5 s first, each wait longer than the last", () => {
    expect(MODEL_RETRY_DELAYS_MS.length).toBe(3);
    expect(MODEL_RETRY_DELAYS_MS[0]).toBe(1500);
    for (let i = 1; i < MODEL_RETRY_DELAYS_MS.length; i++) {
      expect(MODEL_RETRY_DELAYS_MS[i]).toBeGreaterThan(MODEL_RETRY_DELAYS_MS[i - 1]);
    }
  });

  it("recognises R3F's wrapped load error for that URL only", () => {
    const url = "/models/character.glb?v=0123abcd";
    expect(isModelLoadError(new Error(`Could not load ${url}: fetch responded with 503`), url)).toBe(true);
    expect(isModelLoadError(new Error("WebGL context could not be created"), url)).toBe(false);
    expect(isModelLoadError(new Error("Could not load /models/other.glb: 404"), url)).toBe(false);
  });
});

// The protocol the gate relies on, checked against the REAL drei useGLTF (→ R3F useLoader → suspend-react):
// called outside React it throws a promise while loading, then caches a failed download's error and does not
// fetch again until useGLTF.clear — which is exactly why a failed character.glb used to stick.
describe("gltfCache over the real useGLTF", () => {
  let server: Server;
  let status = 503;
  let hits = 0;
  let base = "";
  const hadProgressEvent = "ProgressEvent" in globalThis;

  beforeAll(async () => {
    // three's FileLoader builds a ProgressEvent, which Node lacks.
    if (!hadProgressEvent) {
      (globalThis as Record<string, unknown>).ProgressEvent = class extends Event {
        constructor(type: string, init: object = {}) {
          super(type);
          Object.assign(this, init);
        }
      };
    }
    server = createServer((_req, res) => {
      hits++;
      if (status !== 200) {
        res.writeHead(status);
        res.end("unavailable");
        return;
      }
      res.writeHead(200, { "content-type": "model/gltf+json" });
      res.end(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "n" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!hadProgressEvent) delete (globalThis as Record<string, unknown>).ProgressEvent;
  });

  it("a 503 stays cached until retry(); the next download then loads", async () => {
    const url = `${base}/character.gltf?v=test`;
    const gate = createModelGate(gltfCache(url));
    status = 503;
    hits = 0;

    expect(gate.state()).toBe("loading");
    await expect(gate.settle()).resolves.toBe(false);
    expect(gate.state()).toBe("failed");
    let caught: unknown;
    try {
      useGLTF(url);
    } catch (error) {
      caught = error;
    }
    expect(isModelLoadError(caught, url)).toBe(true);
    expect(hits).toBe(1); // the failure was served from the cache, no second request

    status = 200;
    await expect(gate.reload()).resolves.toBe(true);
    expect(gate.state()).toBe("ready");
    expect(hits).toBe(2);

    gate.retry(); // loaded: kept
    expect(gate.state()).toBe("ready");
    expect(hits).toBe(2);
    useGLTF.clear(url);
  });
});
