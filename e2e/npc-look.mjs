/**
 * e2e/npc-look.mjs — 마을 NPC 전용 모습(owner 2026-11-16): 광장 안내원, 추모관 안내, 버스 기사가 npc.glb의 전용 옷·동작으로
 * 그려지는지, 동작이 굳지 않았는지(뼈 회전이 시간에 따라 바뀌는지), 문의하기를 열면 인사하는지, 버스 기사가 운전석에 앉아 운전대를
 * 잡는지 본다. 보통 화면(게임 카메라)과 가까이 찍은 화면(같은 장면을 따로 둔 카메라로 한 번 그린 것)을 남긴다.
 *
 *   서버·클라이언트를 띄운 뒤: CV_CLIENT_URL=http://localhost:<포트> node e2e/npc-look.mjs --out=<폴더> [--time=<ISO>] [--phone] [--label=day]
 *   --ride  버스가 떠날 때까지 기다려 도는 동안의 기사(조향 무게)를 기록한다(서버를 CV_DEV_CLOCK_OFFSET_MS로 출발 직전에 맞춘다).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, press, sleep, turnCameraTo, waitIdle, walkAndWait, walkTo } from "./lib/common.mjs";
import { act as actRaw, enterHall, joinVillage, leaveHall } from "./lib/village.mjs";

/** The action (E / the round button); a missing button (nothing to do here) is not a failure — the checks after it say what happened. */
const act = (p) => actRaw(p).catch((e) => console.log("   (no action button: " + String(e).slice(0, 80) + ")"));

const args = process.argv.slice(2);
const opt = (n, fallback) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${fallback}`).slice(n.length + 3);
const phone = args.includes("--phone");
const ride = args.includes("--ride");
const label = opt("label", phone ? "phone" : "pc");
const time = opt("time", "2026-11-03T12:30");
const run = createRun("npc-look");
run.evidence = opt("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
run.allow("D3D X3595 (bloom shader, known)", /warning X3595: gradient instruction used in a loop/);

/** Draw the scene once from (eye → at) with the game's renderer into a PNG (the game camera is put back at once). */
async function closeUp(p, file, eye, at, fov = 30) {
  const data = await p.page.evaluate(
    ([eye, at, fov]) => {
      const { gl, scene, camera } = window.__cvThree();
      const saved = { p: camera.position.clone(), q: camera.quaternion.clone(), fov: camera.fov, near: camera.near };
      camera.position.set(eye[0], eye[1], eye[2]);
      camera.fov = fov;
      camera.near = 0.05;
      camera.updateProjectionMatrix();
      camera.lookAt(at[0], at[1], at[2]);
      camera.updateMatrixWorld(true);
      gl.render(scene, camera);
      const url = gl.domElement.toDataURL("image/png");
      camera.position.copy(saved.p);
      camera.quaternion.copy(saved.q);
      camera.fov = saved.fov;
      camera.near = saved.near;
      camera.updateProjectionMatrix();
      return url;
    },
    [eye, at, fov],
  );
  const { Buffer } = await import("node:buffer");
  writeFileSync(join(run.evidence, file), Buffer.from(data.split(",")[1], "base64"));
}

/** The world position of a point given in the bus model's frame. */
const busPoint = (p, local) =>
  p.page.evaluate((l) => {
    const root = window.__cvBus().root;
    root.updateWorldMatrix(true, false);
    const v = root.position.clone().set(l[0], l[1], l[2]);
    root.localToWorld(v);
    return [v.x, v.y, v.z];
  }, local);

/** Rotations (quaternion xyzw) of a few bones of the avatar under the object found by `pick` (page code string). */
const bonesOf = (p, which) =>
  p.page.evaluate((which) => {
    const { scene } = window.__cvThree();
    let root = null;
    if (which === "driver") {
      const bus = window.__cvBus?.().root;
      bus?.traverse((o) => {
        if (!root && o.isSkinnedMesh) root = o.skeleton;
      });
    } else {
      const [x, z] = which;
      scene.traverse((o) => {
        if (root || !o.isSkinnedMesh) return;
        const w = o.skeleton.bones[0].getWorldPosition(o.position.clone());
        if (Math.hypot(w.x - x, w.z - z) < 0.6) root = o.skeleton;
      });
    }
    if (!root) return null;
    const out = {};
    for (const b of root.bones) if (/^(upperarm|lowerarm|head|spine|chest|hand)/.test(b.name)) out[b.name] = b.quaternion.toArray().map((n) => Math.round(n * 1e4) / 1e4);
    return out;
  }, which);
const moved = (a, b) => {
  if (!a || !b) return 0;
  let m = 0;
  for (const k of Object.keys(a)) for (let i = 0; i < 4; i++) m = Math.max(m, Math.abs(a[k][i] - (b[k]?.[i] ?? a[k][i])));
  return m;
};
const avatars = (p) => p.page.evaluate(() => window.__cvAvatars?.() ?? {});

const browser = await launchBrowser();
const summary = { label, time };
try {
  const P = await openPlayer(browser, run, { tag: label, device: phone ? PHONE : DESKTOP, settings: { graphics: phone ? "low" : "high" } });
  await joinVillage(P, "npc", time);

  await run.step("the NPCs wear their own looks (npc.glb), not a player's", async () => {
    await P.page.waitForFunction(() => {
      const a = window.__cvAvatars?.() ?? {};
      return a["guide:plaza_guide"]?.parts?.includes("top__npc_guide") && a["npc:bus_driver"]?.parts?.includes("top__npc_driver");
    }, null, { timeout: 60000 });
    const a = await avatars(P);
    summary.avatars = a;
    run.check("plaza guide: red info vest, hat, clipboard", ["top__npc_guide", "hat__npc_guide_hat", "item__npc_clipboard", "bottom__pants"].every((n) => a["guide:plaza_guide"].parts.includes(n)), a["guide:plaza_guide"]);
    run.check("plaza guide plays its own idle", a["guide:plaza_guide"].clip === "Npc_Guide_Idle", a["guide:plaza_guide"].clip);
    run.check("bus driver: uniform, cap, seated driving clip", ["top__npc_driver", "hat__npc_driver_cap", "bottom__pants"].every((n) => a["npc:bus_driver"].parts.includes(n)) && a["npc:bus_driver"].clip === "Npc_Drive", a["npc:bus_driver"]);
    run.check("draw meshes within the avatar budget (8)", a["guide:plaza_guide"].drawMeshes <= 8 && a["npc:bus_driver"].drawMeshes <= 8, [a["guide:plaza_guide"].drawMeshes, a["npc:bus_driver"].drawMeshes]);
  });

  if (!ride) await run.step("plaza guide: normal view, close-ups, idle moves, greeting on 문의하기", async () => {
    await walkAndWait(P, 2.2, 15.2, 30000, 0.8);
    await turnCameraTo(P, 5, 12);
    await sleep(1200);
    await run.shot(P, `${label}-guide-normal.png`);
    await closeUp(P, `${label}-guide-close-front.png`, [5 - 2.6 * 0.6, 1.55, 12 + 2.6 * 0.8], [5, 1.15, 12], 34);
    await closeUp(P, `${label}-guide-close-back.png`, [5 + 2.2, 1.6, 12 - 2.2], [5, 1.1, 12], 36);
    const a = await bonesOf(P, [5, 12]);
    await sleep(1500);
    const b = await bonesOf(P, [5, 12]);
    run.check("the guide's idle moves (bones rotate over 1.5 s)", moved(a, b) > 0.005, moved(a, b));
    await walkAndWait(P, 5, 14.1, 20000, 0.6);
    await act(P);
    await sleep(500);
    // E picks the nearest thing to do; if it did not open the guide's questions, open them as the button would
    if (!(await P.page.evaluate(async () => (await window.__imp("/src/village/guideDialogStore.ts")).guideDialogOpen()))) {
      summary.guideOpenedByModule = true;
      await P.page.evaluate(async () => (await window.__imp("/src/village/guideDialogStore.ts")).openGuideDialog("plaza_guide"));
    }
    await sleep(500);
    const g = await avatars(P);
    run.check("문의하기 opens and the guide greets (Npc_Guide_Greet)", g["guide:plaza_guide"].clip === "Npc_Guide_Greet", g["guide:plaza_guide"].clip);
    await closeUp(P, `${label}-guide-greet.png`, [5 - 1.4, 1.6, 12 + 2.6], [5, 1.2, 12], 36);
    await sleep(2600);
    const g2 = await avatars(P);
    run.check("back to the idle after the greeting", g2["guide:plaza_guide"].clip === "Npc_Guide_Idle", g2["guide:plaza_guide"].clip);
    await P.page.evaluate(async () => (await window.__imp("/src/village/guideDialogStore.ts")).closeGuideDialog());
    await sleep(400);
  });

  await run.step("bus driver at the stop: seated at the wheel", async () => {
    const eyeFront = await busPoint(P, [-0.9, 2.1, -9.0]);
    const atFront = await busPoint(P, [-0.62, 1.55, -3.6]);
    await closeUp(P, `${label}-driver-front.png`, eyeFront, atFront, 26);
    const eyeSide = await busPoint(P, [-4.2, 2.0, -3.2]);
    const atSide = await busPoint(P, [-0.62, 1.4, -3.7]);
    await closeUp(P, `${label}-driver-window.png`, eyeSide, atSide, 34);
    const eyeIn = await busPoint(P, [0.5, 2.05, -1.6]);
    const atIn = await busPoint(P, [-0.62, 1.35, -3.6]);
    await closeUp(P, `${label}-driver-cabin.png`, eyeIn, atIn, 50);
    const eyeFar = await busPoint(P, [6, 3.0, -14]);
    const atFar = await busPoint(P, [0, 1.3, -1]);
    await closeUp(P, `${label}-driver-bus-normal.png`, eyeFar, atFar, 40);
    const a = await bonesOf(P, "driver");
    await sleep(1500);
    const b = await bonesOf(P, "driver");
    run.check("the driver's arms/head move (steering, mirror glances)", moved(a, b) > 0.003, moved(a, b));
  });

  if (ride) {
    await run.step("the bus drives: the driver steers with the turns", async () => {
      const log = [];
      const t0 = Date.now();
      let shots = 0;
      while (Date.now() - t0 < 200000) {
        const s = await P.page.evaluate(async () => {
          const ts = await window.__imp("/src/net/transitSync.ts");
          const pose = ts.getTransitRenderPose();
          const bus = window.__cvBus?.().root;
          let wheel = null;
          bus?.traverse((o) => {
            if (o.name === "bus_steering_wheel") wheel = o.quaternion.toArray().map((n) => Math.round(n * 1e4) / 1e4);
          });
          return { x: pose.x, z: pose.z, yaw: pose.yaw, wheel };
        });
        log.push({ t: Date.now() - t0, ...s });
        const n = log.length;
        if (n > 2 && Math.hypot(log[n - 1].x - log[n - 2].x, log[n - 1].z - log[n - 2].z) > 0.3 && shots < 6 && n % 4 === 0) {
          shots += 1;
          const eye = await busPoint(P, [-0.9, 2.3, -8.5]);
          const at = await busPoint(P, [-0.62, 1.5, -3.6]);
          await closeUp(P, `${label}-driver-driving-${shots}.png`, eye, at, 28);
        }
        await sleep(500);
      }
      summary.rideLog = log;
      const turns = log.filter((r) => r.wheel).map((r) => r.wheel);
      const spreadW = turns.length ? Math.max(...turns.map((q) => Math.abs(q[2] - turns[0][2]))) : 0;
      run.check("the steering wheel turned while the bus drove (v3 wheel node)", spreadW > 0.05, { samples: turns.length, spread: spreadW });
      run.check("the bus moved while watched", log.some((r, i) => i > 0 && Math.hypot(r.x - log[i - 1].x, r.z - log[i - 1].z) > 0.3), log.length);
    });
  }


  if (!phone && !ride) {
    await run.step("memorial hall desk: suit and ribbon, folded hands, bow on 문의하기", async () => {
      await enterHall(P);
      await P.page.waitForFunction(() => (window.__cvAvatars?.() ?? {})["guide:hall_desk"]?.parts?.includes("top__npc_memorial"), null, { timeout: 60000 });
      const a0 = await avatars(P);
      run.check("hall desk: black suit with the ribbon, own idle", a0["guide:hall_desk"].clip === "Npc_Memorial_Idle", a0["guide:hall_desk"]);
      await walkAndWait(P, 303.0, 4.6, 20000, 0.6);
      await turnCameraTo(P, 306.4, 4.6);
      await sleep(1200);
      await run.shot(P, `${label}-hall-normal.png`);
      await closeUp(P, `${label}-hall-close.png`, [303.9, 1.55, 5.4], [306.4, 1.1, 4.6], 34);
      await closeUp(P, `${label}-hall-close-chest.png`, [304.9, 1.35, 4.9], [306.4, 1.0, 4.6], 30);
      await act(P);
      await sleep(500);
      if (!(await P.page.evaluate(async () => (await window.__imp("/src/village/guideDialogStore.ts")).guideDialogOpen()))) {
        summary.hallOpenedByModule = true;
        await P.page.evaluate(async () => (await window.__imp("/src/village/guideDialogStore.ts")).openGuideDialog("hall_desk"));
      }
      await sleep(400);
      const a1 = await avatars(P);
      run.check("문의하기 opens and the hall desk bows (Npc_Memorial_Bow)", a1["guide:hall_desk"].clip === "Npc_Memorial_Bow", a1["guide:hall_desk"].clip);
      await closeUp(P, `${label}-hall-bow.png`, [303.9, 1.55, 5.4], [306.4, 1.0, 4.6], 34);
      await sleep(3200);
      const a2 = await avatars(P);
      run.check("back to the folded-hands idle", a2["guide:hall_desk"].clip === "Npc_Memorial_Idle", a2["guide:hall_desk"].clip);
      await P.page.evaluate(async () => (await window.__imp("/src/village/guideDialogStore.ts")).closeGuideDialog());
      await leaveHall(P);
    });
  }
  if (!ride) await run.step("lake rental shopkeeper: behind the window, idle, waves when I step on the pad and when a rod is rented", async () => {
    if (!phone) for (const [x, z] of [[0, -33], [-14, -20], [-20, 5], [2, 15]]) await walkAndWait(P, x, z, 60000, 1.5);
    for (const [x, z] of [[30, 12], [46, 9], [62, 2], [80, -9], [100, -12]]) await walkAndWait(P, x, z, 60000, 2);
    await P.page.waitForFunction(() => (window.__cvAvatars?.() ?? {})["npc:lake_shopkeeper"]?.parts?.includes("top__npc_shopkeeper"), null, { timeout: 90000 });
    await sleep(1500);
    const a0 = await avatars(P);
    run.check("shopkeeper: fishing vest, bucket hat, own idle", a0["npc:lake_shopkeeper"].parts.includes("hat__npc_shop_hat") && a0["npc:lake_shopkeeper"].clip === "Npc_Shop_Idle", a0["npc:lake_shopkeeper"]);
    await turnCameraTo(P, 102, -20.9);
    await sleep(1000);
    await run.shot(P, `${label}-shop-normal.png`);
    await closeUp(P, `${label}-shop-close.png`, [101.2, 2.0, -16.6], [102, 1.55, -20.9], 34);
    await closeUp(P, `${label}-shop-wide.png`, [98.5, 3.0, -11.5], [102, 1.4, -20.5], 40);
    const b0 = await bonesOf(P, [102, -20.9]);
    await sleep(1500);
    const b1 = await bonesOf(P, [102, -20.9]);
    run.check("the shopkeeper's idle moves", moved(b0, b1) > 0.003, moved(b0, b1));
    const waved = () =>
      P.page.waitForFunction(() => (window.__cvAvatars?.() ?? {})["npc:lake_shopkeeper"]?.clip === "Npc_Shop_Wave", null, { timeout: 8000 }).then(() => true, () => false);
    await walkTo(P, 102, -16.8);
    const w1 = await waved();
    run.check("stepping onto the rental pad: the shopkeeper waves", w1, (await avatars(P))["npc:lake_shopkeeper"].clip);
    await closeUp(P, `${label}-shop-wave.png`, [101.2, 2.0, -16.4], [102, 1.6, -20.9], 34);
    await waitIdle(P);
    await sleep(6500);
    await act(P); // rent a rod
    const w2 = await waved();
    const rod = await P.page.evaluate(async () => {
      const n = await window.__imp("/src/lake/lakeNet.ts");
      const v = { rod: 0 };
      n.readFishView(n.selfId(), v);
      return v.rod;
    });
    run.check("renting a rod: the shopkeeper waves again", w2 && rod > 0, { waved: w2, rod });
    await sleep(3000);
    const a3 = await avatars(P);
    run.check("back to the idle", a3["npc:lake_shopkeeper"].clip === "Npc_Shop_Idle", a3["npc:lake_shopkeeper"].clip);
    for (const [x, z] of [[100, -12], [80, -9], [40, 0], [0, 10]]) await walkAndWait(P, x, z, 60000, 2);
  });

} finally {
  writeFileSync(join(run.evidence, `${label}-summary.json`), JSON.stringify(summary, null, 2));
  const code = run.finish();
  await browser.close();
  process.exit(code);
}
