import { useEffect, useMemo, useState } from "react";
import { BoxGeometry, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, type Texture } from "three";
import type { CubbyAnchor } from "@caysonverse/shared/village/villageLayout";
import { placementMatrix } from "../cubbyProps";
import { cubbyCardAnchor, useCubbyCard } from "../cubbyCard";
import { isMine, useClaims } from "./claimsStore";
import { mediaUrl } from "./memorialApi";

/**
 * The portrait in a claimed cubby (memorial stage B): a small oak frame standing where the sample's photo frame stands, with the
 * family's photo — the approved one for everyone; this family's own devices also see their photo while it is in review. The
 * 128 px tile everywhere, the 512 px one in the cubby the close-up is looking at. No photo yet: the frame with a cream mat.
 * The rest of a claimed cubby's props (house frame, urn, flowers, name card) are instanced with the sample's (MemorialHall).
 */

/** Frame and photo sizes (m): 4:5 like the card. */
const FRAME = { w: 0.12, h: 0.15, d: 0.012 };
const PHOTO = { w: 0.1, h: 0.125 };
/** Leaning back a little, like a frame on its stand. */
const LEAN = -0.1;
/** Where it stands in the cubby frame (same spot as the sample's photo frame). */
const SPOT = { u: 0, w: 0.2, dy: 0, turn: 0 };

const frameGeo = new BoxGeometry(FRAME.w, FRAME.h, FRAME.d);
const photoGeo = new PlaneGeometry(PHOTO.w, PHOTO.h);
const frameMat = new MeshBasicMaterial({ color: 0xd8bd8e }); /* light oak, like the sample's frame */
const matMat = new MeshBasicMaterial({ color: 0xeee6d8 });

export function claimPhotoUrl(c: Parameters<typeof isMine>[0], big: boolean): string {
  if (!c) return "";
  const urls = isMine(c) ? (c.familyCover?.urls ?? c.photo) : c.photo;
  if (!urls) return "";
  return mediaUrl(big ? urls.s512 : urls.s128);
}

function useTextureUrl(url: string): Texture | null {
  const [tex, setTex] = useState<Texture | null>(null);
  useEffect(() => {
    if (!url) {
      setTex(null);
      return;
    }
    let alive = true;
    const loader = new TextureLoader();
    loader.setCrossOrigin("anonymous");
    let loaded: Texture | null = null;
    loader.load(
      url,
      (t) => {
        t.colorSpace = SRGBColorSpace;
        loaded = t;
        if (alive) setTex(t);
        else t.dispose();
      },
      undefined,
      () => alive && setTex(null),
    );
    return () => {
      alive = false;
      loaded?.dispose();
    };
  }, [url]);
  return tex;
}

function Frame({ anchor, url }: { anchor: CubbyAnchor; url: string }) {
  const matrix = useMemo(() => placementMatrix(anchor, SPOT), [anchor]);
  const tex = useTextureUrl(url);
  const photoMat = useMemo(() => (tex ? new MeshBasicMaterial({ map: tex, toneMapped: false }) : null), [tex]);
  useEffect(() => () => photoMat?.dispose(), [photoMat]);
  return (
    <group matrixAutoUpdate={false} matrix={matrix} name={`claim_frame__${anchor.id}`}>
      <group rotation={[LEAN, 0, 0]}>
        <mesh geometry={frameGeo} material={frameMat} position={[0, FRAME.h / 2, 0]} />
        <mesh geometry={photoGeo} material={photoMat ?? matMat} position={[0, FRAME.h / 2, FRAME.d / 2 + 0.0015]} />
      </group>
    </group>
  );
}

export function ClaimFrames({ anchors }: { anchors: readonly CubbyAnchor[] }) {
  const claims = useClaims();
  const card = useCubbyCard();
  const focused = cubbyCardAnchor(card)?.id ?? null;
  const byId = useMemo(() => new Map(anchors.map((a) => [a.id, a])), [anchors]);
  const items: { anchor: CubbyAnchor; url: string }[] = [];
  for (const [slotId, c] of claims.claims) {
    const anchor = byId.get(slotId);
    if (!anchor) continue;
    items.push({ anchor, url: claimPhotoUrl(claims.mine.get(slotId) ?? c, slotId === focused) });
  }
  return (
    <group name="claim_frames">
      {items.map((it) => (
        <Frame key={it.anchor.id} anchor={it.anchor} url={it.url} />
      ))}
    </group>
  );
}
