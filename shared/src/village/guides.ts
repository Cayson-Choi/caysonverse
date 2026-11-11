/**
 * 케이슨 마을's guides (Task 9A, owner 2026-11-03: "어느 건물 또는 npc에게 문의할 때만 음성이 나오도록 ... 진짜 사람이
 * 말하는 것 같은 음성"). Two NPCs answer a few fixed questions; each answer has a pre-generated voice clip
 * (`/village/voice/<voice>.m4a`, made offline by art/village/voice/make_voice.py with VoxCPM2 from a DESIGNED voice —
 * never a clone of a real person). Chat is never spoken (CHAT_VOICE_ENABLED stays false).
 *
 * Browser-safe data (plain numbers and strings). The server and the client both put a small collider on each guide
 * (`guideColliders`, part of the village geometry), so nobody walks through them.
 *
 *  - plaza_guide (마을 안내원) stands on the plaza at (5, 12), clear of the spawn disc (0, 14) r 3, facing the spawn.
 *  - hall_desk (추모관 안내 데스크) stands inside the B hall at (306.4, 4.6) facing -x: it sits beside the new desk
 *    footprint (x 304.6..305.35, z 3.4..5.8), clear of the 34-column north wall and the east cubby unit (which ends
 *    at z 2.07). The layout test pins the clearances and the arrival/door pads.
 */
import type { Appearance } from "../appearance";
import { appearanceFromIds } from "../appearance";
import type { AABB } from "../collision";
import type { AreaId } from "./villageLayout";

export type GuideId = "plaza_guide" | "hall_desk";

export interface GuideQA {
  /** The question as the player picks it. */
  question: string;
  /** The answer shown in the dialog and spoken by the clip (1-3 short sentences, "~요"). */
  answer: string;
  /** The clip id: `/village/voice/<voice>.m4a`. */
  voice: string;
}

export interface Guide {
  id: GuideId;
  /** The dialog's title. */
  name: string;
  /** The name tag above the head. */
  tag: string;
  area: AreaId;
  pos: { x: number; z: number };
  /** `atan2(dirX, dirZ)` (0 faces +z). */
  yaw: number;
  /** A fixed look on the toy figure. */
  appearance: Appearance;
  qas: readonly GuideQA[];
}

/** Within this distance (m, on the ground) "문의하기" is offered. */
export const GUIDE_REACH_M = 2.2;
/** Half the side of a guide's square collider (m): 0.6 x 0.6, about the figure's footprint. */
export const GUIDE_COLLIDER_HALF = 0.3;
/** The words on the action button and the touch button. */
export const GUIDE_ASK_LABEL = "문의하기";
/** Where the clips are served from. */
export const GUIDE_VOICE_DIR = "/village/voice";
/** The label in the dialog that says the voice is synthetic. */
export const GUIDE_AI_VOICE_LABEL = "AI 음성";

export const guideVoiceUrl = (voice: string): string => `${GUIDE_VOICE_DIR}/${voice}.m4a`;

const PLAZA_POS = { x: 5, z: 12 };
const SPAWN = { x: 0, z: 14 };

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

export const GUIDES: readonly Guide[] = deepFreeze([
  {
    id: "plaza_guide",
    name: "마을 안내원",
    tag: "안내원",
    area: "village",
    pos: PLAZA_POS,
    yaw: Math.atan2(SPAWN.x - PLAZA_POS.x, SPAWN.z - PLAZA_POS.z),
    appearance: appearanceFromIds(
      { hat: null, hair: "bob", face: "smile", top: "shirt_tie", bottom: "pants", shoes: "sneakers", item: "map" },
      { hatColor: 2, hairColor: 1, skin: 1, topColor: 4, bottomColor: 7, shoesColor: 10, itemColor: 2, voice: 1 },
    ),
    qas: [
      {
        question: "여기는 어떤 곳이에요?",
        answer: "여기는 케이슨 마을이에요. 건물이 하나씩 천천히 늘어나는 조용한 시골 마을이에요.",
        voice: "plaza_guide_1",
      },
      {
        question: "추모관은 어디에 있어요?",
        answer: "추모관은 광장 북쪽에 있어요. 분수를 지나 쭉 걸어가시면 추모관 문이 보여요.",
        voice: "plaza_guide_2",
      },
      {
        question: "하늘색 테두리가 있는 빈 땅은 뭐예요?",
        answer: "앞으로 새 건물이 들어설 자리예요. 도서관 같은 건물이 하나씩 지어질 거예요.",
        voice: "plaza_guide_3",
      },
      {
        question: "여기도 밤이 오나요?",
        answer: "네, 이 마을은 한국의 실제 시간을 따라가요. 저녁이 되면 마을에도 해가 지고 밤이 찾아와요.",
        voice: "plaza_guide_4",
      },
    ],
  },
  {
    id: "hall_desk",
    name: "추모관 안내 데스크",
    tag: "안내원",
    area: "hall",
    pos: { x: 306.4, z: 4.6 },
    yaw: -Math.PI / 2, // faces -x
    appearance: appearanceFromIds(
      { hat: null, hair: "bob", face: "calm", top: "shirt_tie", bottom: "longskirt", shoes: "dress", item: null },
      { hatColor: 2, hairColor: 0, skin: 0, topColor: 7, bottomColor: 7, shoesColor: 7, itemColor: 2, voice: 1 },
    ),
    qas: [
      {
        question: "이곳은 어떤 곳인가요?",
        answer: "이곳은 먼저 떠난 반려동물을 기억하는 추모관이에요. 편하게 머물다 가셔도 괜찮아요.",
        voice: "hall_desk_1",
      },
      {
        question: "칸을 가까이 보려면 어떻게 하나요?",
        answer: "보고 싶은 칸 앞에 서서 E 키를 누르거나, 가까이 보기 버튼을 눌러 주세요.",
        voice: "hall_desk_2",
      },
      {
        question: "촛불은 어떻게 켜나요?",
        answer: "칸을 가까이 보신 다음 촛불 켜기를 눌러 주세요. 켜진 촛불은 추모관 안에 계신 분들이 함께 볼 수 있어요.",
        voice: "hall_desk_3",
      },
      {
        question: "우리 아이도 이곳에 모실 수 있나요?",
        answer: "곧 빈 칸에 가족분들이 아이의 사진과 이름을 직접 모실 수 있도록 준비하고 있어요.",
        voice: "hall_desk_4",
      },
    ],
  },
] satisfies Guide[]);

const BY_ID: ReadonlyMap<string, Guide> = new Map(GUIDES.map((g) => [g.id, g]));

export function guideById(id: string): Guide | null {
  return BY_ID.get(id) ?? null;
}

/** Each guide's square collider (0.6 x 0.6 around its feet), for the walk geometry. */
export function guideColliders(guides: readonly Guide[] = GUIDES): AABB[] {
  return guides.map((g) => ({
    minX: g.pos.x - GUIDE_COLLIDER_HALF,
    maxX: g.pos.x + GUIDE_COLLIDER_HALF,
    minZ: g.pos.z - GUIDE_COLLIDER_HALF,
    maxZ: g.pos.z + GUIDE_COLLIDER_HALF,
  }));
}

/** The nearest guide of `area` within `GUIDE_REACH_M` of (x, z), and how far it is; null when none is. */
export function nearestGuide(area: AreaId, x: number, z: number, guides: readonly Guide[] = GUIDES): { guide: Guide; dist: number } | null {
  let best: { guide: Guide; dist: number } | null = null;
  for (const g of guides) {
    if (g.area !== area) continue;
    const d = Math.hypot(x - g.pos.x, z - g.pos.z);
    if (d <= GUIDE_REACH_M && (best === null || d < best.dist)) best = { guide: g, dist: d };
  }
  return best;
}
