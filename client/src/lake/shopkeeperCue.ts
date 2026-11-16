// 낚시터 대여점 주인이 언제 손을 흔드는지(LakeShopkeeper.tsx): 누가 대를 빌리거나 돌려줄 때, 그리고 내가 대여 발판에 올라설 때.
// 순수 모듈(단위 테스트).

/** 같은 인사를 다시 하기까지 쉬는 시간(ms): 여럿이 잇달아 빌려도 손을 쉬지 않고 흔들지는 않는다. */
export const SHOP_WAVE_COOLDOWN_MS = 6000;

export interface ShopCueState {
  /** 지난번에 대를 들고 있던 사람들(세션 id). null = 아직 한 번도 보지 않음(처음 본 사람들에게는 인사하지 않는다). */
  holders: Set<string> | null;
  /** 내가 발판 위에 있었는가. */
  onPad: boolean;
  /** 마지막으로 인사한 때(ms). */
  lastWave: number;
}

export function emptyShopCue(): ShopCueState {
  return { holders: null, onPad: false, lastWave: -Infinity };
}

/**
 * 한 번 살핀다: 지금 대를 든 사람들, 내가 발판 위인지, 지금 시각. 인사해야 하면 true(쉬는 시간 안이면 false).
 * 대를 새로 든 사람(빌림)이나 내려놓은 사람(반납·떠남), 또는 내가 발판에 막 올라선 것이 계기다.
 */
export function stepShopCue(st: ShopCueState, holders: ReadonlySet<string>, onPad: boolean, now: number): boolean {
  let cue = false;
  if (st.holders !== null) {
    for (const sid of holders) if (!st.holders.has(sid)) cue = true;
    for (const sid of st.holders) if (!holders.has(sid)) cue = true;
  }
  if (onPad && !st.onPad && st.holders !== null) cue = true;
  st.holders = new Set(holders);
  st.onPad = onPad;
  if (cue && now - st.lastWave >= SHOP_WAVE_COOLDOWN_MS) {
    st.lastWave = now;
    return true;
  }
  return false;
}
