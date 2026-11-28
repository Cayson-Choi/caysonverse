import type { Material, Object3D, Texture, WebGLRenderer } from "three";
import { texturesOf } from "../game/programGate";

/**
 * The last stage of the entry's loading screen (fix/entry-full-load, 2026-11-28; owner: "광장화면 접속전에 다 로딩화면에서 다 로딩된
 * 다음에 광장화면이 나오는거 아냐?"). Once the village is dressed, the screen stays until
 *
 *  1. 풍경 (scenery): every file three is fetching has come in (loadTracker.ts: the houses, the lot buildings and their textures, the bus,
 *     the mountains, the lake, the park's skyline — whatever the plaza mounts) and nothing new started for `quietMs`;
 *  2. 준비 (warm): every material in the scene is compiled for the frame's target (SceneWarmUp's `warmScene`) and every texture is on
 *     the GPU (`uploadTextures`, a slice of main-thread time per animation frame);
 *  3. a few frames are drawn with nothing held back by the shader gate (programGate.ts) and nothing loading.
 *
 * Each has a cap, so a stalled file never keeps the screen up: past it the stage ends anyway (and says which files it gave up on).
 * Only what is needed LATER is left to load after the reveal, and it shows no chip: the lots' rooms behind their glass (RoomShowcase),
 * the café's walk-in PC files, a house's or a room's files at its door, the memorial hall, the park beyond the gate.
 */

export interface RevealTiming {
  /** Nothing in flight and nothing new for this long (ms): the scenery is in. */
  quietMs: number;
  /** The scenery stage gives up waiting after this long (ms) from the dressing. */
  sceneryCapMs: number;
  /** The warm-up's compile and its uploads each give up after this long (ms). */
  warmCapMs: number;
  /** The clean frames give up after this long (ms): something still held back then shows a frame or two late, not never. */
  framesCapMs: number;
  /** Clean frames (nothing held, nothing pending) drawn before the reveal. */
  cleanFrames: number;
  /** Main-thread time (ms) per animation frame for texture uploads. */
  uploadSliceMs: number;
}

export const REVEAL_TIMING: { pc: RevealTiming; phone: RevealTiming } = {
  pc: { quietMs: 900, sceneryCapMs: 25000, warmCapMs: 8000, framesCapMs: 3000, cleanFrames: 3, uploadSliceMs: 14 },
  phone: { quietMs: 1500, sceneryCapMs: 25000, warmCapMs: 8000, framesCapMs: 4000, cleanFrames: 3, uploadSliceMs: 12 },
};

/** Whether the files have settled: none in flight, and the last start or end was `quietMs` ago. */
export function sceneryQuiet(now: number, pending: number, lastChange: number, quietMs: number): boolean {
  return pending === 0 && now - lastChange >= quietMs;
}

/** The share of this entry's files that are in (0..1): ended / started since the entry began; 1 when none started. */
export function sceneryShare(started: number, ended: number): number {
  if (started <= 0) return 1;
  return Math.max(0, Math.min(1, ended / started));
}

/**
 * Whether one more drawn frame was clean: the gate held nothing back in it (its `held` counter did not move) and has nothing queued,
 * and no file is in flight. `streak` counts clean frames in a row.
 */
export function nextCleanStreak(streak: number, heldBefore: number, heldAfter: number, gatePending: number, filesPending: number): number {
  return heldAfter === heldBefore && gatePending === 0 && filesPending === 0 ? streak + 1 : 0;
}

/** Every texture `root`'s materials sample that still has to go up to the GPU (has image data, not uploaded yet). */
export function texturesToUpload(root: Object3D, uploaded: (t: Texture) => boolean): Texture[] {
  const mats = new Set<Material>();
  root.traverse((o) => {
    const m = (o as Object3D & { material?: Material | Material[] }).material;
    if (Array.isArray(m)) for (const x of m) mats.add(x);
    else if (m) mats.add(m);
  });
  const out = new Set<Texture>();
  for (const m of mats)
    for (const t of texturesOf(m)) {
      const tx = t as Texture & { isRenderTargetTexture?: boolean; isVideoTexture?: boolean };
      if (tx.isRenderTargetTexture || tx.isVideoTexture || tx.version === 0 || !tx.image) continue;
      if (!uploaded(t)) out.add(t);
    }
  return [...out];
}

/** Whether three has put `t` on the GPU. */
export function isUploaded(gl: Pick<WebGLRenderer, "properties">, t: Texture): boolean {
  return (gl.properties.get(t) as { __webglInit?: boolean }).__webglInit === true;
}

/**
 * Upload `list` a slice of main-thread time per animation frame (the loading screen keeps moving); `progress(done, total)` after each
 * slice. Resolves when all are up (a texture that fails is left to three's own first draw).
 */
export function uploadTextures(
  gl: Pick<WebGLRenderer, "initTexture" | "properties">,
  list: readonly Texture[],
  sliceMs: number,
  progress: (done: number, total: number) => void,
  isDead: () => boolean,
  frame: (fn: () => void) => void = (fn) => requestAnimationFrame(() => fn()),
  now: () => number = () => performance.now(),
): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      if (isDead()) return resolve();
      const t0 = now();
      while (i < list.length) {
        const t = list[i++]!;
        if (!isUploaded(gl, t)) {
          try {
            gl.initTexture(t);
          } catch {
            // leave it to three's own first draw
          }
        }
        if (now() - t0 > sliceMs) break;
      }
      progress(i, list.length);
      if (i >= list.length) resolve();
      else frame(step);
    };
    step();
  });
}
