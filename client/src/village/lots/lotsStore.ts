import { useSyncExternalStore } from "react";
import type { LotId } from "@caysonverse/shared/village/villageLots";

/**
 * Which lot buildings are drawn now (L5): the village clone's old plot signs and posts go only while their lot stands
 * (LotsVillagePatch, PlotMarkers), so a failed lot file leaves the plot as it was.
 */
let drawn: readonly LotId[] = [];
const listeners = new Set<() => void>();

export function setLotsDrawn(ids: readonly LotId[]): void {
  if (ids.length === drawn.length && ids.every((id, i) => drawn[i] === id)) return;
  drawn = [...ids];
  for (const l of listeners) l();
}

export function lotsDrawn(): readonly LotId[] {
  return drawn;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLotsDrawn(): readonly LotId[] {
  return useSyncExternalStore(subscribe, lotsDrawn, lotsDrawn);
}
