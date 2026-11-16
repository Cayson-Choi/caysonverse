// 마을 NPC 전용 모습(owner 2026-11-16, 네 번째는 낚시터 대여점 주인 "낚시대 대여점에도 안에 낚시대 관리하는 캐릭터"; "버스기사캐릭터가 앉아서 핸들을 조정하고 … 마을 안내원도 안내원만의 캐릭터 … 추모공간에 맞는
// 캐릭터 … 화면 처음에 캐릭터를 고르고 옷을 고를때 없는 캐릭터"). 세 NPC의 옷·모자·소품·동작은 character.glb가 아니라 따로 받는
// npc.glb에 있다(같은 뼈대, 같은 뼈 순서 — 클라이언트가 아바타의 Skeleton에 그대로 묶는다). 머리·손·얼굴·머리카락·신발·긴바지(색만 NPC마다)는
// character.glb의 것을 그대로 쓴다.
//
// 원본: docs/designs/npc/npc_build.py(art/character/cayson-toy.blend의 툴킷으로 만든다; 블렌드는 저장하지 않는다).
// 다시 내보내면 NPC_GLB_HASH를 새 sha256 앞 8자리로 바꾼다(npcLooks.test.ts가 어긋나면 실패한다).
//
// 조립실·옷장에 절대 나오지 않는다: NPC 부품 id는 모두 `npc_`로 시작하고 character.manifest의 slots에도, 외형(Appearance) 인덱스로
// 고를 수 있는 SLOT_OPTIONS에도 없다(npcLooks.test.ts가 지킨다). 브라우저 안전 모듈(숫자와 문자열만).

import type { CharacterSlot } from "../characterManifest";

/** 클라이언트가 받는 경로(NPC가 보이는 곳에서만 받는다). */
export const NPC_GLB_PATH = "/models/npc.glb";

/** npc.glb 내용의 sha256 앞 8자리. 모델 URL에 ?v=로 붙인다. */
export const NPC_GLB_HASH = "7ffc5c7d";

/**
 * 디스크 예산(character.glb와 따로): 1.5 MB. owner 2026-11-16 "절대로 허접해 보이면 안되고 디테일을 잘 살리도록 해"로 옷감 노멀 맵·
 * 바느질·단추가 늘어 1 MB에서 올렸다(가중치·정점색은 8비트로 줄였다).
 */
export const NPC_GLB_MAX_BYTES = 1.5 * 1024 * 1024;

/** NPC 전용 부품 id의 머리말. 플레이어 부품에는 없다. */
export const NPC_PART_PREFIX = "npc_";

/** 클립 이름 → 길이(초)·반복 여부. 모두 온몸 클립(character.glb의 44개 뼈 전부를 움직인다). */
export const NPC_CLIPS = {
  /** 버스 기사: 앉아서 두 손으로 운전대(10시·2시), 잔잔한 조향, 왼쪽·오른쪽 거울을 번갈아 본다. */
  Npc_Drive: { seconds: 8.0, loop: true },
  /** 버스 기사: 왼쪽으로 크게 꺾은 운전대(버스가 왼쪽으로 돌 때 Npc_Drive 위에 무게로 섞는다). */
  Npc_Drive_Left: { seconds: 2.0, loop: true },
  /** 버스 기사: 오른쪽으로 크게 꺾은 운전대. */
  Npc_Drive_Right: { seconds: 2.0, loop: true },
  /** 마을 안내원: 클립보드를 가슴 앞에 들고 둘러보다가 왼손으로 옆을 가리킨다. */
  Npc_Guide_Idle: { seconds: 5.0, loop: true },
  /** 마을 안내원: 왼손을 들어 흔드는 인사(문의하기를 열 때 한 번). */
  Npc_Guide_Greet: { seconds: 2.5, loop: false },
  /** 추모관 안내: 두 손을 배 앞에 모은 공수 자세, 잔잔한 숨. */
  Npc_Memorial_Idle: { seconds: 5.0, loop: true },
  /** 추모관 안내: 공수한 채 허리를 굽혀 천천히 하는 인사(문의하기를 열 때 한 번). */
  Npc_Memorial_Bow: { seconds: 3.0, loop: false },
  /** 낚시터 대여점 주인: 창구 턱에 두 손을 얹고 밖을 내다보다가 오른손으로 턱을 훔치듯 정리한다. */
  Npc_Shop_Idle: { seconds: 6.0, loop: true },
  /** 낚시터 대여점 주인: 오른손을 흔들고 고개를 끄덕이는 인사(누가 대를 빌리거나 돌려줄 때). */
  Npc_Shop_Wave: { seconds: 2.5, loop: false },
} as const;

export type NpcClip = keyof typeof NPC_CLIPS;

export type NpcId = "bus_driver" | "village_guide" | "memorial_staff" | "lake_shopkeeper";

export interface NpcLook {
  id: NpcId;
  /**
   * 슬롯별 부품 id(없음 = null). `npc_`로 시작하는 id는 npc.glb의 메시 노드 `<slot>__<id>`, 나머지는 character.glb의 부품이다.
   * 모자를 쓰면 머리카락은 character.glb의 모자용 변형(`hair__<id>__hat`)을 쓴다(플레이어와 같은 규칙).
   */
  parts: Record<CharacterSlot, string | null>;
  /** 틴트 재질의 색(`#RRGGBB`): NPC 부품은 고정색이라 피부·머리카락·신발(character.glb 부품)만 의미가 있다. */
  colors: { skin: string; hair: string; hat: string; top: string; bottom: string; shoes: string; item: string; accent: string };
  /** 늘 도는 클립. */
  idle: NpcClip;
  /** 문의하기를 열 때 한 번 하는 인사(없으면 없음). */
  greet: NpcClip | null;
}

const NEUTRAL = "#FFFFFF";

export const NPC_LOOKS: Readonly<Record<NpcId, NpcLook>> = {
  bus_driver: {
    id: "bus_driver",
    // 옅은 하늘색 반소매 제복 셔츠 + 남색 넥타이·견장(금줄)·은색 명찰 + 흰 장갑, 남색 바지, 남색 정모(금 끈·바퀴 휘장), 검은 구두
    parts: { hat: "npc_driver_cap", hair: "short", face: "smile", top: "npc_driver", bottom: "pants", shoes: "dress", item: null },
    colors: { skin: "#F5C9A0", hair: "#2B2420", hat: NEUTRAL, top: NEUTRAL, bottom: "#22305A", shoes: "#1B1B1F", item: NEUTRAL, accent: NEUTRAL },
    idle: "Npc_Drive",
    greet: null,
  },
  village_guide: {
    id: "village_guide",
    // 크림 셔츠 + 빨간 안내 조끼(흰 테, 가슴·등 'i' 표시) + 목걸이 명찰 "안내원", 빨간 챙 모자, 클립보드, 흰 운동화
    parts: { hat: "npc_guide_hat", hair: "ponytail", face: "smile", top: "npc_guide", bottom: "pants", shoes: "sneakers", item: "npc_clipboard" },
    colors: { skin: "#FFDCC2", hair: "#4A3226", hat: NEUTRAL, top: NEUTRAL, bottom: "#3B4250", shoes: "#F7F7F2", item: NEUTRAL, accent: NEUTRAL },
    idle: "Npc_Guide_Idle",
    greet: "Npc_Guide_Greet",
  },
  memorial_staff: {
    id: "memorial_staff",
    // 검은 정장 재킷(흰 셔츠, 검은 넥타이, 긴소매) + 왼쪽 깃의 검은 추모 리본(글자 없음), 검은 바지, 검은 구두, 단정한 단발
    parts: { hat: null, hair: "bob", face: "calm", top: "npc_memorial", bottom: "pants", shoes: "dress", item: null },
    colors: { skin: "#FFDCC2", hair: "#2B2420", hat: NEUTRAL, top: NEUTRAL, bottom: "#1E2026", shoes: "#1B1B1F", item: NEUTRAL, accent: NEUTRAL },
    idle: "Npc_Memorial_Idle",
    greet: "Npc_Memorial_Bow",
  },
  lake_shopkeeper: {
    id: "lake_shopkeeper",
    // 낚시터 대여점 주인(owner 2026-11-16 "낚시대 대여점에도 안에 낚시대 관리하는 캐릭터"): 회청색 셔츠 위 주머니 많은 국방색 낚시 조끼(D링),
    // 목에 두른 수건(흰 바탕 파란 끝), 베이지 벙거지, 안경, 짙은 녹색 장화
    parts: { hat: "npc_shop_hat", hair: "short", face: "glasses", top: "npc_shopkeeper", bottom: "pants", shoes: "boots", item: null },
    colors: { skin: "#E0A47A", hair: "#3A3430", hat: NEUTRAL, top: NEUTRAL, bottom: "#5B5446", shoes: "#3F5A3A", item: NEUTRAL, accent: NEUTRAL },
    idle: "Npc_Shop_Idle",
    greet: "Npc_Shop_Wave",
  },
};

/** 낚시터 대여점 주인이 서는 자리: lake_structures.glb의 빈 노드(창구 안, 바닥 높이 0.4, 남쪽(+z)을 본다). */
export const LAKE_SHOPKEEPER_NODE = "npc__lake_shopkeeper";

/** npc.glb에 있어야 하는 부품 메시 노드 이름(`<slot>__npc_*`), 정렬. */
export function npcPartNodes(): string[] {
  const out = new Set<string>();
  for (const look of Object.values(NPC_LOOKS)) {
    for (const [slot, id] of Object.entries(look.parts)) if (id !== null && id.startsWith(NPC_PART_PREFIX)) out.add(`${slot}__${id}`);
  }
  return [...out].sort();
}

/**
 * 버스 기사의 자리(owner 2026-11-16 "버스기사캐릭터가 앉아서 핸들을 조정"), village_bus.glb 모형 공간(glTF: +x = 문 쪽(오른쪽),
 * +y = 위, -z = 앞(코)). 마을버스 v3(feat/bus-v3 3927e48, art/village/tools/build_bus.py driver_place())의 노드와 약속한다:
 *  - `bus_driver_sit`(빈 노드): 앉은 사람의 뿌리 자리, 바닥 위(좌석 중심 앞 0.53 m, 승객 좌석과 같은 규칙). 기사 아바타의 뿌리는 여기서
 *    ROOT_LIFT(쿠션 0.452 - SIT_POSE.contactY)만큼 위, 코 쪽(-z)을 본다;
 *  - `bus_steering_wheel`(메시): 운전대, 원점 = 고리 중심(hub), 로컬 +Z = 기둥 축(기사 쪽), 고리 반지름 0.22, 수평에서 35° 기운 면.
 *    기사가 돌리는 만큼 로컬 Z 둘레로 돌린다(+ = 왼쪽으로);
 *  - `bus_driver_seat`(메시): 운전석(원점 = 좌석 중심, 바닥).
 * Npc_Drive 클립의 손은 뿌리에서 본 운전대 고리(v3: hub = 뿌리 + (0, 0.898, -0.23))를 잡는다(npc_build.py DRIVE). 노드가 없는 옛 버스
 * (v3 전)에서는 운전대 중심 WHEEL_HUB_V2에서 같은 상대 위치(ROOT_FROM_HUB)에 앉힌다: 손은 고리 위에 오고 몸이 조금 낮아진다.
 */
export const BUS_DRIVER = {
  sitNode: "bus_driver_sit",
  wheelNode: "bus_steering_wheel",
  seatNode: "bus_driver_seat",
  /** bus_driver_sit(바닥) → 아바타 뿌리 높이(m): 쿠션 윗면 0.452 - SIT_POSE.contactY 0.39. */
  rootLift: 0.452 - 0.39,
  /** 운전대 중심 → 아바타 뿌리(모형 공간, m): v3의 bus_driver_sit(+ rootLift) - bus_steering_wheel. */
  rootFromHub: [0, 0.34 + 0.452 - 0.39 - 1.3, -3.71 + 3.94] as const,
  /** 노드가 없는 옛 버스의 운전대 중심(build_bus.py v2 cabin()). */
  wheelHubV2: [-0.62, 1.08, -3.8] as const,
  /** 기사 아바타의 yaw(모형 공간): 아바타는 +z를 보고 만들어졌고 버스 코는 -z. */
  yaw: Math.PI,
  /** 버스가 이 각속도(rad/s)로 돌 때 운전대를 끝까지 꺾은 클립(Npc_Drive_Left/Right)이 다 실린다. */
  fullSteerYawRate: 0.35,
  /** 끝까지 꺾었을 때 운전대가 도는 각(rad): Npc_Drive_Left/Right에서 손이 돈 각(40°)과 같다. */
  fullWheelTurn: (40 * Math.PI) / 180,
} as const;
