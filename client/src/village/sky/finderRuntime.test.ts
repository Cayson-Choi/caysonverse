import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BufferGeometry, Float32BufferAttribute, PerspectiveCamera, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseKstTime } from "@caysonverse/shared/village/sunClock";
import { altAzOf, angleDeg, PLANET_IDS, type Vec3 } from "@caysonverse/shared/village/skyMath";
import { viewState } from "../../game/viewState";
import { clearSelection, finderFrame, lineSpec, resetFinderRuntime, selectFigure, skyOverlay } from "./finderRuntime";
import { parseStarCatalog } from "./starCatalog";
import { anchorDirection, setSkyCatalog, sky, updateSky } from "./skyRuntime";
import { closeFinder, openFinder, useStarFinder } from "./starFinderStore";
import { syncGlow } from "./StarSky";

const FILE = fileURLToPath(new URL("../../../public/sky/stars.v1.bin", import.meta.url));
const bytes = readFileSync(FILE);
const catalog = parseStarCatalog(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

const W = 1280;
const H = 800;
const camera = new PerspectiveCamera(55, W / H, 0.2, 1600);
camera.position.set(0, 1.6, 8);

/** Point the camera along a scene direction. */
function look(d: Readonly<Vec3>): void {
  camera.lookAt(new Vector3(camera.position.x + d[0], camera.position.y + d[1], camera.position.z + d[2]));
  camera.updateMatrixWorld(true);
}

/** Run `seconds` of frames at 60 fps (the sky pinned to `utcMs`, the sun at `sunEl`). */
function run(seconds: number, utcMs: number, sunEl = -30): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    updateSky(utcMs, sunEl, 5.5);
    finderFrame(camera, 1 / 60, W, H);
  }
}

const target = () => sky.figures.find((g) => g.figure.id === useStarFinder.getState().targetId)!;

describe("the star finder's frame", () => {
  const night = parseKstTime("2026-11-10T21:00")!;
  beforeEach(() => {
    resetFinderRuntime();
    setSkyCatalog(catalog);
    useStarFinder.setState({ progress: { found: {}, showFound: false }, foundNow: null, ranking: [], targetId: null });
    viewState.mode = "fp";
    viewState.blend = 1;
    look([0, 0, -1]);
  });
  afterEach(() => {
    skyOverlay.card = null;
    skyOverlay.labels = [];
    closeFinder();
    setSkyCatalog(null);
    viewState.mode = "tp";
    viewState.blend = 0;
  });

  it("by day says the stars come out tonight, with tonight's time", () => {
    openFinder();
    run(0.1, parseKstTime("2026-11-10T14:00")!, 30);
    const st = useStarFinder.getState();
    expect(st.phase).toBe("day");
    expect(st.targetId).toBeNull();
    expect(st.duskText).toMatch(/^오늘 오후 5시 5\d분쯤$/);
  });

  it("on an autumn night lists what is up (Cassiopeia first, the Dipper and Orion are not), with where each stands", () => {
    openFinder();
    run(0.1, night);
    const st = useStarFinder.getState();
    expect(st.phase).toBe("night");
    expect(st.firstPerson).toBe(true);
    expect(st.targetId).toBeNull(); // nothing is drawn until a name is tapped
    expect(st.ranking[0]).toBe("Cas");
    expect(st.ranking[1]).toBe("polaris");
    expect(st.ranking).not.toContain("dipper");
    expect(st.ranking).not.toContain("Ori"); // winter's Orion is still under the hills at 21:00 in November
    expect(st.rowInfo.Cas).toBe("북쪽 · 높이");
    expect(Object.keys(st.rowInfo).sort()).toEqual([...st.ranking].sort());
    expect(lineSpec).toHaveLength(0);
  });

  it("a tap on a name draws its lines and name, marks it seen, and turns the view to it; a drag takes over", () => {
    openFinder();
    run(0.1, night);
    viewState.fpYaw = 2.5; // looking south-ish
    viewState.fpPitch = 0;
    selectFigure("Cas");
    let st = useStarFinder.getState();
    expect(st.targetId).toBe("Cas");
    expect(st.progress.found.Cas).toBe("2026-11-10T21:00:00+09:00");
    expect(st.announce).toMatch(/^카시오페이아자리를 하늘에 그렸어요\. 가을 발견 1\/6$/);
    run(0.1, night);
    st = useStarFinder.getState();
    expect(st.targetWhere).toMatch(/^북쪽 하늘, 높이 \(고도 6\d°\)$/);
    expect(st.targetShape?.points.length).toBe(5);
    expect(lineSpec.find((l) => l.geom.figure.id === "Cas")?.brightness).toBe(1);
    // the view turns toward the figure within ~2 s, and ends facing it (a little above it)
    run(2.5, night);
    const d = anchorDirection(target(), [0, 0, 0]);
    const fwd: Vec3 = [-Math.sin(viewState.fpYaw) * Math.cos(viewState.fpPitch), -Math.sin(viewState.fpPitch), -Math.cos(viewState.fpYaw) * Math.cos(viewState.fpPitch)];
    expect(angleDeg(fwd, d)).toBeLessThan(6); // 0.08 of the view height under the middle (the card is above)
    // picking again does not count twice
    selectFigure("Cas");
    expect(Object.keys(useStarFinder.getState().progress.found)).toEqual(["Cas"]);
    // a drag in the middle of a turn stops it
    viewState.fpYaw = 2.5;
    viewState.fpPitch = 0;
    selectFigure("polaris");
    run(0.2, night);
    const yawNow = viewState.fpYaw;
    viewState.fpYaw = yawNow + 0.5; // the player's drag
    run(1, night);
    expect(viewState.fpYaw).toBeCloseTo(yawNow + 0.5, 6);
  });

  it("does not turn the camera in third person (the card asks for first person)", () => {
    viewState.mode = "tp";
    viewState.blend = 0;
    openFinder();
    run(0.1, night);
    viewState.fpYaw = 1;
    selectFigure("Cas");
    run(1, night);
    expect(useStarFinder.getState().firstPerson).toBe(false);
    expect(viewState.fpYaw).toBe(1);
  });

  it("restores stars from the first figure when a second is selected during its pulse", () => {
    openFinder();
    run(0.1, night);
    const geometry = new BufferGeometry();
    const brightness = new Float32BufferAttribute(new Float32Array(PLANET_IDS.length + catalog.count).fill(1), 1);
    geometry.setAttribute("aGlow", brightness);
    selectFigure("Cas");
    run(0.3, night);
    syncGlow(geometry);
    const firstStar = PLANET_IDS.length + target().stars[0]!;
    expect(brightness.getX(firstStar)).toBeCloseTo(1.5);
    clearSelection();
    selectFigure("polaris");
    run(0.3, night);
    syncGlow(geometry);
    expect(brightness.getX(firstStar)).toBe(1);
    expect(brightness.getX(PLANET_IDS.length + target().stars[0]!)).toBeCloseTo(1.5);
    run(0.4, night);
    syncGlow(geometry);
    expect(brightness.array.every((n) => n === 1)).toBe(true);
  });

  it("lets go of a pick that has gone below the hills, and the back button clears it", () => {
    openFinder();
    run(0.1, night);
    selectFigure("Cas");
    run(0.1, night);
    clearSelection();
    expect(useStarFinder.getState().targetId).toBeNull();
    selectFigure("Cas");
    // the next morning the sky is gone (day): the pick is let go
    run(0.1, parseKstTime("2026-11-11T14:00")!, 30);
    const st = useStarFinder.getState();
    expect(st.targetId).toBeNull();
  });

  it("shows the summer sky's Lyra almost overhead: the steepest look reaches it", () => {
    const summer = parseKstTime("2026-08-15T21:00")!;
    openFinder();
    run(0.1, summer);
    expect(useStarFinder.getState().ranking).toContain("Lyr");
    selectFigure("Lyr");
    run(3, summer);
    const g = sky.figures.find((x) => x.figure.id === "Lyr")!;
    const d = anchorDirection(g, [0, 0, 0]);
    expect(altAzOf(d).altDeg).toBeGreaterThan(75);
    const fwd: Vec3 = [-Math.sin(viewState.fpYaw) * Math.cos(viewState.fpPitch), -Math.sin(viewState.fpPitch), -Math.cos(viewState.fpYaw) * Math.cos(viewState.fpPitch)];
    expect(angleDeg(fwd, d)).toBeLessThan(6);
  });

  it("keeps found figures drawn faintly when 찾은 별자리 보기 is on, and none when it is off", () => {
    useStarFinder.setState({ progress: { found: { Cas: "x", Peg: "y" }, showFound: true } });
    run(0.1, night);
    expect(lineSpec.map((l) => l.geom.figure.id).sort()).toEqual(["Cas", "Peg"]);
    expect(lineSpec.every((l) => l.brightness === 0.3)).toBe(true);
    useStarFinder.setState({ progress: { found: { Cas: "x", Peg: "y" }, showFound: false } });
    run(0.1, night);
    expect(lineSpec).toHaveLength(0);
  });

  it("shows a found constellation's name in the area freed by closing the finder card", () => {
    const label = { textContent: "", dataset: {}, style: {}, hidden: true } as unknown as HTMLElement;
    skyOverlay.labels = [label];
    skyOverlay.card = { getBoundingClientRect: () => ({ left: 0, top: 0, right: W, bottom: H }) } as HTMLElement;
    useStarFinder.setState({ progress: { found: { Cas: "x" }, showFound: true } });
    openFinder();
    run(0.1, night);
    look(anchorDirection(sky.figures.find((g) => g.figure.id === "Cas")!));
    run(0.3, night);
    expect(label.hidden).toBe(true);
    closeFinder();
    skyOverlay.card = null;
    run(0.1, night);
    expect(label.hidden).toBe(false);
    expect(label.textContent).toContain("카시오페이아");
  });
});
