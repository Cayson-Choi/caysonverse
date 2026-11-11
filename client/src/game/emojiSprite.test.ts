import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EMOJIS } from "@caysonverse/shared/constants";

// The unit tests have no DOM: a canvas that takes the glyph's draw calls and counts them.
let drawn = 0;
beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        font: "",
        textAlign: "",
        textBaseline: "",
        fillText: () => {
          drawn++;
        },
      }),
    }),
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe("emoji reaction textures (perf/interaction-latency: no canvas draw or upload in a reaction's frame)", () => {
  it("one texture per glyph, shared by every reaction with it; a reaction's dispose keeps it", async () => {
    const { createEmojiSprite, emojiTexture } = await import("./emojiSprite");
    const before = drawn;
    const a = createEmojiSprite("👍");
    const b = createEmojiSprite("👍");
    expect(drawn - before).toBe(1);
    const texA = (a.sprite.material as { map: unknown }).map;
    expect(texA).toBe((b.sprite.material as { map: unknown }).map);
    expect(texA).toBe(emojiTexture("👍"));
    // each reaction fades on its own: its own material
    expect(a.sprite.material).not.toBe(b.sprite.material);
    let disposed = 0;
    (texA as { addEventListener(t: string, f: () => void): void }).addEventListener("dispose", () => disposed++);
    a.dispose();
    b.dispose();
    expect(disposed).toBe(0);
    const c = createEmojiSprite("👍");
    expect((c.sprite.material as { map: unknown }).map).toBe(texA);
    expect(drawn - before).toBe(1);
  });

  it("prewarm uploads every palette glyph once, one per idle slot, and can be cancelled", async () => {
    const { prewarmEmojiTextures, emojiTexture } = await import("./emojiSprite");
    const queue: (() => void)[] = [];
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => queue.push(cb));
    const uploaded: unknown[] = [];
    prewarmEmojiTextures({ initTexture: (t) => void uploaded.push(t) });
    expect(uploaded).toHaveLength(0);
    while (queue.length) queue.shift()!();
    expect(uploaded).toEqual(EMOJIS.map((g) => emojiTexture(g)));

    const more: unknown[] = [];
    const cancel = prewarmEmojiTextures({ initTexture: (t) => void more.push(t) });
    queue.shift()!();
    cancel();
    while (queue.length) queue.shift()!();
    expect(more).toHaveLength(1);
  });

  it("(fix/crisp-labels) a 256 px mipmapped glyph sampled half a level sharp, on the label layer, never pixel-snapped", async () => {
    const { createEmojiSprite, EMOJI_LOD_BIAS } = await import("./emojiSprite");
    const { LABEL_LAYER } = await import("./spriteCanvas");
    const { LinearMipmapLinearFilter } = await import("three");
    const e = createEmojiSprite("🎉");
    const material = e.sprite.material as unknown as {
      map: { image: { width: number }; generateMipmaps: boolean; minFilter: number };
      toneMapped: boolean;
      onBeforeCompile(s: unknown, r: unknown): void;
    };
    expect(material.map.image.width).toBe(256);
    expect(material.map.generateMipmaps).toBe(true);
    expect(material.map.minFilter).toBe(LinearMipmapLinearFilter);
    expect(material.toneMapped).toBe(false);
    expect(e.sprite.layers.mask).toBe(1 << LABEL_LAYER);
    const s = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: "", fragmentShader: "void main() {}" };
    material.onBeforeCompile(s, null);
    expect(s.uniforms.uLodBias!.value).toBe(EMOJI_LOD_BIAS);
    expect(s.uniforms.uSnap!.value).toBe(0);
    e.dispose();
  });
});
