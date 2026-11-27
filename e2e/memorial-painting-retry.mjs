/**
 * The lounge painting must come in even when its first fetch fails (2026-11-27: a long PC run showed the bare placeholder
 * canvas). The first two requests for the painting image are aborted; the hall must still end with the painting loaded.
 *
 *   server:  PORT=3015 npx tsx src/index.ts            (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:3015 npx vite --port 5615 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5615 node e2e/memorial-painting-retry.mjs
 */
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep } from "./lib/common.mjs";
import { enterHall, joinVillage } from "./lib/village.mjs";

const run = createRun("memorial-painting-retry");
run.allow("the two painting fetches this test fails on purpose", /Failed to load resource: net::ERR_FAILED/);
const browser = await launchBrowser();
try {
  const p = await openPlayer(browser, run, { tag: "A", device: DESKTOP });
  let aborted = 0;
  let requests = 0;
  await p.page.route(/T_h_art_wheat_cypresses_met/, (route) => {
    requests += 1;
    if (aborted < 2) {
      aborted += 1;
      return route.abort("failed");
    }
    return route.continue();
  });
  await run.step("into the hall with the painting's first two fetches failing", async () => {
    await joinVillage(p, "pr");
    await enterHall(p);
  });
  await run.step("the painting still comes in (retried after the failures)", async () => {
    let loaded = false;
    for (let i = 0; i < 40 && !loaded; i++) {
      loaded = await p.page.evaluate(() => Boolean(window.__cvHall?.().painting?.loaded));
      if (!loaded) await sleep(500);
    }
    run.check("the first two painting fetches were failed", aborted === 2, { aborted, requests });
    run.check("the painting is loaded after the retries", loaded, { aborted, requests });
  });
} finally {
  await browser.close();
}
process.exit(run.finish());
