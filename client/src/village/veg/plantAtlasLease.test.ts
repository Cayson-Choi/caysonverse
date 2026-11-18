import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTexture } from "three";
import { acquirePlantAtlas } from "./plantAtlasLease";
import { createCrownGrower, type Textures } from "./crownGrow";
import * as plant from "./vegPlantAtlas";

const realMake = plant.makePlantAtlas;
const pixels = { data: new Uint8Array(1024 * 1024 * 4), width: 1024, height: 1024 };
const alive = () => false;
const inline = { offPage: false, atlas: () => Promise.resolve(null) };
const owners: ReturnType<typeof acquirePlantAtlas>[] = [];
function owner() {
  const lease = acquirePlantAtlas();
  owners.push(lease);
  return lease;
}
function observeFactory() {
  return vi.spyOn(plant, "makePlantAtlas").mockImplementation((p = pixels) => realMake(p));
}
function workerJob() {
  let complete!: (value: Textures | null) => void;
  const result = new Promise<Textures | null>((resolve) => { complete = resolve; });
  return { offPage: true, atlas: vi.fn((_drawPlant: boolean) => result), complete };
}
afterEach(() => {
  for (const lease of owners.splice(0)) lease.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the shared plant atlas", () => {
  it("shares in-flight worker pixels across the village, house flowers and park while still requesting each worker's barks", async () => {
    const make = observeFactory();
    const houses = owner(), village = owner(), park = owner();
    const first = workerJob(), second = workerJob();
    await houses.startTextures(inline);
    const villageJob = village.startTextures(first);
    const parkJob = park.startTextures(second);
    const textures = [houses.texture(alive), village.texture(alive), park.texture(alive)];
    expect(first.atlas).toHaveBeenCalledWith(true);
    expect(second.atlas).toHaveBeenCalledWith(false);
    expect(make).not.toHaveBeenCalled();
    second.complete({ atlas: null, bark: { smooth: Uint8Array.of(8) } });
    first.complete({ atlas: pixels, bark: { smooth: Uint8Array.of(5) } });
    expect((await villageJob)?.bark.smooth).toEqual(Uint8Array.of(5));
    expect((await parkJob)?.bark.smooth).toEqual(Uint8Array.of(8));
    const [a, b, c] = await Promise.all(textures);
    if (!(a instanceof DataTexture)) throw new Error("Expected a plant DataTexture");
    expect(b?.uuid).toBe(a.uuid);
    expect(c?.uuid).toBe(a.uuid);
    expect(a.image.data === pixels.data).toBe(true);
    expect(pixels.data.byteLength).toBe(4_194_304);
    expect(make).toHaveBeenCalledTimes(1);
    expect(make.mock.calls[0]?.[0] === pixels).toBe(true);
    const dispose = vi.spyOn(a, "dispose");
    village.dispose();
    houses.dispose();
    houses.dispose();
    expect(dispose).not.toHaveBeenCalled();
    park.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect((await owner().texture(alive))?.uuid).not.toBe(a.uuid);
  });

  it("uses a completed page-only atlas when a worker starts later", async () => {
    const make = observeFactory();
    const houses = owner(), village = owner();
    await houses.startTextures(inline);
    const texture = await houses.texture(alive);
    const worker = workerJob();
    const job = village.startTextures(worker);
    expect(worker.atlas).toHaveBeenCalledWith(false);
    worker.complete({ atlas: null, bark: {} });
    await job;
    expect(await village.texture(alive)).toBe(texture);
    expect(make).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledWith(undefined);
  });

  it("falls back once when the worker has no OffscreenCanvas, and skips a cancelled owner", async () => {
    const make = observeFactory();
    const a = owner(), b = owner(), c = owner();
    const worker = workerJob();
    const job = a.startTextures(worker);
    const requests = [a.texture(() => true), b.texture(alive), c.texture(alive)];
    worker.complete({ atlas: null, bark: {} });
    await job;
    const [skipped, housed, parked] = await Promise.all(requests);
    expect(skipped).toBeNull();
    expect(housed).toBeInstanceOf(DataTexture);
    expect(parked).toBe(housed);
    expect(make).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledWith(undefined);
  });

  it("lets surviving house flowers draw their atlas when the village cancels its outstanding worker", async () => {
    const make = observeFactory();
    const posted = vi.fn(), terminate = vi.fn();
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
    const grower = createCrownGrower(() => ({ postMessage: posted, terminate } as unknown as Worker));
    const village = owner(), houses = owner();
    const job = village.startTextures(grower);
    const requests = [village.texture(alive), houses.texture(alive)];
    expect(posted).toHaveBeenCalledWith({ type: "atlas", id: 1, drawPlant: true });
    village.dispose();
    grower.dispose();
    expect(await job).toBeNull();
    expect(terminate).toHaveBeenCalledOnce();
    const [skipped, texture] = await Promise.all(requests);
    expect(skipped).toBeNull();
    expect(texture).toBeInstanceOf(DataTexture);
    expect(make).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledWith(undefined);
  });

  it("discards a late worker result after the last owner leaves, even if a new build has already started", async () => {
    const make = observeFactory();
    const old = owner(), worker = workerJob();
    const job = old.startTextures(worker);
    const waiting = old.texture(alive);
    old.dispose();
    const fresh = owner();
    await fresh.startTextures(inline);
    const current = await fresh.texture(alive);
    worker.complete({ atlas: pixels, bark: {} });
    await job;
    expect(await waiting).toBeNull();
    expect(await fresh.texture(alive)).toBe(current);
    expect(make).toHaveBeenCalledTimes(1);
  });
});
