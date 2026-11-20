import { PerspectiveCamera, Vector3 } from "three";
import { afterEach, expect, it, vi } from "vitest";
import { COASTER_DWELL_MS, coasterAt } from "@caysonverse/shared/land/coaster";
import { resetRideClock, setRideClockForTests } from "./rideClock";
import { carEyeWorld, resetRideCamera, stepRideCamera } from "./coasterRide";

afterEach(() => {
  resetRideCamera();
  resetRideClock();
  vi.restoreAllMocks();
});

it("keeps the rider's eye within the car during a run of slow frames", () => {
  const camera = new PerspectiveCamera();
  const seatEye = new Vector3();
  let now = 0;
  setRideClockForTests(() => now);
  let maxOffset = 0;
  for (let i = 0; i < 100; i++) {
    now = COASTER_DWELL_MS + 15_000 + i * 100;
    stepRideCamera(camera, 0.1, 0, 0, 60);
    carEyeWorld(coasterAt(now).s, 0, seatEye);
    maxOffset = Math.max(maxOffset, camera.position.distanceTo(seatEye));
  }
  expect(maxOffset).toBeLessThan(0.5);
});
