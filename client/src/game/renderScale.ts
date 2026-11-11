/**
 * The render scale the frame is being drawn at (perf/interaction-latency): the rich tier's post chain draws the scene into
 * a part of its target when the frame governor has stepped down (postChain.ts `setScale`), and stretches it over the screen.
 * A size given in screen pixels (a PointsMaterial without size attenuation: the village's stars) has to shrink with it, or
 * it would come out larger by the stretch; it reads this in its onBeforeRender. 1 outside the post chain's scene pass (the
 * light tier; the shadow map's own targets are not stretched).
 */
let scale = 1;
let interactionPressureUntil = -Infinity;

/** Keep the next few frames cheap after an input starts. This is deliberately a module scalar: pointer/keyboard
 * handlers can set it without a React render, while the post chain applies the scale at the next frame boundary. */
export function noteInteraction(now = typeof performance === "undefined" ? 0 : performance.now()): void {
  interactionPressureUntil = Math.max(interactionPressureUntil, now + 1200);
}

export function interactionPressureActive(now = typeof performance === "undefined" ? 0 : performance.now()): boolean {
  return now < interactionPressureUntil;
}

/** Test helper; production input paths never need to clear the pressure explicitly. */
export function resetInteractionPressure(): void {
  interactionPressureUntil = -Infinity;
}

export function renderScale(): number {
  return scale;
}

export function setRenderScale(s: number): void {
  scale = s;
}
