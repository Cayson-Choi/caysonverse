import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PerspectiveCamera, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseKstTime } from "@caysonverse/shared/village/sunClock";
import { altAzOf, type Vec3 } from "@caysonverse/shared/village/skyMath";
import { viewState } from "../../game/viewState";
import { finderFrame, lineSpec, resetFinderRuntime } from "./finderRuntime";
import { parseStarCatalog } from "./starCatalog";
import { anchorDirection, setSkyCatalog, sky, updateSky } from "./skyRuntime";
import { closeFinder, openFinder, useStarFinder } from "./starFinderStore";

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

  it("on an autumn night picks Cassiopeia first (the Dipper is down), and finds it after a second in the reticle", () => {
    openFinder();
    run(0.1, night);
    let st = useStarFinder.getState();
    expect(st.phase).toBe("night");
    expect(st.firstPerson).toBe(true);
    expect(st.targetId).toBe("Cas");
    expect(st.ranking[1]).toBe("polaris");
    expect(st.ranking).not.toContain("dipper");
    expect(st.ranking).not.toContain("Ori"); // winter's Orion is still under the hills at 21:00 in November
    expect(st.targetWhere).toMatch(/^북쪽 하늘, 높이 \(고도 6\d°\)$/); // near its upper culmination in mid-November
    expect(st.targetShape?.points.length).toBe(5);

    // looking away for two seconds: nothing
    look([0, 0.3, 1]);
    run(2, night);
    expect(useStarFinder.getState().foundNow).toBeNull();

    // into the reticle: found after one second, not before
    const d = anchorDirection(target(), [0, 0, 0]);
    look(d);
    run(0.9, night);
    expect(useStarFinder.getState().foundNow).toBeNull();
    run(0.2, night);
    st = useStarFinder.getState();
    expect(st.foundNow).toBe("Cas");
    expect(st.progress.found.Cas).toBe("2026-11-10T21:00:00+09:00");
    expect(st.announce).toMatch(/^카시오페이아자리를 찾았어요! 가을 발견 1\/6$/);
    // its lines are drawn (revealing), at full brightness
    expect(lineSpec.find((l) => l.geom.figure.id === "Cas")?.brightness).toBe(1);
  });

  it("forgives a shaky hand: a short slip out of the reticle drains the count at double speed", () => {
    openFinder();
    run(0.1, night);
    const d = anchorDirection(target(), [0, 0, 0]);
    look(d);
    run(0.6, night);
    look([0, 0.3, 1]);
    run(0.1, night); // 0.6 - 0.2 = 0.4 left
    look(d);
    run(0.5, night);
    expect(useStarFinder.getState().foundNow).toBeNull();
    run(0.2, night);
    expect(useStarFinder.getState().foundNow).toBe("Cas");
  });

  it("does not aim in third person (the card asks for first person)", () => {
    viewState.mode = "tp";
    viewState.blend = 0;
    openFinder();
    run(0.1, night);
    const d = anchorDirection(target(), [0, 0, 0]);
    look(d);
    run(2, night);
    const st = useStarFinder.getState();
    expect(st.firstPerson).toBe(false);
    expect(st.foundNow).toBeNull();
  });

  it("shows the faint ghost lines after 20 s without finding", () => {
    openFinder();
    run(0.1, night);
    look([0, -0.2, 1]);
    run(19.5, night);
    expect(useStarFinder.getState().ghost).toBe(false);
    run(1, night);
    expect(useStarFinder.getState().ghost).toBe(true);
    expect(lineSpec.find((l) => l.geom.figure.id === "Cas")?.brightness).toBe(0.15);
  });

  it("finds the summer sky's Lyra almost overhead (the 86° look-up reaches it)", () => {
    const summer = parseKstTime("2026-08-15T21:00")!;
    useStarFinder.setState({ progress: { found: { dipper: "x", polaris: "y" }, showFound: false } });
    openFinder();
    run(0.1, summer);
    useStarFinder.setState({ targetId: "Lyr" });
    const g = sky.figures.find((x) => x.figure.id === "Lyr")!;
    const d = anchorDirection(g, [0, 0, 0]);
    expect(altAzOf(d).altDeg).toBeGreaterThan(75);
    // the steepest first-person look (pitch -1.5 rad = 86°) still has it inside the allowance
    const steep: Vec3 = [Math.sin(Math.atan2(d[0], -d[2])) * Math.cos(1.5), Math.sin(1.5), -Math.cos(Math.atan2(d[0], -d[2])) * Math.cos(1.5)];
    look(altAzOf(d).altDeg > 86 ? steep : d);
    run(1.1, summer);
    expect(useStarFinder.getState().foundNow).toBe("Lyr");
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
});
