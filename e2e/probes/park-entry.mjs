/**
 * Entering 케이슨랜드: the avatar and the camera must look INTO the park (owner 2026-11-21), in third and in first person, and turning
 * round one sees the village through the arch. No photo camera: the player's own view.
 *   node e2e/probe.mjs e2e/probes/park-entry.mjs <out> desktop|phone <time> -- <tag>
 * Checks: the avatar's facing and the camera's view direction both point south (+z, away from the arch) on arrival.
 */
export default async ({ P, run, DEV, args, enterPark, hideHud, shot, cam, sleep }) => {
  const [TAG] = args;
  await enterPark();
  await sleep(2500);
  const read = () =>
    P.page.evaluate(async () => {
      const { camera } = window.__cvThree();
      const V = camera.position.constructor;
      const d = new V();
      camera.getWorldDirection(d);
      const p = window.__cv.getPos();
      return { pos: p, yaw: p.yaw ?? null, camDir: [d.x, d.y, d.z], cam: camera.position.toArray(), mode: (await window.__imp("/src/game/viewState.ts")).viewState.mode };
    });
  const a = await read();
  console.log("arrival", JSON.stringify(a));
  run.check("arrives at the park's arrival spot", Math.hypot(a.pos.x - 40, a.pos.z + 171) < 3, a.pos);
  if (a.yaw !== null) run.check("the avatar faces into the park (+z), not back at the arch", Math.cos(a.yaw) > 0.9, a.yaw);
  run.check("the camera looks into the park (+z)", a.camDir[2] > 0.7, a.camDir);
  await hideHud(true);
  await shot(`${TAG}-${DEV}-entry-tp`);
  // first person
  await hideHud(false);
  await P.page.evaluate(async () => {
    const vs = await window.__imp("/src/game/viewState.ts");
    vs.toggleViewMode(window.__cv.getOrbit());
  });
  await sleep(2500);
  const b = await read();
  console.log("first person", JSON.stringify(b));
  run.check("first person: the eye looks into the park (+z)", b.camDir[2] > 0.7, b.camDir);
  await hideHud(true);
  await shot(`${TAG}-${DEV}-entry-fp`);
  // turned round at the arrival spot: the village through the arch (the photo camera at the eye, looking north)
  await cam([40, 1.7, -171], [40, 2.6, -190], 60);
  await sleep(2500);
  await shot(`${TAG}-${DEV}-back`);
  await cam([34, 1.7, -160], [42, 2.6, -190], 60);
  await sleep(2000);
  await shot(`${TAG}-${DEV}-back-side`);
  await cam([40, 1.7, -178], [40, 2.6, -190], 70);
  await sleep(2000);
  await shot(`${TAG}-${DEV}-back-near`);
  await cam([60, 1.7, -120], [40, 3, -190], 40);
  await sleep(2000);
  await shot(`${TAG}-${DEV}-back-far`);
};
