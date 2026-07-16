import { describe, it, expect } from "vitest";
import {
  quantizeDpad,
  DPAD_SECTOR_INTENTS,
  DPAD_DEAD_ZONE,
  DPAD_DEAD_ZONE_RELEASE,
  DPAD_HYSTERESIS_RAD,
} from "./dpad";
import type { DpadSector } from "./dpad";
import { joystickIntent } from "./joystick";

/**
 * The D-pad quantizer turns a touch offset (zone-centre-relative, normalized to
 * the pad radius, y UP-positive — the nipplejs vector convention) into one of 8
 * discrete 45° sectors + the keyboard-style {-1,0,1} intent, with a radial dead
 * zone and ±10° angular hysteresis at the sector boundaries (design 21). Angles
 * below are degrees clockwise from north (▲): 0=N, 45=NE, 90=E … 315=NW.
 */
const at = (deg: number, r = 1) => {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.sin(rad) * r, y: Math.cos(rad) * r };
};

const quant = (deg: number, prev: DpadSector | null = null, r = 1) => {
  const p = at(deg, r);
  return quantizeDpad(p.x, p.y, prev);
};

describe("quantizeDpad — 8-sector mapping (fresh, no previous sector)", () => {
  it("maps the 8 sector centres to the keyboard-style discrete intents", () => {
    expect(quant(0)).toEqual({ sector: 0, intent: { forward: 1, right: 0 } }); // ▲
    expect(quant(45)).toEqual({ sector: 1, intent: { forward: 1, right: 1 } }); // ↗
    expect(quant(90)).toEqual({ sector: 2, intent: { forward: 0, right: 1 } }); // ▶
    expect(quant(135)).toEqual({ sector: 3, intent: { forward: -1, right: 1 } }); // ↘
    expect(quant(180)).toEqual({ sector: 4, intent: { forward: -1, right: 0 } }); // ▼
    expect(quant(225)).toEqual({ sector: 5, intent: { forward: -1, right: -1 } }); // ↙
    expect(quant(270)).toEqual({ sector: 6, intent: { forward: 0, right: -1 } }); // ◀
    expect(quant(315)).toEqual({ sector: 7, intent: { forward: 1, right: -1 } }); // ↖
  });

  it("splits at the ±22.5° sector boundaries (pure quantization when fresh)", () => {
    expect(quant(22).sector).toBe(0); // just inside north
    expect(quant(23).sector).toBe(1); // just past the N/NE boundary
    expect(quant(-22).sector).toBe(0);
    expect(quant(-23).sector).toBe(7); // just past the N/NW boundary
    expect(quant(180 - 23).sector).toBe(3); // south boundaries near the ±π seam
    expect(quant(180 + 23).sector).toBe(5);
  });

  it("diagonal sectors set BOTH components to ±1", () => {
    for (const s of [1, 3, 5, 7] as const) {
      const { intent } = quant(s * 45);
      expect(Math.abs(intent.forward)).toBe(1);
      expect(Math.abs(intent.right)).toBe(1);
    }
  });
});

describe("quantizeDpad — y-sign convention (nipplejs: y is UP-positive)", () => {
  it("y=+1 (up) is forward+1 and y=-1 (down) is forward-1", () => {
    expect(quantizeDpad(0, 1, null).intent).toEqual({ forward: 1, right: 0 });
    expect(quantizeDpad(0, -1, null).intent).toEqual({ forward: -1, right: 0 });
    expect(quantizeDpad(1, 0, null).intent).toEqual({ forward: 0, right: 1 });
    expect(quantizeDpad(-1, 0, null).intent).toEqual({ forward: 0, right: -1 });
  });

  it("matches joystickIntent on the cardinals (same shared moveInput semantics)", () => {
    for (const v of [
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
    ]) {
      expect(quantizeDpad(v.x, v.y, null).intent).toEqual(joystickIntent(v, 1));
    }
  });
});

describe("quantizeDpad — radial dead zone (with enter/release hysteresis)", () => {
  it("inside the dead zone reads as idle: sector null, zero intent", () => {
    expect(quant(0, null, DPAD_DEAD_ZONE - 0.01)).toEqual({
      sector: null,
      intent: { forward: 0, right: 0 },
    });
    expect(quantizeDpad(0, 0, null).sector).toBeNull();
  });

  it("activates exactly at the enter radius (>= threshold moves, like the joystick)", () => {
    expect(quant(0, null, DPAD_DEAD_ZONE).sector).toBe(0);
  });

  it("while active, stays active between the release and enter radii (no idle chatter)", () => {
    const r = (DPAD_DEAD_ZONE + DPAD_DEAD_ZONE_RELEASE) / 2; // in the hysteresis band
    expect(quant(0, 0, r)).toEqual({ sector: 0, intent: { forward: 1, right: 0 } });
  });

  it("while active, releases to idle below the release radius", () => {
    expect(quant(0, 0, DPAD_DEAD_ZONE_RELEASE - 0.01)).toEqual({
      sector: null,
      intent: { forward: 0, right: 0 },
    });
  });

  it("the release radius is strictly inside the enter radius (real hysteresis band)", () => {
    expect(DPAD_DEAD_ZONE_RELEASE).toBeLessThan(DPAD_DEAD_ZONE);
  });
});

describe("quantizeDpad — ±10° angular hysteresis at sector boundaries", () => {
  it("exports a 10° hysteresis threshold", () => {
    expect(DPAD_HYSTERESIS_RAD).toBeCloseTo((10 * Math.PI) / 180, 10);
  });

  it("wobbling ±9° across a boundary never leaves the held sector", () => {
    // Boundary N/NE is at 22.5°; ±9° around it spans 13.5°..31.5°.
    let sector: DpadSector | null = quant(0).sector; // establish ▲
    for (const deg of [31.5, 13.5, 31.5, 13.5, 31.5, 13.5]) {
      const res = quant(deg, sector);
      expect(res.sector).toBe(0);
      expect(res.intent).toEqual({ forward: 1, right: 0 });
      sector = res.sector;
    }
  });

  it("crossing a boundary by 11° transitions to the neighbour", () => {
    expect(quant(22.5 + 11, 0)).toEqual({ sector: 1, intent: { forward: 1, right: 1 } });
    expect(quant(-(22.5 + 11), 0)).toEqual({ sector: 7, intent: { forward: 1, right: -1 } });
  });

  it("is wrap-safe around the ±180° seam (south sector)", () => {
    expect(quant(180 + 22.5 + 9, 4).sector).toBe(4); // stays ▼
    expect(quant(180 + 22.5 + 11, 4).sector).toBe(5); // → ↙
    expect(quant(180 - 22.5 - 9, 4).sector).toBe(4);
    expect(quant(180 - 22.5 - 11, 4).sector).toBe(3); // → ↘
  });

  it("a large jump re-quantizes immediately (hysteresis only guards the boundary)", () => {
    expect(quant(180, 0).sector).toBe(4); // ▲ → ▼ flick
    expect(quant(90, 0).sector).toBe(2); // ▲ → ▶ flick
  });

  it("re-entry from the dead zone (prev null) quantizes purely — no hysteresis", () => {
    // 30° with a held ▲ would stay sector 0 (30 < 32.5)…
    expect(quant(30, 0).sector).toBe(0);
    // …but after a release (prev null) the same angle is plain-quantized to NE.
    expect(quant(30, null).sector).toBe(1);
  });
});

describe("DPAD_SECTOR_INTENTS — table shape (drives the button highlights)", () => {
  it("has 8 entries whose components are all in {-1,0,1}", () => {
    expect(DPAD_SECTOR_INTENTS).toHaveLength(8);
    for (const { forward, right } of DPAD_SECTOR_INTENTS) {
      expect([-1, 0, 1]).toContain(forward);
      expect([-1, 0, 1]).toContain(right);
    }
  });

  it("returned intents are copies — mutating one never corrupts the table", () => {
    const a = quantizeDpad(0, 1, null).intent;
    a.forward = 99;
    expect(quantizeDpad(0, 1, null).intent).toEqual({ forward: 1, right: 0 });
    expect(DPAD_SECTOR_INTENTS[0]).toEqual({ forward: 1, right: 0 });
  });
});
