import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from "three";
import { mergeBufferGeometries } from "three-stdlib";
import { canvas2d, canvasTexture, roundRect } from "./spriteCanvas";
import {
  ARTWORKS,
  FRAME_DEPTH,
  FRAME_MARGIN,
  FRAME_WALL_GAP,
  GALLERY_TITLE,
  PANEL_WALL_GAP,
  PHOTO_CENTER_Y,
  PHOTO_H,
  PHOTO_WALL_GAP,
  PLAQUE_CENTER_Y,
  PLAQUE_H,
  PLAQUE_W,
  PLAQUE_WALL_GAP,
  TITLE_BANNER,
  type WallPanel,
} from "./gallery";

/**
 * Gallery palette — warm golds against the cosmic navy/violet world. The photos
 * themselves are UNLIT (meshBasicMaterial, the lecture-screen technique) so they
 * stay true-colour under the dim world lighting; the gold frames get a weak
 * emissive so the mouldings read even in the room's darker corners (design 25:
 * "은은한 발광 테두리").
 */
const FRAME_COLOR = "#c9a557";
const FRAME_EMISSIVE = "#6b5322";
/** Dark placeholder shown until a photo's texture arrives (never a white flash). */
const PLACEHOLDER_COLOR = "#151022";

/** Shared Korean UI font stack (matches the lecture-hall slide). */
const KR_FONT = `"Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;

// ─────────────────────────── Canvas rasterizers ───────────────────────────

/**
 * Title plaque: a bright ivory caption card with dark lettering. Titles are
 * full phrases now (design 34), so the type SHRINKS to fit the card (the
 * lecture-slide precedent) instead of assuming a two-glyph "N살" label.
 */
function drawPlaque(label: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 704;
  canvas.height = 172;
  const ctx = canvas2d(canvas);
  const inset = 10;
  ctx.fillStyle = "#f6efdd"; // warm ivory
  roundRect(ctx, inset, inset, canvas.width - inset * 2, canvas.height - inset * 2, 22);
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = "#a5813c"; // thin gold rim, matching the frames
  roundRect(ctx, inset, inset, canvas.width - inset * 2, canvas.height - inset * 2, 22);
  ctx.stroke();
  ctx.fillStyle = "#33250f";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = 84;
  do {
    ctx.font = `700 ${size}px ${KR_FONT}`;
    size -= 4;
  } while (size > 28 && ctx.measureText(label).width > canvas.width * 0.86);
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 5);
  return canvas;
}

/**
 * Shared banner/sign painter: deep-plum plate, double gold rule, centred gold
 * lettering flanked by ornament diamonds. `title` shrinks to fit so a future
 * copy change can never overflow the plate (lecture-slide precedent).
 */
function drawGoldPanel(title: string, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas2d(canvas);

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#2b2049");
  grad.addColorStop(1, "#1c1533");
  ctx.fillStyle = grad;
  roundRect(ctx, 4, 4, width - 8, height - 8, height * 0.12);
  ctx.fill();

  // Double gold rule — outer bold, inner hairline.
  ctx.strokeStyle = "#d8b269";
  ctx.lineWidth = Math.max(4, height * 0.03);
  roundRect(ctx, 10, 10, width - 20, height - 20, height * 0.1);
  ctx.stroke();
  ctx.lineWidth = Math.max(2, height * 0.012);
  ctx.strokeStyle = "rgba(216, 178, 105, 0.55)";
  roundRect(ctx, 10 + height * 0.09, 10 + height * 0.09, width - 20 - height * 0.18, height - 20 - height * 0.18, height * 0.06);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = Math.round(height * 0.52);
  do {
    ctx.font = `700 ${size}px ${KR_FONT}`;
    size -= 4;
  } while (size > 24 && ctx.measureText(title).width > width * 0.7);
  const textW = ctx.measureText(title).width;
  ctx.fillStyle = "#e9c886";
  ctx.fillText(title, width / 2, height / 2 + height * 0.02);

  // Ornament diamonds + side rules filling the leftover width.
  const midY = height / 2;
  const pad = height * 0.42;
  const ruleStart = width * 0.09;
  const ruleEndL = width / 2 - textW / 2 - pad;
  ctx.strokeStyle = "rgba(216, 178, 105, 0.8)";
  ctx.lineWidth = Math.max(3, height * 0.02);
  const diamond = (cx: number) => {
    const r = height * 0.07;
    ctx.beginPath();
    ctx.moveTo(cx, midY - r);
    ctx.lineTo(cx + r, midY);
    ctx.lineTo(cx, midY + r);
    ctx.lineTo(cx - r, midY);
    ctx.closePath();
    ctx.fillStyle = "#d8b269";
    ctx.fill();
  };
  if (ruleEndL - ruleStart > height * 0.4) {
    ctx.beginPath();
    ctx.moveTo(ruleStart, midY);
    ctx.lineTo(ruleEndL - height * 0.16, midY);
    ctx.moveTo(width - ruleStart, midY);
    ctx.lineTo(width - ruleEndL + height * 0.16, midY);
    ctx.stroke();
    diamond(ruleEndL);
    diamond(width - ruleEndL);
  }
  return canvas;
}

// ─────────────────────────────── Sub-scenes ───────────────────────────────

/**
 * All nine gold frames merged into ONE BufferGeometry → a single draw call
 * (MazeWalls precedent). Each frame is four moulding rails built in portrait-
 * local space (plane facing +Z), rotated onto its wall and baked at its world
 * anchor, so the mesh sits at the origin with a frozen identity matrix.
 */
function GalleryFrames() {
  const geometry = useMemo(() => {
    const geos: BoxGeometry[] = [];
    const depthOff = FRAME_WALL_GAP + FRAME_DEPTH / 2;
    for (const p of ARTWORKS) {
      const outerW = p.w + 2 * FRAME_MARGIN; // per-work: widths follow aspect
      const rails: Array<[number, number, number, number]> = [
        [0, PHOTO_H / 2 + FRAME_MARGIN / 2, outerW, FRAME_MARGIN], // top rail
        [0, -(PHOTO_H / 2 + FRAME_MARGIN / 2), outerW, FRAME_MARGIN], // bottom rail
        [-(p.w / 2 + FRAME_MARGIN / 2), 0, FRAME_MARGIN, PHOTO_H], // left stile
        [p.w / 2 + FRAME_MARGIN / 2, 0, FRAME_MARGIN, PHOTO_H], // right stile
      ];
      for (const [cx, cy, sx, sy] of rails) {
        const g = new BoxGeometry(sx, sy, FRAME_DEPTH);
        g.translate(cx, cy, depthOff);
        g.rotateY(p.rotY);
        g.translate(p.x, PHOTO_CENTER_Y, p.z);
        geos.push(g);
      }
    }
    const merged = mergeBufferGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    return merged ?? new BoxGeometry(0, 0, 0);
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} matrixAutoUpdate={false} castShadow>
      <meshStandardMaterial
        color={FRAME_COLOR}
        emissive={FRAME_EMISSIVE}
        emissiveIntensity={0.32}
        roughness={0.45}
        metalness={0.65}
      />
    </mesh>
  );
}

/**
 * The nine photos: unlit planes (lecture-screen technique) recessed inside
 * their frame rings. Each starts as a dark placeholder and swaps to its JPEG
 * the moment TextureLoader delivers it — the load callback guards against a
 * post-unmount arrival by disposing the late texture instead of leaking it.
 * One shared plane geometry; per-photo materials (each holds its own map).
 */
function GalleryPhotos() {
  const gl = useThree((s) => s.gl);

  const { group, entries, dispose } = useMemo(() => {
    // One UNIT plane shared by all: each mesh scales to its work's aspect-true
    // width at the shared eye-line height (never stretching the image).
    const geometry = new PlaneGeometry(1, 1);
    const loader = new TextureLoader();
    const group = new Group();
    let disposed = false;

    const entries = ARTWORKS.map((p) => {
      const material = new MeshBasicMaterial({ color: PLACEHOLDER_COLOR, toneMapped: false });
      const mesh = new Mesh(geometry, material);
      mesh.position.set(
        p.x + p.nx * PHOTO_WALL_GAP,
        PHOTO_CENTER_Y,
        p.z + p.nz * PHOTO_WALL_GAP,
      );
      mesh.rotation.y = p.rotY;
      mesh.scale.set(p.w, PHOTO_H, 1);
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      group.add(mesh);

      const entry = { title: p.title, url: p.url, loaded: false, texture: null as Texture | null, material };
      loader.load(
        p.url,
        (texture) => {
          if (disposed) {
            texture.dispose(); // arrived after unmount — never leak it
            return;
          }
          texture.colorSpace = SRGBColorSpace;
          texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
          entry.texture = texture;
          material.map = texture;
          material.color.set("#ffffff");
          material.needsUpdate = true;
          entry.loaded = true;
        },
        undefined,
        () => {
          // Missing asset keeps the dark placeholder (no console error spam);
          // the E2E's loaded-flag + network assertions surface it loudly.
        },
      );
      return entry;
    });

    group.matrixAutoUpdate = false;
    const dispose = () => {
      disposed = true;
      geometry.dispose();
      for (const e of entries) {
        e.texture?.dispose();
        e.material.dispose();
      }
    };
    return { group, entries, dispose };
  }, [gl]);

  useEffect(() => dispose, [dispose]);

  // Dev/E2E-only hook: per-portrait load state plus a sampled mean luminance of
  // the DELIVERED texture image — lets the E2E prove "real photo, not the dark
  // placeholder" by pixels without reaching into the R3F scene graph.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const sampleMean = (texture: Texture | null): number | null => {
      const image = texture?.image as CanvasImageSource | undefined;
      if (!image) return null;
      try {
        const c = document.createElement("canvas");
        c.width = 16;
        c.height = 16;
        const ctx = canvas2d(c);
        ctx.drawImage(image, 0, 0, 16, 16);
        const data = ctx.getImageData(0, 0, 16, 16).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        return sum / (data.length / 4);
      } catch {
        return null;
      }
    };
    const w = window as unknown as {
      __cvGallery?: () => { title: string; url: string; loaded: boolean; mean: number | null }[];
    };
    w.__cvGallery = () =>
      entries.map((e) => ({ title: e.title, url: e.url, loaded: e.loaded, mean: sampleMean(e.texture) }));
    return () => {
      delete w.__cvGallery;
    };
  }, [entries]);

  return <primitive object={group} />;
}

/** The nine title plaques — one canvas texture each, flush under the frames. */
function GalleryPlaques() {
  const group = useMemo(() => {
    const geometry = new PlaneGeometry(PLAQUE_W, PLAQUE_H);
    const root = new Group();
    for (const p of ARTWORKS) {
      const texture = canvasTexture(drawPlaque(p.title));
      const material = new MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.2, // clean rounded-card corners (maze plaque precedent)
        toneMapped: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.position.set(
        p.x + p.nx * PLAQUE_WALL_GAP,
        PLAQUE_CENTER_Y,
        p.z + p.nz * PLAQUE_WALL_GAP,
      );
      mesh.rotation.y = p.rotY;
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
    }
    root.matrixAutoUpdate = false;
    return root;
  }, []);

  useEffect(
    () => () => {
      let shared: PlaneGeometry | null = null;
      for (const child of group.children) {
        const mesh = child as Mesh;
        if (!mesh.isMesh) continue;
        shared = mesh.geometry as PlaneGeometry; // one geometry shared by all nine
        const material = mesh.material as MeshBasicMaterial;
        material.map?.dispose();
        material.dispose();
      }
      shared?.dispose();
    },
    [group],
  );

  return <primitive object={group} />;
}

/** One wall-mounted canvas-texture panel (the north-wall title banner). */
function WallText({ panel, title }: { panel: WallPanel; title: string }) {
  const texture = useMemo(
    // Canvas resolution tracks the panel's aspect at ~210 px per metre.
    () => canvasTexture(drawGoldPanel(title, Math.round(panel.w * 210), Math.round(panel.h * 210))),
    [panel, title],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh
      position={[panel.x + panel.nx * PANEL_WALL_GAP, panel.y, panel.z + panel.nz * PANEL_WALL_GAP]}
      rotation-y={panel.rotY}
      onUpdate={(m) => {
        m.updateMatrix();
        m.matrixAutoUpdate = false; // static — freeze after the initial placement
      }}
    >
      <planeGeometry args={[panel.w, panel.h]} />
      <meshBasicMaterial map={texture} transparent alphaTest={0.2} toneMapped={false} />
    </mesh>
  );
}

/**
 * "AI 갤러리" room contents (design 25 room, design 34 exhibition): nine unlit
 * AI-painted works in merged gold frames, curator-title plaques, the
 * north-wall title banner, and one warm fill light for ambience (the artworks
 * need no light at all — they are unlit by design). The former lounge-side
 * entrance sign was removed by design 26 — the lounge-side RoomPosters name
 * the door instead. The room floor is WorldMap's ZoneFloor; the walls come
 * from the shared WALLS render. Everything here is static: matrices are baked
 * once and frozen.
 */
export function GalleryRoom() {
  return (
    <group>
      <GalleryFrames />
      <GalleryPhotos />
      <GalleryPlaques />
      <WallText panel={TITLE_BANNER} title={GALLERY_TITLE} />
      {/* Warm centre fill — kept inside the room (distance < room half-diagonal
          + falloff) so it never spills past the gallery walls. */}
      <pointLight position={[-15, 3.4, -26]} intensity={10} distance={16} decay={2} color="#ffd9a8" />
    </group>
  );
}
