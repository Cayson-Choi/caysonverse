import { pbrSetInfo } from "./pbr/pbrLibrary";
import type { SurfaceSpec } from "./exteriorFaces";

/** The library set ids the dress surfaces name (each must exist in the manifest: pbrSetInfo throws on an unknown id). */
export function pbrIdsOf(surfaces: Readonly<Record<string, SurfaceSpec>>): string[] {
  return Object.values(surfaces)
    .map((s) => s.pbr)
    .filter((id): id is string => !!id)
    .map((id) => pbrSetInfo(id).id);
}
