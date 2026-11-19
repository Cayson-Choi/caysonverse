/**
 * 케이슨 마을's guides (Task 9A). The plaza guide answers in words only — since 2026-11-20 with topic pages (the client's
 * village/guideTopics.ts: cards, steps, Q&As, "지도에서 보기" and "같이 가요"; its earlier six Q&As live on there, under their topics): the voice clips were taken out
 * (owner 2026-11-17: "음성 만드는데 리소스를 많이 잡아 먹는것 같으니 일단 안내원의 음성은 모두 빼자"); the old clips
 * (VoxCPM2, a designed voice) are in git history before this change if they ever come back. Chat is never spoken.
 *
 * Browser-safe data (plain numbers and strings). The server and the client both put a small collider on each guide
 * (`guideColliders`, part of the village geometry), so nobody walks through them.
 *
 *  - plaza_guide (마을 안내원) stands on the plaza at (5, 12), clear of the spawn disc (0, 14) r 3, facing the spawn.
 *  - (the memorial hall's desk guide was removed on 2026-11-17, owner: "추모관에 안내원은 없애자 없는게 낫겠다". What it
 *    told visitors — how to look closer, light a candle, lay a pet to rest — is on the cubby card itself.)
 */
import type { Appearance } from "../appearance";
import { appearanceFromIds } from "../appearance";
import type { AABB } from "../collision";
import type { AreaId } from "./villageLayout";
import type { NpcId } from "./npcLooks";

export type GuideId = "plaza_guide";

export interface Guide {
  id: GuideId;
  /** The dialog's title. */
  name: string;
  /** The name tag above the head. */
  tag: string;
  area: AreaId;
  pos: { x: number; z: number };
  /** How far away (m) the guide can be asked; absent = GUIDE_REACH_M. */
  reach?: number;
  /** `atan2(dirX, dirZ)` (0 faces +z). */
  yaw: number;
  /**
   * The guide's own NPC look (npcLooks.ts, owner 2026-11-16: "마을 안내원도 안내원만의 캐릭터"): an outfit nobody can pick in the
   * character creator, from npc.glb. Absent = the fixed look below.
   */
  npc?: NpcId;
  /** A fixed look on the toy figure: the guide's look when it has no NPC look, or while npc.glb cannot be had. */
  appearance: Appearance;
}

/** Within this distance (m, on the ground) "문의하기" is offered. */
export const GUIDE_REACH_M = 2.2;
/** Half the side of a guide's square collider (m): 0.6 x 0.6, about the figure's footprint. */
export const GUIDE_COLLIDER_HALF = 0.3;
/** The words on the action button and the touch button. */
export const GUIDE_ASK_LABEL = "문의하기";
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
    npc: "village_guide",
    appearance: appearanceFromIds(
      { hat: null, hair: "bob", face: "smile", top: "shirt_tie", bottom: "pants", shoes: "sneakers", item: "map" },
      { hatColor: 2, hairColor: 1, skin: 1, topColor: 4, bottomColor: 7, shoesColor: 10, itemColor: 2, voice: 1 },
    ),
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
    if (d <= (g.reach ?? GUIDE_REACH_M) && (best === null || d < best.dist)) best = { guide: g, dist: d };
  }
  return best;
}
