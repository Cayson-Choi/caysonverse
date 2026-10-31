import { describe, expect, it } from "vitest";
import { TYPING_RATE, TYPING_TTL_MS } from "@caysonverse/shared/constants";
import { TypingRegistry, createTypingSender, TYPING_SEND_INTERVAL_MS } from "./typing";

function makeSender(intervalMs?: number) {
  const sent: boolean[] = [];
  const sender = createTypingSender((on) => sent.push(on), intervalMs);
  return { sent, sender };
}

describe("createTypingSender", () => {
  it("defaults its heartbeat gap to the server window plus 50 ms of slack", () => {
    // The server keeps a hit that is exactly windowMs old, so an ON at +windowMs is
    // rejected; the client must wait strictly longer.
    expect(TYPING_SEND_INTERVAL_MS).toBe(TYPING_RATE.windowMs + 50);
    expect(TYPING_SEND_INTERVAL_MS).toBeGreaterThan(TYPING_RATE.windowMs);
  });

  it("ON at the first keystroke, heartbeat at most once per TYPING_SEND_INTERVAL_MS, OFF when cleared", () => {
    const { sent, sender } = makeSender();
    sender.onInput(0, true);
    sender.onInput(100, true);
    sender.onInput(TYPING_SEND_INTERVAL_MS - 1, true);
    expect(sent).toEqual([true]); // 3049: still inside the gap
    sender.onInput(TYPING_SEND_INTERVAL_MS, true);
    expect(sent).toEqual([true, true]); // 3050: the heartbeat
    sender.onInput(TYPING_SEND_INTERVAL_MS + 50, false);
    expect(sent).toEqual([true, true, false]);
  });

  it("a held key never trips the server window: every ON the sender emits is accepted", () => {
    // A server that, like RateWindow, still counts a hit exactly windowMs old; a user
    // who types every 50 ms for 20 s. No ON the sender emits may be rejected.
    let t = 0;
    let rejected = 0;
    const accepted: number[] = [];
    const sender = createTypingSender((on) => {
      if (!on) return;
      const last = accepted.length > 0 ? accepted[accepted.length - 1] : -Infinity;
      if (t - last > TYPING_RATE.windowMs) accepted.push(t);
      else rejected += 1;
    });
    for (t = 0; t <= 20_000; t += 50) sender.onInput(t, true);
    expect(rejected).toBe(0);
    expect(accepted.length).toBe(7); // 0, 3050, 6100, ... 18300
    // the heartbeat gap stays inside the receiver's TTL, so the indicator never lapses
    for (let i = 1; i < accepted.length; i += 1) {
      expect(accepted[i] - accepted[i - 1]).toBeLessThan(TYPING_TTL_MS);
    }
  });

  it("mirrors the server limit: an ON right after an OFF waits for the window", () => {
    const { sent, sender } = makeSender();
    sender.onInput(0, true);
    sender.onInput(500, false);
    expect(sent).toEqual([true, false]);
    sender.onInput(1000, true); // inside the window since the last ON
    expect(sent).toEqual([true, false]);
    sender.onInput(TYPING_SEND_INTERVAL_MS - 1, true);
    expect(sent).toEqual([true, false]);
    sender.onInput(TYPING_SEND_INTERVAL_MS, true);
    expect(sent).toEqual([true, false, true]);
  });

  it("the window runs from the last ON actually sent — it survives stop() (and so a sent chat)", () => {
    const { sent, sender } = makeSender();
    sender.onInput(0, true);
    sender.stop(); // e.g. the line was sent: the server's rate window still remembers the ON
    expect(sent).toEqual([true, false]);
    sender.onInput(1000, true);
    expect(sent).toEqual([true, false]);
    sender.onInput(TYPING_SEND_INTERVAL_MS, true);
    expect(sent).toEqual([true, false, true]);
  });

  it("the window is measured from the last ON, not from the last keystroke", () => {
    const { sent, sender } = makeSender();
    sender.onInput(0, true);
    sender.onInput(2000, true);
    sender.onInput(2900, true);
    sender.onInput(3049, true);
    expect(sent).toEqual([true]);
    sender.onInput(3050, true); // 3050 after the ON at 0, not 3050 after 3049
    expect(sent).toEqual([true, true]);
  });

  it("empty input while not typing sends nothing", () => {
    const { sent, sender } = makeSender();
    sender.onInput(0, false);
    sender.onInput(10, false);
    expect(sent).toEqual([]);
  });

  it("clearing the input sends exactly one OFF", () => {
    const { sent, sender } = makeSender();
    sender.onInput(0, true);
    sender.onInput(100, false);
    sender.onInput(200, false);
    expect(sent).toEqual([true, false]);
  });

  it("stop() sends exactly one OFF, and nothing when not typing", () => {
    const { sent, sender } = makeSender();
    sender.stop(); // never typed
    expect(sent).toEqual([]);
    sender.onInput(0, true);
    sender.stop();
    sender.stop();
    expect(sent).toEqual([true, false]);
    sender.onInput(100, false); // already stopped: no second OFF
    expect(sent).toEqual([true, false]);
  });

  it("after stop() a fresh keystroke turns ON again once the window allows it", () => {
    const { sent, sender } = makeSender();
    sender.onInput(0, true);
    sender.stop();
    sender.onInput(10_000, true);
    expect(sent).toEqual([true, false, true]);
    sender.stop();
    expect(sent).toEqual([true, false, true, false]);
  });

  it("honours an explicit interval", () => {
    const { sent, sender } = makeSender(1000);
    sender.onInput(0, true);
    sender.onInput(999, true);
    expect(sent).toEqual([true]);
    sender.onInput(1000, true);
    expect(sent).toEqual([true, true]);
  });
});

describe("TypingRegistry", () => {
  it("registry expires TYPING_TTL_MS after the last ON — sender vanished (Review Focus 5)", () => {
    const r = new TypingRegistry();
    r.set("a", 0);
    expect(r.isTyping("a", TYPING_TTL_MS - 1)).toBe(true);
    expect(r.isTyping("a", TYPING_TTL_MS)).toBe(false);
  });

  it("a fresh ON restarts the TTL (the heartbeat keeps the indicator up)", () => {
    const r = new TypingRegistry();
    r.set("a", 0);
    r.set("a", 3050);
    expect(r.isTyping("a", TYPING_TTL_MS + 1000)).toBe(true);
    expect(r.isTyping("a", 3050 + TYPING_TTL_MS - 1)).toBe(true);
    expect(r.isTyping("a", 3050 + TYPING_TTL_MS)).toBe(false);
  });

  it("an unknown sid is not typing", () => {
    const r = new TypingRegistry();
    expect(r.isTyping("nobody", 0)).toBe(false);
  });

  it("remove() clears at once (chat received or avatar left)", () => {
    const r = new TypingRegistry();
    r.set("a", 0);
    r.set("b", 0);
    r.remove("a");
    expect(r.isTyping("a", 1)).toBe(false);
    expect(r.isTyping("b", 1)).toBe(true);
    r.remove("nobody"); // harmless
    expect(r.isTyping("b", 1)).toBe(true);
  });

  it("clear() on teardown drops everyone", () => {
    const r = new TypingRegistry();
    r.set("a", 0);
    r.set("b", 0);
    r.clear();
    expect(r.isTyping("a", 1)).toBe(false);
    expect(r.isTyping("b", 1)).toBe(false);
    expect(r.snapshot(1)).toEqual([]);
  });

  it("an expired entry stays gone even if asked at an earlier time later", () => {
    const r = new TypingRegistry();
    r.set("a", 0);
    expect(r.isTyping("a", TYPING_TTL_MS)).toBe(false); // expired and dropped
    expect(r.isTyping("a", 1)).toBe(false);
  });

  it("snapshot lists only the sids still typing at `now`", () => {
    const r = new TypingRegistry();
    r.set("old", 0);
    r.set("new", 4000);
    expect(r.snapshot(TYPING_TTL_MS - 1).sort()).toEqual(["new", "old"]);
    expect(r.snapshot(TYPING_TTL_MS)).toEqual(["new"]);
    expect(r.snapshot(4000 + TYPING_TTL_MS)).toEqual([]);
  });
});
