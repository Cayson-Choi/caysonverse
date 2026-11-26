/**
 * The gate from both sides, in pairs at the same distance (owner 2026-11-21: "들어가기전에 입구를 바라본 이미지와 들어간 후에 입구를 바라본
 * 이미지가 일치하도록"): from the village looking in, then - through the gate - from the park looking back.
 *   node e2e/probe.mjs e2e/probes/gate-pair.mjs <out> desktop|phone <time> -- <tag>
 * Checks that the park draws the village's gatehouse (the same objects) and not a gate of its own.
 */
const VILLAGE_GATE = [-24, 94];
const PARK_GATE = [40, -186.5];
const DIST = [28, 14, 7];

export default async ({ P, run, DEV, args, enterPark, hideHud, cam, shot, sleep }) => {
  const [TAG] = args;
  await hideHud(true);
  await cam([-24, 2.2, 78], [-24, 4, 94], 55);
  await sleep(6000);
  await P.page.waitForFunction(() => {
    let lot = false, wall = false;
    window.__cvThree().scene.traverse((o) => { if (o.name === "lotdetail__lot_gate") lot = true; if (o.name === "castle_wall") wall = true; });
    return lot && wall;
  }, null, { timeout: 180000 });
  await sleep(4000);
  for (const d of DIST) {
    await cam([VILLAGE_GATE[0], 1.7, VILLAGE_GATE[1] - d], [VILLAGE_GATE[0], 1.7 + d * 0.16, VILLAGE_GATE[1]], 60);
    await sleep(3000);
    await shot(`${TAG}-${DEV}-village-${d}`);
  }
  // a step to the side: the park behind the arch must move as a place does
  await cam([VILLAGE_GATE[0] + 4, 1.7, VILLAGE_GATE[1] - 12], [VILLAGE_GATE[0] - 1, 2.6, VILLAGE_GATE[1]], 60);
  await sleep(2500);
  await shot(`${TAG}-${DEV}-village-side`);
  const portal = await P.page.evaluate(() => { let f = false; window.__cvThree().scene.traverse((o) => { if (o.name === "village_park_portal") f = true; }); return f; });
  run.check("the village's gateway shows the real park (the portal is mounted)", portal);
  await cam(null);
  await enterPark();
  await hideHud(true);
  await P.page.waitForFunction(() => { let n = 0; window.__cvThree().scene.traverse((o) => { if (o.name === "park_gate_lot") n = o.children.length; }); return n > 3; }, null, { timeout: 180000 });
  await sleep(3000);
  const names = await P.page.evaluate(() => { let c = []; window.__cvThree().scene.traverse((o) => { if (o.name === "park_gate_lot") c = o.children.map((x) => x.name); }); return c; });
  run.check("the park's gate is the village's gatehouse (its detail, leaves, dressing)", ["lotdetail__lot_gate", "gate_far_dress", "door__lot_gate_main"].every((n) => names.includes(n)), names.slice(0, 12));
  for (const d of DIST) {
    await cam([PARK_GATE[0], 1.7, PARK_GATE[1] + d], [PARK_GATE[0], 1.7 + d * 0.16, PARK_GATE[1]], 60);
    await sleep(3000);
    await shot(`${TAG}-${DEV}-park-${d}`);
  }
  await cam([PARK_GATE[0] - 4, 1.7, PARK_GATE[1] + 12], [PARK_GATE[0] + 1, 2.6, PARK_GATE[1]], 60);
  await sleep(2500);
  await shot(`${TAG}-${DEV}-park-side`);
};
