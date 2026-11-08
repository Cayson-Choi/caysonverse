import { useMemo } from "react";
import { getBlobShadow } from "./blobShadowAsset";
import { decalY, useGroundDecal } from "./groundDecal";

/**
 * Flat radial-gradient shadow under an avatar's feet (touch/low-spec profile,
 * standing in for the real directional shadow). Rendered as a child of the
 * avatar group so it follows the avatar. Uses the ONE shared geometry+material
 * for all avatars; `dispose={null}` stops R3F from disposing that shared
 * resource when this avatar unmounts. Its height and polygon offset are the
 * scene's ground-decal placement (groundDecal.ts; 케이슨 마을 raises it).
 */
export function BlobShadow() {
  const decal = useGroundDecal();
  const { geometry, material } = useMemo(() => getBlobShadow(decal), [decal]);
  return (
    <mesh
      geometry={geometry}
      material={material}
      rotation-x={-Math.PI / 2}
      position={[0, decalY(decal), 0]}
      dispose={null}
    />
  );
}
