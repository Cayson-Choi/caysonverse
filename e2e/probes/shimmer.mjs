/**
 * Shimmer measure: per view, N frames while the camera creeps a millimetre or two per frame (a fraction of a pixel on screen). A sound
 * surface barely changes between such frames; z-fighting and under-filtered textures jump. tools/analyze-flicker.py turns the frames into a
 * number and a heat map per view.
 *   node e2e/probe.mjs e2e/probes/shimmer.mjs <out> desktop <time> -- <views.json> <tag>
 * views.json: [{ name, park?, cam:[x,y,z], look:[x,y,z], fov?, step?: metres per frame (default 0.002) }]
 */
import { readFileSync } from "node:fs";

export default async ({ P, DEV, args, enterPark, hideHud, cam, shot, sleep }) => {
  const [viewsFile, TAG] = args;
  const views = JSON.parse(readFileSync(viewsFile, "utf8"));
  const N = 10;
  for (const v of views) {
    if (v.park) await enterPark();
    await hideHud(true);
    const d = [v.look[0] - v.cam[0], v.look[1] - v.cam[1], v.look[2] - v.cam[2]];
    const l = Math.hypot(d[0], d[2]) || 1;
    const side = [d[2] / l, 0, -d[0] / l]; // the view's right
    const fwd = [d[0] / l, 0, d[2] / l];
    const step = v.step ?? 0.002;
    for (let i = 0; i < N; i++) {
      // creep sideways and a little forward (and down a hair): what walking past does
      const o = [side[0] * step * i + fwd[0] * step * 0.5 * i, -step * 0.2 * i, side[2] * step * i + fwd[2] * step * 0.5 * i];
      await cam([v.cam[0] + o[0], v.cam[1] + o[1], v.cam[2] + o[2]], [v.look[0] + o[0], v.look[1] + o[1], v.look[2] + o[2]], v.fov ?? 50);
      await sleep(i === 0 ? 2500 : 350);
      await shot(`${TAG}-${DEV}-${v.name}-${String(i).padStart(2, "0")}`);
    }
  }
};
