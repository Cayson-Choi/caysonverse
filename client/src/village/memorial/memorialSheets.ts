import { useSyncExternalStore } from "react";

/**
 * Which memorial sheet is open over the hall (one at a time): the claim form (모시기), its edit (고치기), the family-device sheet,
 * or the recovery-code sheet. Plain module state like cubbyCard.ts.
 */
export type SheetState =
  | { kind: "claim"; slotId: string }
  | { kind: "edit"; slotId: string }
  | { kind: "family"; slotId: string }
  | { kind: "recover"; slotId: string | null }
  | null;

let state: SheetState = null;
const listeners = new Set<() => void>();

export function openSheet(next: SheetState): void {
  state = next;
  for (const l of [...listeners]) l();
}

export function closeSheet(): void {
  if (state) openSheet(null);
}

export function sheetState(): SheetState {
  return state;
}

export function useSheet(): SheetState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    sheetState,
    sheetState,
  );
}

/** Copy of the memorial sheets and the claimed card: gentle "~요", never "!" (design memorial-2 §1). */
export const MEM_COPY = {
  claimCta: "우리 아이 모시기",
  claimTitle: "우리 아이 모시기",
  editTitle: "칸 고치기",
  stepInfo: "아이 정보",
  stepPhoto: "사진",
  stepCheck: "확인",
  name: "이름",
  namePh: "예: 콩이",
  species: "아이",
  born: "태어난 날",
  passed: "무지개다리 건넌 날",
  dateUnknown: "날짜 몰라요",
  line: "남기고 싶은 한 줄",
  linePh: "예: 늘 곁에 있어 줘서 고마웠어요",
  next: "다음",
  back: "이전",
  cancel: "닫기",
  save: "저장하기",
  confirm: "모시기",
  saving: "모시고 있어요",
  pickPhoto: "사진 고르기",
  changePhoto: "다른 사진 고르기",
  photoLater: "사진은 나중에 올려도 돼요",
  photoReview: "사진은 확인한 뒤에 다른 분들께 보여요. 보통 하루 안에 끝나요",
  photoBusy: "사진을 준비하고 있어요",
  photoTooBig: "사진이 너무 커요. 다른 사진을 골라 주세요",
  photoNotImage: "사진을 읽지 못했어요. 다른 사진을 골라 주세요",
  uploading: "사진을 올리고 있어요",
  privacy: "사진, 이름, 날짜 말고는 아무것도 받지 않아요",
  deviceNote: "이 기기가 칸의 가족 기기가 돼요. 다른 기기는 나중에 가족 링크로 더할 수 있어요",
  free: "지금은 무료로, 한 가족에 한 칸까지 모실 수 있어요",
  recoveryTitle: "복구 코드를 꼭 적어 두세요",
  recoveryBody: "이 기기를 잃어버리거나 기록이 지워지면, 이 코드로 우리 아이 칸을 다시 찾을 수 있어요. 다시 보여 드리지 않아요",
  copy: "복사하기",
  copied: "복사했어요",
  wroteIt: "적어 두었어요",
  pending: "검토 중이에요",
  pendingNote: "사진은 확인한 뒤에 다른 분들께 보여요 (보통 하루 안에)",
  rejected: "사진이 공개되지 못했어요. 다른 사진으로 바꿔 주세요",
  noPhoto: "사진을 기다리고 있어요",
  edit: "고치기",
  photo: "사진 바꾸기",
  addPhoto: "사진 올리기",
  family: "가족 기기",
  oneOnly: "지금은 한 가족에 한 칸까지 모실 수 있어요",
  goMine: "우리 아이 칸 보기",
  haveCode: "다른 기기에서 모셨나요? 코드로 연결하기",
  mineBadge: "우리 가족 칸",
  familyTitle: "가족 기기 추가하기",
  familyBody: "이 링크를 받은 사람은 칸을 고칠 수 있어요. 24시간 동안 한 번만 쓸 수 있어요",
  makeLink: "가족 링크 만들기",
  share: "보내기",
  devices: "연결된 기기",
  thisDevice: "이 기기",
  removeDevice: "빼기",
  recoverTitle: "코드로 이 기기 연결하기",
  recoverBody: "모실 때 받은 복구 코드 12자를 넣어 주세요",
  recoverPh: "예: 7KQ2-M9XD-4HEZ",
  connect: "연결하기",
  joined: "가족 기기로 연결했어요. 추모관에서 우리 아이 칸을 볼 수 있어요",
  joinFailed: "가족 링크가 맞지 않거나 시간이 지났어요",
  off: "곧 이 자리에 우리 아이를 모실 수 있어요",
} as const;
