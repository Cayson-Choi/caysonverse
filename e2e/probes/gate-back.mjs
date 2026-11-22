/**
 * The village gatehouse seen from BEHIND (the park's side), the castle wall and the park's stand-in taken away: what the gate's own model
 * holds on its back.   node e2e/probe.mjs e2e/probes/gate-back.mjs <out> desktop <time> -- <tag>
 */
export default async ({ P, args, hideHud, cam, shot, sleep }) => {
  const [TAG] = args;
  await hideHud(true);
  await cam([-24, 2.2, 78], [-24, 4, 94], 55);
  await sleep(6000);
  await P.page.waitForFunction(() => {
    let lot = false, wall = false;
    window.__cvThree().scene.traverse((o) => { if (o.name === "lotdetail__lot_gate") lot = true; if (o.name === "castle_wall") wall = true; });
    return lot && wall;
  }, null, { timeout: 180000 });
  await sleep(3000);
  await P.page.evaluate(() => {
    const { scene } = window.__cvThree();
    const gone = [];
    scene.traverse((o) => { if (o.name === "castle_wall" || o.name === "park_skyline") gone.push(o); });
    for (const o of gone) o.removeFromParent();
    const V = scene.position.constructor;
    // the ground behind the gate rises: cut it away above the gate's floor so the back can be seen
    scene.traverse((o) => { if (/outer|ground/i.test(o.name) && o.isMesh) o.visible = false; });
    void V;
  });
  for (const [name, c, l, fov] of [
    ["back", [-24, 3, 112], [-24, 5, 95], 60],
    ["backL", [-36, 3, 106], [-28, 4, 95], 55],
    ["backNear", [-24, 1.7, 101], [-24, 3, 95], 65],
    ["backHigh", [-24, 14, 112], [-24, 5, 95], 55],
  ]) {
    await cam(c, l, fov);
    await sleep(2500);
    await shot(`${TAG}-${name}`);
  }
};
