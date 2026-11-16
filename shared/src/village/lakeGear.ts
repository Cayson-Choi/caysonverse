// 낚시터 장비·물고기 모델 약속(설계 lake-fishing 6장·13장 C). 원본: docs/designs/lake-fishing/tools/build_gear.py, build_fish.py.
// 다시 내보내면 해시를 새 sha256 앞 8자리로 바꾼다(시험이 어긋나면 실패한다).

export const LAKE_GEAR_PATH = "/models/lake/lake_gear.glb";
export const LAKE_GEAR_GLB_HASH = "6c87365a";
export const LAKE_GEAR_MAX_BYTES = 250 * 1024;

export const LAKE_FISH_PATH = "/models/lake/lake_fish.glb";
export const LAKE_FISH_GLB_HASH = "0b97d52b";
export const LAKE_FISH_MAX_BYTES = 800 * 1024;

/**
 * lake_gear.glb 뿌리 노드(씬 맨 위 3개). 셋 다 원점 = 쥐는 점, 노드 자체 변환은 항등.
 * - `grip`: 낚싯대(스킨 메시 + 뼈 rod0~rod7). handslotr에 붙이고 position = GRIP_OFFSET, 회전은 그대로 → 대 축이 ROD_AXIS_R, 손잡이 뒤끝이 -축 쪽 0.32 m.
 *   자식 `rod_tip`(= rod7 뼈 끝, 줄 매는 곳). 클립: Rod_Folded(1.15 m)/Rod_Extended(3.61 m)/Rod_Extend(0→14프레임 24fps, 접힘→펴짐)/Rod_Bend_Idle/Rod_Bend_Fight(펴진 상태에서 덧씌움).
 * - `net_grip`: 뜰채. handslotl에 붙이고 position = GRIP_OFFSET → 손잡이 축 = NET_AXIS_L, 테 면의 법선 = 로컬 +Z(손등 쪽), 망은 -Z로 늘어짐.
 * - `float`: 찌. 원점 = 수면선, 위(+Y)로 찌톱 0.35 m(1.6배), 아래 0.2 m. 자식 `float_top`(맨 위 끝)·`chemi`(케미 막대, 재질 M_chemi 발광 — 밤에만 emissiveIntensity를 올린다).
 */
export const LAKE_GEAR_NODES = { rod: "grip", rodTip: "rod_tip", float: "float", floatTop: "float_top", chemi: "chemi", net: "net_grip" } as const;
export const ROD_CLIPS = ["Rod_Folded", "Rod_Extended", "Rod_Extend", "Rod_Bend_Idle", "Rod_Bend_Fight"] as const;
export const ROD_BONES = ["rod0", "rod1", "rod2", "rod3", "rod4", "rod5", "rod6", "rod7"] as const;
/** 낚싯대 길이(m): 접힘 / 펴짐(초릿대 끝까지). 쥐는 점은 대 뒤끝에서 0.32 m. */
export const ROD_FOLDED_LENGTH = 1.15;
export const ROD_EXTENDED_LENGTH = 3.61;

/**
 * lake_fish.glb: 종마다 뿌리 노드 `fish_<id>`(메시 자식 1개, 재질 M_fish(몸·눈·수염) + M_fin(알파 컷 지느러미, alphaMode MASK) 두 재질, 아틀라스 JPEG 1 + PNG 1 공유).
 * 전체 길이(주둥이~꼬리 끝) = 1.0, +Z = 머리, +Y = 등, 길이 중앙이 원점. 클라이언트가 잡힌 cm / 노드 extras.refCm(=100)(× 아바타 배율)로 늘리고(extras.kindIndex = fishKind 번호 1~11) z 좌표로 꼬리 흔들기.
 */
export const LAKE_FISH_IDS = [
  "crucian_carp", // 붕어
  "bluegill", // 블루길
  "minnow", // 피라미
  "prussian_carp", // 떡붕어
  "bass", // 배스
  "carp", // 잉어
  "korean_bullhead", // 동자개
  "catfish", // 메기
  "mirror_carp", // 향어
  "snakehead", // 가물치
  "eel", // 장어
] as const;
export type LakeFishId = (typeof LAKE_FISH_IDS)[number];
export const lakeFishNode = (id: LakeFishId): string => `fish_${id}`;
