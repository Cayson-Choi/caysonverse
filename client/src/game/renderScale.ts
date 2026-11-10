/**
 * The render scale the frame is being drawn at (perf/interaction-latency): the rich tier's post chain draws the scene into
 * a part of its target when the frame governor has stepped down (postChain.ts `setScale`), and stretches it over the screen.
 * A size given in screen pixels (a PointsMaterial without size attenuation: the village's stars) has to shrink with it, or
 * it would come out larger by the stretch; it reads this in its onBeforeRender. 1 outside the post chain's scene pass (the
 * light tier; the shadow map's own targets are not stretched).
 */
let scale = 1;

export function renderScale(): number {
  return scale;
}

export function setRenderScale(s: number): void {
  scale = s;
}
