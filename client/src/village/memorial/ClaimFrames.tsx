import { useEffect, useMemo, useState } from "react";
import { CanvasTexture, Matrix4, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, Vector3, type Texture } from "three";
import type { CubbyAnchor } from "@caysonverse/shared/village/villageLayout";
import { placementMatrix } from "../cubbyProps";
import { cubbyCardAnchor, useCubbyCard } from "../cubbyCard";
import { CUBBY_SET, SAMPLE_BY_ID, SAMPLE_CUBBIES, SAMPLE_PHOTO_URL } from "../sampleCubbies";
import { isMine, useClaims } from "./claimsStore";
import { mediaUrl } from "./memorialApi";

/**
 * The photo in every filled cubby's frame (2026-11-17: the photo is the cubby's main object). The frame itself is the props file's
 * `frame_large` (walnut moulding, mat, glass; build_props.py), instanced with the rest of the cubby set; this lays the picture in
 * its window: the sample's own portrait, or the family's photo — the approved one for everyone, and this family's own devices also
 * see their photo while it is in review. 512 px in the cubby the close-up looks at, 128 px elsewhere. No photo yet: the cream mat.
 */

/** frame_large's picture window (build_props.py FRAME_*): the frame's height, depth, foot offset and lean. */
const FRAME_H = 0.24;
const FRAME_D = 0.024;
const FRAME_BACK = 0.03;
const FRAME_TILT = (8 * Math.PI) / 180;
const PIC = { w: 0.204 - 2 * (0.022 + 0.008 + 0.0015), h: 0.24 - 2 * (0.022 + 0.008 + 0.0015) } as const;
/** Just in front of the props file's own (unused) picture face, behind the frame glass. */
const PIC_DEPTH = FRAME_D - 0.013 - 0.0012;
/** Where the picture's centre sits in the frame prop's own frame (x, up, toward the viewer). */
export const PICTURE_CENTRE = {
  x: 0,
  y: (FRAME_H / 2) * Math.cos(FRAME_TILT) + PIC_DEPTH * Math.sin(FRAME_TILT),
  z: PIC_DEPTH * Math.cos(FRAME_TILT) - (FRAME_H / 2) * Math.sin(FRAME_TILT) - FRAME_BACK,
} as const;
export const PICTURE_SIZE = PIC;

const FRAME_SPOT = CUBBY_SET.find((p) => p.kind === "frame_large")!;
const photoGeo = new PlaneGeometry(PIC.w, PIC.h);
const matMat = new MeshBasicMaterial({ color: 0xece5d8 });

const SAMPLE_IDS: ReadonlySet<string> = new Set(SAMPLE_CUBBIES.map((s) => s.id));

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
        t.anisotropy = 4;
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

/**
 * The name engraved on the cubby's small brass plate (the board under its glass door, build_memorial.py cubby_unit): dark letters,
 * never over the photo. Only filled cubbies get one; empty plates stay blank like a real 봉안함's.
 */
const PLATE = { w: 0.062, h: 0.0135 } as const;
const plateGeo = new PlaneGeometry(PLATE.w, PLATE.h);

function nameTexture(name: string): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 384;
  c.height = 84;
  const g = c.getContext("2d");
  if (!g) return null;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = "rgba(58, 40, 22, 0.92)";
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = 58;
  g.font = `600 ${size}px "Noto Serif KR", "Nanum Myeongjo", serif`;
  while (g.measureText(name).width > c.width - 24 && size > 24) {
    size -= 2;
    g.font = `600 ${size}px "Noto Serif KR", "Nanum Myeongjo", serif`;
  }
  g.fillText(name, c.width / 2, c.height / 2 + 2);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const plateOffset = new Vector3();
function NamePlate({ anchor, name }: { anchor: CubbyAnchor; name: string }) {
  const tex = useMemo(() => nameTexture(name), [name]);
  const mat = useMemo(() => (tex ? new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }) : null), [tex]);
  useEffect(
    () => () => {
      mat?.dispose();
      tex?.dispose();
    },
    [mat, tex],
  );
  const matrix = useMemo(() => {
    // on the plate's face: the board's middle under the door (opening centre 0.2 + half the 2.5 cm board down), 4.7 mm out
    plateOffset.set(Math.sin(anchor.yaw) * 0.0047, -(0.2 + 0.0125), Math.cos(anchor.yaw) * 0.0047);
    return new Matrix4().makeRotationY(anchor.yaw).setPosition(anchor.x + plateOffset.x, anchor.y + plateOffset.y, anchor.z + plateOffset.z);
  }, [anchor]);
  if (!mat) return null;
  return <mesh geometry={plateGeo} material={mat} matrixAutoUpdate={false} matrix={matrix} renderOrder={2} />;
}

function Picture({ anchor, url }: { anchor: CubbyAnchor; url: string }) {
  const matrix = useMemo(() => placementMatrix(anchor, FRAME_SPOT), [anchor]);
  const tex = useTextureUrl(url);
  const photoMat = useMemo(() => (tex ? new MeshBasicMaterial({ map: tex, toneMapped: false }) : null), [tex]);
  useEffect(() => () => photoMat?.dispose(), [photoMat]);
  return (
    <group matrixAutoUpdate={false} matrix={matrix} name={`cubby_photo__${anchor.id}`}>
      <mesh
        geometry={photoGeo}
        material={photoMat ?? matMat}
        position={[PICTURE_CENTRE.x, PICTURE_CENTRE.y, PICTURE_CENTRE.z]}
        rotation={[-FRAME_TILT, 0, 0]}
      />
    </group>
  );
}

export function ClaimFrames({ anchors }: { anchors: readonly CubbyAnchor[] }) {
  const claims = useClaims();
  const card = useCubbyCard();
  const focused = cubbyCardAnchor(card)?.id ?? null;
  const byId = useMemo(() => new Map(anchors.map((a) => [a.id, a])), [anchors]);
  const items: { anchor: CubbyAnchor; url: string; name: string }[] = [];
  for (const id of SAMPLE_IDS) {
    const anchor = byId.get(id);
    if (anchor) items.push({ anchor, url: SAMPLE_PHOTO_URL, name: SAMPLE_BY_ID.get(id)?.name ?? "" });
  }
  for (const [slotId, c] of claims.claims) {
    const anchor = byId.get(slotId);
    if (!anchor || SAMPLE_IDS.has(slotId)) continue;
    items.push({ anchor, url: claimPhotoUrl(claims.mine.get(slotId) ?? c, slotId === focused), name: c.petName });
  }
  return (
    <group name="cubby_photos">
      {items.map((it) => (
        <group key={it.anchor.id}>
          <Picture anchor={it.anchor} url={it.url} />
          {it.name ? <NamePlate anchor={it.anchor} name={it.name} /> : null}
        </group>
      ))}
    </group>
  );
}
