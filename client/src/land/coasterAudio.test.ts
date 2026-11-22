import { describe, expect, it } from "vitest";
import { rideMuted, setRideMuted } from "./coasterAudio";
import { useSoundStore } from "../stores/soundStore";

describe("the rides' sound follows the menu's master 소리 switch", () => {
  it("rideMuted is true when either the ride panel's own mute or the master switch is on", () => {
    setRideMuted(false);
    useSoundStore.setState({ muted: false });
    expect(rideMuted()).toBe(false);
    useSoundStore.setState({ muted: true });
    expect(rideMuted()).toBe(true); // master off: every ride sound is silent
    useSoundStore.setState({ muted: false });
    setRideMuted(true);
    expect(rideMuted()).toBe(true); // the panel's own button still works
    setRideMuted(false);
    expect(rideMuted()).toBe(false);
  });
});
