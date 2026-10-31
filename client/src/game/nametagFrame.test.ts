import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Group, PerspectiveCamera, Sprite } from "three";
import { SPEECH_BUBBLE_MS, TYPING_TTL_MS } from "@caysonverse/shared/constants";
import { bubbleRegistry } from "./bubbleRegistry";
import {
  BUBBLE_GAP_M,
  NAMETAG_BASE_HEIGHT_M,
  NAMETAG_CAP,
  NAMETAG_HEIGHT,
  NAMETAG_HIGHLIGHT_MS,
  NAMETAG_OCCLUDED_OPACITY,
  NAMETAG_OCCLUSION_PER_FRAME,
  NAMETAG_SELECT_INTERVAL_MS,
  NAMETAG_TEXT_FRACTION,
  NAMETAG_TEXT_PX,
} from "./constants";
import {
  getNametagCostMs,
  labelEntries,
  nametagProbe,
  registerLabel,
  resetNametagCost,
  setNametagMode,
  type LabelEntry,
} from "./labelRegistry";
import type { Nametag } from "./nametag";
import { createNametagFrame, type NametagFrame } from "./nametagFrame";
import { distanceFade, pixelsPerMetre, viewDepth } from "./nametagLayout";
import { typingRegistry } from "./typing";

const W = 1280;
const H = 720;
const FOV_RAD = (55 * Math.PI) / 180;
const DT = 1 / 60;

/** A Nametag stand-in: the real sprite geometry rules (centre-origin, scale = h × aspect), no canvas. */
interface FakeTag extends Nametag {
  opacity: number;
  highlight: boolean;
  typing: boolean;
  offsetM: number;
}
function fakeTag(aspect = 3): FakeTag {
  const sprite = new Sprite();
  sprite.position.set(0, NAMETAG_HEIGHT, 0);
  sprite.scale.set(NAMETAG_BASE_HEIGHT_M * aspect, NAMETAG_BASE_HEIGHT_M, 1);
  const tag: FakeTag = {
    sprite,
    opacity: 0,
    highlight: false,
    typing: false,
    offsetM: 0,
    setHeight(h) {
      sprite.scale.set(h * aspect, h, 1);
    },
    setOpacity(o) {
      tag.opacity = o;
      sprite.visible = o > 0.01;
    },
    setOffsetY(o) {
      tag.offsetM = o;
      sprite.position.y = NAMETAG_HEIGHT + o;
    },
    setHighlight(on) {
      tag.highlight = on;
    },
    setTyping(on) {
      tag.typing = on;
    },
    dispose() {},
  };
  return tag;
}

interface Avatar {
  id: string;
  group: Group;
  tag: FakeTag;
  entry: LabelEntry;
  unregister: () => void;
}

const avatars: Avatar[] = [];

function addAvatar(id: string, x: number, z: number, pinned = false, y = 0): Avatar {
  const group = new Group();
  group.position.set(x, y, z);
  const tag = fakeTag();
  group.add(tag.sprite);
  const entry: LabelEntry = { id, anchor: group, tag, pinned, bubbleAnchor: { y: 2.5 } };
  const avatar: Avatar = { id, group, tag, entry, unregister: registerLabel(entry) };
  avatars.push(avatar);
  return avatar;
}

/** Camera in the lecture hall (east of the x = 0 divider), looking north (-z), at eye height 3 m. */
function makeCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(55, W / H, 0.1, 200);
  cam.position.set(8, 3, 12);
  cam.lookAt(8, 2.5, -20);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

let cam: PerspectiveCamera;
let frame: NametagFrame;
let now: number;

/** Run `n` frames of DT seconds each. */
function run(n: number): void {
  for (let i = 0; i < n; i++) {
    now += DT * 1000;
    frame.update(cam, W, H, DT, now);
  }
}

beforeEach(() => {
  cam = makeCamera();
  frame = createNametagFrame();
  now = 10_000;
  setNametagMode("nearby");
  resetNametagCost();
});

afterEach(() => {
  for (const a of avatars.splice(0)) a.unregister();
  frame.reset();
  bubbleRegistry.clear();
  typingRegistry.clear();
  setNametagMode("nearby");
});

/** Students strung out in front of the camera at increasing distance, all inside the hall. */
function addStudents(n: number, firstZ = 6, stepZ = 0.5): Avatar[] {
  return Array.from({ length: n }, (_, i) =>
    addAvatar(`s${String(i).padStart(2, "0")}`, 8 + ((i % 5) - 2) * 1.2, firstZ - i * stepZ),
  );
}

describe("selection", () => {
  it("shows only the nearest 15 of 40 on-screen students; the rest dissolve to nothing", () => {
    const students = addStudents(40);
    run(40);
    const shown = students.filter((s) => s.tag.opacity > 0.01);
    expect(shown.length).toBe(NAMETAG_CAP);
    expect(shown.map((s) => s.id).sort()).toEqual(students.slice(0, NAMETAG_CAP).map((s) => s.id));
    for (const s of shown) expect(s.tag.opacity).toBeCloseTo(1, 5);
    for (const s of students.slice(NAMETAG_CAP)) expect(s.tag.sprite.visible).toBe(false);
  });

  it("a newly registered tag starts hidden and fades in rather than popping", () => {
    const a = addAvatar("a", 8, 4);
    run(1);
    expect(a.tag.opacity).toBeGreaterThan(0);
    expect(a.tag.opacity).toBeLessThan(0.2);
    run(30);
    expect(a.tag.opacity).toBeCloseTo(1, 5);
  });

  it("the pinned teacher is added on top of the nearest 15, even from afar", () => {
    const students = addStudents(20, 6, 0.3);
    const teacher = addAvatar("teacher", 11, -10, true); // ~22 m from the camera
    run(40);
    const shown = [...students, teacher].filter((s) => s.tag.opacity > 0.01);
    expect(shown.length).toBe(NAMETAG_CAP + 1);
    expect(teacher.tag.opacity).toBeCloseTo(1, 5);
    expect(nametagProbe.get("teacher")?.selected).toBe(true);
  });

  it("a pinned tag that is off screen (behind the camera) or past 30 m is not shown", () => {
    const behind = addAvatar("behind", 8, 18, true);
    const far = addAvatar("far", 8, -25, true); // ~37 m ahead
    addStudents(3);
    run(30);
    expect(behind.tag.sprite.visible).toBe(false);
    expect(far.tag.sprite.visible).toBe(false);
    expect(nametagProbe.get("behind")?.selected).toBe(false);
    expect(nametagProbe.get("far")?.selected).toBe(false);
  });

  it("a speaker beyond the nearest 15 is shown too, and drops again when the bubble ends", () => {
    const students = addStudents(30, 6, 0.4);
    const speaker = students[25];
    bubbleRegistry.set(speaker.id, "hello", now);
    run(40);
    expect(speaker.tag.opacity).toBeGreaterThan(0.99);
    run(Math.ceil(((SPEECH_BUBBLE_MS + 500) / 1000) * 60));
    expect(speaker.tag.sprite.visible).toBe(false);
  });

  it("mode 'off' hides everything; 'all' shows every tag in range, not just 15", () => {
    const students = addStudents(30, 6, 0.4);
    setNametagMode("all");
    run(40);
    expect(students.filter((s) => s.tag.opacity > 0.99).length).toBe(30);
    setNametagMode("off");
    run(40);
    expect(students.every((s) => !s.tag.sprite.visible)).toBe(true);
  });

  it("re-selects only every NAMETAG_SELECT_INTERVAL_MS (5 Hz)", () => {
    expect(NAMETAG_SELECT_INTERVAL_MS).toBe(200);
    const a = addAvatar("a", 8, 4);
    run(1); // the first frame runs a selection: "a" is chosen
    setNametagMode("off"); // takes effect at the NEXT selection tick, not before
    run(10); // 183 ms in: still inside the 200 ms interval, so the tag keeps rising
    const peak = a.tag.opacity;
    expect(peak).toBeGreaterThan(0.5);
    run(10); // the tick at 200 ms has run: the tag is on its way out
    expect(a.tag.opacity).toBeLessThan(peak);
  });
});

describe("distance and occlusion", () => {
  it("fades with the camera distance: 1 up to 25 m, 0.6 at 27 m, hidden at 30 m+", () => {
    const near = addAvatar("near", 8, 12 - 10);
    const mid = addAvatar("mid", 8, 12 - 27); // x = 8 straight ahead: head 27.01 m away
    run(60);
    expect(near.tag.opacity).toBeCloseTo(1, 5);
    expect(mid.tag.opacity).toBeCloseTo(distanceFade(Math.hypot(27, 3 - NAMETAG_HEIGHT)), 2);
    expect(mid.tag.opacity).toBeGreaterThan(0.5);
    expect(mid.tag.opacity).toBeLessThan(0.7);
  });

  it("dims a tag behind a wall to 35 % while a clear one stays at full opacity", () => {
    // The lounge/hall divider is the wall at x = 0 (north of its door): the camera (x = 8)
    // looks across it at this avatar, who is on screen but stands in the lounge.
    const hidden = addAvatar("hidden", -1, -6);
    const clear = addAvatar("clear", 8, 4);
    run(40);
    expect(clear.tag.opacity).toBeCloseTo(1, 5);
    expect(hidden.tag.opacity).toBeCloseTo(NAMETAG_OCCLUDED_OPACITY, 5);
    expect(nametagProbe.get("hidden")?.occluded).toBe(true);
    expect(nametagProbe.get("clear")?.occluded).toBe(false);
  });

  it("undims once the wall is no longer in the way", () => {
    const walker = addAvatar("walker", -1, -6);
    run(40);
    expect(walker.tag.opacity).toBeCloseTo(NAMETAG_OCCLUDED_OPACITY, 5);
    walker.group.position.set(4, 0, -6); // stepped over to the hall side of the divider
    run(40);
    expect(walker.tag.opacity).toBeCloseTo(1, 5);
    expect(nametagProbe.get("walker")?.occluded).toBe(false);
  });

  it("visits NAMETAG_OCCLUSION_PER_FRAME tags a frame: every one is checked within a few frames", () => {
    expect(NAMETAG_OCCLUSION_PER_FRAME).toBe(8);
    const behind = Array.from({ length: 20 }, (_, i) => addAvatar(`w${i}`, -4 - (i % 5), 8 - i * 0.3));
    run(1);
    const checkedAfterOne = behind.filter((a) => nametagProbe.get(a.id)?.occluded).length;
    expect(checkedAfterOne).toBe(NAMETAG_OCCLUSION_PER_FRAME);
    run(2); // 3 frames × 8 ≥ 20 labels
    expect(behind.every((a) => nametagProbe.get(a.id)?.occluded)).toBe(true);
  });
});

describe("size", () => {
  /** Projected height of the tag's TEXT in px, from the sprite's real scale and its depth at its real height. */
  function textPx(a: Avatar): number {
    const depth = viewDepth(
      cam.matrixWorld.elements,
      a.group.position.x,
      a.group.position.y + a.tag.sprite.position.y,
      a.group.position.z,
    );
    return a.tag.sprite.scale.y * NAMETAG_TEXT_FRACTION * pixelsPerMetre(depth, FOV_RAD, H);
  }

  it("a pinned (NPC-style) tag reads 12–16 px at 8 m, 20 m and 27 m, and fades with distance", () => {
    const at8 = addAvatar("npc:near", 8, 4, true);
    const at20 = addAvatar("npc:mid", 9, -8, true);
    const at27 = addAvatar("npc:far", 7, -15, true);
    run(60);
    for (const a of [at8, at20, at27]) {
      expect(textPx(a)).toBeGreaterThanOrEqual(NAMETAG_TEXT_PX.min - 0.01);
      expect(textPx(a)).toBeLessThanOrEqual(NAMETAG_TEXT_PX.max + 0.01);
    }
    expect(at8.tag.opacity).toBeCloseTo(1, 5);
    expect(at20.tag.opacity).toBeCloseTo(1, 5);
    expect(at27.tag.opacity).toBeGreaterThan(0.4);
    expect(at27.tag.opacity).toBeLessThan(0.8);
  });

  it("measures at the tag's actual height: a tag lifted by stacking still reads 12–16 px", () => {
    const front = addAvatar("front", 8, 0);
    const back = addAvatar("back", 8, -0.4); // right behind: stacks on top of the first
    run(80);
    expect(back.tag.offsetM).toBeGreaterThan(0.05);
    expect(back.tag.sprite.position.y).toBeCloseTo(NAMETAG_HEIGHT + back.tag.offsetM, 9);
    for (const a of [front, back]) {
      expect(textPx(a)).toBeGreaterThanOrEqual(NAMETAG_TEXT_PX.min - 0.01);
      expect(textPx(a)).toBeLessThanOrEqual(NAMETAG_TEXT_PX.max + 0.01);
    }
  });

});

describe("stacking", () => {
  it("overlapping tags: the nearer keeps its place, the farther steps up out of the way", () => {
    const nearer = addAvatar("nearer", 8, 2);
    const farther = addAvatar("farther", 8.1, 1.6);
    run(80);
    expect(nearer.tag.offsetM).toBeCloseTo(0, 3);
    expect(farther.tag.offsetM).toBeGreaterThan(0.05);
  });

  it("tags that do not overlap stay at rest height", () => {
    const left = addAvatar("left", 5, 2);
    const right = addAvatar("right", 11, 2);
    run(80);
    expect(left.tag.offsetM).toBeCloseTo(0, 3);
    expect(right.tag.offsetM).toBeCloseTo(0, 3);
  });

  it("the lift eases in instead of snapping", () => {
    addAvatar("nearer", 8, 2);
    const farther = addAvatar("farther", 8.1, 1.6);
    run(80);
    const settled = farther.tag.offsetM;
    expect(settled).toBeGreaterThan(0.05);
    farther.group.position.set(20, 0, 2); // clear of the other tag…
    run(80);
    expect(farther.tag.offsetM).toBeCloseTo(0, 3);
    farther.group.position.set(8.1, 0, 1.6); // …and overlapping again
    run(13); // a 5 Hz tick has certainly run, but the smoothing has not finished
    expect(farther.tag.offsetM).toBeGreaterThan(0);
    expect(farther.tag.offsetM).toBeLessThan(settled * 0.999);
  });
});

describe("speech bubble anchor", () => {
  it("sits just above the tag's top edge", () => {
    const a = addAvatar("a", 8, 4);
    run(30);
    const top = a.tag.sprite.position.y + a.tag.sprite.scale.y / 2;
    expect(a.entry.bubbleAnchor.y).toBeCloseTo(top + BUBBLE_GAP_M, 9);
  });

  it("tracks the tag when it is stacked and lifted", () => {
    addAvatar("nearer", 8, 2);
    const farther = addAvatar("farther", 8.1, 1.6);
    run(80);
    expect(farther.tag.offsetM).toBeGreaterThan(0.05);
    const top = farther.tag.sprite.position.y + farther.tag.sprite.scale.y / 2;
    expect(farther.entry.bubbleAnchor.y).toBeCloseTo(top + BUBBLE_GAP_M, 9);
    expect(farther.entry.bubbleAnchor.y).toBeGreaterThan(NAMETAG_HEIGHT + 0.05 + BUBBLE_GAP_M);
  });

  it("grows with the tag at distance (the tag gets taller to keep its 12 px text)", () => {
    const near = addAvatar("near", 8, 6);
    const far = addAvatar("far", 8, -12);
    run(40);
    expect(far.entry.bubbleAnchor.y).toBeGreaterThan(near.entry.bubbleAnchor.y);
  });
});

describe("typing and highlight", () => {
  it("shows the typing '…' on a visible tag while the player types, and clears it at the TTL", () => {
    const a = addAvatar("a", 8, 4);
    run(30);
    expect(a.tag.typing).toBe(false);
    typingRegistry.set("a", now);
    run(2);
    expect(a.tag.typing).toBe(true);
    now += TYPING_TTL_MS;
    run(1);
    expect(a.tag.typing).toBe(false);
  });

  it("highlights the tag for NAMETAG_HIGHLIGHT_MS after its owner speaks", () => {
    const a = addAvatar("a", 8, 4);
    run(30);
    expect(a.tag.highlight).toBe(false);
    bubbleRegistry.set("a", "hi there", now);
    run(3);
    expect(a.tag.highlight).toBe(true);
    run(Math.floor((NAMETAG_HIGHLIGHT_MS / 1000) * 60) - 20);
    expect(a.tag.highlight).toBe(true); // ~0.7 s in
    run(30); // ~1.2 s in
    expect(a.tag.highlight).toBe(false);
  });

  it("a second message restarts the highlight", () => {
    const a = addAvatar("a", 8, 4);
    run(30);
    bubbleRegistry.set("a", "one", now);
    run(80); // 1.3 s: highlight over, bubble still up
    expect(a.tag.highlight).toBe(false);
    bubbleRegistry.set("a", "two", now);
    run(2);
    expect(a.tag.highlight).toBe(true);
  });

  it("a tag that only now comes into view does not light up for something said seconds ago", () => {
    const a = addAvatar("a", 8, 4);
    bubbleRegistry.set("a", "old news", now);
    setNametagMode("off");
    run(60 * 3); // 3 s with the tag hidden
    setNametagMode("nearby");
    run(40);
    expect(a.tag.opacity).toBeGreaterThan(0.99);
    expect(a.tag.highlight).toBe(false);
  });

  it("leaves a hidden tag's look alone (swapping looks rasterizes a texture)", () => {
    const far = addAvatar("far", 8, -25); // ~37 m: never shown
    typingRegistry.set("far", now);
    bubbleRegistry.set("far", "hi", now);
    run(30);
    expect(far.tag.typing).toBe(false);
    expect(far.tag.highlight).toBe(false);
  });
});

describe("registry and bookkeeping", () => {
  it("forgets a tag that unregisters, and picks up one that registers", () => {
    const a = addAvatar("a", 8, 4);
    run(10);
    expect(nametagProbe.has("a")).toBe(true);
    a.unregister();
    run(1);
    expect(nametagProbe.has("a")).toBe(false);
    const before = a.tag.opacity;
    run(10);
    expect(a.tag.opacity).toBe(before); // no longer driven
    addAvatar("b", 8, 4);
    run(1);
    expect(nametagProbe.has("b")).toBe(true);
    expect(labelEntries().length).toBe(1);
  });

  it("one label leaving as another joins in the same frame does not leak state", () => {
    const a = addAvatar("a", 8, 4);
    run(5);
    a.unregister();
    addAvatar("b", 8, 4);
    run(1);
    expect([...nametagProbe.keys()]).toEqual(["b"]);
  });

  it("reset() forgets everything; the next update starts afresh", () => {
    addAvatar("a", 8, 4);
    run(10);
    frame.reset();
    expect(nametagProbe.size).toBe(0);
    run(1);
    expect(nametagProbe.has("a")).toBe(true);
  });

  it("records the frame cost in a 120-frame average (DEV)", () => {
    addStudents(10);
    expect(getNametagCostMs()).toBe(0);
    run(5);
    expect(Number.isFinite(getNametagCostMs())).toBe(true);
    expect(getNametagCostMs()).toBeGreaterThanOrEqual(0);
  });

  it("does nothing, and does not throw, with no labels", () => {
    expect(() => run(5)).not.toThrow();
  });
});
