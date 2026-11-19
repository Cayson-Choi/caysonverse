// 낚시 동작 클립(설계 lake-fishing 6.3). character.glb와 같은 뼈 이름의 별도 GLB(뼈 노드 + 클립만, 메시 없음).
// 원본: art/character/cayson-toy.blend 텍스트 블록 'fishing_anims' = docs/designs/lake-fishing/anim_src/fishing_anims.py.
// 다시 내보내면 FISHING_ANIMS_GLB_HASH를 새 sha256 앞 8자리로 바꾼다(시험이 어긋나면 실패한다).

/** 클라이언트가 받는 경로(낚싯대가 화면에 보일 때·빌릴 때 받는다). */
export const FISHING_ANIMS_PATH = "/models/lake/fishing_anims.glb";

/** fishing_anims.glb 내용의 sha256 앞 8자리. 모델 URL에 ?v=로 붙인다. */
export const FISHING_ANIMS_GLB_HASH = "35d6ee8a";

/** 디스크 예산(설계 10장: ≤ 700 KB). */
export const FISHING_ANIMS_MAX_BYTES = 700 * 1024;

/**
 * 클립 이름 → 길이(초)·반복 여부·덮는 범위.
 * - "body": 온몸(앉은 클립의 다리·엉덩이는 Sit_Chair_Idle 첫 프레임과 같다 → 의자 맞춤이 그대로).
 * - "rightArm": 오른팔 사슬(upperarm.r → handslot.r)만. 걷기·서기 위에 덮어 쓴다(Carry_Rod, 길이 = Walking_A).
 */
export const FISHING_CLIPS = {
  Fish_Sit_Idle: { seconds: 4.0, loop: true, part: "body" },
  Fish_Sit_Cast: { seconds: 1.0, loop: false, part: "body" },
  Fish_Sit_Strike: { seconds: 10 / 24, loop: false, part: "body" },
  Fish_Sit_Fight: { seconds: 2.0, loop: true, part: "body" },
  Fish_Sit_Lift: { seconds: 1.0, loop: false, part: "body" },
  Fish_Net: { seconds: 29 / 24, loop: false, part: "body" },
  Fish_Stand_Show: { seconds: 2.5, loop: false, part: "body" },
  Fish_Release: { seconds: 19 / 24, loop: false, part: "body" },
  Carry_Rod: { seconds: 25 / 24, loop: true, part: "rightArm" },
} as const;

export type FishingClip = keyof typeof FISHING_CLIPS;

/** Carry_Rod가 움직이는 뼈(나머지 뼈는 걷기·서기 클립이 그대로 움직인다). */
export const RIGHT_ARM_BONES = ["upperarm.r", "lowerarm.r", "wrist.r", "hand.r", "handslot.r"] as const;

/**
 * 손에 드는 물건 약속(parts2.py item_frame과 같은 규칙, Blender 뼈 로컬 공간 → glTF 뼈 노드 로컬 공간도 같다).
 * - 낚싯대: 뿌리 노드 `grip`을 handslot.r에 붙이고, 대 축 = ROD_AXIS_R, 쥐는 점 = GRIP_OFFSET.
 * - 뜰채: handslot.l에 붙이고 손잡이 축 = NET_AXIS_L(오른손 축의 거울상).
 * - 물고기(Fish_Stand_Show·Fish_Release): 두 handslot 가운데에 가로로(handslot.l → handslot.r 방향) 얹는다.
 *   Fish_Sit_Lift 끝에는 왼손(handslot.l)이 물고기를 쥔다.
 * Blender 뼈 로컬 축(x, y, z)은 glTF 노드 로컬 축과 같다(내보내기가 뼈 축을 바꾸지 않는다).
 */
export const ROD_AXIS_R = [-0.8, 0.6, 0] as const;
export const NET_AXIS_L = [0.8, 0.6, 0] as const;
export const GRIP_OFFSET = [0, 0, 0.025] as const;
