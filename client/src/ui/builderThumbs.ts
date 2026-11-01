// 조립실 부품 카드·프리셋 카드의 그림(Task 7b). 빌드 때 굽지 않고 실행 중에 미리보기 Canvas의 WebGL 렌더러
// 하나로 그린다(두 번째 WebGL 컨텍스트 없음): 첫 화면 용량을 아끼고, GLB가 바뀌면 그림도 저절로 맞고, 지금 고른
// 색으로 칠할 수 있다.
//
// 순수 부분(테스트): 캐시 키(칩 = 부품 + 색, 프리셋 = id), 그릴 순서(지금 탭 → 프리셋 → 다른 탭), 프레임당 2장.
// three 부분(ThumbStudio): character.glb 장면을 한 번 복제해 Idle 자세로 세운 "촬영용 인형"을 만들고(셰이더는
// KHR_parallel_shader_compile로 미리 — 프레임을 막지 않는다), 일감마다 보일 부품과 색만 바꿔 렌더 타깃에 찍는다
// (화면 = 기본 프레임버퍼는 건드리지 않는다: 예전처럼 캔버스 구석에 그리고 drawImage로 읽으면, 느린 GPU(SwiftShader)
// 에서 그 사이의 캔버스가 인형 없이 화면에 나가는 일이 있었다). 출력 패스로 미리보기와 같은 톤매핑·sRGB를 입히고,
// 픽셀을 비동기로 읽어(PBO) WebP blob URL을 만든다. 동시에 그리는 중인 그림은 2장까지(GPU가 밀리면 기다린다).
// 촬영용 인형·렌더 타깃은 조립실이 닫힐 때 놓는다(복제한 재질·뼈 텍스처·타깃을 dispose).
// useAvatar를 거치지 않으므로 __cvAvatars 항목도, 합친 지오메트리 캐시 몫도 늘지 않는다. 그림이 없거나
// 실패하면 카드는 이름만 보인다.

import {
  ACESFilmicToneMapping,
  AnimationMixer,
  Box3,
  Color,
  ColorManagement,
  DirectionalLight,
  HalfFloatType,
  HemisphereLight,
  MathUtils,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RawShaderMaterial,
  SRGBTransfer,
  Scene,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
  type AnimationClip,
  type Material,
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
import { THUMB_LIGHTS } from "./builderOptions";
import { CLIP } from "../game/constants";

/** 그림 크기(px): 칩은 64 CSS px에 2배, 프리셋은 80 CSS px에 2배. */
export const THUMB_PX = { chip: 128, preset: 160 } as const;
/** 한 프레임에 그리는 그림 수. */
export const THUMBS_PER_FRAME = 2;
/**
 * 동시에 그리는 중(GPU에서 읽어 오기·인코딩)일 수 있는 그림 수. 읽기는 비동기라 찍는 데 드는 GPU 시간이 프레임 예산에
 * 잡히지 않는다: 느린 GPU에서 프레임마다 2장씩 쌓이면 미리보기 프레임이 그 뒤에 밀린다. 이만큼 밀려 있으면 새 그림은
 * 다음 프레임으로 미룬다.
 */
export const THUMBS_IN_FLIGHT = 2;
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

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * 그림 캐시: 키 → 그림 URL(실패는 null). 그리는 중(begin~set)인 키도 "있음"으로 쳐서 다시 일감으로 나가지 않는다.
 * 상한을 넘으면 오래된 것부터, 지금 원하는 키가 아닌 것만 버리고 그 URL을 놓는다. 무엇이든 바뀌면 version이 오른다.
 */
export class ThumbCache {
  private readonly urls = new Map<string, string | null>();
  private readonly pending = new Set<string>();
  private readonly listeners = new Set<() => void>();
  /** begin·set·forgetFailures마다 오른다(스케줄러가 다시 훑을지 정한다). */
  version = 0;

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

  /** 지금 그리는 중(GPU에서 읽어 오기·인코딩)인 그림 수. */
  get drawing(): number {
    return this.pending.size;
  }

  /** 그리기 시작(인코딩이 끝나 set이 올 때까지). */
  begin(key: string): void {
    this.pending.add(key);
    this.version += 1;
  }

  set(key: string, url: string | null, keep: ReadonlySet<string> = NO_KEYS): void {
    this.pending.delete(key);
    this.version += 1;
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

  /** 실패한 그림을 잊는다(다시 일감이 된다 — 미리보기 캔버스 크기가 바뀔 때 한 번 더 해 본다). */
  forgetFailures(): void {
    let forgot = false;
    for (const [key, url] of this.urls) {
      if (url !== null) continue;
      this.urls.delete(key);
      forgot = true;
    }
    if (forgot) this.version += 1;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * 이번 프레임에 그릴 일감: 순서대로, 아직 캐시에 없는(그린 적도, 실패한 적도, 그리는 중도 아닌) 것 n개까지.
 * out을 비우고 채워 돌려준다(프레임마다 새 배열을 만들지 않게).
 */
export function nextThumbJobs(jobs: readonly ThumbJob[], cache: ThumbCache, n = THUMBS_PER_FRAME, out: ThumbJob[] = []): ThumbJob[] {
  out.length = 0;
  for (const job of jobs) {
    if (out.length >= n) break;
    if (!cache.has(job.key)) out.push(job);
  }
  return out;
}

/**
 * 프레임 경로의 그림 일감 고르기. 패널이 want()로 원하는 일감을 바꾸고, 미리보기 Canvas가 프레임마다 next()를 부른다.
 * 일감도 캐시도 그대로면 다시 훑지 않고(모두 그린 뒤에는 프레임마다 하는 일이 없다), 늘 같은 배열을 채워 준다.
 * disable()하면 이 세션 동안 그림을 그리지 않는다(카드는 이름만).
 */
export class ThumbScheduler {
  private jobs: readonly ThumbJob[] = [];
  private wanted: ReadonlySet<string> = NO_KEYS;
  private wantVersion = 0;
  /** 마지막으로 "할 일 없음"을 확인한 때의 버전. 그대로면 다시 훑지 않는다. */
  private idleAt = { want: -1, cache: -1 };
  private readonly batch: ThumbJob[] = [];
  disabled = false;

  constructor(readonly cache: ThumbCache = new ThumbCache()) {}

  /** 지금 원하는 그림 키(캐시가 상한을 넘어도 이것들은 지우지 않는다). */
  get keys(): ReadonlySet<string> {
    return this.wanted;
  }

  want(jobs: readonly ThumbJob[]): void {
    this.jobs = jobs;
    this.wanted = new Set(jobs.map((j) => j.key));
    this.wantVersion += 1;
  }

  next(n = THUMBS_PER_FRAME): readonly ThumbJob[] {
    if (this.disabled || (this.idleAt.want === this.wantVersion && this.idleAt.cache === this.cache.version)) {
      this.batch.length = 0;
      return this.batch;
    }
    nextThumbJobs(this.jobs, this.cache, n, this.batch);
    if (this.batch.length === 0) {
      this.idleAt.want = this.wantVersion;
      this.idleAt.cache = this.cache.version;
    }
    return this.batch;
  }

  /** 실패한 그림을 다시 해 본다(미리보기 캔버스 크기가 바뀐 뒤). */
  retryFailed(): void {
    this.cache.forgetFailures();
  }

  disable(): void {
    this.disabled = true;
  }
}

/** 조립실이 쓰는 그림 일감·캐시(패널이 정하고, 미리보기 Canvas 안의 그리는 쪽이 가져간다). */
export const thumbStore = new ThumbScheduler();

/** 그림을 찍는 쪽(ThumbStudio). 테스트에서는 가짜를 넣는다. */
export interface ThumbShooter<G> {
  /** 찍을 준비가 되었는가(촬영용 인형·셰이더). 던지면 그림을 끈다. */
  prepare(gl: G): boolean;
  /** 지금 찍고, 인코딩이 끝나면 URL. 그릴 수 없으면 null. */
  shoot(gl: G, job: ThumbJob): Promise<string | null> | null;
  release(): void;
}

/** 기본 시계(모듈 하나 — 프레임마다 새 함수를 만들지 않게). */
const now = () => performance.now();

/** 한 프레임에서 그림 찍기에 쓰는 시간: 첫 장을 찍고 이만큼 넘었으면 둘째 장은 다음 프레임으로 미룬다. */
export const THUMB_FRAME_BUDGET_MS = 6;

/**
 * 미리보기 프레임마다 한 번(useFrame): 그릴 그림이 있으면 2장까지(시간이 모자라면 1장, GPU가 앞의 그림 2장을 아직
 * 하는 중이면 0장 — THUMBS_IN_FLIGHT) 찍는다. 일감이 없을 때는
 * 할당 없이 바로 돌아간다. 촬영용 인형은 일이 없어도 놓지 않는다 — 조립실이 떠 있는 동안 두고 닫힐 때 놓는다
 * (PreviewThumbs). 색을 바꿀 때마다 다시 만들면 4배 느린 CPU에서 그 프레임이 약 30 ms 더 길어졌다(보고서 Fix round 1).
 * 촬영 준비가 던지면(WebGL 기능 부족 등) 이 세션의 그림을 끄고 인형을 놓는다 — 미리보기는 계속 그린다.
 */
export function drawThumbFrame<G>(
  scheduler: ThumbScheduler,
  studio: ThumbShooter<G>,
  gl: G,
  clock: () => number = now,
): void {
  const jobs = scheduler.next();
  if (jobs.length === 0) return;
  try {
    if (!studio.prepare(gl)) return; // 셰이더를 만드는 중(메인 스레드를 막지 않는다)
  } catch (err) {
    scheduler.disable();
    try {
      studio.release();
    } catch {
      /* 이미 반쯤 만든 것을 놓다 실패해도 미리보기는 계속 */
    }
    if (import.meta.env?.DEV) console.warn("[builder] card pictures are off for this session", err);
    return;
  }
  const { cache } = scheduler;
  const start = clock();
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (i > 0 && clock() - start > THUMB_FRAME_BUDGET_MS) break;
    if (cache.drawing >= THUMBS_IN_FLIGHT) break; // GPU가 아직 앞의 그림을 하는 중
    let shot: Promise<string | null> | null = null;
    try {
      shot = studio.shoot(gl, job);
    } catch (err) {
      if (import.meta.env?.DEV) console.warn("[builder] thumbnail failed", job.key, err);
    }
    if (!shot) {
      cache.set(job.key, null, scheduler.keys);
      cache.notify();
      continue;
    }
    cache.begin(job.key);
    const key = job.key;
    shot.then(
      (url) => {
        cache.set(key, url, scheduler.keys);
        cache.notify();
      },
      () => {
        cache.set(key, null, scheduler.keys);
        cache.notify();
      },
    );
  }
}

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
/** 그림을 찍는 정사각형(px, 렌더 타깃 크기): 칩은 이것을 부품 상자로 잘라 128에, 프리셋은 통째로 160에 맞춘다. */
const RENDER_PX = 192;
const CHIP_PAD = 0.08;
/** 프리셋 얼굴 그림이 담는 높이(머리 높이의 배수)와 그 가운데(머리 아래에서 머리 높이의 비율). */
const PORTRAIT_SPAN = 1.3;
const PORTRAIT_CENTER = 0.5;
/** 기본 외형의 색(머리카락 칩의 피부·얼굴 칩의 머리처럼 고정으로 보이는 부분). */
const BASE_COLORS = lookFromAppearance(DEFAULT_APPEARANCE).colors;

function tintKeyFor(slot: CharacterSlot): TintKey {
  return slot === "face" ? "skin" : slot;
}

/**
 * 출력 패스: 렌더 타깃에 찍은 장면(선형, 톤매핑 전 — three는 렌더 타깃에는 톤매핑·sRGB를 하지 않는다)을 미리보기
 * 캔버스와 같은 모습으로 바꾼다. MSAA로 풀린 가장자리의 미리 곱한 알파를 풀고, 렌더러와 같은 톤매핑(ACES)과 sRGB
 * 전달 함수를 쓴다(three의 OutputShader와 같은 계산·같은 셰이더 조각).
 */
const OUTPUT_VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const OUTPUT_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tScene, vUv);
  if (c.a > 0.0) c.rgb /= c.a;
  #ifdef ACES_FILMIC_TONE_MAPPING
  c.rgb = ACESFilmicToneMapping(c.rgb);
  #endif
  #ifdef SRGB_TRANSFER
  c = sRGBTransferOETF(c);
  #endif
  gl_FragColor = c;
}`;

interface Rig {
  root: Object3D;
  nodes: Map<string, Object3D>;
  materials: MeshStandardMaterial[];
  skeleton: Skeleton | null;
  /** Idle 자세를 붙들고 있는 믹서(놓을 때 함께 버린다). */
  mixer: AnimationMixer | null;
  /** 장면을 찍는 MSAA 렌더 타깃(가능하면 half float)과, 출력 패스가 쓰는 8비트 렌더 타깃. */
  sceneTarget: WebGLRenderTarget;
  outTarget: WebGLRenderTarget;
  output: RawShaderMaterial;
  quad: Mesh;
  /** 렌더 타깃용 셰이더를 만드는 중인 재질(KHR_parallel_shader_compile: 드라이버가 메인 스레드를 막지 않고 만든다). */
  compiling: Material[];
  /** 셰이더를 다 만들었는가. */
  ready: boolean;
}

/**
 * 이 재질의 셰이더가 다 만들어졌는가. three의 compileAsync와 같은 확인이지만 타이머로 묻지 않고 일감이 있는 프레임에
 * 묻는다: 조립실이 셰이더를 만드는 중에 닫혀도(재질을 놓아도) 남아서 도는 콜백이 없다. 컨텍스트를 잃었으면 false.
 */
function compiled(gl: WebGLRenderer, material: Material): boolean {
  const { currentProgram } = gl.properties.get(material) as { currentProgram?: { isReady(): boolean | null } };
  return currentProgram?.isReady() === true;
}

/** 잘라 낼 영역(찍은 정사각형 안의 정수 px, 위가 0). */
interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 미리보기 렌더러로 부품·프리셋 그림을 찍는다. 화면(기본 프레임버퍼)은 건드리지 않는다: 렌더 타깃에 찍고 출력 패스를
 * 거쳐 readRenderTargetPixelsAsync(PBO + 펜스, 메인 스레드를 막지 않는다)로 읽은 뒤 2D 캔버스에 놓고 비동기(toBlob)로
 * 인코딩한다. 그래서 미리보기 캔버스가 그림을 찍는 중간 상태로 화면에 나갈 일이 없다. 두 번째 WebGL 컨텍스트는 없다.
 * 렌더러 상태(렌더 타깃·지움 색·autoClear)는 되돌린다.
 */
export class ThumbStudio {
  private rig: Rig | null = null;
  /** 자세를 잡은 부품의 월드 상자. 자세는 늘 같으므로 촬영용 인형을 다시 만들어도 그대로 쓴다. */
  private readonly boxes = new Map<string, Box3>();
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(THUMB_FOV, 1, 0.05, 60);
  private readonly outScene = new Scene();
  private readonly outCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly clearColor = new Color();

  constructor(private readonly source: { scene: Object3D; animations: AnimationClip[] }) {
    // 미리보기와 같은 조명(테두리광만 THUMB_RIM_LIGHT).
    const { hemi, sun, fill, rim } = THUMB_LIGHTS;
    this.scene.add(new HemisphereLight(hemi.sky, hemi.ground, hemi.intensity));
    for (const light of [sun, fill, rim]) {
      const d = new DirectionalLight(light.color, light.intensity);
      d.position.set(light.position[0], light.position[1], light.position[2]);
      this.scene.add(d);
    }
  }

  /**
   * 촬영 준비: 촬영용 인형이 없으면 만들고(장면 한 번 복제, 재질 복제 — 공유 GLB 재질은 건드리지 않는다 —, 뼈대
   * 하나로 묶고, Idle 자세), 렌더 타깃·출력 패스를 만들고, 렌더 타깃용 셰이더를 만들기 시작한다. 셰이더가 다 되면 true
   * (일감이 있는 프레임마다 다시 묻는다).
   */
  prepare(gl: WebGLRenderer): boolean {
    const built = this.rig;
    if (built) {
      if (!built.ready) built.ready = built.compiling.every((m) => compiled(gl, m));
      return built.ready;
    }
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

    // 톤매핑 전 값이 1을 넘으므로 가능하면 half float(EXT_color_buffer_float), 없으면 8비트(어두운 곳 띠가 조금 생긴다).
    const sceneTarget = new WebGLRenderTarget(RENDER_PX, RENDER_PX, {
      type: gl.extensions.has("EXT_color_buffer_float") ? HalfFloatType : UnsignedByteType,
      samples: 4,
    });
    const outTarget = new WebGLRenderTarget(RENDER_PX, RENDER_PX, { type: UnsignedByteType, depthBuffer: false });
    const defines: Record<string, string> = {};
    if (gl.toneMapping === ACESFilmicToneMapping) defines.ACES_FILMIC_TONE_MAPPING = "";
    if (ColorManagement.getTransfer(gl.outputColorSpace) === SRGBTransfer) defines.SRGB_TRANSFER = "";
    const output = new RawShaderMaterial({
      name: "ThumbOutputPass",
      uniforms: { tScene: { value: sceneTarget.texture }, toneMappingExposure: { value: gl.toneMappingExposure } },
      vertexShader: OUTPUT_VERTEX,
      fragmentShader: OUTPUT_FRAGMENT,
      defines,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), output);
    quad.frustumCulled = false;
    this.outScene.add(quad);

    // 셰이더를 만들기 전에 rig로 걸어 둔다: compile·setRenderTarget이 던지면(컨텍스트 잃음 등) drawThumbFrame이
    // release()를 부르는데, 그때 위에서 만든 인형·복제 재질·렌더 타깃·출력 패스를 모두 놓을 수 있어야 한다.
    const compiling: Material[] = [];
    this.rig = { root, nodes, materials: [...clones.values()], skeleton, mixer, sceneTarget, outTarget, output, quad, compiling, ready: false };
    // 셰이더는 렌더 타깃에 그릴 때의 것(톤매핑·sRGB 없음)이 따로 있으므로 그 타깃을 걸어 둔 채 만든다.
    const target = gl.getRenderTarget();
    try {
      gl.setRenderTarget(sceneTarget);
      compiling.push(...gl.compile(this.scene, this.camera));
      gl.setRenderTarget(outTarget);
      compiling.push(...gl.compile(this.outScene, this.outCamera));
    } finally {
      gl.setRenderTarget(target);
    }
    return false;
  }

  /** 촬영용 인형을 놓는다(복제 재질·뼈 텍스처·렌더 타깃·출력 패스 dispose). 다음 일감이 오면 다시 만든다. */
  release(): void {
    const rig = this.rig;
    if (!rig) return;
    this.rig = null;
    this.scene.remove(rig.root);
    this.outScene.remove(rig.quad);
    rig.mixer?.uncacheRoot(rig.root);
    for (const m of rig.materials) m.dispose();
    rig.skeleton?.dispose();
    rig.sceneTarget.dispose();
    rig.outTarget.dispose();
    rig.output.dispose();
    rig.quad.geometry.dispose();
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
   * 일감 하나를 찍는다(prepare가 true일 때). 렌더 타깃에 찍고 출력 패스를 거쳐 읽기를 지금 걸어 두고(PBO), 읽기와
   * 인코딩이 끝나면 URL을 돌려준다. 그릴 수 없으면 null(카드는 이름만 보인다).
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

    const crop = job.kind === "chip" ? this.frameChip(rig, job.slot, names) : this.framePortrait(rig);
    if (!crop) return null;
    const pixels = new Uint8Array(crop.w * crop.h * 4);
    const target = gl.getRenderTarget();
    const autoClear = gl.autoClear;
    const clearAlpha = gl.getClearAlpha();
    gl.getClearColor(this.clearColor);
    let read: Promise<unknown>;
    try {
      gl.autoClear = false;
      gl.setClearColor(0x000000, 0);
      gl.setRenderTarget(rig.sceneTarget);
      gl.clear(true, true, true);
      gl.render(this.scene, this.camera);
      rig.output.uniforms.toneMappingExposure.value = gl.toneMappingExposure;
      gl.setRenderTarget(rig.outTarget);
      gl.render(this.outScene, this.outCamera);
      // 렌더 타깃의 줄은 아래에서 위로 간다: 위가 0인 crop은 아래에서 RENDER_PX - (y + h)에서 시작한다.
      read = gl.readRenderTargetPixelsAsync(rig.outTarget, crop.x, RENDER_PX - crop.y - crop.h, crop.w, crop.h, pixels);
    } finally {
      gl.setRenderTarget(target);
      gl.setClearColor(this.clearColor, clearAlpha);
      gl.autoClear = autoClear;
    }
    const outPx = job.kind === "chip" ? THUMB_PX.chip : THUMB_PX.preset;
    const pad = job.kind === "chip" ? CHIP_PAD : 0;
    return read.then(() => encodeThumb(pixels, crop.w, crop.h, outPx, pad));
  }

  /** 부품 상자에 맞춰 카메라를 두고, 그 상자가 찍힐 영역(정수 px)을 돌려준다. */
  private frameChip(rig: Rig, slot: CharacterSlot, names: string[]): Crop | null {
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
    const toPx = (v: number) => Math.min(RENDER_PX, Math.max(0, ((v + 1) / 2) * RENDER_PX));
    const left = Math.floor(toPx(x0));
    const top = Math.floor(RENDER_PX - toPx(y1));
    const crop = { x: left, y: top, w: Math.ceil(toPx(x1)) - left, h: Math.ceil(RENDER_PX - toPx(y0)) - top };
    return crop.w > 1 && crop.h > 1 ? crop : null;
  }

  /**
   * 프리셋 얼굴 그림: 시안처럼 얼굴이 카드를 채운다 — 머리를 가운데 두고 머리 높이의 1.3배만 담는다(큰 모자 끝과 어깨는
   * 잘린다). 카드는 가운데 맞춰 자르므로(object-fit: cover) 세로로 긴 카드는 양옆이, 가로로 긴 휴대폰 카드는 위아래가
   * 잘려도 얼굴은 남는다. 찍은 정사각형 전체를 쓴다.
   */
  private framePortrait(rig: Rig): Crop | null {
    const head = this.posedBox(rig, "body__head");
    if (!head) return null;
    const size = head.getSize(new Vector3());
    const side = size.y * PORTRAIT_SPAN;
    const center = new Vector3((head.min.x + head.max.x) / 2, head.min.y + size.y * PORTRAIT_CENTER, (head.min.z + head.max.z) / 2);
    this.aim(center, side / 2 / Math.tan(MathUtils.degToRad(THUMB_FOV) / 2), 0.45, 0.08);
    return { x: 0, y: 0, w: RENDER_PX, h: RENDER_PX };
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
}

/**
 * 읽은 픽셀(아래에서 위로, 곧은 알파 RGBA8) → 위아래를 뒤집어 2D 캔버스에 놓고, outPx 정사각형 가운데에(여백 pad)
 * 비율을 지켜 맞춘 뒤 WebP blob URL로(비동기). 아무것도 찍히지 않았으면 null.
 */
function encodeThumb(pixels: Uint8Array, w: number, h: number, outPx: number, pad: number): Promise<string | null> {
  let drawn = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > 8) {
      drawn = true;
      break;
    }
  }
  if (!drawn) return Promise.resolve(null);
  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const out = document.createElement("canvas");
  out.width = outPx;
  out.height = outPx;
  const wctx = work.getContext("2d");
  const octx = out.getContext("2d");
  if (!wctx || !octx) return Promise.resolve(null);
  const image = wctx.createImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) image.data.set(pixels.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  wctx.putImageData(image, 0, 0);
  const scale = (outPx * (1 - 2 * pad)) / Math.max(w, h);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(work, 0, 0, w, h, (outPx - w * scale) / 2, (outPx - h * scale) / 2, w * scale, h * scale);
  return new Promise((resolve) => out.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), "image/webp", 0.9));
}
