import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import { compassState, headingFromDirection } from "./compass";

const dir = new Vector3();
const up = new Vector3();

/**
 * Writes where the real camera looks (deg clockwise from north) into `compassState` once per frame, for the HUD's
 * 동서남북 dial. It reads the camera itself, so it is right in every view (follow, first person, the bus, the map)
 * without knowing how the camera rig got there. Looking (almost) straight down — the overview map, north up — the
 * screen's up direction is the heading instead. Allocation-free; mounted inside the Canvas.
 */
export function CompassProbe() {
  useFrame(({ camera }) => {
    camera.getWorldDirection(dir);
    if (Math.abs(dir.y) > 0.97) {
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      compassState.heading = headingFromDirection(up.x, up.z);
    } else {
      compassState.heading = headingFromDirection(dir.x, dir.z);
    }
  });
  return null;
}
