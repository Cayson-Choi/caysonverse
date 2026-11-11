/** The vegetation mode (veg3d): `old` = the baked cards as they were, `new` = the 3D vegetation, `both` = overlaid (debug). */
export type VegMode = "old" | "new" | "both";

/** `?veg=old|new|both` in a DEV build (side-by-side screenshots); production always draws the new vegetation. */
export function vegModeFrom(search: string, dev: boolean): VegMode {
  if (!dev) return "new";
  const v = new URLSearchParams(search).get("veg");
  return v === "old" || v === "both" ? v : "new";
}
