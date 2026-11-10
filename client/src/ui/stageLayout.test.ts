import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { PREVIEW_CAMERA } from "./builderOptions";
import {
  ENTRY_ART,
  FIGURE_BELOW_FEET,
  FIGURE_HALF_WIDTH_PER_HEIGHT,
  FIGURE_TOP,
  SHEET_FIRST_ROW,
  SHEET_OPEN,
  SHEET_REST,
  entryArtFor,
  previewFrameY,
  stageLayout,
  type StageLayout,
} from "./stageLayout";

describe("stageLayout — the camera's view of the stage (Task 7b)", () => {
  it("puts the feet 87.7 % down the canvas whatever the angle, and higher points above them", () => {
    expect(previewFrameY(0)).toBeCloseTo(0.877, 3);
    expect(previewFrameY(PREVIEW_CAMERA.targetY)).toBeCloseTo(0.5, 10);
    expect(previewFrameY(2.19)).toBeLessThan(previewFrameY(1));
    const tip = previewFrameY(FIGURE_TOP.height, FIGURE_TOP.toward);
    expect(tip).toBeGreaterThan(0);
    expect(tip).toBeLessThan(previewFrameY(FIGURE_TOP.height)); // leaning toward the camera reads higher
  });

  it("agrees with a real three.js camera on the orbit, at any angle and canvas shape", () => {
    const { fov, distance, eyeY, targetY } = PREVIEW_CAMERA;
    for (const aspect of [0.6, 1, 1.7]) {
      for (const yaw of [0, 0.5, 2.4, 4]) {
        const camera = new PerspectiveCamera(fov, aspect, 0.1, 40);
        camera.position.set(Math.sin(yaw) * distance, eyeY, Math.cos(yaw) * distance);
        camera.lookAt(0, targetY, 0);
        camera.updateMatrixWorld();
        for (const h of [0, 1, 2.19, FIGURE_TOP.height]) {
          const ndc = new Vector3(0, h, 0).project(camera);
          expect(ndc.x).toBeCloseTo(0, 9); // the figure's axis stays in the middle
          expect((1 - ndc.y) / 2).toBeCloseTo(previewFrameY(h), 9);
        }
        // A point leaning toward the camera (the hat tip seen from behind).
        const lean = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(FIGURE_TOP.toward).setY(FIGURE_TOP.height);
        expect((1 - lean.project(camera).y) / 2).toBeCloseTo(previewFrameY(FIGURE_TOP.height, FIGURE_TOP.toward), 9);
      }
    }
  });

  it("picks the wide art when the screen is at least as wide as it is tall", () => {
    expect(entryArtFor(1280, 800)).toBe("desktop");
    expect(entryArtFor(800, 800)).toBe("desktop");
    expect(entryArtFor(820, 1180)).toBe("phone");
    // 2026-11-10 village-plaza art: anchors measured by matching the old podium into the new art (scratch align.py).
    expect(ENTRY_ART.desktop).toMatchObject({ width: 1600, height: 900, podiumX: 0.5, podiumY: 0.701 });
    expect(ENTRY_ART.phone).toMatchObject({ width: 720, height: 1280, podiumX: 0.5, podiumY: 0.4414 });
    expect(SHEET_REST).toBe(0.47);
    expect(SHEET_OPEN).toBe(0.88);
    expect(SHEET_FIRST_ROW).toBeGreaterThan(0.47 * 844); // the 47 % floor alone hides the first card row (the concept rests ~53 %)
  });
});

describe("stageLayout (Task 7b: the figure stands on the podium)", () => {
  const BRIEF: [number, number, StageLayout["mode"], StageLayout["art"]][] = [
    [1280, 800, "wide", "desktop"],
    [1440, 900, "wide", "desktop"],
    [1920, 1080, "wide", "desktop"],
    [1024, 768, "wide", "desktop"],
    [820, 1180, "side", "phone"],
    [390, 844, "phone", "phone"],
    [375, 812, "phone", "phone"],
    [360, 740, "phone", "phone"],
    [320, 568, "phone", "phone"],
  ];
  const EXTRA: [number, number, StageLayout["mode"], StageLayout["art"]][] = [
    [844, 390, "side", "desktop"],
    [568, 320, "side", "desktop"],
    [2560, 1080, "wide", "desktop"],
    [1920, 800, "wide", "desktop"],
    [1000, 600, "wide", "desktop"],
    [1024, 1366, "wide", "phone"],
    [600, 960, "side", "phone"],
    [900, 700, "wide", "desktop"],
    [959, 700, "wide", "desktop"],
  ];
  /** The tallest notice we plan for (three lines). */
  const TOAST_MAX_H = 80;
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it.each([...BRIEF, ...EXTRA])("%i×%i → %s layout, %s art, feet on the podium top", (w, h, mode, art) => {
    const L = stageLayout(w, h);
    expect(L.mode).toBe(mode);
    expect(L.art).toBe(art);
    const spec = ENTRY_ART[art];
    // The podium top centre in the drawn picture…
    const podiumX = L.bg.x + spec.podiumX * L.bg.width;
    const podiumY = L.bg.y + spec.podiumY * L.bg.height;
    // …and where the camera draws the feet inside the canvas box.
    const feetX = L.canvas.x + L.canvas.width / 2;
    const feetY = L.canvas.y + previewFrameY(0) * L.canvas.height;
    const halfThickness = (spec.podiumThickness * L.scale) / 2;
    expect(Math.abs(feetY - podiumY)).toBeLessThanOrEqual(Math.min(0.5, halfThickness));
    expect(Math.abs(feetX - podiumX)).toBeLessThanOrEqual(0.5);
    expect(L.feet).toEqual({ x: expect.closeTo(podiumX, 6), y: expect.closeTo(podiumY, 6) });
    expect(L.podium.thickness / 2).toBeCloseTo(halfThickness, 6);
  });

  it.each([...BRIEF, ...EXTRA])("%i×%i: the wizard hat tip, the figure's sides and the name row all fit", (w, h) => {
    const L = stageLayout(w, h);
    const tipY = L.canvas.y + previewFrameY(FIGURE_TOP.height, FIGURE_TOP.toward) * L.canvas.height;
    expect(tipY).toBeGreaterThanOrEqual(L.canvas.y); // not clipped by the canvas…
    expect(tipY).toBeGreaterThanOrEqual(L.topBar); // …nor under the top bar
    if (!L.hint.centered) expect(tipY).toBeGreaterThanOrEqual(L.hint.y + L.hint.height); // …nor beside the top-left hint pill
    const half = L.canvas.height * FIGURE_HALF_WIDTH_PER_HEIGHT;
    expect(L.feet.x - half).toBeGreaterThanOrEqual(L.stage.x); // no panel or sheet covers the figure
    expect(L.feet.x + half).toBeLessThanOrEqual(L.stage.x + L.stage.width);
    expect(L.canvas.height).toBeGreaterThan(150);
    // The background covers the stage.
    expect(L.bg.x).toBeLessThanOrEqual(L.stage.x + 0.5);
    expect(L.bg.x + L.bg.width).toBeGreaterThanOrEqual(L.stage.x + L.stage.width - 0.5);
    expect(L.bg.y).toBeLessThanOrEqual(0.5);
    expect(L.bg.y + L.bg.height).toBeGreaterThanOrEqual(h - 0.5);
    // Name row: under the feet, inside the stage, above the 입장 button / the sheet.
    const row = L.nameRow;
    const rowWidth = row.plateWidth + 2 * (row.button + row.gap);
    expect(row.plateWidth).toBeGreaterThanOrEqual(180);
    expect(rowWidth).toBeLessThanOrEqual(L.stage.width);
    // The shoes' toes come down in front of the feet point: the hint and the name row keep clear of them.
    const toes = L.feet.y + FIGURE_BELOW_FEET * L.canvas.height;
    expect(row.y).toBeGreaterThanOrEqual(toes);
    if (L.hint.centered) expect(L.hint.y).toBeGreaterThanOrEqual(toes);
    const rowBox = { x: L.feet.x - rowWidth / 2, y: row.y, width: rowWidth, height: row.height };
    expect(rowBox.x).toBeGreaterThanOrEqual(L.stage.x);
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(L.stage.y + L.stage.height);
    const hintBox = L.hint.centered
      ? { x: L.hint.x - 100, y: L.hint.y, width: 200, height: L.hint.height }
      : { x: L.hint.x, y: L.hint.y, width: 160, height: L.hint.height };
    // On sheet layouts 입장 is fixed at the bottom of the sheet (58 px, 18 px up, 16 px side margins).
    const sheetX = L.mode === "side" ? w - L.sheet!.width : 0;
    const cta = L.cta ?? { x: sheetX + 16, y: h - 18 - 58, width: (L.sheet?.width ?? w) - 32, height: 58 };
    if (L.cta) {
      expect(L.cta.y + L.cta.height).toBeLessThanOrEqual(h);
      expect(L.cta.x).toBeGreaterThanOrEqual(L.stage.x);
      expect(L.cta.width).toBeGreaterThanOrEqual(240);
      expect(L.cta.height).toBeGreaterThanOrEqual(56);
      expect(overlaps(rowBox, L.cta)).toBe(false);
      expect(overlaps(hintBox, rowBox)).toBe(false);
    }
    // The notice toast (nickname error, kick/disconnect notice) never covers the name row, ⟲ ⟳, 입장 or the hint.
    const T = L.toast;
    const toastBox = { x: T.x - T.maxWidth / 2, y: T.anchor === "top" ? T.y : T.y - TOAST_MAX_H, width: T.maxWidth, height: TOAST_MAX_H };
    expect(T.maxWidth).toBeGreaterThanOrEqual(200);
    expect(toastBox.y).toBeGreaterThanOrEqual(L.topBar);
    expect(toastBox.x).toBeGreaterThanOrEqual(0);
    expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(w);
    expect(overlaps(toastBox, rowBox)).toBe(false);
    expect(overlaps(toastBox, cta)).toBe(false);
    expect(overlaps(toastBox, hintBox)).toBe(false);
  });

  it("matches the concept at 1280×800: podium at y 561, 400 px panels, a 380×70 입장 button", () => {
    const L = stageLayout(1280, 800);
    expect(L.feet.y).toBeCloseTo(560.8, 1);
    expect(L.panelWidth).toBe(400);
    expect(L.stage).toEqual({ x: 424, y: 0, width: 432, height: 800 });
    expect(L.cta).toEqual({ x: 450, y: 704, width: 380, height: 70 });
    expect(L.nameRow.plateWidth).toBe(284);
    expect(L.sheet).toBeNull();
  });

  it("rests the phone sheet high enough for a full first row of cards (as in the concept), opening to 88 %", () => {
    for (const [w, h] of [[390, 844], [375, 812]]) {
      const L = stageLayout(w, h);
      expect(L.sheet!.rest).toBe(SHEET_FIRST_ROW);
      expect(L.sheet!.rest / h).toBeGreaterThan(0.52);
      expect(L.sheet!.rest / h).toBeLessThanOrEqual(0.56);
      expect(L.sheet!.open).toBe(Math.round(SHEET_OPEN * h));
      expect(L.stage.height).toBe(h - L.sheet!.rest);
      expect(L.stage.height).toBeGreaterThanOrEqual(200);
      expect(L.cta).toBeNull();
    }
    // Short phones keep the 47 % sheet so the figure keeps its room; mid-size ones cap at 56 %.
    expect(stageLayout(320, 568).sheet!.rest).toBe(Math.round(0.47 * 568));
    expect(stageLayout(360, 740).sheet!.rest).toBe(Math.round(0.56 * 740));
  });

  it("compacts the top bar on 320 px phones and gives tablets a full-height side sheet", () => {
    expect(stageLayout(320, 568).compactBar).toBe(true);
    expect(stageLayout(375, 812).compactBar).toBe(false);
    expect(stageLayout(820, 1180).sheet).toEqual({ width: 360, rest: 1180, open: 1180 });
  });

  it("keeps a usable nameplate on 900–959 px windows (smaller ⟲ ⟳ there)", () => {
    for (const w of [900, 930, 959]) {
      const L = stageLayout(w, 700);
      expect(L.mode).toBe("wide");
      expect(L.nameRow.plateWidth).toBeGreaterThanOrEqual(180);
      expect(L.nameRow.button).toBeGreaterThanOrEqual(44);
    }
    expect(stageLayout(1280, 800).nameRow.button).toBe(48);
  });

  it("puts the wide-screen notice at the top of the stage and the phone one just above 입장", () => {
    const wide = stageLayout(1280, 800);
    expect(wide.toast).toEqual({ x: 640, y: 82, maxWidth: 408, anchor: "top" });
    const phone = stageLayout(390, 844);
    expect(phone.toast).toEqual({ x: 195, y: 844 - 90, maxWidth: 358, anchor: "bottom" });
    const side = stageLayout(820, 1180);
    expect(side.toast).toMatchObject({ x: 820 - 180, y: 1180 - 90, maxWidth: 328, anchor: "bottom" });
  });
});
