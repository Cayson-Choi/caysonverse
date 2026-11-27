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

  it("prewarm draws every palette glyph once, one per idle slot, and can be cancelled", async () => {
    vi.resetModules();
    const { prewarmEmojiTextures, emojiTexture } = await import("./emojiSprite");
    const queue: (() => void)[] = [];
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => queue.push(cb));
    const before = drawn;
    prewarmEmojiTextures();
    expect(drawn - before).toBe(0);
    while (queue.length) queue.shift()!();
    expect(drawn - before).toBe(EMOJIS.length);
    for (const g of EMOJIS) emojiTexture(g); // already drawn: no more draws
    expect(drawn - before).toBe(EMOJIS.length);

    vi.resetModules();
    const fresh = await import("./emojiSprite");
    const mid = drawn;
    const cancel = fresh.prewarmEmojiTextures();
    queue.shift()!();
    cancel();
    while (queue.length) queue.shift()!();
    expect(drawn - mid).toBe(1);
  });

  it("(fix/crisp-labels) a 256 px glyph on the label layer, never pixel-snapped, not tone-mapped", async () => {
    const { createEmojiSprite } = await import("./emojiSprite");
    const { LABEL_LAYER, labelInfo } = await import("./spriteCanvas");
    const e = createEmojiSprite("🎉");
    const material = e.sprite.material as unknown as { map: { image: { width: number } }; toneMapped: boolean };
    expect(material.map.image.width).toBe(256);
    expect(material.toneMapped).toBe(false);
    expect(e.sprite.layers.mask).toBe(1 << LABEL_LAYER);
    expect(labelInfo(e.sprite).snap).toBe(0);
    e.dispose();
  });
});
