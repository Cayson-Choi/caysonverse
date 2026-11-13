import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { VEG_LAMPS, setVegLamps, vegLampsUniform } from "./vegMaterial";
import { lampPlaces } from "./villageVegetation";

describe("the street lamps that light the vegetation at night", () => {
  it("finds one place per lamp from its glowing glass (M_lamp), and none from other meshes", () => {
    const root = new Group();
    const glass = new MeshBasicMaterial({ name: "M_lamp" });
    for (const [x, z] of [
      [0, 0],
      [10, 4],
      [-7, 20],
    ]) {
      const m = new Mesh(new BoxGeometry(0.3, 0.4, 0.3), glass);
      m.position.set(x, 3.8, z);
      root.add(m);
    }
    root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ name: "LM_bark" })));
    const places = lampPlaces(root);
    expect(places).toHaveLength(3);
    for (const p of places) expect(p[1]).toBeCloseTo(3.8, 1);
  });

  it("puts the nearest lamps first into the uniform and pads the rest with none (strength 0)", () => {
    const used = setVegLamps(
      [
        [50, 4, 0],
        [1, 4, 0],
      ],
      [0, 0, 0],
    );
    expect(used).toBe(2);
    expect(vegLampsUniform.value[0]!.x).toBe(1);
    expect(vegLampsUniform.value[1]!.x).toBe(50);
    expect(vegLampsUniform.value[2]!.w).toBe(0);
    expect(vegLampsUniform.value).toHaveLength(VEG_LAMPS);
  });
});

describe("the follow camera's keep-out of the bark", () => {
  it("is out of bounds within the room of a segment's surface, only while the vegetation is drawn", async () => {
    const { cameraKeepOut, BARK_CAMERA_ROOM } = await import("./villageVegetation");
    let t = 0;
    const k = cameraKeepOut([0, 0, 0, 0, 4, 0, 0.1], BARK_CAMERA_ROOM, () => t);
    expect(k(0.1 + BARK_CAMERA_ROOM - 0.02, 2, 0)).toBe(true);
    expect(k(0.1 + BARK_CAMERA_ROOM + 0.02, 2, 0)).toBe(false);
    expect(k(0, 4.45, 0)).toBe(true);
    expect(k(0, 4.6, 0)).toBe(false);
    t = 2000;
    expect(k(0.2, 2, 0)).toBe(false);
    k.touch();
    expect(k(0.2, 2, 0)).toBe(true);
  });
});
