import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Group, LinearMipmapLinearFilter, Vector3, type SpriteMaterial, type Texture } from "three";
import {
  NAMETAG_BASE_HEIGHT_M,
  NAMETAG_FONT_PX,
  NAMETAG_HEIGHT,
  NAMETAG_PAD_Y_PX,
} from "./constants";
import {
  clearIdleNametagLooks,
  createNametag,
  nametagCacheKey,
  nametagCacheSize,
  nametagIdleSize,
  nametagLabel,
  NAMETAG_IDLE_LOOKS,
  type Nametag,
} from "./nametag";

// ── a recording canvas: the module only needs getContext("2d") ──────────────

interface Draw {
  kind: "fill" | "stroke" | "text";
  style: string;
  lineWidth?: number;
  text?: string;
  font?: string;
  x?: number;
}

interface FakeCanvas {
  width: number;
  height: number;
  draws: Draw[];
  getContext(type: string): unknown;
}

const canvases: FakeCanvas[] = [];

function fakeCanvas(): FakeCanvas {
  const draws: Draw[] = [];
  const ctx = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "",
    textBaseline: "",
    // 20 px per UTF-16 unit in the 48 px text font, 15 in the 26 px pill font.
    measureText(s: string) {
      return { width: s.length * (ctx.font.startsWith("700") ? 15 : 20) };
    },
    beginPath() {},
    moveTo() {},
    arcTo() {},
    closePath() {},
    fill() {
      draws.push({ kind: "fill", style: String(ctx.fillStyle) });
    },
    stroke() {
      draws.push({ kind: "stroke", style: String(ctx.strokeStyle), lineWidth: ctx.lineWidth });
    },
    fillText(text: string, x: number) {
      draws.push({ kind: "text", style: String(ctx.fillStyle), text, font: ctx.font, x });
    },
  };
  const canvas: FakeCanvas = {
    width: 300,
    height: 150,
    draws,
    getContext: () => ctx,
  };
  canvases.push(canvas);
  return canvas;
}

beforeEach(() => {
  canvases.length = 0;
  clearIdleNametagLooks(); // the parked looks are module state: start every test from none
  vi.stubGlobal("document", { createElement: () => fakeCanvas() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The canvases drawn so far, minus the one the module keeps for measuring text. */
const drawn = () => canvases.filter((c) => c.draws.length > 0);
const CANVAS_H = NAMETAG_FONT_PX + 2 * NAMETAG_PAD_Y_PX;
const mapOf = (tag: Nametag) => (tag.sprite.material as SpriteMaterial).map as Texture;

describe("label and cache key", () => {
  it("a teacher's text gets the crown in front, a typist's gets ' …' behind", () => {
    expect(nametagLabel("민수", "none", false)).toBe("민수");
    expect(nametagLabel("민수", "teacher", false)).toBe("👑 민수");
    expect(nametagLabel("조교", "ai", false)).toBe("조교"); // the AI pill is drawn, not typed
    expect(nametagLabel("민수", "none", true)).toBe("민수 …");
    expect(nametagLabel("민수", "teacher", true)).toBe("👑 민수 …");
  });

  it("keys on badge|highlight|typing|text", () => {
    expect(nametagCacheKey("민수", "none", false, false)).toBe("none|0|0|민수");
    expect(nametagCacheKey("민수", "teacher", true, false)).toBe("teacher|1|0|민수");
    expect(nametagCacheKey("조교", "ai", false, true)).toBe("ai|0|1|조교");
  });

  it("a name containing '|' cannot collide with another look (the text is the tail)", () => {
    expect(nametagCacheKey("a|1|0|b", "none", false, false)).not.toBe(
      nametagCacheKey("b", "none", true, false),
    );
  });
});

describe("rasterized looks", () => {
  it("student: a white capsule with dark 600-weight text and no border", () => {
    const tag = createNametag("민수");
    const [c] = drawn();
    expect(drawn()).toHaveLength(1);
    expect(c.draws.filter((d) => d.kind === "stroke")).toEqual([]);
    expect(c.draws[0]).toEqual({ kind: "fill", style: "rgba(255, 255, 255, 0.92)" });
    const text = c.draws.find((d) => d.kind === "text")!;
    expect(text.text).toBe("민수");
    expect(text.style).toBe("#1d1b2e");
    expect(text.font).toMatch(/^600 48px /);
    expect(c.height).toBe(CANVAS_H);
    tag.dispose();
  });

  it("the font stack names Korean and emoji faces for Windows, macOS and Android", () => {
    const tag = createNametag("민수", "teacher");
    const font = drawn()[0].draws.find((d) => d.kind === "text")!.font!;
    for (const face of ["Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"]) {
      expect(font).toContain(face);
    }
    tag.dispose();
  });

  it("teacher: 👑 in front of the name and a 3px #e0a100 border", () => {
    const tag = createNametag("민수", "teacher");
    const [c] = drawn();
    const strokes = c.draws.filter((d) => d.kind === "stroke");
    expect(strokes).toEqual([{ kind: "stroke", style: "#e0a100", lineWidth: 3 }]);
    expect(c.draws.find((d) => d.kind === "text")!.text).toBe("👑 민수");
    tag.dispose();
  });

  it("AI: a #5b4bd8 pill with white 'AI' in front of the text", () => {
    const tag = createNametag("조교", "ai");
    const [c] = drawn();
    const fills = c.draws.filter((d) => d.kind === "fill").map((d) => d.style);
    expect(fills).toEqual(["rgba(255, 255, 255, 0.92)", "#5b4bd8"]);
    const texts = c.draws.filter((d) => d.kind === "text");
    expect(texts.map((t) => t.text)).toEqual(["AI", "조교"]);
    expect(texts[0].style).toBe("#ffffff");
    expect(texts[1].style).toBe("#1d1b2e");
    expect(c.draws.some((d) => d.kind === "stroke")).toBe(false);
    // The pill sits left of the text.
    expect(texts[0].x!).toBeLessThan(texts[1].x!);
    tag.dispose();
  });

  it("AI and teacher tags are wider than a plain tag with the same text", () => {
    const plain = createNametag("조교");
    const ai = createNametag("조교", "ai");
    const wPlain = drawn()[0].width;
    const wAi = drawn()[1].width;
    expect(wAi).toBeGreaterThan(wPlain);
    plain.dispose();
    ai.dispose();
  });

  it("highlight: a 4px #4f8cff border (it replaces the teacher's gold one)", () => {
    const tag = createNametag("민수", "teacher");
    tag.setHighlight(true);
    const strokes = drawn()[1].draws.filter((d) => d.kind === "stroke");
    expect(strokes).toEqual([{ kind: "stroke", style: "#4f8cff", lineWidth: 4 }]);
    expect(drawn()[1].draws.find((d) => d.kind === "text")!.text).toBe("👑 민수"); // crown stays
    tag.dispose();
  });

  it("typing: the label ends with ' …' and the tag gets wider", () => {
    const tag = createNametag("민수");
    const before = drawn()[0].width;
    tag.setTyping(true);
    expect(drawn()[1].draws.find((d) => d.kind === "text")!.text).toBe("민수 …");
    expect(drawn()[1].width).toBeGreaterThan(before);
    tag.dispose();
  });

  it("every look is exactly NAMETAG_FONT_PX + 2·NAMETAG_PAD_Y_PX tall (the text fraction depends on it)", () => {
    const tags = [
      createNametag("a"),
      createNametag("b", "teacher"),
      createNametag("c", "ai"),
    ];
    for (const t of tags) {
      t.setHighlight(true);
      t.setTyping(true);
    }
    expect(drawn().length).toBeGreaterThan(3);
    for (const c of drawn()) expect(c.height).toBe(CANVAS_H);
    tags.forEach((t) => t.dispose());
  });

  it("mipmapped, so 48 px text shown at 12–16 px does not shimmer", () => {
    const tag = createNametag("민수");
    expect(mapOf(tag).minFilter).toBe(LinearMipmapLinearFilter);
    expect(mapOf(tag).generateMipmaps).toBe(true);
    tag.dispose();
  });
});

describe("texture cache", () => {
  it("variants are made on first use, not up front", () => {
    const tag = createNametag("민수");
    expect(drawn()).toHaveLength(1); // only the plain look
    tag.setTyping(true);
    expect(drawn()).toHaveLength(2);
    tag.setHighlight(true);
    expect(drawn()).toHaveLength(3);
    tag.dispose();
  });

  it("two tags with the same look share one texture; the last owner disposes it", () => {
    const a = createNametag("민수");
    const b = createNametag("민수");
    expect(drawn()).toHaveLength(1);
    expect(nametagCacheSize()).toBe(1);
    expect(mapOf(a)).toBe(mapOf(b));
    const disposed = vi.fn();
    mapOf(a).addEventListener("dispose", disposed);

    a.dispose();
    expect(disposed).not.toHaveBeenCalled(); // b still shows it
    expect(nametagCacheSize()).toBe(1);
    b.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(nametagCacheSize()).toBe(0);
  });

  it("switching looks takes the new texture and releases the old one", () => {
    const tag = createNametag("민수");
    const plain = mapOf(tag);
    const plainDisposed = vi.fn();
    plain.addEventListener("dispose", plainDisposed);

    tag.setTyping(true);
    const typing = mapOf(tag);
    expect(typing).not.toBe(plain);
    expect(plainDisposed).toHaveBeenCalledTimes(1); // nobody else was showing it
    expect(nametagCacheSize()).toBe(1);

    tag.setTyping(false);
    expect(mapOf(tag)).not.toBe(typing); // back on the plain look, not the one it just left
    tag.dispose();
    expect(nametagCacheSize()).toBe(0);
  });

  it("a look let go of is parked: switching back reuses its canvas and texture instead of rasterizing again", () => {
    const tag = createNametag("민수");
    const plain = mapOf(tag);
    tag.setTyping(true);
    const typing = mapOf(tag);
    expect(drawn()).toHaveLength(2);
    expect(nametagIdleSize()).toBe(1); // the plain look, GPU copy freed but canvas kept
    expect(nametagCacheSize()).toBe(1);

    tag.setTyping(false); // → plain again
    tag.setTyping(true); //  → typing again
    tag.setHighlight(true);
    tag.setHighlight(false);
    expect(mapOf(tag)).toBe(typing);
    expect(drawn()).toHaveLength(3); // plain, typing, typing + highlight: one canvas per look, ever
    tag.setTyping(false);
    expect(mapOf(tag)).toBe(plain);
    expect(drawn()).toHaveLength(3);
    tag.dispose();
    expect(nametagCacheSize()).toBe(0);
    expect(nametagIdleSize()).toBe(3);
  });

  it("a parked texture is disposed when it is parked, so its GPU copy is freed", () => {
    const tag = createNametag("민수");
    const plain = mapOf(tag);
    const disposed = vi.fn();
    plain.addEventListener("dispose", disposed);
    tag.setTyping(true);
    expect(disposed).toHaveBeenCalledTimes(1);
    tag.setTyping(false); // reuse: it is shown again…
    expect(mapOf(tag)).toBe(plain);
    expect(disposed).toHaveBeenCalledTimes(1);
    tag.setTyping(true); // …and freed again when it is let go
    expect(disposed).toHaveBeenCalledTimes(2);
    tag.dispose();
  });

  it("another tag with the same name reuses a parked look", () => {
    const a = createNametag("민수");
    const plain = mapOf(a);
    a.dispose(); // the player leaves…
    expect(nametagCacheSize()).toBe(0);
    const b = createNametag("민수"); // …and comes back
    expect(mapOf(b)).toBe(plain);
    expect(drawn()).toHaveLength(1);
    expect(nametagIdleSize()).toBe(0);
    b.dispose();
  });

  it("keeps at most NAMETAG_IDLE_LOOKS parked looks, the oldest dropped first", () => {
    const tags = Array.from({ length: NAMETAG_IDLE_LOOKS + 5 }, (_, i) => createNametag(`학생${i}`));
    const first = mapOf(tags[0]);
    tags.forEach((t) => t.dispose());
    expect(nametagCacheSize()).toBe(0);
    expect(nametagIdleSize()).toBe(NAMETAG_IDLE_LOOKS);
    // The five oldest were dropped: a new tag with the first name needs a new canvas…
    const before = drawn().length;
    const again = createNametag("학생0");
    expect(drawn()).toHaveLength(before + 1);
    expect(mapOf(again)).not.toBe(first);
    // …while the newest is still parked.
    const newest = createNametag(`학생${NAMETAG_IDLE_LOOKS + 4}`);
    expect(drawn()).toHaveLength(before + 1);
    again.dispose();
    newest.dispose();
  });

  it("clearIdleNametagLooks drops the parked looks but never one a tag still shows", () => {
    const shown = createNametag("민수");
    const other = createNametag("영희");
    other.dispose();
    expect(nametagIdleSize()).toBe(1);
    clearIdleNametagLooks();
    expect(nametagIdleSize()).toBe(0);
    expect(nametagCacheSize()).toBe(1);
    const same = createNametag("민수");
    expect(mapOf(same)).toBe(mapOf(shown));
    shown.dispose();
    same.dispose();
  });

  it("a look still shown by another tag survives a switch away", () => {
    const a = createNametag("민수");
    const b = createNametag("민수");
    const shared = mapOf(a);
    const disposed = vi.fn();
    shared.addEventListener("dispose", disposed);

    a.setTyping(true);
    expect(disposed).not.toHaveBeenCalled();
    expect(mapOf(b)).toBe(shared);
    a.setTyping(false); // back onto the cached plain look: no new canvas
    expect(mapOf(a)).toBe(shared);
    expect(drawn()).toHaveLength(2);

    a.dispose();
    b.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(nametagCacheSize()).toBe(0);
  });

  it("setting a flag to its current value does nothing", () => {
    const tag = createNametag("민수");
    const before = mapOf(tag);
    tag.setTyping(false);
    tag.setHighlight(false);
    expect(mapOf(tag)).toBe(before);
    expect(drawn()).toHaveLength(1);
    tag.dispose();
  });

  it("dispose is idempotent and cannot release a texture someone else now owns", () => {
    const a = createNametag("민수");
    a.dispose();
    expect(nametagCacheSize()).toBe(0);
    const b = createNametag("민수"); // same key, brand-new entry
    const disposed = vi.fn();
    mapOf(b).addEventListener("dispose", disposed);

    a.dispose(); // a second dispose of the old tag
    expect(disposed).not.toHaveBeenCalled();
    expect(nametagCacheSize()).toBe(1);
    b.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it("a disposed tag owns nothing: switching its look afterwards leaks no texture", () => {
    const tag = createNametag("민수");
    tag.dispose();
    tag.setTyping(true);
    tag.setHighlight(true);
    expect(nametagCacheSize()).toBe(0);
    expect(drawn()).toHaveLength(1); // nothing was rasterized for the late switches
  });
});

describe("sprite state", () => {
  it("starts at the base height, NAMETAG_HEIGHT above the feet, fully opaque", () => {
    const tag = createNametag("민수");
    expect(tag.sprite.scale.y).toBe(NAMETAG_BASE_HEIGHT_M);
    expect(tag.sprite.position.y).toBe(NAMETAG_HEIGHT);
    expect((tag.sprite.material as SpriteMaterial).opacity).toBe(1);
    expect(tag.sprite.visible).toBe(true);
    tag.dispose();
  });

  it("setHeight keeps the canvas's aspect ratio, and a look switch keeps the height", () => {
    const tag = createNametag("민수");
    const aspect = drawn()[0].width / CANVAS_H;
    tag.setHeight(0.5);
    expect(tag.sprite.scale.x).toBeCloseTo(0.5 * aspect, 9);
    expect(tag.sprite.scale.y).toBe(0.5);

    tag.setTyping(true);
    const typingAspect = drawn()[1].width / CANVAS_H;
    expect(typingAspect).toBeGreaterThan(aspect);
    expect(tag.sprite.scale.x).toBeCloseTo(0.5 * typingAspect, 9);
    expect(tag.sprite.scale.y).toBe(0.5);
    tag.dispose();
  });

  it("setOpacity writes the material and hides the sprite at 0.01 or less", () => {
    const tag = createNametag("민수");
    const material = tag.sprite.material as SpriteMaterial;
    tag.setOpacity(0.6);
    expect(material.opacity).toBe(0.6);
    expect(tag.sprite.visible).toBe(true);
    tag.setOpacity(0.011);
    expect(tag.sprite.visible).toBe(true);
    tag.setOpacity(0.01);
    expect(tag.sprite.visible).toBe(false);
    tag.setOpacity(0);
    expect(tag.sprite.visible).toBe(false);
    tag.setOpacity(0.5);
    expect(tag.sprite.visible).toBe(true);
    tag.dispose();
  });

  it("opacity is per tag: two tags sharing a texture do not share fades", () => {
    const a = createNametag("민수");
    const b = createNametag("민수");
    a.setOpacity(0.2);
    expect((b.sprite.material as SpriteMaterial).opacity).toBe(1);
    a.dispose();
    b.dispose();
  });

  it("setOffsetY lifts the tag from NAMETAG_HEIGHT", () => {
    const tag = createNametag("민수");
    tag.setOffsetY(0.35);
    expect(tag.sprite.position.y).toBeCloseTo(NAMETAG_HEIGHT + 0.35, 9);
    tag.setOffsetY(0);
    expect(tag.sprite.position.y).toBe(NAMETAG_HEIGHT);
    tag.dispose();
  });

  it("a tag made for a taller avatar rests at its own height and lifts from there", () => {
    const tall = createNametag("민수", "none", 2.95); // e.g. a wizard hat: rest height from the avatar top
    expect(tall.sprite.position.y).toBe(2.95);
    tall.setOffsetY(0.35);
    expect(tall.sprite.position.y).toBeCloseTo(2.95 + 0.35, 9);
    tall.setOffsetY(0);
    expect(tall.sprite.position.y).toBe(2.95);
    // the default stays NAMETAG_HEIGHT, and one tag never moves another
    const plain = createNametag("민수");
    expect(plain.sprite.position.y).toBe(NAMETAG_HEIGHT);
    tall.setOffsetY(0.5);
    expect(plain.sprite.position.y).toBe(NAMETAG_HEIGHT);
    tall.dispose();
    plain.dispose();
  });

  it("rides the avatar group: a jump lift moves the tag with it, and the offset still applies", () => {
    const tag = createNametag("민수");
    const avatar = new Group();
    avatar.add(tag.sprite);
    const world = new Vector3();

    avatar.position.set(3, 0.75, -2); // mid-hop
    avatar.updateMatrixWorld(true);
    tag.sprite.getWorldPosition(world);
    expect(world.y).toBeCloseTo(0.75 + NAMETAG_HEIGHT, 9);
    expect(world.x).toBeCloseTo(3, 9);
    expect(world.z).toBeCloseTo(-2, 9);

    tag.setOffsetY(0.2);
    avatar.position.y = 1.0; // apex
    avatar.updateMatrixWorld(true);
    tag.sprite.getWorldPosition(world);
    expect(world.y).toBeCloseTo(1.0 + NAMETAG_HEIGHT + 0.2, 9);
    tag.dispose();
  });
});
