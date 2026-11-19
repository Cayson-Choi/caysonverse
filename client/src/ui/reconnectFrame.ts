/**
 * The last picture of the village before a reconnect, kept as a plain image (QA 2026-11-20).
 *
 * A reconnect remounts the village scene against the new room (App.tsx: that is what rebuilds every room binding and the remote
 * store clean, so no avatar is ever drawn twice). The new 3D canvas starts black and needs several seconds to put the village back,
 * so the reconnect overlay (ReconnectingOverlay) shows this picture behind its dim until the new scene is up: the village stays in
 * view the whole time instead of going black.
 *
 * FrameGrab (in the Canvas) takes the picture right after a rendered frame once a reconnect begins (`want`); the overlay reads it.
 */
let image: string | null = null;
let wanted = false;
let villageAt = 0;
let villageFrames = 0;

export const reconnectFrame = {
  /** Take a picture at the next rendered frame. */
  want(): void {
    wanted = true;
  },
  wanted(): boolean {
    return wanted;
  },
  /** FrameGrab: the canvas just rendered; keep a (down-scaled) copy of it. */
  grab(canvas: HTMLCanvasElement): void {
    wanted = false;
    try {
      const w = Math.min(960, canvas.width);
      const h = Math.max(1, Math.round((canvas.height * w) / Math.max(1, canvas.width)));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      if (!g) return;
      g.drawImage(canvas, 0, 0, w, h);
      image = c.toDataURL("image/jpeg", 0.72);
    } catch {
      image = null; // a tainted or lost canvas: no picture, the overlay just dims
    }
  },
  /** VillageModel: the village's model is in the scene now / is gone. */
  villageIn(): void {
    villageAt = performance.now();
    villageFrames = 0;
  },
  /** FrameGrab: one frame was rendered. */
  tick(): void {
    if (villageAt) villageFrames++;
  },
  /** Frames rendered since the village's model went into the scene (the main thread may have been busy long before the first). */
  villageFrames(): number {
    return villageAt ? villageFrames : 0;
  },
  villageOut(): void {
    villageAt = 0;
  },
  /** ms since the village's model went into the scene (0: it is not in). */
  villageAge(): number {
    return villageAt ? performance.now() - villageAt : 0;
  },
  get(): string | null {
    return image;
  },
  clear(): void {
    image = null;
    wanted = false;
  },
};
