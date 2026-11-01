// 조립식 아바타(설계 5.3·5.4). 공유 character.glb 장면을 SkeletonUtils로 복제하고, 보이는 부품만 남긴다.
// 텍스처가 없는 부품(피부·틴트·고정색)은 외형 색을 정점색으로 구운 SkinnedMesh 하나(`avatar__solid`)로 합치고,
// 텍스처가 있는 얼굴만 따로 그린다. 그래서 아바타 1명이 그리는 메시는 보통 2개다(예산 MAX_DRAW_MESHES).
// React·drei를 import 하지 않는다(훅은 useAvatar.ts).
//
// 합친 지오메트리는 lookKey로 공유한다(같은 외형 = 같은 지오메트리, nametag.ts의 텍스처 캐시처럼 참조 카운트).
// 소유 규칙 — React 19 StrictMode(개발)에서도 운영에서도 잡기·놓기가 정확히 짝을 이루게 나눈다:
// - assembleAvatar: 렌더 단계용. 아무것도 잡지 않는다. 캐시에 그 외형이 있으면 그 지오메트리를 쓰고, 없으면 합쳐서
//   "아직 아무도 잡지 않은" 항목(refs 0)으로 넣는다. 그래서 StrictMode가 useMemo를 두 번 불러도, 커밋되지 않고
//   버려지는 렌더가 있어도 새는 참조가 없고, 같은 커밋에 같은 외형이 여럿 들어와도 한 번만 합친다.
// - retainAvatar: 지오메트리 몫 +1(이미 잡았으면 아무것도 안 함). 그사이 캐시에서 빠졌으면 자기 지오메트리를 다시
//   넣고, 같은 키로 다른 지오메트리가 들어와 있으면 그쪽으로 바꿔 탄다. 아무도 잡지 않은 항목은 이때 캐시에서
//   뺀다(잡은 아바타가 없었으니 그려진 적도 없어 dispose할 GPU 자원이 없다. 남은 배열은 GC가 치운다).
//   이 청소는 retainAvatar 안에서만 한다: 커밋되지 않은 렌더가 합친 지오메트리는 다음 retainAvatar까지 캐시에
//   남는다(CPU 메모리뿐, GPU에는 올라간 적이 없다).
// - releaseAvatar: 몫 −1(두 번 불러도 한 번만). 0이 되면 지오메트리를 dispose하고 캐시에서 뺀다. 재질과 뼈 텍스처도
//   dispose한다. three는 dispose한 자원을 다시 그릴 때 다시 올리므로, 다시 retainAvatar한 아바타는 그대로 쓸 수 있다.
// - releaseAvatarSoon: 마이크로태스크 뒤에 releaseAvatar. 그 전에 retainAvatar가 오면 취소된다. StrictMode의 effect
//   재실행(cleanup → setup)은 같은 태스크 안에서 일어나므로 중간에 dispose되지 않고, 진짜 언마운트에서 한 번만 놓는다.
// - buildAvatar = assembleAvatar + retainAvatar(곧바로 소유하는 경로. 테스트·React 밖에서 쓴다).
//
// 캐시는 한 캐릭터 장면을 전제한다(drei가 URL마다 GLTF를 하나만 캐시한다). 합치기는 Task 2 테스트가 고정한 전제
// (부품 변환 항등, 스킨 1개, 인덱스 있음, 속성 화이트리스트)에 기댄다.

import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  MeshStandardMaterial,
  SkinnedMesh,
  Sphere,
  Uint16BufferAttribute,
  Vector3,
  type BufferAttribute,
  type InterleavedBufferAttribute,
  type Material,
  type Mesh,
  type Object3D,
  type Skeleton,
} from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { lookKey, solidColorFor, visibleParts, type AvatarLook } from "./characterLook";

export interface AvatarAssets {
  /** 캐시된 character.glb 장면. 읽기만 하고 바꾸지 않는다. */
  scene: Object3D;
}

export interface BuiltAvatar {
  /** 씬에 붙일 복제본(뼈 + 남은 메시). */
  root: Object3D;
  /** 이 아바타가 소유한 재질(합친 재질·얼굴·decorate가 넣은 것). 해제·반투명 대상. */
  materials: Material[];
  /** visibleParts 결과(정렬). */
  parts: string[];
  /** 합친 지오메트리 캐시 키(= lookKey). */
  solidKey: string;
  /** root 아래 보이는 Mesh 수. */
  drawMeshes: number;
  /** 그 메시들의 삼각형 합. */
  triangles: number;
}

/** 아바타 1명이 그려도 되는 메시 수(설계 5.4). */
export const MAX_DRAW_MESHES = 8;
/** 합친 메시의 거칠기. 부품 재질(0.25~0.7)의 가운데쯤. */
export const SOLID_ROUGHNESS = 0.45;
/**
 * 스킨 메시마다 주는 넉넉한 경계 구. 스킨 메시의 경계는 쉬는 자세 기준이라 애니메이션 중에 화면 가장자리에서
 * 잘려 사라진다. 객체 자신의 boundingSphere를 주면 three가 공유 지오메트리 대신 이것을 본다(옛 avatar.ts BOUNDS_*).
 */
export const AVATAR_BOUNDS = { center: [0, 1, 0], radius: 3 } as const;

/** 부품 노드 이름. 다중 재질 부품은 이 이름의 Group 아래에 `<부품>_1`, `<부품>_2` Mesh가 있다. */
const PART_NODE = /^(body|hat|hair|face|top|bottom|shoes|item)__/;
const SOLID_NAME = "avatar__solid";

/** setAvatarOpacity가 되돌아갈 원래 상태. 조립 때 재질마다 userData.base에 적는다. */
interface OpacityBase {
  transparent: boolean;
  depthWrite: boolean;
  opacity: number;
}

// ── 합친 지오메트리 캐시 ───────────────────────────────────────────────────────

interface SolidEntry {
  geometry: BufferGeometry;
  /** 이 지오메트리를 잡은 아바타 수. 0 = 렌더 단계에서 합쳤지만 아직 아무도 잡지 않음. */
  refs: number;
}

const solidCache = new Map<string, SolidEntry>();

/** 이 외형의 합친 지오메트리를 잡은 아바타 수. 0 = 아무도 잡지 않음(해제되었거나 캐시에 없음). */
export function solidGeometryRefs(key: string): number {
  return solidCache.get(key)?.refs ?? 0;
}

// ── 아바타별 소유 상태(BuiltAvatar 모양은 그대로 두고 여기 둔다) ────────────────

interface Ownership {
  solid: SkinnedMesh;
  skeleton: Skeleton;
  /** 지오메트리 몫을 지금 잡고 있는가. */
  held: boolean;
}

const ownership = new WeakMap<BuiltAvatar, Ownership>();
/** releaseAvatarSoon이 예약한 해제. 값은 예약마다 새 토큰이라 retain 뒤에 다시 예약해도 옛 예약은 무효다. */
const pendingRelease = new Map<BuiltAvatar, object>();

// ── 조립 ──────────────────────────────────────────────────────────────────────

/** 이름이 부품 규칙에 맞는 가장 바깥 노드들. 그 아래(다중 재질 부품의 자식)로는 내려가지 않는다. */
function outermostPartNodes(node: Object3D, out: Object3D[] = []): Object3D[] {
  for (const child of node.children) {
    if (PART_NODE.test(child.name)) out.push(child);
    else outermostPartNodes(child, out);
  }
  return out;
}

/** 같은 뼈를 같은 순서로 쓰는가(SkeletonUtils.clone은 메시마다 Skeleton을 새로 만들지만 뼈는 같은 복제본이다). */
function sameBones(a: Skeleton, b: Skeleton): boolean {
  if (a === b) return true;
  if (a.bones.length !== b.bones.length) return false;
  for (let i = 0; i < a.bones.length; i++) if (a.bones[i] !== b.bones[i]) return false;
  return true;
}

function requireAttribute(mesh: Mesh, name: string): BufferAttribute | InterleavedBufferAttribute {
  const attribute = mesh.geometry.getAttribute(name) as BufferAttribute | InterleavedBufferAttribute | undefined;
  if (!attribute) throw new Error(`characterAvatar: ${mesh.name} has no ${name} attribute`);
  return attribute;
}

/** 뼈 인덱스를 Uint16으로. primitive마다 형식(Uint8/Uint16)이 달라도 합쳐진다. */
function asUint16(attribute: BufferAttribute | InterleavedBufferAttribute): Uint16BufferAttribute {
  const out = new Uint16BufferAttribute(attribute.count * 4, 4);
  for (let i = 0; i < attribute.count; i++) {
    out.setXYZW(i, attribute.getX(i), attribute.getY(i), attribute.getZ(i), attribute.getW(i));
  }
  return out;
}

/** 뼈 가중치를 Float32로. 정규화 정수는 getX()가 풀어 준다. 이미 Float32면 원본을 그대로 쓴다. */
function asFloat32(attribute: BufferAttribute | InterleavedBufferAttribute): BufferAttribute {
  if (
    attribute.array instanceof Float32Array &&
    !attribute.normalized &&
    !(attribute as InterleavedBufferAttribute).isInterleavedBufferAttribute
  ) {
    return attribute as BufferAttribute;
  }
  const out = new Float32BufferAttribute(attribute.count * 4, 4);
  for (let i = 0; i < attribute.count; i++) {
    out.setXYZW(i, attribute.getX(i), attribute.getY(i), attribute.getZ(i), attribute.getW(i));
  }
  return out;
}

/**
 * 텍스처 없는 primitive들을 정점색 지오메트리 하나로 합친다. position·normal·index는 원본을 참조하고(합치면서
 * 복사된다), 뼈 속성은 형식을 맞추고, color는 틴트 재질이면 외형 색(`#RRGGBB` → 선형은 ColorManagement가 한다),
 * 고정색이면 그 재질의 색(이미 선형)으로 채운다. uv 같은 다른 속성은 넣지 않는다.
 */
function mergeSolids(solids: readonly SkinnedMesh[], look: AvatarLook): BufferGeometry {
  const color = new Color();
  const pieces: BufferGeometry[] = [];
  for (const mesh of solids) {
    const material = mesh.material as MeshStandardMaterial;
    const position = requireAttribute(mesh, "position");
    const piece = new BufferGeometry();
    piece.setIndex(mesh.geometry.index);
    piece.setAttribute("position", position);
    piece.setAttribute("normal", requireAttribute(mesh, "normal"));
    piece.setAttribute("skinIndex", asUint16(requireAttribute(mesh, "skinIndex")));
    piece.setAttribute("skinWeight", asFloat32(requireAttribute(mesh, "skinWeight")));

    const hex = solidColorFor(material.name, look);
    if (hex !== null) color.set(hex);
    else color.copy(material.color);
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }
    piece.setAttribute("color", new Float32BufferAttribute(colors, 3));
    pieces.push(piece);
  }
  const merged: BufferGeometry | null = mergeGeometries(pieces, false);
  if (!merged) {
    throw new Error(`characterAvatar: cannot merge the solid parts ${solids.map((m) => m.name).join(", ")}`);
  }
  return merged;
}

function countDrawn(built: BuiltAvatar): void {
  let drawMeshes = 0;
  let triangles = 0;
  built.root.traverseVisible((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    drawMeshes += 1;
    const { index, attributes } = mesh.geometry;
    triangles += Math.floor((index ? index.count : (attributes.position?.count ?? 0)) / 3);
  });
  built.drawMeshes = drawMeshes;
  built.triangles = triangles;
}

/**
 * 아바타를 조립하되 합친 지오메트리를 잡지 않는다(렌더 단계용 — 위 소유 규칙). 그리기 전에 retainAvatar로 잡고,
 * releaseAvatar(또는 releaseAvatarSoon)로 놓는다. 소유까지 한 번에 하려면 buildAvatar.
 */
export function assembleAvatar(
  assets: AvatarAssets,
  look: AvatarLook,
  decorate?: (a: BuiltAvatar) => void,
): BuiltAvatar {
  const root = cloneSkinned(assets.scene);
  const parts = visibleParts(look.parts);
  const keep = new Set(parts);

  // 숨긴 부품은 아예 뺀다(그리기·행렬 갱신 비용도 없앤다).
  const kept: Object3D[] = [];
  for (const node of outermostPartNodes(root)) {
    if (keep.has(node.name)) kept.push(node);
    else node.removeFromParent();
  }
  const holder = kept[0]?.parent; // 아마추어(Rig). Task 2 테스트: 부품 변환은 항등
  if (!holder) throw new Error(`characterAvatar: none of ${parts.join(", ")} is in the character scene`);

  const materials: Material[] = [];
  const solids: SkinnedMesh[] = [];
  let skeleton: Skeleton | undefined;
  let skeletonFrom = "";
  for (const node of kept) {
    node.traverse((o) => {
      const mesh = o as SkinnedMesh;
      if (!mesh.isMesh) return;
      if (mesh.isSkinnedMesh) {
        if (!skeleton) {
          skeleton = mesh.skeleton;
          skeletonFrom = mesh.name;
        } else if (!sameBones(mesh.skeleton, skeleton)) {
          // 뼈 인덱스가 다른 뼈를 가리키게 된다: 한 Skeleton으로 묶거나 합치면 몸이 엉뚱하게 움직인다.
          throw new Error(
            `characterAvatar: ${mesh.name} is skinned to a different skeleton (bones or their order) than ${skeletonFrom}; every part must share one skin`,
          );
        }
      }
      const source = mesh.material as MeshStandardMaterial;
      if (mesh.isSkinnedMesh && !source.map) {
        solids.push(mesh); // 피부·틴트·고정색 → 합친다
        return;
      }
      const own = source.clone(); // 얼굴: 아바타별 재질(반투명·해제가 다른 아바타로 번지지 않게)
      // three는 양면 반투명 재질을 뒷면·앞면 두 번 그린다. 얼굴은 머리 앞에 붙은 한 겹 판이라 뒷면은 머리 속에
      // 묻혀 어차피 깊이 검사에 가려진다 — 한 번에 그려 아바타당 draw call을 하나 줄인다.
      if (own.transparent && own.side === DoubleSide) own.forceSinglePass = true;
      materials.push(own);
      mesh.material = own;
      // SkeletonUtils.clone은 메시마다 Skeleton을 따로 만든다. 하나로 묶어 뼈 텍스처를 프레임당 한 번만 올린다.
      if (mesh.isSkinnedMesh && skeleton) mesh.bind(skeleton, mesh.bindMatrix);
    });
  }
  if (!skeleton || solids.length === 0) {
    throw new Error(`characterAvatar: no untextured skinned part to merge in ${parts.join(", ")}`);
  }
  // 합친 메시는 solids[0]의 bind 행렬 하나로 묶인다. 다른 bind 행렬의 부품을 넣으면 그 부품만 어긋나 그려진다.
  for (const mesh of solids) {
    if (!mesh.bindMatrix.equals(solids[0].bindMatrix)) {
      throw new Error(
        `characterAvatar: ${mesh.name} has a different bind matrix than ${solids[0].name}; it cannot join the merged mesh`,
      );
    }
  }

  const solidKey = lookKey(look);
  let entry = solidCache.get(solidKey);
  if (!entry) {
    entry = { geometry: mergeSolids(solids, look), refs: 0 };
    solidCache.set(solidKey, entry);
  }

  const solidMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: SOLID_ROUGHNESS, metalness: 0 });
  solidMaterial.name = SOLID_NAME;
  // 부품 재질은 양면(glTF doubleSided)으로 만들어졌다. 한 면으로 합치면 챙·치마 안쪽 같은 열린 면이 사라진다.
  if (solids.some((m) => (m.material as Material).side === DoubleSide)) solidMaterial.side = DoubleSide;
  materials.push(solidMaterial);
  const solid = new SkinnedMesh(entry.geometry, solidMaterial);
  solid.name = SOLID_NAME;
  holder.add(solid);
  solid.bind(skeleton, solids[0].bindMatrix);
  for (const mesh of solids) mesh.removeFromParent();
  // 자식이 모두 합쳐진 다중 재질 부품 Group은 빈 껍데기라 뺀다.
  for (const node of kept) if (!(node as Mesh).isMesh && node.children.length === 0) node.removeFromParent();

  root.traverse((o) => {
    const mesh = o as SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    if (mesh.isSkinnedMesh) mesh.boundingSphere = new Sphere(new Vector3(...AVATAR_BOUNDS.center), AVATAR_BOUNDS.radius);
  });

  const built: BuiltAvatar = { root, materials, parts, solidKey, drawMeshes: 0, triangles: 0 };
  decorate?.(built); // NPC 헤일로 등. 재질은 built.materials에 넣는다
  for (const m of built.materials) {
    const base: OpacityBase = { transparent: m.transparent, depthWrite: m.depthWrite, opacity: m.opacity };
    m.userData.base = base;
  }
  countDrawn(built);
  ownership.set(built, { solid, skeleton, held: false });
  return built;
}

/** 조립하고 곧바로 합친 지오메트리 몫을 잡는다(+1). releaseAvatar와 짝이다. */
export function buildAvatar(assets: AvatarAssets, look: AvatarLook, decorate?: (a: BuiltAvatar) => void): BuiltAvatar {
  const avatar = assembleAvatar(assets, look, decorate);
  retainAvatar(avatar);
  return avatar;
}

// ── 소유 ──────────────────────────────────────────────────────────────────────

/** 합친 지오메트리 몫을 잡는다(+1). 이미 잡았으면 아무것도 안 한다. 예약된 releaseAvatarSoon은 취소한다. */
export function retainAvatar(a: BuiltAvatar): void {
  const own = ownership.get(a);
  if (!own) return;
  pendingRelease.delete(a);
  if (own.held) return;
  let entry = solidCache.get(a.solidKey);
  if (!entry) {
    // 놓였다가 다시 보이는 아바타(Activity·Suspense)나, 다른 아바타가 잡기 전에 캐시에서 빠진 렌더 결과.
    entry = { geometry: own.solid.geometry, refs: 0 };
    solidCache.set(a.solidKey, entry);
  } else if (entry.geometry !== own.solid.geometry) {
    own.solid.geometry = entry.geometry; // 같은 외형을 그사이 다른 아바타가 다시 합쳐 잡았다: 그것을 함께 쓴다
  }
  entry.refs += 1;
  own.held = true;
  // 아무도 잡지 않은 항목(커밋되지 않은 렌더가 합친 것)은 뺀다. 그려진 적이 없으니 dispose할 것도 없다.
  for (const [key, e] of solidCache) if (e.refs === 0) solidCache.delete(key);
}

/** 몫을 놓는다(−1, 두 번 불러도 한 번만). 마지막 몫이면 지오메트리를 dispose하고 캐시에서 뺀다. 재질·뼈 텍스처도 dispose. */
export function releaseAvatar(a: BuiltAvatar): void {
  const own = ownership.get(a);
  if (!own) return;
  pendingRelease.delete(a);
  if (!own.held) return;
  own.held = false;
  const entry = solidCache.get(a.solidKey);
  if (entry && entry.geometry === own.solid.geometry) {
    entry.refs -= 1;
    if (entry.refs === 0) {
      solidCache.delete(a.solidKey);
      entry.geometry.dispose();
    }
  }
  for (const m of a.materials) m.dispose();
  own.skeleton.dispose();
}

/**
 * 지금 태스크가 끝난 뒤(마이크로태스크)에 releaseAvatar. 그 전에 retainAvatar가 오면 취소된다. useAvatar의 effect
 * 정리에서 쓴다: StrictMode가 같은 태스크 안에서 cleanup → setup을 다시 돌려도 아바타가 놓이지 않는다.
 */
export function releaseAvatarSoon(a: BuiltAvatar): void {
  const token = {};
  pendingRelease.set(a, token);
  queueMicrotask(() => {
    if (pendingRelease.get(a) === token) releaseAvatar(a);
  });
}

// ── 반투명 ────────────────────────────────────────────────────────────────────

/**
 * 아바타 전체의 불투명도(연결이 끊긴 아바타 50% 등). 재질마다 조립 때 적어 둔 원래 상태에서 계산하므로 1로
 * 되돌리면 얼굴 같은 BLEND 재질은 다시 transparent·depthWrite false로 돌아간다(Review Focus 2).
 * 매 프레임 불러도 된다: 할당이 없고, 셰이더를 다시 고르는 needsUpdate는 transparent가 바뀔 때만 켠다.
 */
export function setAvatarOpacity(a: BuiltAvatar, opacity: number): void {
  const translucent = opacity < 1;
  const { materials } = a;
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    const base = m.userData.base as OpacityBase | undefined;
    if (!base) continue;
    const transparent = base.transparent || translucent;
    if (m.transparent !== transparent) {
      m.transparent = transparent;
      m.needsUpdate = true; // 불투명 재질은 셰이더가 알파를 1로 고정한다(OPAQUE)
    }
    m.depthWrite = translucent ? false : base.depthWrite;
    m.opacity = base.opacity * opacity;
  }
}
