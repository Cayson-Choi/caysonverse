import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpriteMaterial, Texture } from "three";
import {
  BUBBLE_MAX_FONT_PX,
  BUBBLE_MIN_FONT_PX,
  BUBBLE_START_FONT_PX,
  bubbleMetrics,
  bubbleTextCssPx,
  createBubbleSprite,
} from "./bubbleSprite";
import { LABEL_LAYER, LABEL_SNAP } from "./spriteCanvas";

// A recording canvas (no DOM in the unit tests): 0.5 x the font size per UTF-16 unit.
interface FakeCanvas {
  width: number;
  height: number;
  texts: { text: string; font: string; x: number; y: number }[];
  getContext(): unknown;
}
let canvases: FakeCanvas[] = [];
let frame = 0;
function fakeCanvas(): FakeCanvas {
  const texts: FakeCanvas["texts"] = [];
  const ctx = {
    font: "",
    fillStyle: "",
    textAlign: "",
    textBaseline: "",
    measureText(s: string) {
      const px = Number(/ (\d+)px /.exec(ctx.font)?.[1] ?? 10);
      return { width: s.length * px * 0.5 };
    },
    beginPath() {},
    moveTo() {},
    arcTo() {},
    closePath() {},
    fill() {},
    fillText(text: string, x: number, y: number) {
      texts.push({ text, font: ctx.font, x, y });
    },
  };
  const c: FakeCanvas = { width: 300, height: 150, texts, getContext: () => ctx };
  canvases.push(c);
  return c;
}
const stubDocument = () =>
  vi.stubGlobal("document", { createElement: () => fakeCanvas(), timeline: { currentTime: ++frame } });
const drawn = () => canvases.filter((c) => c.texts.length > 0);
const fontOf = (c: FakeCanvas) => Number(/ (\d+)px /.exec(c.texts[0]!.font)![1]);

beforeEach(() => {
  canvases = [];
  stubDocument();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("speech bubble at device pixels (fix/crisp-labels)", () => {
  it("the text's CSS height follows the bubble's world density (40 design px at 0.42 / 76 m each)", () => {
    expect(bubbleTextCssPx(100)).toBeCloseTo((40 * 0.42 * 100) / 76, 6);
    expect(bubbleTextCssPx(0)).toBe(0);
  });

  it("metrics scale from the 40 px design and are whole pixels", () => {
    expect(bubbleMetrics(40)).toEqual({ font: 40, lineHeight: 51, padX: 34, padY: 22, corner: 24 });
    for (let f = BUBBLE_MIN_FONT_PX; f <= BUBBLE_MAX_FONT_PX; f++) {
      const m = bubbleMetrics(f);
      for (const v of Object.values(m)) expect(Number.isInteger(v)).toBe(true);
      expect(m.lineHeight).toBeGreaterThan(f);
    }
  });

  it("rasterized straight at the size it is asked for; whole-pixel line starts; bottom-edge origin; snapped label", () => {
    const b = createBubbleSprite("안녕하세요 반가워요!", 21.4);
    const [c] = drawn();
    expect(drawn()).toHaveLength(1);
    expect(fontOf(c!)).toBe(21);
    const m = bubbleMetrics(21);
    expect(c!.height).toBe(m.lineHeight + 2 * m.padY);
    for (const t of c!.texts) {
      expect(Number.isInteger(t.x)).toBe(true);
      expect(Number.isInteger(t.y)).toBe(true);
    }
    expect(b.sprite.center.toArray()).toEqual([0.5, 0]);
    expect(b.sprite.layers.mask).toBe(1 << LABEL_LAYER);
    const s = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: "", fragmentShader: "void main() {}" };
    (b.sprite.material as SpriteMaterial).onBeforeCompile(s as never, null as never);
    expect(s.uniforms.uSnap!.value).toBe(LABEL_SNAP);
    b.dispose();
  });

  it("without a size (or a nonsense one) it starts at the old 2x raster", () => {
    createBubbleSprite("a").dispose();
    createBubbleSprite("b", 0).dispose();
    expect(drawn().map(fontOf)).toEqual([BUBBLE_START_FONT_PX, BUBBLE_START_FONT_PX]);
  });

  it("re-rasterizes when the shown size moves a whole pixel, keeps its world height and its line breaks", () => {
    const text = "가나다라마바사아자차카타파하 가나다라마바사아자차카타파하 가나다라마바사아자차카타파하";
    const b = createBubbleSprite(text, 30);
    const h = b.heightM;
    const lines = drawn()[0]!.texts.map((t) => t.text);
    expect(lines.length).toBeGreaterThan(1);
    const old = (b.sprite.material as SpriteMaterial).map as Texture;
    let disposed = 0;
    old.addEventListener("dispose", () => disposed++);
    b.setTextDevicePx(30.5); // within the hysteresis: nothing
    expect(drawn()).toHaveLength(1);
    b.setTextDevicePx(18);
    expect(drawn()).toHaveLength(2);
    const c = drawn()[1]!;
    expect(fontOf(c)).toBe(18);
    expect(c.texts.map((t) => t.text)).toEqual(lines);
    expect(b.heightM).toBe(h);
    expect(b.sprite.scale.y).toBe(h);
    expect(b.sprite.scale.x / b.sprite.scale.y).toBeCloseTo(c.width / c.height, 6);
    expect((b.sprite.material as SpriteMaterial).map).not.toBe(old);
    expect(disposed).toBe(1);
    b.dispose();
  });

  it("shares the per-frame raster budget: a third bubble waits for the next frame", () => {
    const bs = [createBubbleSprite("a", 20), createBubbleSprite("b", 20), createBubbleSprite("c", 20)];
    stubDocument();
    const n = drawn().length;
    for (const b of bs) b.setTextDevicePx(30);
    expect(drawn().length - n).toBe(2);
    stubDocument();
    for (const b of bs) b.setTextDevicePx(30);
    expect(drawn().length - n).toBe(3);
    bs.forEach((b) => b.dispose());
  });

  it("a disposed bubble rasterizes nothing", () => {
    const b = createBubbleSprite("a", 20);
    b.dispose();
    b.setTextDevicePx(40);
    expect(drawn()).toHaveLength(1);
  });
});
