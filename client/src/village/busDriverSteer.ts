// 버스 기사의 조향 무게(BusDriver.tsx): 버스 경로 자세의 yaw가 바뀌는 빠르기 → 운전대를 꺾은 클립의 무게. 순수 함수(단위 테스트).

import { BUS_DRIVER } from "@caysonverse/shared/village/npcLooks";

export interface SteerState {
  /** 지난 프레임의 yaw(rad). NaN = 아직 없음. */
  yaw: number;
  /** 고른 yaw 변화 빠르기(rad/s, + = 왼쪽으로 돈다). */
  rate: number;
  /** 운전대를 꺾은 정도(-1 오른쪽 끝 … 0 곧게 … +1 왼쪽 끝), 부드럽게 따라간다. */
  s: number;
}

/** 각을 -PI..PI로. */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * 한 프레임: yaw 변화로 빠르기를 고르고(약 0.25 s), 꺾는 정도가 그 빠르기를 따라간다(약 0.4 s, 손이 운전대를 미리 돌리는 느낌).
 * yaw는 0 = +z, 늘면 +x 쪽으로 돈다: 앞을 보는 차에게 +x는 왼쪽이라 + = 왼쪽으로 도는 것.
 */
export function stepYawRate(st: SteerState, yaw: number, delta: number): void {
  if (!(delta > 0)) return;
  if (Number.isNaN(st.yaw)) {
    st.yaw = yaw;
    return;
  }
  const raw = wrap(yaw - st.yaw) / delta;
  st.yaw = yaw;
  // 순간이동(경로가 다시 맞춰질 때)은 빠르기로 보지 않는다
  const r = Math.abs(raw) > 3 ? 0 : raw;
  st.rate += (r - st.rate) * Math.min(1, delta / 0.25);
  const want = Math.max(-1, Math.min(1, st.rate / BUS_DRIVER.fullSteerYawRate));
  st.s += (want - st.s) * Math.min(1, delta / 0.4);
}

/** 꺾는 정도 → 세 클립의 무게(합 1). */
export function steerWeights(s: number): { drive: number; left: number; right: number } {
  const k = Math.max(-1, Math.min(1, s));
  return { drive: 1 - Math.abs(k), left: Math.max(0, k), right: Math.max(0, -k) };
}
