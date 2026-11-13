/**
 * e2e/tree-vegetation-smoke.mjs — 케이슨 마을 나무 점검 (2026-11-13). 휴대폰(graphics low)과 PC(graphics high)로 입장해서:
 *  - 나무마다 3D 수관이 다시 자랐는지(종류별 그루 수), 끝이 빈 잔가지 0, 가지 없는 잎 0(window.__cvVeg().connection),
 *    인스턴스 나무 밑동에 덩어리가 없는지(originBlobs 0);
 *  - 잎 가지의 밑동과 꽃송이의 꽃자루가 화면에 그려진 잔가지·껍질 삼각형에서 5 cm 안에 있는지(window.__cvVegDrawn():
 *    이 화질에서 실제로 만든 잔가지 메시와 마을 파일의 껍질로 잰다. 휴대폰의 단순화된 잔가지도 그대로);
 *  - 입장 직후 식생이 준비되기 전에도 옛 평면 잎·꽃 카드와 광장 느티나무가 보이지 않는지;
 *  - 옛 평면 잎 카드가 남지 않았는지(잎 메시의 카드 삼각형, 인스턴스 잎 메시, 벚꽃은 떨어진 꽃잎만 남음), 광장 느티나무가 없어졌는지,
 *    뒷산 숲(inst__far_*)의 카드는 그대로 보이는지;
 *  - 새 메시들의 경계 구(bounding sphere)가 비어 있지 않은지(절두체 컬링으로 사라지는 일 없음);
 *  - 가로수 밑에 카메라를 두면 그 나무가 가장 가까운 단계(3D 잎 가지)로 그려지는지.
 *
 *   서버  (server/)  PORT=<p> npx tsx src/index.ts
 *   클라  (client/)  VITE_SERVER_URL=http://localhost:<p> npx vite --port <q> --strictPort
 *   CV_CLIENT_URL=http://localhost:<q> node e2e/tree-vegetation-smoke.mjs
 */
import { mkdirSync } from "node:fs";
import { createRun, DESKTOP, entryReady, launchBrowser, openPlayer, PHONE, press, CLIENT_URL, sleep } from "./lib/escape.mjs";

const run = createRun("tree-vegetation-smoke");
run.allow("D3D X3595 (bloom shader, known)", /warning X3595: gradient instruction used in a loop/);
mkdirSync(run.evidence, { recursive: true });
const EXPECT_TREES = { plaza_cherry: 6, village_cherry: 11, street_cherry: 12, orchard: 36, village_green: 16, street_green: 19, young: 10, willow: 4 };
const browser = await launchBrowser();

async function check(tag, device, graphics) {
  const player = await openPlayer(browser, run, { tag, device, settings: { graphics } });
  await run.step(`${tag}: 입장`, async () => {
    await player.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded" });
    await entryReady(player);
    await player.page.locator("input.cv-input").first().fill(`나무${tag.slice(0, 2)}`);
    await press(player, player.page.locator(".cv-submit"));
    await player.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
    // until the 3D vegetation is ready: no old flat foliage card shows and the plaza zelkova is already gone (the
    // arrival hides them at once; a cancelled first build must not give them back)
    const early = { samples: 0, legacy: [], zelkova: 0 };
    for (let i = 0; i < 900; i++) {
      const r = await player.page.evaluate(() => {
        const v = window.__cvVillage?.();
        if (!v) return null;
        const out = { legacy: [], deck: false, ready: !!window.__cvVeg?.() };
        v.root.traverse((o) => {
          if (!o.isMesh || o.name.startsWith("inst__far_")) return;
          let vis = true;
          for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
          if (!vis) return;
          const names = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => m?.name);
          if (o.name === "zelkova_deck_top") out.deck = true;
          // before the build is done, every foliage mesh of the file is hidden (after it, the petals come back)
          if (!out.ready && names.some((n) => /^M_leaf_(green|cherry)$/.test(n))) out.legacy.push(o.name);
        });
        return out;
      });
      if (r) {
        early.samples++;
        early.legacy.push(...r.legacy);
        if (!r.deck) early.zelkova++;
        if (r.ready) break;
      }
      await sleep(100);
    }
    run.check("입장 직후(식생 준비 전)에 옛 평면 잎·꽃 카드가 보이지 않는다", early.samples > 0 && early.legacy.length === 0, early);
    run.check("입장 직후부터 광장 느티나무가 없다", early.samples > 0 && early.zelkova === 0, early);
    await player.page.waitForFunction(() => typeof window.__cvVeg === "function" && window.__cvVeg() !== null && !!window.__cvThree?.(), null, { timeout: 90000 });
  });
  await run.step(`${tag}: 수관과 연결`, async () => {
    const s = await player.page.evaluate(() => window.__cvVeg());
    for (const [kind, n] of Object.entries(EXPECT_TREES)) run.check(`${kind}: ${n}그루`, s.trees[kind]?.trees === n, s.trees[kind]);
    for (const [kind, k] of Object.entries(s.trees)) run.check(`${kind}: 잎·꽃송이와 잔가지가 있다`, k.clusters > k.trees * 150 && k.twigs > k.trees * 40, k);
    const c = s.connection;
    run.check("잎·꽃송이 5만 개 이상을 검사했다", c.clusters > 50000, c.clusters);
    // (c.maxGap is measured on the line each cluster was placed on: it cannot fail. The gap that counts is measured
    // below, on the drawn twig and bark triangles.)
    run.check("끝이 허공에서 끝나는 잔가지가 없다", c.bareTips === 0, c.bareTips);
    run.check("가지 없는 잎·꽃송이가 없다", c.unattached === 0, c.unattached);
    run.check("인스턴스 나무 밑동에 잎 덩어리가 없다", s.originBlobs === 0, s.originBlobs);
    run.check("관목 100그루 이상이 3D 덤불", s.bushes >= 100, s.bushes);
    run.check("녹색 잎 카드 4700장 이상 숨김", s.hiddenCards.green >= 4700, s.hiddenCards);
    run.check("벚꽃 수관 카드 7500장 이상 숨김", s.hiddenCards.cherry >= 7500, s.hiddenCards);
    run.check("가로수·관목 인스턴스 잎 카드 숨김", ["inst__street_green_1", "inst__shrub_0"].every((n) => s.hiddenInstanced.includes(n)), s.hiddenInstanced);
    run.check("가로 벚나무·과수원은 떨어진 꽃잎만", ["inst__street_cherry_1", "inst__orchard_1"].every((n) => s.petalInstanced.includes(n)), s.petalInstanced);
    run.check("광장 느티나무 껍질 삼각형을 걷어냈다", s.zelkovaBarkTris > 300, s.zelkovaBarkTris);
  });
  await run.step(`${tag}: 그려진 잔가지·껍질과 잎의 간격`, async () => {
    // every leaf spray's stem foot and blossom bunch's spur against the triangles on screen: the twig meshes as built
    // for this graphics level (the phone's simplified ones) and the village's own bark
    const d = await player.page.evaluate(() => window.__cvVegDrawn());
    run.check("그려진 형상으로 잎·꽃송이 13만 개 이상을 검사했다", d.clusters > 130000, d.clusters);
    run.check("그려진 잔가지·껍질에서 5 cm 넘게 떨어진 잎·꽃송이가 없다", d.over5cm === 0 && d.maxGap <= 0.05, { maxGap: d.maxGap, over5cm: d.over5cm, worst: d.worst });
    for (const [kind, k] of Object.entries(d.byKind)) run.check(`${kind}: 그려진 간격 5 cm 이하`, k.maxGap <= 0.05, k);
  });
  await run.step(`${tag}: 장면 — 옛 카드, 뒷산 숲, 경계 구`, async () => {
    const r = await player.page.evaluate(() => {
      const { scene } = window.__cvThree();
      const out = { leafTrisLeft: [], instancedLeafVisible: [], farVisible: 0, farHidden: 0, cherryHigh: [], emptyBounds: [], deck: false, zelkovaLeft: 0 };
      const mats = (o) => (Array.isArray(o.material) ? o.material : [o.material]).map((m) => m?.name);
      const visible = (o) => {
        for (let p = o; p; p = p.parent) if (!p.visible) return false;
        return true;
      };
      scene.traverse((o) => {
        if (!o.isMesh || !visible(o)) return;
        const names = mats(o);
        const g = o.geometry;
        if (o.name.startsWith("inst__far_")) {
          out.farVisible += o.count;
          return;
        }
        if (names.includes("M_leaf_green")) {
          if (o.isInstancedMesh) out.instancedLeafVisible.push(o.name);
          else if ((g.index?.count ?? 0) > 0) out.leafTrisLeft.push(`${o.name}:${g.index.count / 3}`);
        }
        if (names.includes("M_leaf_cherry") && g.index) {
          // what is left of the cherries' cards: only the petals lying on the soil (low, flat)
          const pos = g.attributes.position;
          let top = -Infinity;
          for (let i = 0; i < g.index.count; i++) top = Math.max(top, pos.getY(g.index.getX(i)));
          if (top > 0.12) out.cherryHigh.push(`${o.name}:${top.toFixed(2)}`);
        }
        if (o.name === "zelkova_deck_top") out.deck = true;
        if (o.parent?.name === "village_vegetation" || o.name.startsWith("veg_")) {
          const s = o.isInstancedMesh ? o.boundingSphere : g.boundingSphere;
          if (o.frustumCulled && (!s || !(s.radius > 0) || !Number.isFinite(s.radius))) out.emptyBounds.push(o.name);
          // a tree's own mesh: every cluster (origin + its reach) inside the sphere three culls it by
          if (o.isInstancedMesh && o.frustumCulled && s) {
            const m = o.matrixWorld.clone();
            const e = m.elements;
            if (!g.boundingSphere) g.computeBoundingSphere();
            const local = g.boundingSphere.center.length() + g.boundingSphere.radius;
            for (let i = 0; i < o.count; i++) {
              o.getMatrixAt(i, m);
              const reach = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])) * local;
              if (Math.hypot(e[12] - s.center.x, e[13] - s.center.y, e[14] - s.center.z) + reach > s.radius + 1e-3) {
                out.emptyBounds.push(`${o.name}#${i}`);
                break;
              }
            }
          }
        }
      });
      // LM_bark left round the zelkova's foot (the deck at (-25, -5))
      scene.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || !mats(o).includes("LM_bark") || !o.geometry.index) return;
        const pos = o.geometry.attributes.position;
        const idx = o.geometry.index;
        for (let i = 0; i < idx.count; i++) {
          const v = idx.getX(i);
          if (Math.hypot(pos.getX(v) + 25, pos.getZ(v) + 5) < 1.5 && pos.getY(v) > 0.3) out.zelkovaLeft++;
        }
      });
      return out;
    });
    run.check("녹색 잎 메시에 평면 카드가 남지 않았다", r.leafTrisLeft.length === 0, r.leafTrisLeft);
    run.check("인스턴스 녹색 잎 카드가 보이지 않는다 (뒷산 숲 제외)", r.instancedLeafVisible.length === 0, r.instancedLeafVisible);
    run.check("벚꽃 카드는 땅 위 꽃잎만 남았다", r.cherryHigh.length === 0, r.cherryHigh);
    run.check("뒷산 숲 카드 7000그루가 보인다", r.farVisible >= 7000, r.farVisible);
    run.check("느티나무 줄기가 평상 위에 남지 않았다", r.zelkovaLeft === 0, r.zelkovaLeft);
    run.check("평상 가운데 판", r.deck, r.deck);
    run.check("컬링되는 새 메시의 경계 구가 모두 유효하다", r.emptyBounds.length === 0, r.emptyBounds);
  });
  await run.step(`${tag}: 가로수 밑에서 가장 가까운 단계`, async () => {
    await player.page.evaluate(() => {
      const { camera } = window.__cvThree();
      const V = Object.getPrototypeOf(camera.position);
      camera.position.set = function () {
        return this;
      };
      camera.lookAt = function () {};
      V.set.call(camera.position, 26.5, 1.6, -29.9);
      Object.getPrototypeOf(camera).lookAt.call(camera, 27.6, 6.5, -31.3);
      camera.updateMatrixWorld();
    });
    await sleep(1500);
    const near = await player.page.evaluate(() => {
      const { scene } = window.__cvThree();
      const hits = [];
      scene.traverse((o) => {
        if (o.isInstancedMesh && /^veg_street_green_400_\d+_near$/.test(o.name) && o.visible) hits.push(o.name);
      });
      const s = window.__cvVeg();
      return { hits, levels: s.levels.green, twigs: s.twigMeshes };
    });
    run.check("가로수가 3D 잎 가지(가장 가까운 단계)로 그려진다", near.hits.length >= 1 && near.levels[0] > 0, near);
    run.check("그 나무의 잔가지가 그려진다", near.twigs >= 1, near.twigs);
    await run.shot(player, `${tag}-street-green-under.png`);
  });
  await player.ctx.close();
}

try {
  await check("phone", PHONE, "low");
  await check("desktop", DESKTOP, "high");
} finally {
  await browser.close();
}
process.exit(run.finish());
