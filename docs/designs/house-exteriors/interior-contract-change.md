# 실내 약속 변경 요청 (집 외관 A8 → houses interior, `feat/houses-g` / `release/2`)

2026-11-16 · X0(feat/exterior)에서 씀 · 실내 브랜치는 고치지 않았어요. 실내 담당(P0)이 이 쪽지대로 바꿔 주세요.
근거: 사장님 "추천대로"(A안 — 집 몸체 = 실내 + 벽, 창 1:1), `contract.md` 1·7장.

## 1. `EXTERIOR_BODY_DEFAULT` (shared/src/village/houseAreas.ts)
```ts
// 지금(옛 빌더 숫자, 비례로 옮김)
export const EXTERIOR_BODY_DEFAULT = Object.freeze({ halfWidth: 5.15, back: -4.05, front: 2.7 });
// 바꿀 값(A8 몸체의 벽 안쪽 면 → 비례 식이 그대로 1:1이 돼요)
export const EXTERIOR_BODY_DEFAULT = Object.freeze({ halfWidth: 5.3, back: -4.975, front: 2.825 });
```
- `exteriorToLocal` 식은 그대로 둬도 돼요: x = 5.3 + extX, z = 2.825 − extZ. 바깥 Frame은 같아요(원점 = 발자국 가운데, x = 들어오는 사람의 오른쪽, z = 문 밖). A8 발자국 가운데는 몸체 가운데보다 1.075 m 앞이라 `front`가 2.825예요.
- 같은 값이 feat/exterior의 `shared/src/village/exteriorWindows.ts` `EXTERIOR_BODY_A8`에 있어요(합칠 때 하나로).
- `houseAreas.test.ts`의 `exteriorToLocal(0, 2.7)` 등 3줄 → `(0, 2.825) → (5.3, 0)`, `(-5.3, -4.975) → (0, 7.8)`, `(5.3, 2.825) → (10.6, 0)`.

## 2. 창 위치는 표에서 읽기
- 파일: `shared/src/village/generated/exterior_windows.json`, 읽기 `exteriorWindowsOf(houseId)` (`exteriorWindows.ts`). 형식은 `contract.md` 7장. **이미 실내 로컬 좌표**라 `exteriorToLocal`을 거치지 않아요.
- 지금은 설계값(`source: "design"`), 집 빌드(X4)가 실제 개구부로 `source: "build"`로 덮어써요. 둘 다 ±2 cm 안이라 지금 숫자로 가구를 놓아도 돼요.
- 설계 표(3.5): 앞 1층 창 x 2.0 / 8.6 (1.4 × 2.0, 창대 0.9), 문 x 4.4~6.2; 앞 2층 x 2.0 / 5.3 / 8.6 (창대 4.9, **3번 가운데는 2.2 × 2.6 파티오문**); 뒤 x 2.7 / 7.9 (**9번 1층은 x 5.3 폭 2.7 파티오창 하나**); 옆(x 0, 10.6) z 2.35(1.4) / 5.15(1층 1.8, 2층 1.4).
- 바꿀 곳: `ha_common.py`, `hb_common.py`, `h01.py`의 손으로 적은 창 숫자(`EXT_FRONT_1 = (2.68, 7.92)` 등) → 표에서 읽기(`contract.json`에 `exteriorWindows`를 넣어 Blender로 넘기는 게 쉬워요). 계단 뒤에 숨는 창은 지금처럼 빼도 돼요(바깥은 그대로 뚫려 있고 커튼이 닫힌 것으로 보여요).
- HA·HB: 창이 옮겨지니 **창 앞 가구**를 다시 확인(설계 3.5 "창 앞 가구만").

## 3. 그 밖에 실내에 영향 없음
- 문(1.8 × 2.9, 앞벽 가운데), 번호키 1004, 실내 스폰, 층 높이 4.0, 천장 3.7 — 그대로.
- 바깥 바닥이 0.30 올라가 보이지만 서버 걷는 면은 y 0 그대로라 실내 도착·패드 판정은 바뀌지 않아요.
