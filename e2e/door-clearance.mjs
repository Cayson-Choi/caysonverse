/**
 * e2e/door-clearance.mjs — 자동문이 주위 물건과 겹치지 않는지 사진으로 본다 (owner 2026-11-17: "자동문이 주위의 물체와
 * 겹치잖아 제발 좀 꼼꼼하게 확인해").
 *
 * 추모관 안의 유리 자동문(memorial.glb `door__leaf_l/_r`, PublicAutoDoor.tsx가 민다)과 마을 쪽 추모관 입구 자동문(PublicAutoDoor
 * 마을 쪽)을 닫힘·반쯤·활짝 열림으로 고정하고(`autoDoorHold`), 안·밖·문짝 양옆 가까이에서 찍는다. 낮과 밤, PC(1280x800)와
 * 폰(375x812). 사진 말고도 열린 문짝의 상자와 그 자리의 다른 메시 상자를 장면에서 직접 재서 `overlaps`로 남긴다.
 *
 *   CV_CLIENT_URL=http://localhost:5696 node e2e/door-clearance.mjs [--out=<폴더>] [--devices=pc,phone] [--times=day,night] [--areas=hall,village]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { enterHall, hideHud, joinVillage, leaveHall } from "./lib/village.mjs";

const run = createRun("door-clearance");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
run.evidence = opt("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
const DEVICES = opt("devices", "pc,phone").split(",");
const TIMES = opt("times", "day,night").split(",");
const AREAS = opt("areas", "hall,village").split(",");
const TIME_OF = { day: "2026-11-03T12:30", night: "2026-11-03T22:30" };
const AMOUNTS = [0, 0.5, 1];

/** Fixed views per door: [name, camera, target]. */
const VIEWS = {
  hall: [
    ["in-wide", [300, 1.65, 1.6], [300, 1.35, 6]],
    ["in-left", [298.1, 1.55, 3.9], [298.7, 1.3, 6]],
    ["in-right", [301.9, 1.55, 3.9], [301.3, 1.3, 6]],
    ["in-left-side", [296.2, 1.4, 5.0], [299.0, 1.3, 6.0]],
    ["in-right-side", [303.8, 1.4, 5.0], [301.0, 1.3, 6.0]],
    ["out", [300, 1.6, 9.2], [300, 1.35, 6]],
  ],
  village: [
    ["out-wide", [0, 1.65, -46.2], [0, 1.6, -52]],
    ["out-left", [-2.4, 1.5, -48.6], [-1.2, 1.4, -52]],
    ["out-right", [2.4, 1.5, -48.6], [1.2, 1.4, -52]],
    ["out-side", [-4.4, 1.4, -50.6], [-1, 1.4, -52]],
  ],
};

/** Hold every auto door at `amount` (null: back to the live state machine). */
const hold = (p, amount) =>
  p.page.evaluate(async (a) => {
    (await window.__imp("/src/village/PublicAutoDoor.tsx")).autoDoorHold.amount = a;
  }, amount);

/** Draw the scene from a camera of our own and return a PNG (the frame is read in the same task as it is drawn). */
const shoot = (p, eye, at, file) =>
  p.page
    .evaluate(
      ([eye, at]) => {
        const { gl, scene, camera } = window.__cvThree();
        const cam = camera.clone();
        cam.position.set(...eye);
        cam.up.set(0, 1, 0);
        cam.lookAt(...at);
        cam.fov = 62;
        cam.aspect = gl.domElement.width / gl.domElement.height;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
        scene.updateMatrixWorld(true);
        gl.render(scene, cam);
        return gl.domElement.toDataURL("image/png");
      },
      [eye, at],
    )
    .then((url) => writeFileSync(file, Buffer.from(url.split(",")[1], "base64")));

/**
 * In the scene: the world boxes of each door leaf (the meshes under it) and of every other visible mesh near the door
 * whose box crosses a leaf's box. Merged meshes (the room's baked shell) are skipped by size: they are checked by
 * triangles in the vitest (doorClearance.test.ts).
 */
const overlaps = (p, area) =>
  p.page.evaluate((area) => {
    const { scene } = window.__cvThree();
    scene.updateMatrixWorld(true);
    const leaves = [];
    scene.traverse((o) => {
      if (/^door__leaf_[lr]$/.test(o.name) || /^auto_door_leaf_[lr]$/.test(o.name)) leaves.push(o);
    });
    const leafMeshes = new Set();
    for (const l of leaves) l.traverse((m) => leafMeshes.add(m));
    const box = (o) => {
      const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
      o.updateMatrixWorld(true);
      o.traverse((m) => {
        if (!m.isMesh || !m.visible) return;
        m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox;
        for (const x of [bb.min.x, bb.max.x])
          for (const y of [bb.min.y, bb.max.y])
            for (const z of [bb.min.z, bb.max.z]) {
              const v = m.localToWorld(bb.min.clone().set(x, y, z));
              for (const [k, c] of ["x", "y", "z"].entries()) {
                b.min[k] = Math.min(b.min[k], v[c]);
                b.max[k] = Math.max(b.max[k], v[c]);
              }
            }
      });
      return b;
    };
    const hit = (a, b) => [0, 1, 2].every((k) => a.min[k] < b.max[k] - 0.002 && b.min[k] < a.max[k] - 0.002);
    const out = { leaves: leaves.map((l) => ({ name: l.name, ...box(l) })), hits: [] };
    scene.traverse((m) => {
      if (!m.isMesh || !m.visible || leafMeshes.has(m) || m.isInstancedMesh) return;
      let anc = m;
      while (anc && !/^(public_auto_door__|auto_door__)/.test(anc.name || "")) anc = anc.parent;
      if (anc) return; // the door's own frame, header, track
      const b = box(m);
      const size = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
      if (size > 4) return; // the baked shell: by triangles in the vitest
      for (const l of out.leaves) if (hit(l, b)) out.hits.push({ leaf: l.name, mesh: m.name, box: b });
    });
    return out;
  }, area);

const browser = await launchBrowser();
const report = [];
try {
  for (const dev of DEVICES) {
    for (const time of TIMES) {
      const p = await openPlayer(browser, run, { tag: `${dev}-${time}`, device: dev === "phone" ? PHONE : DESKTOP });
      await joinVillage(p, "door", TIME_OF[time]);
      for (const area of AREAS) {
        if (area === "hall") {
          await enterHall(p);
          // out of every fixed view (behind the cameras), by the way the visitor came in
          await walkAndWait(p, 300, 1.5, 15000, 0.6);
          await walkAndWait(p, 302.6, 0.5, 15000, 0.6);
        } else {
          if (AREAS.includes("hall")) await leaveHall(p);
          await walkAndWait(p, 0, -44, 40000, 1.2);
        }
        await sleep(1500);
        await hideHud(p);
        for (const amount of AMOUNTS) {
          await hold(p, amount);
          await sleep(400);
          for (const [name, eye, at] of VIEWS[area]) {
            const file = join(run.evidence, `${dev}-${time}-${area}-${name}-open${Math.round(amount * 100)}.png`);
            await shoot(p, eye, at, file);
          }
          const o = await overlaps(p, area);
          report.push({ dev, time, area, amount, leaves: o.leaves, hits: o.hits });
          run.check(`${dev} ${time} ${area} open ${amount}: no small mesh inside a leaf's box`, o.hits.length === 0, o.hits);
        }
        // the live door with the player walking through it (the follow camera's own view)
        await hold(p, null);
        if (area === "hall") {
          await walkAndWait(p, 300, 1.5, 15000, 0.6);
          await walkAndWait(p, 300, 3.2, 15000, 0.5);
          await walkAndWait(p, 300, 4.9, 15000, 0.5);
        } else {
          await walkAndWait(p, 0, -50.6, 30000, 0.6);
        }
        if (area === "hall") await turnCameraTo(p, 300, 6.5);
        else await turnCameraTo(p, 0, -53);
        await sleep(1200);
        await p.page.screenshot({ path: join(run.evidence, `${dev}-${time}-${area}-live-open.png`) });
      }
      await p.ctx.close();
    }
  }
} finally {
  writeFileSync(join(run.evidence, "overlaps.json"), JSON.stringify(report, null, 1));
  await browser.close();
}
process.exitCode = run.finish();
