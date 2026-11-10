import { describe, expect, it } from "vitest";
import { touchHudLayout } from "../game/hud";
import { pressNearAny } from "./chatBar";
import { addChatLayoutTargets, chatLayoutTargets } from "./chatLayoutTargets";

describe("chatLayoutTargets — controls that come back with the HUD, registered by their own component", () => {
  it("lists what is registered right now, and nothing once disposed (a second dispose is harmless)", () => {
    const card = { x: 10, y: 20, w: 200, h: 90 };
    const fan = [
      { x: 1, y: 2, w: 3, h: 4 },
      { x: 5, y: 6, w: 7, h: 8 },
    ];
    let place: { x: number; y: number; w: number; h: number }[] = [card];
    const offCard = addChatLayoutTargets(() => place);
    const offFan = addChatLayoutTargets(() => fan);
    expect(chatLayoutTargets()).toEqual([card, ...fan]);
    place = []; // read when asked: a card with no place right now
    expect(chatLayoutTargets()).toEqual(fan);
    offFan();
    offFan();
    expect(chatLayoutTargets()).toEqual([]);
    offCard();
    expect(chatLayoutTargets()).toEqual([]);
  });

  // Review round 5, the e2e on an iPhone 13: with the fan's six places always counted, the thumb on the joystick (lower
  // left) was "near" the closed fan's leftmost place — the half circle spans most of the bottom of a phone — and the HUD
  // stayed hidden while walking. The fan registers its places only while it is open (EmojiFan).
  it("on a phone the joystick's corner is far from the fixed buttons but near the CLOSED fan's half circle — why the fan only counts while open", () => {
    for (const [vw, vh] of [
      [390, 844],
      [412, 860],
      [375, 667],
    ]) {
      const l = touchHudLayout({ vw, vh, safe: { top: 0, right: 0, bottom: 0, left: 0 }, size: "medium", leftHanded: false });
      const stick = { x: Math.round(vw * 0.25), y: Math.round(vh * 0.72) };
      expect(pressNearAny(stick.x, stick.y, [l.chat, l.jump, l.action, l.emoji]), `${vw}×${vh} fixed`).toBe(false);
      // the look half, up high: far from everything
      expect(pressNearAny(Math.round(vw * 0.72), Math.round(vh * 0.33), [l.chat, l.jump, l.action, l.emoji, ...l.fan]), `${vw}×${vh} up high`).toBe(false);
      // each of the fixed buttons' own centres: near
      for (const r of [l.chat, l.jump, l.action, l.emoji]) expect(pressNearAny(r.x + r.w / 2, r.y + r.h / 2, [l.chat, l.jump, l.action, l.emoji])).toBe(true);
    }
    const l = touchHudLayout({ vw: 390, vh: 844, safe: { top: 0, right: 0, bottom: 0, left: 0 }, size: "medium", leftHanded: false });
    expect(pressNearAny(98, 608, l.fan)).toBe(true); // the open fan's leftmost button reaches the stick's corner
  });
});
