import { createContext, useContext, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { DynamicDrawUsage } from "three";
import { SOLID_ROUGHNESS } from "./characterAvatar";
import { getBlobShadow } from "./blobShadowAsset";
import { decalY, useGroundDecal } from "./groundDecal";
import { CrowdImpostors, FULL_BUDGET } from "./crowdImpostor";

/** The far-avatar stand-ins of the scene the roster is in (crowdImpostor.ts); null outside a RemotePlayers. */
export const CrowdContext = createContext<CrowdImpostors | null>(null);

export function useCrowd(): CrowdImpostors | null {
  return useContext(CrowdContext);
}

/**
 * Owns the scene's CrowdImpostors: builds it once, draws it (one instanced mesh of the figure, one of the blob shadows on the
 * touch tier), settles its distance threshold once a frame, and provides it to the RemotePlayers below.
 */
export function CrowdLayer({ blobShadow, children }: { blobShadow: boolean; children: React.ReactNode }) {
  const decal = useGroundDecal();
  const crowd = useMemo(() => {
    const blob = blobShadow ? { ...getBlobShadow(decal), y: decalY(decal) } : null;
    const c = new CrowdImpostors(blob, SOLID_ROUGHNESS);
    const tier = blobShadow ? FULL_BUDGET.lite : FULL_BUDGET.rich;
    c.budget = tier.count;
    c.minM = tier.minM;
    c.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    if (c.blob) c.blob.instanceMatrix.setUsage(DynamicDrawUsage);
    return c;
  }, [blobShadow, decal]);
  useEffect(() => () => crowd.dispose(), [crowd]);
  useFrame(() => crowd.startFrame(), -1000); // before the avatars' own frame callbacks (a negative priority only orders)
  return (
    <CrowdContext.Provider value={crowd}>
      <primitive object={crowd.mesh} />
      {crowd.blob && <primitive object={crowd.blob} />}
      {children}
    </CrowdContext.Provider>
  );
}
