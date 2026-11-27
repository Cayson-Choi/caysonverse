import { describe, expect, it } from "vitest";
import { CanvasTexture, Group, PerspectiveCamera, Scene, Vector3, type SpriteMaterial } from "three";
import { LabelOverlay, placeLabel, type LabelPlacement, type OverlayCanvas, type OverlayContext } from "./labelOverlay";
import { LABEL_SNAP, billboardSprite } from "./spriteCanvas";

function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(55, 412 / 915, 0.1, 200);
  c.position.set(0, 1.6, 6);
  c.lookAt(0, 1.4, 0);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}

const fresh = (): LabelPlacement => ({ x: 0, y: 0, w: 0, h: 0, depth: 0 });

describe("placeLabel: a label sprite's place on the overlay, in device px (the sprite shader's rule on the CPU)", () => {
  const W = 1236;
  const H = 2745;

  it("unsnapped: centred on the anchor's projection, its world size projected", () => {
    const cam = camera();
    const scene = new Scene();
    const s = billboardSprite(new CanvasTexture({ width: 10, height: 10 } as never), 2, 0.3, 999);
    s.position.set(0.4, 2, 0);
    scene.add(s);
    scene.updateMatrixWorld(true);
    const out = fresh();
    expect(placeLabel(s.matrixWorld.elements, cam.matrixWorldInverse.elements, cam.projectionMatrix.elements, 0.5, 0.5, 10, 10, 0, W, H, out)).toBe(true);
    const p = new Vector3(0.4, 2, 0).project(cam);
    const ax = (p.x * 0.5 + 0.5) * W;
    const ay = (0.5 - p.y * 0.5) * H;
    const depth = -new Vector3(0.4, 2, 0).applyMatrix4(cam.matrixWorldInverse).z;
    const ppm = H / (2 * Math.tan((55 * Math.PI) / 360) * depth);
    expect(out.h).toBeCloseTo(0.3 * ppm, 3);
    expect(out.w).toBeCloseTo(0.6 * ppm, 3);
    expect(out.x + out.w / 2).toBeCloseTo(ax, 3);
    expect(out.y + out.h / 2).toBeCloseTo(ay, 3);
    expect(out.depth).toBeCloseTo(depth, 4);
  });

  it("snapped: within the tolerance it is the canvas's own size, its corner on a whole pixel; the center's y is up", () => {
    const cam = camera();
    const scene = new Scene();
    const s = billboardSprite(new CanvasTexture({ width: 10, height: 10 } as never), 1, 0.3, 999);
    s.position.set(-0.3, 2.1, 0.5);
    scene.add(s);
    scene.updateMatrixWorld(true);
    const free = fresh();
    placeLabel(s.matrixWorld.elements, cam.matrixWorldInverse.elements, cam.projectionMatrix.elements, 0.5, 0, 10, 10, 0, W, H, free);
    const texW = Math.round(free.w * 1.1);
    const texH = Math.round(free.h * 0.95);
    const out = fresh();
    placeLabel(s.matrixWorld.elements, cam.matrixWorldInverse.elements, cam.projectionMatrix.elements, 0.5, 0, texW, texH, LABEL_SNAP, W, H, out);
    expect([out.w, out.h]).toEqual([texW, texH]);
    expect(Number.isInteger(out.x) && Number.isInteger(out.y)).toBe(true);
    // center (0.5, 0): the anchor is the BOTTOM middle
    expect(out.y + out.h).toBeCloseTo(free.y + free.h, -0.1);
    expect(out.x + out.w / 2).toBeCloseTo(free.x + free.w / 2, -0.1);
    // far from the canvas's size: drawn at the projected size instead
    const far = fresh();
    placeLabel(s.matrixWorld.elements, cam.matrixWorldInverse.elements, cam.projectionMatrix.elements, 0.5, 0, texW * 3, texH, LABEL_SNAP, W, H, far);
    expect(far.w).toBeCloseTo(free.w, 6);
  });

  it("nothing behind the camera or past the far plane", () => {
    const cam = camera();
    const scene = new Scene();
    const s = billboardSprite(new CanvasTexture({ width: 10, height: 10 } as never), 1, 0.3, 999);
    scene.add(s);
    for (const z of [9, 7, -500]) {
      s.position.set(0, 1.5, z);
      scene.updateMatrixWorld(true);
      expect(placeLabel(s.matrixWorld.elements, cam.matrixWorldInverse.elements, cam.projectionMatrix.elements, 0.5, 0.5, 10, 10, 0, W, H, fresh())).toBe(false);
    }
  });
});

function fakeOverlay() {
  const calls: { op: string; args: unknown[]; alpha: number }[] = [];
  const ctx = {
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    clearRect: (...args: unknown[]) => void calls.push({ op: "clear", args, alpha: ctx.globalAlpha }),
    drawImage: (...args: unknown[]) => void calls.push({ op: "draw", args, alpha: ctx.globalAlpha }),
  } as unknown as OverlayContext & { globalAlpha: number };
  const canvas: OverlayCanvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
  return { canvas, calls, overlay: new LabelOverlay(canvas) };
}

describe("LabelOverlay: every shown label sprite, over the 3D canvas, at the device's pixel ratio", () => {
  function world() {
    const scene = new Scene();
    const cam = camera();
    const avatar = new Group();
    scene.add(avatar);
    const img = (w: number, h: number) => ({ width: w, height: h });
    const tag = billboardSprite(new CanvasTexture(img(60, 20) as never), 3, 0.3, 999, { snap: LABEL_SNAP });
    tag.position.set(0, 2, 0);
    const bubble = billboardSprite(new CanvasTexture(img(200, 60) as never), 3.3, 0.5, 1000, { snap: LABEL_SNAP });
    bubble.position.set(0, 2.3, 0);
    avatar.add(tag, bubble);
    const back = billboardSprite(new CanvasTexture(img(60, 20) as never), 3, 0.3, 999, { snap: LABEL_SNAP });
    back.position.set(1, 2, -10);
    scene.add(back);
    scene.updateMatrixWorld(true);
    return { scene, cam, avatar, tag, bubble, back };
  }

  it("sizes itself to the view at the dpr; draws in three's order (renderOrder, then far to near) with each opacity", () => {
    const { canvas, calls, overlay } = fakeOverlay();
    const w = world();
    (w.tag.material as SpriteMaterial).opacity = 0.5;
    expect(overlay.draw(w.scene, w.cam, 412, 915, 3)).toBe(3);
    expect([canvas.width, canvas.height]).toEqual([1236, 2745]);
    expect(canvas.style.width).toBe("412px");
    expect(canvas.style.pointerEvents).toBe("none");
    const draws = calls.filter((c) => c.op === "draw");
    const imgOf = (s: typeof w.tag) => (s.material as SpriteMaterial).map!.image;
    expect(draws.map((d) => d.args[0])).toEqual([imgOf(w.back), imgOf(w.tag), imgOf(w.bubble)]);
    expect(draws.map((d) => d.alpha)).toEqual([1, 0.5, 1]);
    for (const s of [w.back, w.tag, w.bubble]) (s.material as SpriteMaterial).dispose();
    overlay.dispose();
  });

  it("skips hidden, transparent, off-scene and disposed labels", () => {
    const { calls, overlay } = fakeOverlay();
    const w = world();
    w.avatar.visible = false; // an avatar inside a house: its tag and bubble go with it
    (w.back.material as SpriteMaterial).opacity = 0;
    expect(overlay.draw(w.scene, w.cam, 412, 915, 3)).toBe(0);
    w.avatar.visible = true;
    (w.back.material as SpriteMaterial).opacity = 1;
    w.back.visible = false;
    expect(overlay.draw(w.scene, w.cam, 412, 915, 3)).toBe(2);
    w.scene.remove(w.avatar);
    expect(overlay.draw(w.scene, w.cam, 412, 915, 3)).toBe(0);
    w.scene.add(w.avatar);
    (w.tag.material as SpriteMaterial).dispose();
    expect(overlay.draw(w.scene, w.cam, 412, 915, 3)).toBe(1);
    expect(calls.filter((c) => c.op === "draw").length).toBe(3);
    for (const s of [w.back, w.bubble]) (s.material as SpriteMaterial).dispose();
  });

  it("clears only what the last frame drew; a resize starts clean", () => {
    const { calls, overlay } = fakeOverlay();
    const w = world();
    overlay.draw(w.scene, w.cam, 412, 915, 3);
    expect(calls.some((c) => c.op === "clear")).toBe(false); // nothing drawn before
    const drawn = calls.filter((c) => c.op === "draw").map((c) => c.args.slice(1) as number[]);
    calls.length = 0;
    overlay.draw(w.scene, w.cam, 412, 915, 3);
    const clears = calls.filter((c) => c.op === "clear").map((c) => c.args as number[]);
    expect(clears).toHaveLength(drawn.length);
    clears.forEach(([x, y, cw, ch], i) => {
      const [dx, dy, dw, dh] = drawn[i]!;
      expect(x).toBeLessThanOrEqual(dx!);
      expect(y).toBeLessThanOrEqual(dy!);
      expect(x! + cw!).toBeGreaterThanOrEqual(Math.min(1236, dx! + dw!));
      expect(y! + ch!).toBeGreaterThanOrEqual(Math.min(2745, dy! + dh!));
    });
    calls.length = 0;
    overlay.draw(w.scene, w.cam, 400, 900, 3);
    expect(calls.some((c) => c.op === "clear")).toBe(false);
    for (const s of [w.back, w.tag, w.bubble]) (s.material as SpriteMaterial).dispose();
  });
});
