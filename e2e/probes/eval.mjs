/**
 * Run a page script and print what it returns: node e2e/probe.mjs e2e/probes/eval.mjs <out> desktop <time> -- <script.js> [park] [waitMs]
 * The script file is the BODY of an async function (it may use window.__cvThree(), window.__imp, and must `return` JSON-able data).
 */
import { readFileSync } from "node:fs";

export default async ({ P, args, enterPark, cam, sleep }) => {
  const [file, where, wait = "6000"] = args;
  if (where === "park") await enterPark();
  else await cam([-24, 2.2, 78], [-24, 4, 94], 55);
  await sleep(Number(wait));
  const body = readFileSync(file, "utf8");
  const out = await P.page.evaluate(`(async () => { ${body} })()`);
  console.log(typeof out === "string" ? out : JSON.stringify(out, null, 1));
};
