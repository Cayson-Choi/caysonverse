import { useMemo } from "react";
import { BLOB_SHADOW_Y, getBlobShadow } from "./blobShadowAsset";

/**
 * Flat radial-gradient shadow under an avatar's feet (touch/low-spec profile,
 * standing in for the real directional shadow). Rendered as a child of the
 * avatar group so it follows the avatar. Uses the ONE shared geometry+material
 * for all avatars; `dispose={null}` stops R3F from disposing that shared
 * resource when this avatar unmounts.
 */
export function BlobShadow() {
  const { geometry, material } = useMemo(() => getBlobShadow(), []);
  return (
    <mesh
      geometry={geometry}
      material={material}
      rotation-x={-Math.PI / 2}
      position={[0, BLOB_SHADOW_Y, 0]}
      dispose={null}
    />
  );
}
