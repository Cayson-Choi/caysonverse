import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { tactileStuds } from "./busStopDetails";

describe("bus stop tactile tiles", () => {
  it.each([true, false])("draws only the nearby rows and clips them at both ends, phone=%s", phone => {
    const studs = tactileStuds(phone);
    for (const z of [-10.5, -6, -1.7]) {
      studs.update(new Vector3(38.8, 1.65, z));
      const mesh = studs.mesh;
      expect(mesh.visible).toBe(true);
      expect(mesh.count).toBeGreaterThan(0);
      expect(mesh.position.z).toBeGreaterThanOrEqual(-10.5);
      expect(mesh.position.z + mesh.count * 0.05).toBeLessThanOrEqual(-1.699);
      if (phone) expect(mesh.count * mesh.geometry.index!.count / 3).toBeLessThan(8100);
    }
    studs.update(new Vector3(30, 40, 60));
    expect(studs.mesh.visible).toBe(false);
    studs.dispose();
  });
});
