/** DEV only: `?ground=old` draws the ground paths as they were (the baked lanes and connectors, the hard-cut trail, the bare park pads), for before/after shots. */
export function groundOld(): boolean {
  return import.meta.env.DEV && typeof location !== "undefined" && /[?&]ground=old/.test(location.search);
}
