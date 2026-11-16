import { describe, expect, it } from "vitest";
import { BUS_SEATS, seatApproachPoint, BUS_WALK_RADIUS, busSeatNumber, cabinBlocked, stepInCabin } from "@caysonverse/shared/village/busCabin";
import { validateBusMove, validateBusSit } from "./busCabinMove";

/** A client's walk (the shared stepInCabin at 60 Hz, one BusMove every 100 ms) against the server's check: every honest step must be taken. */
describe("validateBusMove: the server accepts what the client's own walk produces (review r1: 4 % of steps along a seat's edge were refused)", () => {
  it("random walks along seats, housings and walls: no refused step, no drift", () => {
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let refused = 0;
    let sent = 0;
    for (let walk = 0; walk < 120; walk++) {
      const me = { ahead: 3.4, right: 0.26 };
      const server = { busSeat: 0, ahead: me.ahead, right: me.right };
      let dirA = Math.cos(rnd() * 6.28);
      let dirR = Math.sin(rnd() * 6.28);
      let lastSent = 0;
      const tmp = { ahead: 0, right: 0 };
      for (let frame = 0; frame < 60 * 14; frame++) {
        if (frame % 50 === 0) {
          const a = rnd() * 6.28;
          dirA = Math.cos(a);
          dirR = Math.sin(a);
        }
        const dt = 1 / 60;
        const next = stepInCabin(me, { ahead: me.ahead + dirA * 4 * dt, right: me.right + dirR * 4 * dt }, BUS_WALK_RADIUS, tmp);
        me.ahead = next.ahead;
        me.right = next.right;
        if (frame - lastSent >= 6) {
          sent++;
          const d = validateBusMove(server, { ahead: me.ahead, right: me.right, yaw: 0 }, (frame - lastSent) * (1000 / 60));
          if (d.ok) {
            server.ahead = d.ahead;
            server.right = d.right;
          } else refused++;
          lastSent = frame;
        }
      }
    }
    expect(sent).toBeGreaterThan(5000);
    expect(refused).toBe(0);
  });

  it("through a seat, a wall, the driver's partition or too fast is refused; into another rider too", () => {
    const from = { busSeat: 0, ahead: 0.6, right: 0.0 };
    expect(validateBusMove(from, { ahead: 0.6, right: -1.0, yaw: 0 }, 1000).ok).toBe(false); // into the wall seat
    expect(validateBusMove(from, { ahead: 0.6, right: 5, yaw: 0 }, 1000).ok).toBe(false);
    expect(validateBusMove(from, { ahead: 3.0, right: 0.0, yaw: 0 }, 50).ok).toBe(false); // 2.4 m in 50 ms
    expect(validateBusMove(from, { ahead: 0.9, right: 0.0, yaw: 0 }, 100, [{ ahead: 0.95, right: 0.0 }]).ok).toBe(false);
    // bus v3: nobody walks into another body (a rider standing in the narrow aisle is not passed through)
    expect(validateBusMove({ busSeat: 0, ahead: 0.3, right: 0.0 }, { ahead: 0.5, right: 0.0, yaw: 0 }, 100, [{ ahead: 0.95, right: 0.0 }]).ok).toBe(false);
    expect(validateBusMove(from, { ahead: 0.7, right: 0.0, yaw: 0 }, 100, [{ ahead: -0.3, right: 0.0 }]).ok).toBe(true);
    expect(validateBusMove({ ...from, busSeat: 3 }, { ahead: 0.7, right: 0.0, yaw: 0 }, 100).ok).toBe(false);
    // straight through a whole seat (a long step across its depth): refused
    const s = BUS_SEATS.find((x) => x.id === "RL1")!;
    expect(cabinBlocked(s.ahead - 0.7, 0)).toBe(false);
    expect(validateBusMove({ busSeat: 0, ahead: s.ahead + 0.7, right: -0.9 }, { ahead: s.ahead - 0.7, right: -0.9, yaw: 0 }, 1000).ok).toBe(false);
  });
});

describe("validateBusSit", () => {
  it("bus v3: a hold request (the old poles) is dropped silently", () => {
    const here = { busSeat: 0, ahead: 1.0, right: 0 };
    expect(validateBusSit(here, { kind: "hold", index: 0 }, new Set())).toEqual({ ok: false, notice: "" });
  });

  it("every seat from its approach point is taken, from behind is not, and a taken one is refused", () => {
    BUS_SEATS.forEach((s, i) => {
      const ap = seatApproachPoint(s);
      const at = { busSeat: 0, ahead: ap.ahead, right: ap.right };
      expect(validateBusSit(at, { kind: "seat", index: i }, new Set()).ok, s.id).toBe(true);
      expect(validateBusSit(at, { kind: "seat", index: i }, new Set([busSeatNumber(i)])).ok, s.id).toBe(false);
    });
    const s = BUS_SEATS.find((x) => x.id === "R2")!;
    const behind = { busSeat: 0, ahead: s.ahead - 0.8, right: s.right };
    expect(validateBusSit(behind, { kind: "seat", index: BUS_SEATS.indexOf(s) }, new Set()).ok).toBe(false);
  });
});
