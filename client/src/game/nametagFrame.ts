/**
 * The per-frame logic of the name tag system (controls-ux Task 14, spec §6), kept out
 * of React so it is unit-tested with a real camera and fake tags. NametagSystem.tsx is
 * the thin R3F component that calls `update` from the render loop.
 *
 * Every registered label (labelRegistry) is looked after here:
 *
 *   1. at 5 Hz     — where every head is, which tags are shown (selectNametags) and how
 *                    overlapping ones stack (declutter, in screen pixels);
 *   2. each frame  — a round-robin slice of NAMETAG_OCCLUSION_PER_FRAME tags gets a
 *                    camera → head ray test against the walls;
 *   3. each frame  — for every AWAKE tag: where its head is, opacity (chasing: selected ×
 *                    distance fade × occlusion dimming), stacking lift, size, typing "…",
 *                    the speaking highlight, and the height the owner's speech bubble
 *                    should sit at.
 *
 * AWAKE = shown or still fading / settling (selected, opacity > 0, lift not yet back at
 * rest) or its owner has a speech bubble up. A tag that is none of these is DORMANT: it is
 * invisible, at rest, and nothing about it can change until the next selection tick or a
 * new bubble, so a frame costs it nothing — in a hall of 100 only the ~20–40 tags in view
 * are awake, and with the tags off none are. (Measured on a 4× throttled CPU with 100 bots,
 * Task 19 perf fix: updating all ~104 labels every frame was ~0.7 of the ~1.1 ms a frame
 * cost; the rest was look changes — typing "…" / highlight swap a tag's texture, and a
 * texture not drawn before is rasterized — and the 5 Hz pass.)
 *
 * Look changes never share a frame with the 5 Hz pass: if one is due on that frame it
 * waits for the next (never two frames running, so a very low frame rate cannot starve it).
 *
 * Nothing here allocates per frame: scratch numbers, the candidate objects, the bubble
 * list and the rect pool are created once. The 5 Hz pass allocates a little (a Set, a Map)
 * — at 5 Hz that is fine.
 *
 * Distances and fades use the straight camera → head distance; SIZE uses the view depth
 * (what the projection divides by) at the tag's actual height, so a lifted tag stays at
 * 12–16 px.
 */

import { Matrix4, Vector3, type Object3D, type PerspectiveCamera } from "three";
import { SPEECH_BUBBLE_MS } from "@caysonverse/shared/constants";
import { bubbleRegistry, type BubbleEntry } from "./bubbleRegistry";
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
/**
 * A stacking lift this close to rest (m — a tenth of a millimetre) is rest: it is snapped to
 * 0 so a hidden, settled tag can go dormant. The exponential ease never reaches 0 by itself.
 */
const LIFT_REST_M = 1e-4;

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
  /** Frame number in which the head position and distance above were last computed. */
  headFrame: number;
  /** The owner's visible speech bubble, valid only when `bubbleFrame` is the current frame. */
  bubble: BubbleEntry | null;
  bubbleFrame: number;
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
  /** Label id → state, to hand the visible bubbles to their tags (ids are unique per avatar). */
  const byId = new Map<string, TagState>();
  let syncedList: readonly LabelEntry[] | null = null;
  let frameNo = 0;

  // Scratch — created once, rewritten in place.
  const projScreen = new Matrix4();
  const world = new Vector3();
  const ndc = { x: 0, y: 0 };
  const rrIndices: number[] = [];
  const bubbles: BubbleEntry[] = [];
  const cands: NametagCandidate[] = [];
  const rects: TagRect[] = [];
  const rectPool: TagRect[] = [];
  let rrCursor = 0;
  let nextSelectAt = 0;
  /** The previous frame put its look changes off (see `deferLooks` in `update`). */
  let deferredLast = false;
  // World position of the last anchor read by `anchorWorld`.
  let wx = 0;
  let wy = 0;
  let wz = 0;
  // The parent whose world matrix was already refreshed this frame (every avatar hangs off one scene).
  let freshParent: Object3D | null = null;
  let freshParentFrame = -1;

  /**
   * The anchor's world position into (wx, wy, wz): the parent's world matrix applied to the
   * anchor's local position — exactly Object3D.getWorldPosition, without composing and
   * multiplying the anchor's own matrix (and re-walking the shared parents) for every label.
   * The parent chain is refreshed once per frame, so a position set this frame is seen.
   */
  function anchorWorld(anchor: Object3D): void {
    if (!anchor.matrixAutoUpdate) {
      // Its matrix is set by hand, so `position` says nothing: let three work it out.
      anchor.getWorldPosition(world);
      wx = world.x;
      wy = world.y;
      wz = world.z;
      return;
    }
    const p = anchor.position;
    const parent = anchor.parent;
    if (parent === null) {
      wx = p.x;
      wy = p.y;
      wz = p.z;
      return;
    }
    if (parent !== freshParent || freshParentFrame !== frameNo) {
      parent.updateWorldMatrix(true, false);
      freshParent = parent;
      freshParentFrame = frameNo;
    }
    const m = parent.matrixWorld.elements;
    wx = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
    wy = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
    wz = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
  }

  /** Head position and camera distance of one label, once per frame. */
  function refreshHead(s: TagState, camX: number, camY: number, camZ: number): void {
    anchorWorld(s.entry.anchor);
    s.anchorX = wx;
    s.anchorY = wy;
    s.anchorZ = wz;
    s.headY = wy + NAMETAG_HEIGHT;
    const dx = wx - camX;
    const dy = s.headY - camY;
    const dz = wz - camZ;
    s.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    s.headFrame = frameNo;
  }

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
          headFrame: -1,
          bubble: null,
          bubbleFrame: -1,
          cand: { id: entry.id, dist: Infinity, onScreen: false, speaking: false, pinned: entry.pinned },
        };
        byEntry.set(entry, s);
        // From here on the system owns the tag: it starts hidden and is only touched again once it is awake.
        entry.tag.setOpacity(0);
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
    byId.clear();
    for (const s of next) {
      states.push(s);
      byId.set(s.entry.id, s);
    }
    syncedList = list;
  }

  /** The 5 Hz pass: who is shown and how the shown ones stack. Every head is fresh when it runs. */
  function select(camera: PerspectiveCamera, widthPx: number, heightPx: number): void {
    const mode = getNametagMode();
    if (mode === "off") {
      // Nothing is shown whatever the view: no need to project or sort anyone.
      for (const s of states) {
        s.selected = false;
        s.liftPx = 0;
      }
      return;
    }

    // Fresh view matrices: this is the one place a stale (previous-frame) camera could pick the wrong set.
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const proj = projScreen.elements;

    cands.length = 0;
    for (const s of states) {
      const c = s.cand;
      c.dist = s.dist;
      c.onScreen = projectPoint(proj, s.anchorX, s.headY, s.anchorZ, SCREEN_MARGIN, ndc);
      c.speaking = s.bubbleFrame === frameNo;
      cands.push(c);
    }
    const chosen = selectNametags(cands, mode);

    // Lay the chosen tags out in screen px and let the farther ones step up.
    const fov = (camera.fov * Math.PI) / 180;
    const view = camera.matrixWorld.elements;
    rects.length = 0;
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
      let r = rectPool[rects.length];
      if (!r) {
        r = { id: "", x: 0, y: 0, w: 0, h: 0, dist: 0 };
        rectPool.push(r);
      }
      r.id = s.entry.id;
      r.x = (ndc.x * 0.5 + 0.5) * widthPx;
      r.y = (0.5 - ndc.y * 0.5) * heightPx;
      r.w = hM * aspect * ppm;
      r.h = hM * ppm;
      r.dist = s.dist;
      rects.push(r);
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
        frameNo++;
        const camX = camera.position.x;
        const camY = camera.position.y;
        const camZ = camera.position.z;
        const fov = (camera.fov * Math.PI) / 180;
        const view = camera.matrixWorld.elements;

        // 0) Whose speech bubble is up (the registry's own visibility rules), handed to the tags.
        const nb = bubbleRegistry.visibleInto(bubbles, nowMs);
        for (let k = 0; k < nb; k++) {
          const b = bubbles[k];
          const s = byId.get(b.sid);
          if (s) {
            s.bubble = b;
            s.bubbleFrame = frameNo;
          }
        }

        // 1) Selection and stacking, at 5 Hz — it needs every head, so this is the one frame in
        //    five or so on which dormant tags are looked at. Look changes (typing "…", the
        //    highlight border) can rasterize a canvas, the other big one-off cost: they wait one
        //    frame rather than land on top of the selection pass (never two frames running, so a
        //    very low frame rate cannot starve them).
        const selectNow = nowMs >= nextSelectAt;
        const deferLooks = selectNow && !deferredLast;
        deferredLast = deferLooks;
        if (selectNow) {
          nextSelectAt = nowMs + NAMETAG_SELECT_INTERVAL_MS;
          for (let i = 0; i < n; i++) refreshHead(states[i], camX, camY, camZ);
          select(camera, widthPx, heightPx);
        }

        // 2) Occlusion: a few tags per frame, round-robin, so every tag is re-checked
        //    within ~n / 8 frames. A dormant tag's head is brought up to date for its check.
        const count = roundRobinIndices(rrIndices, rrCursor, n, NAMETAG_OCCLUSION_PER_FRAME);
        for (let k = 0; k < count; k++) {
          const s = states[rrIndices[k]];
          if (s.headFrame !== frameNo) refreshHead(s, camX, camY, camZ);
          s.occluded =
            segmentHitFraction(camX, camY, camZ, s.anchorX, s.headY, s.anchorZ, CAMERA_BOXES) < 1;
        }
        rrCursor = (rrCursor + count) % n;

        // 3) Awake tags: opacity, lift, size, typing, highlight, bubble anchor.
        for (let i = 0; i < n; i++) {
          const s = states[i];
          if (!(s.selected || s.opacity > 0 || s.liftM !== 0 || s.bubbleFrame === frameNo)) continue;
          if (s.headFrame !== frameNo) refreshHead(s, camX, camY, camZ);
          const entry = s.entry;
          const tag = entry.tag;

          if (!s.selected && s.opacity === 0 && s.liftM === 0) {
            // Awake only because its owner's speech bubble is up: the tag stays hidden and at rest,
            // so just keep the bubble's anchor where it would be.
            const depth = viewDepth(view, s.anchorX, s.anchorY + tag.sprite.position.y, s.anchorZ);
            const h = nametagWorldHeight(depth, fov, heightPx);
            entry.bubbleAnchor.y = NAMETAG_HEIGHT + h / 2 + BUBBLE_GAP_M;
            if (import.meta.env.DEV) {
              s.tagTopM = tag.sprite.position.y + h / 2;
              s.bubbleM = entry.bubbleAnchor.y;
              s.textPx = h * NAMETAG_TEXT_FRACTION * pixelsPerMetre(depth, fov, heightPx);
            }
            continue;
          }

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
          if (liftTarget === 0 && s.liftM < LIFT_REST_M && s.liftM > -LIFT_REST_M) s.liftM = 0;
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
          if (s.opacity > VISIBLE_OPACITY && !deferLooks) {
            s.typing = typingRegistry.isTyping(entry.id, nowMs);
            tag.setTyping(s.typing);
            const bubble = s.bubbleFrame === frameNo ? s.bubble : null;
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
        bubbles.length = 0; // do not keep expired entries alive until the next frame
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
      byId.clear();
      states.length = 0;
      syncedList = null;
      freshParent = null;
      freshParentFrame = -1;
      rrCursor = 0;
      nextSelectAt = 0;
      deferredLast = false;
    },
  };
}
