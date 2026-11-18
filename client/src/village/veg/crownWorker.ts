/// <reference lib="webworker" />
/**
 * The trees' crowns grown off the page (crownGrow.ts): the space-colonisation growth of each tree (colonise, the twigs,
 * the leaves or the blossom bunches) and its twig bark were most of a slow phone's arrival; here they run on a thread of
 * their own while the page draws the crowns already grown (the bark's arrays are transferred, not copied).
 */
import type { Envelope } from "./crownGrowth";
import type { Box } from "./crownSpace";
import { floraTransfers, growFrom, layFlora, makeTextures, textureTransfers, transfersOf, type WorkerIn, type WorkerOut } from "./crownGrow";

let envs: Envelope[] = [];
let boxes: Box[] = [];
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.type === "init") {
    envs = m.envs;
    boxes = m.boxes;
    return;
  }
  if (m.type === "atlas") {
    const result = makeTextures(m.drawPlant);
    scope.postMessage({ type: "atlas", id: m.id, result } satisfies WorkerOut, textureTransfers(result));
    return;
  }
  if (m.type === "flora") {
    try {
      const result = layFlora(m.cards, true, m.beds);
      scope.postMessage({ type: "flora", id: m.id, result } satisfies WorkerOut, floraTransfers(result));
    } catch (err) {
      scope.postMessage({ type: "error", id: m.id, message: String(err) } satisfies WorkerOut);
    }
    return;
  }
  try {
    const t0 = performance.now();
    const result = growFrom(m.req, envs, boxes, true);
    // DEV: how long the growth took here (the page's __cvCrownTimes)
    if (import.meta.env.DEV) (result as { ms?: number }).ms = performance.now() - t0;
    scope.postMessage({ type: "crown", id: m.id, result } satisfies WorkerOut, transfersOf(result));
  } catch (err) {
    scope.postMessage({ type: "error", id: m.id, message: String(err) } satisfies WorkerOut);
  }
};
