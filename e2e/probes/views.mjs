/**
 * Photos from a list of fixed cameras, with the frame's draw calls / triangles next to them.
 *   node e2e/probe.mjs e2e/probes/views.mjs <out> desktop <time> -- <views.json> <tag>
 * views.json: [{ name, park?, walk?: [x, z], cam: [x, y, z], look: [x, y, z], fov?, wait?, rig?: true (no fixed camera: the player's own view) }]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default async ({ P, OUT, DEV, args, enterPark, leavePark, goTo, areaOf, hideHud, cam, shot, stats, sleep }) => {
  const [viewsFile, TAG] = args;
  const views = JSON.parse(readFileSync(viewsFile, "utf8"));
  const all = {};
  for (const v of views) {
    if (v.park) await enterPark();
    else if ((await areaOf()) === "park") await leavePark();
    if (v.walk) {
      await cam(null);
      await goTo(v.walk[0], v.walk[1]);
    }
    await hideHud(!v.hud);
    await cam(v.rig ? null : v.cam, v.look, v.fov ?? 50);
    await sleep(v.wait ?? 2500);
    all[v.name] = await stats();
    await shot(`${TAG}-${DEV}-${v.name}`);
    console.log(v.name, JSON.stringify(all[v.name]));
  }
  writeFileSync(join(OUT, `${TAG}-${DEV}-stats.json`), JSON.stringify(all, null, 1));
};
