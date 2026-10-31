/**
 * The per-frame logic of the name tag system (controls-ux Task 14, spec §6), kept out
 * of React so it is unit-tested with a real camera and fake tags. NametagSystem.tsx is
 * the thin R3F component that calls `update` from the render loop.
 *
 * Every registered label (labelRegistry) is looked after here:
 *
 *   1. each frame  — where its head is and how far the camera is;
 *   2. at 5 Hz     — which tags are shown (selectNametags) and how overlapping ones stack
 *                    (declutter, in screen pixels);
 *   3. each frame  — a round-robin slice of NAMETAG_OCCLUSION_PER_FRAME tags gets a
 *                    camera → head ray test against the walls;
 *   4. each frame  — opacity (chasing: selected × distance fade × occlusion dimming),
 *                    stacking lift, size, typing "…", the speaking highlight, and the
 *                    height the owner's speech bubble should sit at.
 *
 * Steps 1, 3 and 4 allocate nothing: scratch vectors, matrices, the candidate objects
 * and index buffer are created once. Step 2 allocates a little (a Set, a Map, rects) —
 * at 5 Hz that is fine.
 *
 * Distances and fades use the straight camera → head distance; SIZE uses the view depth
 * (what the projection divides by) at the tag's actual height, so a lifted tag stays at
 * 12–16 px.
 */

import { Matrix4, Vector3, type PerspectiveCamera } from "three";
import { SPEECH_BUBBLE_MS } from "@caysonverse/shared/constants";
import { bubbleRegistry } from "./bubbleRegistry";
import { CAMERA_BOXES, segmentHitFraction } from "./cameraCollision";
import { smoothToward } from "./cameraControls";
import {
  BUBBLE_GAP_M,
  NAMETAG_HEIGHT,
  NAMETAG_HIGHLIGHT_MS,
  NAMETAG_LIFT_RATE,
  NAMETAG_OCCLUDED_OPACITY,
  NAMETAG_OCCLUSION_PER_FRAME,
  NAMETAG_SELECT_INTERVAL_MS,
  NAMETAG_TEXT_FRACTION,
} from "./constants";
import {
  labelEntries,
  getNametagMode,
  nametagProbe,
  recordNametagCost,
  type LabelEntry,
  type NametagProbe,
} from "./labelRegistry";
import {
  distanceFade,
  nametagWorldHeight,
  pixelsPerMetre,
  projectPoint,
  stepOpacity,
  viewDepth,
} from "./nametagLayout";
import {
  declutter,
  roundRobinIndices,
  selectNametags,
  type NametagCandidate,
  type TagRect,
} from "./nametagSelect";
import { typingRegistry } from "./typing";

/** Below this opacity a tag is not drawn at all (nametag.ts HIDDEN_OPACITY), so it needs no look changes. */
const VISIBLE_OPACITY = 0.01;
/** A tag whose head is within this fraction of the half-screen OUTSIDE the screen still counts as on screen. */
const SCREEN_MARGIN = 0.1;

/** Everything the system remembers about one label. */
interface TagState extends NametagProbe {
  entry: LabelEntry;
  /** Stacking lift the last layout asked for, in screen px (`liftM`, from the probe, is the lift applied). */
  liftPx: number;
  /** `bubbleRegistry` seq last seen while the tag was visible (-1 = none). */
  seenSeq: number;
  /** Wall-clock ms until which the highlight border shows. */
  highlightUntil: number;
  // Head, in world space — the tag's resting position (anchor + NAMETAG_HEIGHT).
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  headY: number;
  /** Straight-line camera → head distance (m). */
  dist: number;
  /** Reused for every selection pass. */
  cand: NametagCandidate;
}

export interface NametagFrame {
  /**
   * One frame. `widthPx` / `heightPx` are the canvas's CSS size, `dt` seconds since the
   * last frame, `nowMs` the `performance.now()` clock the registries use.
   */
  update(camera: PerspectiveCamera, widthPx: number, heightPx: number, dt: number, nowMs: number): void;
  /** Forget all per-label state (the scene unmounted); the next `update` starts afresh. */
  reset(): void;
}

export function createNametagFrame(): NametagFrame {
  const states: TagState[] = [];
  const byEntry = new Map<LabelEntry, TagState>();
  let syncedList: readonly LabelEntry[] | null = null;

  // Scratch — created once, rewritten in place.
  const world = new Vector3();
  const projScreen = new Matrix4();
  const ndc = { x: 0, y: 0 };
  const rrIndices: number[] = [];
  let rrCursor = 0;
  let nextSelectAt = 0;

  /** Rebuild `states` for a changed roster, keeping the state of labels that stay. */
  function syncStates(list: readonly LabelEntry[]): void {
    const next: TagState[] = [];
    for (const entry of list) {
      let s = byEntry.get(entry);
      if (!s) {
        s = {
          entry,
          selected: false,
          opacity: 0,
          occluded: false,
          highlight: false,
          typing: false,
          liftM: 0,
          tagTopM: NAMETAG_HEIGHT,
          bubbleM: NAMETAG_HEIGHT,
          textPx: 0,
          liftPx: 0,
          seenSeq: -1,
          highlightUntil: 0,
          anchorX: 0,
          anchorY: 0,
          anchorZ: 0,
          headY: 0,
          dist: Infinity,
          cand: { id: entry.id, dist: Infinity, onScreen: false, speaking: false, pinned: entry.pinned },
        };
        byEntry.set(entry, s);
        if (import.meta.env.DEV) nametagProbe.set(entry.id, s);
      }
      next.push(s);
    }
    // Drop the state of labels that went away.
    if (next.length !== byEntry.size) {
      for (const [entry, s] of byEntry) {
        if (list.includes(entry)) continue;
        byEntry.delete(entry);
        if (import.meta.env.DEV && nametagProbe.get(entry.id) === s) nametagProbe.delete(entry.id);
      }
    }
    states.length = 0;
    for (const s of next) states.push(s);
    syncedList = list;
  }

  /** The 5 Hz pass: who is shown and how the shown ones stack. */
  function select(
    camera: PerspectiveCamera,
    widthPx: number,
    heightPx: number,
    nowMs: number,
  ): void {
    // Fresh view matrices: this is the one place a stale (previous-frame) camera could pick the wrong set.
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const proj = projScreen.elements;

    const cands: NametagCandidate[] = [];
    for (const s of states) {
      const c = s.cand;
      c.dist = s.dist;
      c.onScreen = projectPoint(proj, s.anchorX, s.headY, s.anchorZ, SCREEN_MARGIN, ndc);
      c.speaking = bubbleRegistry.get(s.entry.id, nowMs) !== null;
      cands.push(c);
    }
    const chosen = selectNametags(cands, getNametagMode());

    // Lay the chosen tags out in screen px and let the farther ones step up.
    const fov = (camera.fov * Math.PI) / 180;
    const view = camera.matrixWorld.elements;
    const rects: TagRect[] = [];
    for (const s of states) {
      s.selected = chosen.has(s.entry.id);
      s.liftPx = 0;
      if (!s.selected) continue;
      if (!projectPoint(proj, s.anchorX, s.headY, s.anchorZ, Infinity, ndc)) continue;
      const depth = viewDepth(view, s.anchorX, s.headY, s.anchorZ);
      const ppm = pixelsPerMetre(depth, fov, heightPx);
      if (ppm <= 0) continue;
      const sprite = s.entry.tag.sprite;
      const hM = nametagWorldHeight(depth, fov, heightPx);
      const aspect = sprite.scale.y > 0 ? sprite.scale.x / sprite.scale.y : 1;
      rects.push({
        id: s.entry.id,
        x: (ndc.x * 0.5 + 0.5) * widthPx,
        y: (0.5 - ndc.y * 0.5) * heightPx,
        w: hM * aspect * ppm,
        h: hM * ppm,
        dist: s.dist,
      });
    }
    const lifts = declutter(rects);
    for (const s of states) {
      if (s.selected) s.liftPx = lifts.get(s.entry.id) ?? 0;
    }
  }

  return {
    update(camera, widthPx, heightPx, dt, nowMs) {
      const t0 = import.meta.env.DEV ? performance.now() : 0;

      const list = labelEntries();
      if (list !== syncedList) syncStates(list);
      const n = states.length;
      if (n > 0) {
        const camX = camera.position.x;
        const camY = camera.position.y;
        const camZ = camera.position.z;
        const fov = (camera.fov * Math.PI) / 180;
        const view = camera.matrixWorld.elements;

        // 1) Head position and camera distance.
        for (let i = 0; i < n; i++) {
          const s = states[i];
          s.entry.anchor.getWorldPosition(world);
          s.anchorX = world.x;
          s.anchorY = world.y;
          s.anchorZ = world.z;
          s.headY = world.y + NAMETAG_HEIGHT;
          const dx = world.x - camX;
          const dy = s.headY - camY;
          const dz = world.z - camZ;
          s.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        // 2) Selection and stacking, at 5 Hz.
        if (nowMs >= nextSelectAt) {
          nextSelectAt = nowMs + NAMETAG_SELECT_INTERVAL_MS;
          select(camera, widthPx, heightPx, nowMs);
        }

        // 3) Occlusion: a few tags per frame, round-robin, so every tag is re-checked
        //    within ~n / 8 frames.
        const count = roundRobinIndices(rrIndices, rrCursor, n, NAMETAG_OCCLUSION_PER_FRAME);
        for (let k = 0; k < count; k++) {
          const s = states[rrIndices[k]];
          s.occluded =
            segmentHitFraction(camX, camY, camZ, s.anchorX, s.headY, s.anchorZ, CAMERA_BOXES) < 1;
        }
        rrCursor = (rrCursor + count) % n;

        // 4) Opacity, lift, size, typing, highlight, bubble anchor.
        for (let i = 0; i < n; i++) {
          const s = states[i];
          const entry = s.entry;
          const tag = entry.tag;

          const target = s.selected
            ? distanceFade(s.dist) * (s.occluded ? NAMETAG_OCCLUDED_OPACITY : 1)
            : 0;
          s.opacity = stepOpacity(s.opacity, target, dt);
          tag.setOpacity(s.opacity);

          // The stacking target is in screen px; at this depth it is liftPx / px-per-metre.
          let liftTarget = 0;
          if (s.liftPx > 0) {
            const ppm = pixelsPerMetre(viewDepth(view, s.anchorX, s.headY, s.anchorZ), fov, heightPx);
            if (ppm > 0) liftTarget = s.liftPx / ppm;
          }
          s.liftM = smoothToward(s.liftM, liftTarget, dt, NAMETAG_LIFT_RATE);
          tag.setOffsetY(s.liftM);

          // Size from the depth at the tag's actual height (anchor + sprite.position.y).
          const depth = viewDepth(view, s.anchorX, s.anchorY + tag.sprite.position.y, s.anchorZ);
          const h = nametagWorldHeight(depth, fov, heightPx);
          tag.setHeight(h);

          // The bubble's bottom edge: just above the tag's top edge, wherever it is now.
          entry.bubbleAnchor.y = NAMETAG_HEIGHT + s.liftM + h / 2 + BUBBLE_GAP_M;
          if (import.meta.env.DEV) {
            s.tagTopM = tag.sprite.position.y + h / 2;
            s.bubbleM = entry.bubbleAnchor.y;
            s.textPx = h * NAMETAG_TEXT_FRACTION * pixelsPerMetre(depth, fov, heightPx);
          }

          // Looks change only for tags that can be seen: swapping one rasterizes a texture.
          if (s.opacity > VISIBLE_OPACITY) {
            s.typing = typingRegistry.isTyping(entry.id, nowMs);
            tag.setTyping(s.typing);
            const bubble = bubbleRegistry.get(entry.id, nowMs);
            if (bubble) {
              if (bubble.seq !== s.seenSeq) {
                s.seenSeq = bubble.seq;
                // Counted from when the message was sent, so a tag that only now came into view
                // does not light up for something said seconds ago.
                s.highlightUntil = bubble.expiresAt - SPEECH_BUBBLE_MS + NAMETAG_HIGHLIGHT_MS;
              }
            } else {
              s.seenSeq = -1;
            }
            s.highlight = nowMs < s.highlightUntil;
            tag.setHighlight(s.highlight);
          }
        }
      }

      if (import.meta.env.DEV) recordNametagCost(performance.now() - t0);
    },

    reset() {
      if (import.meta.env.DEV) {
        for (const [entry, s] of byEntry) {
          if (nametagProbe.get(entry.id) === s) nametagProbe.delete(entry.id);
        }
      }
      byEntry.clear();
      states.length = 0;
      syncedList = null;
      rrCursor = 0;
      nextSelectAt = 0;
    },
  };
}
