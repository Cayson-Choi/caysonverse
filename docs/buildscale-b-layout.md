# 건물 크기 B안 레이아웃 단계

`shared/src/village/villageLayout.ts`가 건물 크기 B안의 좌표와 발자국을 단일 소스로 보관한다. 현재 반영한 범위는 다음과 같다.

- 집 10채: `11.2 × 8.4 m`
- 카페: `16 × 12.5 m`, 키오스크: `5 × 4 m`
- 추모관 바깥: 중심 `(0, -60)`, `20 × 16 m`, 문 패드 반지름 `2 m`
- 추모관 안: `15 × 12 m`, 천장 `4.5 m`, 북쪽 봉안함 34열 + 동쪽 18열 = 364칸
- 공터: 추모관 `28 × 24 m`, 북동·동·북서 `26 × 26 m`, 서쪽 `26 × 22 m`, 남쪽 `24 × 18 m`
- 카페·집·정자·버스정류장도 B안 좌표로 재배치했다.

이 커밋의 `shared/src/village/generated/*Colliders.ts`는 B안 레이아웃 계약을 테스트하고 게임 충돌이 레이아웃과 일치하도록 임시로 갱신한 추출 결과 스냅샷이다. 실제 모델과 시각을 맞추려면 아트 폴더에서 Blender를 한 번에 하나씩 실행한다.

1. `npx tsx scripts/export-village-layout.ts`로 `art/village/layout.json`을 다시 만든다.
2. `build_village.py`와 `build_memorial.py`를 B안 스크립트로 실행하고, `--nobake` GLB를 먼저 검사한다.
3. 통과하면 낮·밤 라이트맵을 굽고 `scripts/extract-colliders.ts`를 실행한다.
4. 생성된 두 collider 파일과 `check-school-glb` 결과를 이 스냅샷과 비교한 뒤, GLB가 완성된 커밋에서 스냅샷을 다시 교체한다.

아트 GLB 재빌드 전에는 건물 메시가 이전 크기로 보일 수 있으므로, 이 단계의 검증 기준은 shared 레이아웃·충돌 계약과 415개 shared 테스트다.
