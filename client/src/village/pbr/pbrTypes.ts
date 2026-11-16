/** Types shared by the generated PBR manifest (pbrManifest.generated.ts) and the loader (pbrLibrary.ts). */

/** "2k": PC (화려하게). "1k": phone (가볍게). */
export type PbrTier = "2k" | "1k";
export type PbrMapKind = "albedo" | "normal" | "orm";
export type PbrGroup = "ground" | "stone" | "exterior" | "interior" | "wood" | "metal" | "fabric";

export interface PbrFileInfo {
  /** Size of the .ktx2 file on disk / over the wire. */
  readonly bytes: number;
  /** First 10 hex of the file's md5: the URL's ?v= so a rebuilt texture is fetched at once. */
  readonly hash: string;
}

export interface PbrSetInfo {
  readonly id: string;
  /** Korean label for the preview and docs. */
  readonly label: string;
  readonly group: string;
  /** Intended use (art/materials/README.md has the long form). */
  readonly use: string;
  /** Real-world size of ONE texture tile, metres (square). Repeat = surface metres / tileMeters. */
  readonly tileMeters: number;
  /** True when the source publishes no dimensions and tileMeters is our estimate. */
  readonly tileEstimated: boolean;
  /** The plan's target texel density for this surface, px/m. */
  readonly density: number;
  readonly source: { readonly provider: string; readonly asset: string; readonly page: string; readonly license: string } | null;
  /** Mean albedo (sRGB 0..1) of the 2K map: for flat LOD stand-ins and lightmap tinting. */
  readonly meanAlbedo: readonly number[] | null;
  /** Mean ORM (ao, roughness, metalness) of the 2K map. */
  readonly meanOrm: readonly number[] | null;
  readonly tiers: { readonly [tier: string]: { readonly [kind: string]: PbrFileInfo } };
}
