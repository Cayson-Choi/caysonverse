import { Texture, type WebGLRenderer } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as library from "../pbr/pbrLibrary";
import { LotTextureBank, NEAR_KEEP_MS } from "./lotTextures";

const gl = {
  initTexture: vi.fn(),
  capabilities: { getMaxAnisotropy: () => 8 },
} as unknown as WebGLRenderer;
const id = "plaza_granite";

function sourceSet(): library.PbrSet {
  return { id, tier: "1k", info: library.pbrSetInfo(id), map: new Texture(), normalMap: new Texture(), orm: new Texture() };
}

afterEach(() => vi.restoreAllMocks());

describe("lot texture lifetime", () => {
  it("evicts the three uploaded repeat textures when a detailed lot leaves range", async () => {
    const source = sourceSet();
    vi.spyOn(library, "getPbrSet").mockResolvedValue(source);
    const release = vi.spyOn(library, "releasePbrSet").mockResolvedValue();
    const bank = new LotTextureBank(gl, "1k");
    bank.want(new Set([id]), 0);
    await Promise.resolve();
    bank.pump(3);
    const near = bank.textures(id)!;
    const disposed = [near.map, near.normalMap, near.orm].map((t) => vi.spyOn(t, "dispose"));
    bank.want(new Set(), NEAR_KEEP_MS + 1);
    expect(disposed.map((d) => d.mock.calls.length)).toEqual([1, 1, 1]);
    expect(bank.textures(id)).toBeNull();
    bank.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("retiring an exterior during a load keeps a room's shared maps until it too leaves", async () => {
    const source = sourceSet();
    let finish!: (s: library.PbrSet) => void;
    const pending = new Promise<library.PbrSet>((resolve) => { finish = resolve; });
    vi.spyOn(library, "getPbrSet").mockReturnValue(pending);
    const release = vi.spyOn(library, "releasePbrSet").mockResolvedValue();
    const exterior = new LotTextureBank(gl, "1k");
    const room = new LotTextureBank(gl, "1k", false);
    const loads = [exterior.loadNear(id), room.loadNear(id)];
    exterior.dispose();
    finish(source);
    await Promise.all(loads);
    expect(release).not.toHaveBeenCalled();
    expect(exterior.pump(0)).toBe(0);
    expect(room.textures(id)?.near).toBe(true);
    room.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("a failed room load can retry and release its last reference", async () => {
    vi.spyOn(library, "getPbrSet").mockRejectedValueOnce(new Error("load failed")).mockResolvedValueOnce(sourceSet());
    const release = vi.spyOn(library, "releasePbrSet").mockResolvedValue();
    const room = new LotTextureBank(gl, "1k", false);
    await expect(room.loadNear(id)).rejects.toThrow("load failed");
    await room.loadNear(id);
    release.mockClear();
    room.dispose();
    expect(release).toHaveBeenCalledOnce();
  });
});
