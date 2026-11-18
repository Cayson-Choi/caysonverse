import { describe, expect, it } from "vitest";
import { BUS_STANDING_SPOTS, BUS_SEATS, BUS_ENTRY, cabinFloorAt, seatBodyPoint } from "@caysonverse/shared/village/busCabin";
import { busLocal } from "@caysonverse/shared/village/busBody";
import { BUS_CAM, BUS_SHELL, BUS_TP, busRiderCamera, busSelfHidden, busShoulderScale, busShoulderSide, busTpArm, clampBusPitch, ownSeatIndex, riderFov } from "./transitCamera";
import { SELF_GAP } from "../game/selfGap";
import { BUS_VIEW_YAW } from "../game/busRide";

const bus = { x: 10, z: -4, yaw: 0.9 };
const base = { bus, ahead: 1.0, right: 0.0, floor: 0.34, seated: false, elevation: 0.25, dist: 6 } as const;

/** The camera's eye and look point in the bus's own frame. */
function inBus(cam: ReturnType<typeof busRiderCamera>, b = bus) {
  const e = busLocal(b, cam.x, cam.z);
  const t = busLocal(b, cam.targetX, cam.targetZ);
  return { eye: { ahead: e.ahead, right: e.right, h: cam.y }, target: { ahead: t.ahead, right: t.right, h: cam.targetY } };
}

/** Every place a rider can be: each seat, each standing spot and a grid down the aisle. */
const places: { ahead: number; right: number; seated: boolean; floor: number }[] = [];
BUS_SEATS.forEach((s) => {
  const p = seatBodyPoint(s);
  places.push({ ahead: p.ahead, right: p.right, seated: true, floor: s.floor ?? cabinFloorAt(p.ahead) });
});
BUS_STANDING_SPOTS.forEach((h) => places.push({ ahead: h.ahead, right: h.right, seated: false, floor: cabinFloorAt(h.ahead) }));
for (const a of [-3.4, -2, -0.5, 1, 2.4, 3.4]) for (const r of [-0.1, 0, 0.1]) places.push({ ahead: a, right: r, seated: false, floor: cabinFloorAt(a) });

describe("the rider camera in the bus (owner 2026-11-15: look out of every window)", () => {
  it("the four quick views look the right way in both views: front down the bus, back along the aisle, out of the left windows, out of the door side", () => {
    for (const dist of [0, 6]) {
      const look = (yaw: number) => {
        const c = inBus(busRiderCamera({ ...base, dist, yaw }));
        return { da: c.target.ahead - c.eye.ahead, dr: c.target.right - c.eye.right };
      };
      expect(look(BUS_VIEW_YAW.front).da).toBeGreaterThan(0.5);
      expect(look(BUS_VIEW_YAW.back).da).toBeLessThan(-0.5);
      expect(look(BUS_VIEW_YAW.left).dr).toBeLessThan(-0.3);
      expect(look(BUS_VIEW_YAW.right).dr).toBeGreaterThan(0.3);
    }
  });

  it("the camera turns with the bus: the same view at any heading is the same in the bus's frame", () => {
    for (const heading of [0, 1.1, -2.4, 3.0]) {
      const b = { x: 3, z: 8, yaw: heading };
      const c = inBus(busRiderCamera({ ...base, bus: b, yaw: BUS_VIEW_YAW.right }), b);
      expect(c.target.right - c.eye.right).toBeGreaterThan(0.3);
    }
  });

  it("the eye never leaves the cabin shell (0.25 m inside the walls and the ceiling), at any aim and zoom, anywhere a rider can be", () => {
    for (const sp of [{ ahead: BUS_ENTRY.ahead, right: BUS_ENTRY.right, seated: false, floor: 0.34 }, ...places]) {
      for (let yaw = -Math.PI; yaw <= Math.PI; yaw += 0.35) {
        for (const dist of [3.2, 6, 18]) {
          for (const elevation of [BUS_TP.pitchMin, -0.3, 0.1, 0.7, BUS_TP.pitchMax]) {
            for (const [shoulder, portrait] of [[1, false], [-0.6, true]] as const) {
              const e = inBus(busRiderCamera({ ...base, ...sp, yaw, dist, elevation, shoulder, portrait })).eye;
              expect(e.ahead).toBeGreaterThanOrEqual(BUS_SHELL.aheadMin - 1e-6);
              expect(e.ahead).toBeLessThanOrEqual(BUS_SHELL.aheadMax + 1e-6);
              expect(Math.abs(e.right)).toBeLessThanOrEqual(BUS_SHELL.right + 1e-6);
              expect(e.h).toBeLessThanOrEqual(BUS_SHELL.top + 1e-6);
              expect(e.h).toBeGreaterThanOrEqual(sp.floor + BUS_TP.minOverFloor - 1e-6);
            }
          }
        }
      }
    }
  }, 30000);

  it("owner 2026-11-16: a seat in the way does not shorten the arm, only the cabin's walls do; first person is the rider's eye", () => {
    // standing in the aisle's middle, looking to the front: the lens 3.2 m back along the aim (seats in between are props)
    const c = inBus(busRiderCamera({ ...base, ahead: 0.5, right: 0, yaw: BUS_VIEW_YAW.front, elevation: 0.15, dist: 10 }));
    expect(c.eye.ahead).toBeCloseTo(0.5 - BUS_TP.armMax * Math.cos(0.15), 1);
    // near the back wall the arm stops at the shell
    const end = inBus(busRiderCamera({ ...base, ahead: -3.0, right: 0, yaw: BUS_VIEW_YAW.front, elevation: 0.15, dist: 10 }));
    expect(end.eye.ahead).toBeGreaterThanOrEqual(BUS_SHELL.aheadMin - 1e-6);
    expect(end.eye.ahead).toBeLessThan(-3.0);
    const fp = busRiderCamera({ ...base, yaw: 0, dist: 0 });
    expect(fp.firstPerson).toBe(true);
    expect(fp.arm).toBe(0);
    expect(BUS_CAM.firstPersonDist).toBeLessThan(0.5);
    const l2 = BUS_SEATS.findIndex((s) => s.id === "L2");
    expect(ownSeatIndex(l2 + 1)).toBe(l2);
    expect(ownSeatIndex(0)).toBe(-1);
  });

  it("the lens is wider in the bus, wider still on a portrait phone", () => {
    expect(riderFov(1.6)).toBe(68);
    expect(riderFov(0.46)).toBe(78);
  });
});

describe("owner 2026-11-18: the bus camera aims where the player drags (docs/designs/bus-controls.md)", () => {
  it("both views look exactly along the aim: the yaw (bus-relative) and the pitch, down to 80 deg (the floor) and up to 43 deg", () => {
    for (const dist of [0, 3.2, 6, 10]) {
      for (let yaw = -Math.PI; yaw < Math.PI; yaw += 0.4) {
        for (const pitch of [BUS_TP.pitchMin, -0.3, 0, 0.6, 1.2, BUS_TP.pitchMax]) {
          const c = inBus(busRiderCamera({ ...base, yaw, elevation: pitch, dist }));
          const da = c.target.ahead - c.eye.ahead;
          const dr = c.target.right - c.eye.right;
          const dh = c.target.h - c.eye.h;
          expect(Math.atan2(-dh, Math.hypot(da, dr))).toBeCloseTo(pitch, 4);
          expect(da / Math.hypot(da, dr)).toBeCloseTo(-Math.cos(yaw), 4);
          expect(dr / Math.hypot(da, dr)).toBeCloseTo(Math.sin(yaw), 4);
        }
      }
    }
    expect(BUS_TP.pitchMax).toBeGreaterThanOrEqual(1.39); // 80 deg
    expect(clampBusPitch(9)).toBe(BUS_TP.pitchMax);
    expect(clampBusPitch(-9)).toBe(BUS_TP.pitchMin);
  });

  it("the zoom picks the arm: 1.9 m at the least zoom .. 3.2 m", () => {
    expect(busTpArm(3.2)).toBeCloseTo(BUS_TP.armMin);
    expect(busTpArm(18)).toBeCloseTo(BUS_TP.armMax);
    expect(busTpArm(6)).toBeGreaterThan(BUS_TP.armMin);
    expect(busTpArm(6, true)).toBeCloseTo(busTpArm(6) * BUS_TP.portraitArm);
  });

  it("third person is over the shoulder: looking down the bus the rider is off the middle of the view", () => {
    const c = inBus(busRiderCamera({ ...base, ahead: 0, right: 0, yaw: BUS_VIEW_YAW.front, elevation: 0.2, dist: 6, shoulder: 1 }));
    // the lens is to the right of the rider (looking to the front, right = +right) and above the head, 1.75 m+ off: the rider is shown
    expect(c.eye.right).toBeGreaterThan(0.3);
    expect(c.eye.h).toBeGreaterThan(0.34 + 1.7);
    expect(busSelfHidden(false, busRiderCamera({ ...base, ahead: 0, right: 0, yaw: BUS_VIEW_YAW.front, elevation: 0.2, dist: 6, shoulder: 1 }))).toBe(false);
  });

  it("anywhere, any aim and zoom: the lens never in the head — within 0.6 m of the head and body the own body is hidden", () => {
    let shown = 0;
    let n = 0;
    for (const sp of places) {
      for (let yaw = -Math.PI; yaw < Math.PI; yaw += 0.3) {
        for (const pitch of [BUS_TP.pitchMin, 0, 0.5, 1.0, BUS_TP.pitchMax]) {
          for (const dist of [3.2, 6, 10]) {
            const side = busShoulderSide(sp.right, yaw, 1);
            const c = busRiderCamera({ ...base, ...sp, yaw, elevation: pitch, dist, shoulder: side });
            const hidden = busSelfHidden(false, c);
            if (!hidden) {
              expect(c.gap).toBeGreaterThanOrEqual(SELF_GAP.hide);
              expect(c.arm).toBeGreaterThanOrEqual(BUS_TP.hideAt);
              shown++;
            }
            n++;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
    // all aims count here (out of a window, straight down, against an end wall: the body hidden, by design); the views along the
    // bus, where the third person is meant to show the rider, are the next test's
    expect(shown / n).toBeGreaterThan(0.05);
  });

  it("looking along the bus (front / back) from the aisle at a level aim, the rider is shown (the third person is a third person)", () => {
    let shown = 0;
    let n = 0;
    for (const a of [-2, -1, 0, 1, 2]) {
      for (const yaw of [BUS_VIEW_YAW.front, BUS_VIEW_YAW.back]) {
        const c = busRiderCamera({ ...base, ahead: a, right: 0, yaw, elevation: 0.2, dist: 6, shoulder: busShoulderSide(0, yaw, 1) });
        if (!busSelfHidden(false, c)) shown++;
        n++;
      }
    }
    expect(shown / n).toBeGreaterThanOrEqual(0.8);
  });

  it("the shoulder flips to the side with room: a rider by the right wall looking to the front stands the lens over the left shoulder", () => {
    expect(busShoulderSide(0, BUS_VIEW_YAW.front, 1)).toBe(1);
    expect(busShoulderSide(0.8, BUS_VIEW_YAW.front, 1)).toBe(-1);
    expect(busShoulderSide(-0.8, BUS_VIEW_YAW.front, -1)).toBe(1);
    // looking out of a window the shoulder runs along the bus: both sides have room
    expect(busShoulderSide(0.8, BUS_VIEW_YAW.right, 1)).toBe(1);
    // a portrait phone prefers the left shoulder (the ride panel covers the left of its screen), and the pivot goes less far across
    expect(busShoulderSide(0, BUS_VIEW_YAW.front, -1, -1)).toBe(-1);
    expect(busShoulderSide(-0.8, BUS_VIEW_YAW.front, -1, -1)).toBe(1);
    expect(busShoulderScale(375 / 812)).toBeLessThan(busShoulderScale(1.6));
  });

  it("first person hides the body; a lens under 1.6 m from the head hides it too (a 1 m head would fill half the picture), back only past 1.75 m", () => {
    expect(busSelfHidden(false, { arm: 5, gap: 5, firstPerson: true })).toBe(true);
    expect(busSelfHidden(false, { arm: BUS_TP.hideAt - 0.01, gap: 1, firstPerson: false })).toBe(true);
    expect(busSelfHidden(false, { arm: BUS_TP.hideAt + 0.01, gap: 1, firstPerson: false })).toBe(false);
    expect(busSelfHidden(true, { arm: (BUS_TP.hideAt + BUS_TP.showAt) / 2, gap: 1, firstPerson: false })).toBe(true);
    expect(busSelfHidden(true, { arm: BUS_TP.showAt + 0.01, gap: 1, firstPerson: false })).toBe(false);
    // a portrait phone hides a little farther out
    expect(busSelfHidden(false, { arm: BUS_TP.hideAt + 0.1, gap: 1, firstPerson: false }, true)).toBe(true);
    // never within 0.6 m of the head and body, whatever the centre distance says
    expect(busSelfHidden(false, { arm: 3, gap: SELF_GAP.hide - 0.01, firstPerson: false })).toBe(true);
  });
});
