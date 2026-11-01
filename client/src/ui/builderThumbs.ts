// 조립실 부품 카드·프리셋 카드의 그림(Task 7b). 빌드 때 굽지 않고 실행 중에 미리보기 Canvas의 WebGL 렌더러
// 하나로 그린다(두 번째 WebGL 컨텍스트 없음): 첫 화면 용량을 아끼고, GLB가 바뀌면 그림도 저절로 맞고, 지금 고른
// 색으로 칠할 수 있다.
//
// 순수 부분(테스트): 캐시 키(칩 = 부품 + 색, 프리셋 = id), 그릴 순서(지금 탭 → 프리셋 → 다른 탭), 프레임당 2장.
// three 부분(ThumbStudio): character.glb 장면을 한 번 복제해 Idle 자세로 세운 "촬영용 인형"을 만들고(셰이더는
// compileAsync로 미리), 일감마다 보일 부품과 색만 바꿔 캔버스 왼쪽 아래 구석에 그린 뒤 그 구석을 2D 캔버스로
// 복사해 비동기로 WebP blob URL을 만든다. 그 프레임의 미리보기 렌더가 곧바로 화면 전체를 다시 그리므로 구석
// 그림은 보이지 않는다. 촬영용 인형은 일감이 끝나고 잠시 뒤 놓는다(복제한 재질·뼈 텍스처를 dispose).
// useAvatar를 거치지 않으므로 __cvAvatars 항목도, 합친 지오메트리 캐시 몫도 늘지 않는다. 그림이 없거나
// 실패하면 카드는 이름만 보인다.

import {
  AnimationMixer,
  Box3,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  Vector4,
  Color,
  type AnimationClip,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Skeleton,
  type SkinnedMesh,
  type WebGLRenderer,
} from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  SLOT_COLOR_FIELD,
  SLOT_OPTIONS,
  applyPreset,
  paletteFor,
  withPart,
  type Appearance,
} from "@caysonverse/shared/appearance";
import { CHARACTER_MANIFEST, CHARACTER_SLOTS, type CharacterSlot } from "@caysonverse/shared/characterManifest";
import { lookFromAppearance, visibleParts, type TintKey } from "../game/characterLook";
import { CLIP } from "../game/constants";

/** 그림 크기(px): 칩은 64 CSS px에 2배, 프리셋은 80 CSS px에 2배. */
export const THUMB_PX = { chip: 128, preset: 160 } as const;
/** 한 프레임에 그리는 그림 수. */
export const THUMBS_PER_FRAME = 2;
/** 캐시에 두는 그림 수의 상한(색을 여러 번 바꿔도 메모리가 계속 늘지 않게). */
export const THUMB_CACHE_MAX = 240;

export interface ChipThumbJob {
  kind: "chip";
  key: string;
  slot: CharacterSlot;
  part: string;
  /** 칠할 색(#RRGGBB). */
  hex: string;
}
export interface PresetThumbJob {
  kind: "preset";
  key: string;
  presetId: string;
}
export type ThumbJob = ChipThumbJob | PresetThumbJob;

export function chipThumbKey(slot: CharacterSlot, part: string, hex: string): string {
  return `chip:${slot}:${part}:${hex.toUpperCase()}`;
}

export function presetThumbKey(presetId: string): string {
  return `preset:${presetId}`;
}

/**
 * 부품 칩을 칠할 색: 그 칩을 눌렀을 때 그 슬롯이 갖게 될 색. 보통은 지금 슬롯 색이고, 왕관·티아라처럼 기본색이
 * 있는 부품은 그 색(withPart)이다. 지금 입은 칩은 실제로 입은 색. "없음"이면 null(그림 없음).
 */
export function chipThumbHex(a: Appearance, slot: CharacterSlot, index: number): string | null {
  if (SLOT_OPTIONS[slot][index] == null) return null;
  const field = SLOT_COLOR_FIELD[slot];
  const colorIndex = a[slot] === index ? a[field] : withPart(a, slot, index)[field];
  return paletteFor(field)[colorIndex]?.hex ?? null;
}

function chipJobs(a: Appearance, slot: CharacterSlot): ChipThumbJob[] {
  const jobs: ChipThumbJob[] = [];
  SLOT_OPTIONS[slot].forEach((part, index) => {
    const hex = chipThumbHex(a, slot, index);
    if (part === null || hex === null) return;
    jobs.push({ kind: "chip", key: chipThumbKey(slot, part, hex), slot, part, hex });
  });
  return jobs;
}

/** 그릴 일감 전부, 순서대로: 지금 탭의 칩 → 프리셋 8개 → 나머지 탭의 칩(탭 순서). 같은 키는 한 번만. */
export function thumbJobs(a: Appearance, current: CharacterSlot): ThumbJob[] {
  const jobs: ThumbJob[] = [
    ...chipJobs(a, current),
    ...APPEARANCE_PRESETS.map((p): PresetThumbJob => ({ kind: "preset", key: presetThumbKey(p.id), presetId: p.id })),
    ...CHARACTER_SLOTS.filter((s) => s !== current).flatMap((s) => chipJobs(a, s)),
  ];
  const seen = new Set<string>();
  return jobs.filter((job) => !seen.has(job.key) && seen.add(job.key));
}

/** blob: URL이면 놓는다(캐시에서 밀려난 그림). */
function revokeBlobUrl(url: string): void {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

/**
 * 그림 캐시: 키 → 그림 URL(실패는 null). 그리는 중(begin~set)인 키도 "있음"으로 쳐서 다시 일감으로 나가지 않는다.
 * 상한을 넘으면 오래된 것부터, 지금 원하는 키가 아닌 것만 버리고 그 URL을 놓는다.
 */
export class ThumbCache {
  private readonly urls = new Map<string, string | null>();
  private readonly pending = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly max = THUMB_CACHE_MAX,
    private readonly revoke: (url: string) => void = revokeBlobUrl,
  ) {}

  /** 그림 URL, 실패면 null, 아직 없으면(그리는 중 포함) undefined. */
  get(key: string): string | null | undefined {
    return this.urls.get(key);
  }

  /** 그렸거나, 실패했거나, 지금 그리는 중이다. */
  has(key: string): boolean {
    return this.urls.has(key) || this.pending.has(key);
  }

  get size(): number {
    return this.urls.size;
  }

  /** 그리기 시작(인코딩이 끝나 set이 올 때까지). */
  begin(key: string): void {
    this.pending.add(key);
  }

  set(key: string, url: string | null, keep: ReadonlySet<string> = new Set()): void {
    this.pending.delete(key);
    const old = this.urls.get(key);
    if (old && old !== url) this.revoke(old);
    this.urls.delete(key);
    this.urls.set(key, url);
    if (this.urls.size <= this.max) return;
    for (const [oldKey, oldUrl] of this.urls) {
      if (this.urls.size <= this.max) break;
      if (oldKey === key || keep.has(oldKey)) continue;
      this.urls.delete(oldKey);
      if (oldUrl) this.revoke(oldUrl);
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** 이번 프레임에 그릴 일감: 순서대로, 아직 캐시에 없는(그린 적도, 실패한 적도, 그리는 중도 아닌) 것 n개까지. */
export function nextThumbJobs(jobs: readonly ThumbJob[], cache: ThumbCache, n = THUMBS_PER_FRAME): ThumbJob[] {
  const out: ThumbJob[] = [];
  for (const job of jobs) {
    if (out.length >= n) break;
    if (!cache.has(job.key)) out.push(job);
  }
  return out;
}

/** 조립실 하나가 쓰는 그림 캐시와 지금 원하는 일감(패널이 정하고, 미리보기 Canvas 안의 그리는 쪽이 가져간다). */
export const thumbStore = {
  cache: new ThumbCache(),
  jobs: [] as readonly ThumbJob[],
  keys: new Set<string>() as ReadonlySet<string>,
  want(jobs: readonly ThumbJob[]): void {
    this.jobs = jobs;
    this.keys = new Set(jobs.map((j) => j.key));
  },
};

// ── three: 촬영 ───────────────────────────────────────────────────────────────

const PART_NODE = /^(body|hat|hair|face|top|bottom|shoes|item)__/;

/** 슬롯 → 칩 그림에 보일 부품 노드. 머리카락·얼굴은 머리에 얹어 보인다. */
function chipNodes(slot: CharacterSlot, part: string): string[] {
  if (slot === "hair") return ["body__head", "face__smile", `hair__${part}`];
  if (slot === "face") return ["body__head", `face__${part}`, "hair__short"];
  return [`${slot}__${part}`];
}

/** 슬롯마다 보기 좋은 각도(yaw, pitch rad): 컨셉 렌더러(builder-concept/tools/render.html)와 같다. */
const CHIP_VIEW: Record<CharacterSlot, readonly [number, number]> = {
  hat: [0.35, 0.5],
  hair: [0.35, 0.15],
  face: [0.3, 0.12],
  top: [0.45, 0.18],
  bottom: [0.45, 0.22],
  shoes: [0.55, 0.55],
  item: [0.9, 0.15],
};
const THUMB_FOV = 22;
/** 칩은 크게 찍어 부품 상자(화면에 투영한 것)로 자른 뒤 128에 맞춘다(여백 8%). */
const CHIP_RENDER_PX = 192;
const CHIP_PAD = 0.08;
/** 기본 외형의 색(머리카락 칩의 피부·얼굴 칩의 머리처럼 고정으로 보이는 부분). */
const BASE_COLORS = lookFromAppearance(DEFAULT_APPEARANCE).colors;

function tintKeyFor(slot: CharacterSlot): TintKey {
  return slot === "face" ? "skin" : slot;
}

interface Rig {
  root: Object3D;
  nodes: Map<string, Object3D>;
  materials: MeshStandardMaterial[];
  skeleton: Skeleton | null;
  /** Idle 자세를 붙들고 있는 믹서(놓을 때 함께 버린다). */
  mixer: AnimationMixer | null;
  /** 셰이더를 다 만들었는가(compileAsync: 메인 스레드를 막지 않고 드라이버가 따로 만든다). */
  ready: boolean;
}

/** 잘라 낼 영역(찍은 정사각형 안의 px, 위가 0). */
interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 미리보기 렌더러로 부품·프리셋 그림을 찍는다. 찍은 픽셀은 GPU에서 2D 캔버스로 바로 복사하고(drawImage),
 * 인코딩은 비동기(toBlob)라 메인 스레드에서 오래 걸리는 일이 없다. 렌더러 상태(뷰포트·가위·지움 색)는 되돌린다.
 */
export class ThumbStudio {
  private rig: Rig | null = null;
  /** 자세를 잡은 부품의 월드 상자. 자세는 늘 같으므로 촬영용 인형을 다시 만들어도 그대로 쓴다. */
  private readonly boxes = new Map<string, Box3>();
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(THUMB_FOV, 1, 0.05, 60);
  private readonly saved = { viewport: new Vector4(), scissor: new Vector4(), clear: new Color(), size: new Vector2() };

  constructor(private readonly source: { scene: Object3D; animations: AnimationClip[] }) {
    this.scene.add(new HemisphereLight(0xfff8ee, 0xb8a6e8, 1.5));
    const key = new DirectionalLight(0xffffff, 2.3);
    key.position.set(3, 7, 6);
    const fill = new DirectionalLight(0xdfe8ff, 0.6);
    fill.position.set(-5, 3, 4);
    const rim = new DirectionalLight(0xe6dcff, 1.1);
    rim.position.set(-3, 4, -6);
    this.scene.add(key, fill, rim);
  }

  /**
   * 촬영 준비: 촬영용 인형이 없으면 만들고(장면 한 번 복제, 재질 복제 — 공유 GLB 재질은 건드리지 않는다 —, 뼈대
   * 하나로 묶고, Idle 자세) 셰이더를 비동기로 만든다. 다 되면 true.
   */
  prepare(gl: WebGLRenderer): boolean {
    if (this.rig) return this.rig.ready;
    const root = cloneSkinned(this.source.scene);
    const nodes = new Map<string, Object3D>();
    const clones = new Map<Material, MeshStandardMaterial>();
    let skeleton: Skeleton | null = null;
    const visit = (node: Object3D) => {
      for (const child of node.children) {
        if (PART_NODE.test(child.name)) nodes.set(child.name, child);
        else visit(child);
      }
    };
    visit(root);
    root.traverse((o) => {
      const mesh = o as SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      const source = mesh.material as MeshStandardMaterial;
      let own = clones.get(source);
      if (!own) {
        own = source.clone();
        clones.set(source, own);
      }
      mesh.material = own;
      // SkeletonUtils.clone은 메시마다 Skeleton을 만든다. 부품은 모두 같은 뼈를 쓰므로(Task 5) 하나로 묶어 뼈 텍스처도 하나.
      if (mesh.isSkinnedMesh) {
        if (!skeleton) skeleton = mesh.skeleton;
        else mesh.bind(skeleton, mesh.bindMatrix);
      }
    });
    // Idle 한 장면으로 세운다. 동작을 멈추거나 믹서 캐시를 지우면 three가 뼈를 쉬는 자세(T자)로 되돌리므로
    // 믹서는 촬영용 인형과 함께 두고 다시 update하지 않는다.
    const idle = this.source.animations.find((clip) => clip.name === CLIP.idle);
    let mixer: AnimationMixer | null = null;
    if (idle) {
      mixer = new AnimationMixer(root);
      mixer.clipAction(idle).play();
      mixer.update(0.6);
    }
    root.updateMatrixWorld(true);
    this.scene.add(root);
    const rig: Rig = { root, nodes, materials: [...clones.values()], skeleton, mixer, ready: false };
    this.rig = rig;
    const ready = () => {
      rig.ready = true; // 미리 만들지 못했어도 그릴 때 만든다
    };
    gl.compileAsync(this.scene, this.camera).then(ready, ready);
    return false;
  }

  /** 촬영용 인형을 놓는다(복제 재질·뼈 텍스처 dispose). 다음 일감이 오면 다시 만든다. */
  release(): void {
    const rig = this.rig;
    if (!rig) return;
    this.rig = null;
    this.scene.remove(rig.root);
    rig.mixer?.uncacheRoot(rig.root);
    for (const m of rig.materials) m.dispose();
    rig.skeleton?.dispose();
  }

  /** 자세를 잡은 부품 노드의 월드 경계 상자(스킨 적용). 부품마다 한 번만 잰다. */
  private posedBox(rig: Rig, name: string): Box3 | null {
    const cached = this.boxes.get(name);
    if (cached) return cached;
    const node = rig.nodes.get(name);
    if (!node) return null;
    const box = new Box3();
    node.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as SkinnedMesh).isSkinnedMesh) (mesh as SkinnedMesh).computeBoundingBox();
      else if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const local = (mesh as SkinnedMesh).isSkinnedMesh ? (mesh as SkinnedMesh).boundingBox : mesh.geometry.boundingBox;
      if (local) box.union(local.clone().applyMatrix4(mesh.matrixWorld));
    });
    if (box.isEmpty()) return null;
    this.boxes.set(name, box);
    return box;
  }

  /**
   * 일감 하나를 찍는다(prepare가 true일 때). 찍기와 복사는 지금 하고, 인코딩이 끝나면 URL을 돌려준다.
   * 그릴 수 없으면 null(카드는 이름만 보인다).
   */
  shoot(gl: WebGLRenderer, job: ThumbJob): Promise<string | null> | null {
    const rig = this.rig;
    if (!rig?.ready) return null;
    let names: string[];
    let colors: Record<TintKey, string>;
    if (job.kind === "chip") {
      names = chipNodes(job.slot, job.part);
      colors = { ...BASE_COLORS, [tintKeyFor(job.slot)]: job.hex };
    } else {
      const preset = APPEARANCE_PRESETS.find((p) => p.id === job.presetId);
      if (!preset) return null;
      const look = lookFromAppearance(applyPreset(DEFAULT_APPEARANCE, preset));
      names = visibleParts(look.parts);
      colors = look.colors;
    }
    if (names.some((n) => !rig.nodes.has(n))) return null;
    for (const [name, node] of rig.nodes) node.visible = names.includes(name);
    const tints = CHARACTER_MANIFEST.tintMaterials as Record<TintKey, string>;
    for (const m of rig.materials) {
      for (const key of Object.keys(tints) as TintKey[]) if (tints[key] === m.name) m.color.set(colors[key]);
    }

    const renderPx = job.kind === "chip" ? CHIP_RENDER_PX : THUMB_PX.preset;
    const crop = job.kind === "chip" ? this.frameChip(rig, job.slot, names, renderPx) : this.framePortrait(rig, renderPx);
    if (!crop) return null;
    const outPx = job.kind === "chip" ? THUMB_PX.chip : THUMB_PX.preset;
    const out = this.render(gl, renderPx, crop, outPx, job.kind === "chip" ? CHIP_PAD : 0);
    if (!out) return null;
    return new Promise((resolve) => {
      out.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), "image/webp", 0.9);
    });
  }

  /** 부품 상자에 맞춰 카메라를 두고, 그 상자가 찍힐 영역을 돌려준다. */
  private frameChip(rig: Rig, slot: CharacterSlot, names: string[], renderPx: number): Crop | null {
    const box = new Box3();
    for (const name of names) {
      const b = this.posedBox(rig, name);
      if (b) box.union(b);
    }
    if (box.isEmpty()) return null;
    const center = box.getCenter(new Vector3());
    const radius = Math.max(0.05, box.getSize(new Vector3()).length() / 2);
    const [yaw, pitch] = CHIP_VIEW[slot];
    this.aim(center, (radius / Math.sin(MathUtils.degToRad(THUMB_FOV) / 2)) * 1.02, yaw, pitch);
    // 상자 꼭짓점 8개를 화면에 투영한 범위가 잘라 낼 영역이다(픽셀을 읽어 훑지 않는다).
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const p = new Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(this.camera);
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    const toPx = (v: number) => Math.min(renderPx, Math.max(0, ((v + 1) / 2) * renderPx));
    const crop = { x: toPx(x0), y: renderPx - toPx(y1), w: toPx(x1) - toPx(x0), h: toPx(y1) - toPx(y0) };
    return crop.w > 1 && crop.h > 1 ? crop : null;
  }

  /** 프리셋 얼굴 그림: 머리를 중심으로 모자 일부와 어깨까지(상반신). 찍은 정사각형 전체를 쓴다. */
  private framePortrait(rig: Rig, renderPx: number): Crop | null {
    const head = this.posedBox(rig, "body__head");
    if (!head) return null;
    const size = head.getSize(new Vector3());
    const side = size.y * 1.6;
    const center = new Vector3((head.min.x + head.max.x) / 2, head.min.y + size.y * 0.58, (head.min.z + head.max.z) / 2);
    this.aim(center, side / 2 / Math.tan(MathUtils.degToRad(THUMB_FOV) / 2), 0.45, 0.08);
    return { x: 0, y: 0, w: renderPx, h: renderPx };
  }

  private aim(center: Vector3, distance: number, yaw: number, pitch: number): void {
    const c = this.camera;
    c.position.set(
      center.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      center.y + Math.sin(pitch) * distance,
      center.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    c.near = Math.max(0.01, distance / 20);
    c.far = distance * 4;
    c.updateProjectionMatrix();
    c.lookAt(center);
    c.updateMatrixWorld();
  }

  /**
   * 기본 프레임버퍼 왼쪽 아래 renderPx²에 찍고, 같은 프레임 안에서(화면에 내보내기 전) 캔버스의 그 구석을 새 2D
   * 캔버스로 복사한다: crop 영역을 outPx 정사각형 가운데에(여백 pad) 맞춘다. 미리보기 렌더가 곧 화면 전체를 다시 그린다.
   */
  private render(gl: WebGLRenderer, renderPx: number, crop: Crop, outPx: number, pad: number): HTMLCanvasElement | null {
    const s = this.saved;
    gl.getDrawingBufferSize(s.size);
    if (s.size.x < renderPx || s.size.y < renderPx) return null;
    const out = document.createElement("canvas");
    out.width = outPx;
    out.height = outPx;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    const pr = gl.getPixelRatio();
    const target = gl.getRenderTarget();
    const autoClear = gl.autoClear;
    const scissorTest = gl.getScissorTest();
    const clearAlpha = gl.getClearAlpha();
    gl.getViewport(s.viewport);
    gl.getScissor(s.scissor);
    gl.getClearColor(s.clear);
    try {
      gl.setRenderTarget(null);
      gl.setViewport(0, 0, renderPx / pr, renderPx / pr);
      gl.setScissor(0, 0, renderPx / pr, renderPx / pr);
      gl.setScissorTest(true);
      gl.setClearColor(0x000000, 0);
      gl.autoClear = false;
      gl.clear(true, true, true);
      gl.render(this.scene, this.camera);
      const scale = (outPx * (1 - 2 * pad)) / Math.max(crop.w, crop.h);
      const dw = crop.w * scale;
      const dh = crop.h * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // 캔버스 픽셀은 위가 0이다: 프레임버퍼 왼쪽 아래 구석은 캔버스 높이 - renderPx에서 시작한다.
      ctx.drawImage(gl.domElement, crop.x, s.size.y - renderPx + crop.y, crop.w, crop.h, (outPx - dw) / 2, (outPx - dh) / 2, dw, dh);
    } finally {
      gl.autoClear = autoClear;
      gl.setClearColor(s.clear, clearAlpha);
      gl.setScissorTest(scissorTest);
      gl.setScissor(s.scissor);
      gl.setViewport(s.viewport);
      gl.setRenderTarget(target);
    }
    return out;
  }
}
