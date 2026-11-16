# 마을 부지 건물 v2 — 약속 (contract)

2026-11-17 · `feat/lots2-design` · 설계는 `design.md`, **숫자는 코드가 정답**: `shared/src/village/villageLots.ts`(시험 `villageLots.test.ts` 30개).
틀은 v1(feat/lots-design)과 같고, L5 연결 모듈(feat/lots-wiring 0fbbbaa)이 읽는 이름·함수는 그대로 두었어요. 바뀌는 것은 **lot id, `LOT_SEAT_ORDER`, GLB 목록**뿐이에요.

| 파일 | 내용 |
|---|---|
| `shared/src/village/villageLots.ts` | 6개 부지(`VILLAGE_LOTS`): 로컬 틀, 발자국·몸체, 문(`closedNote`), 방(units), 충돌, 좌석, 자리(`slot__`), 지붕 판, 없앨 모델 상자, 예산, LOD, 질감 규칙, 글자, `lotsForLayoutJson` |
| `shared/src/village/villageLots.test.ts` | 부지·도로·골목·집(지금 + A8)·나무와 안 겹침, 문 안쪽 쓸기, 문·좌석·운동장·정원·절 마당 걸어 닿음(0.25 m 격자), 돌담·울타리가 막음, 정문 75ab7df 그대로, 돈 관련 자리 0, 글자, 예산 |
| `docs/designs/village-lots-v2/tools/plan-svg.ts`, `svg-to-png.mjs` | 숫자에서 평면도 그리기(`shots/plan.svg`, `plan.jpg`) |

## 1. 로컬 틀 (v1·집과 같음, vlib.py `loc()`)
원점 = 발자국 가운데, 로컬 x = 정문으로 **들어가는 사람의 오른쪽**, 로컬 z = 문 밖 쪽(앞선 = +깊이/2). 세계 = `lotLocalToWorld`
(s: x = cx + lx, z = cz + lz · n: x = cx − lx, z = cz − lz · e: x = cx + lz, z = cz − lx · w: x = cx − lz, z = cz + lx). cm 반올림. 걷는 면 y = 0(계단·기단은 몸체 상자 안).

## 2. 부지 (세계)
| lot | 발자국 | 몸체(충돌) | 문 패드 · 도착점 | 높이 |
|---|---|---|---|---|
| `lot_school` 학교 (plot_e, 문 서) | x 48.5..68.5, z 4..26 | x 60.5..68.5, z 7..23 | (59.85, 15) · (58.3, 15) | 16.5 |
| `lot_chapel` 성당 (plot_ne, 서) | x 40..57, z −49..−25 | x 43..54, z −42..−32 (+ apse) | (42.35, −37) · (40.8, −37) | 21 |
| `lot_library` 도서관 (plot_w, 동) | x −64..−49, z 2..22 | x −64..−53, z 8..22 | (−52.35, 15) · (−50.8, 15) | 11.5 |
| `lot_temple` 절 (plot_nw, 동) | x −65..−39, z −49..−25 | 대웅전 x −63.5..−55, z −43.5..−30.5 | (−54.35, −37) · (−52.8, −37) | 11 |
| `lot_church` 교회 (plot_s, 북) | x −9..9, z 50..66 | x −4.2..4.2, z 55..66 | (0, 54.35) · (0, 52.8) | 22 |
| `lot_gate` 정문 (남쪽 둑, 북) — 75ab7df | x −34..−14, z 83..95 | 문 줄 z 92.6..95 | (−24, 91.95) · (−24, 90.4) | 16.5 |

문: 정문 빼고 모두 앞벽 가운데 **안쪽으로 여는 참나무 쌍여닫이**(`leaf: "swing"`), 쓸기 = 폭 × 폭/2가 몸체 안(시험). 노드 `door__<door id>`, 문짝 둘
`door__<id>_l`/`_r`(경첩 = 문설주, 0 → 90°). 2단계 전 문 패드 안내: 학교·도서관 "준비 중", 성당·절·교회 `closedNote` "조용히 둘러보세요".

## 3. 충돌 상자 (`lotColliders`) — id 순서 고정, 모델 `col__<id>`와 0.01 m까지 같게
몸체 `col__<lot>`(카메라 상자, 높이 = `cameraHeight`) 다음 순서대로:
- 학교: `_porch_post_1/2`, `_bench_1/2`, `_swings`, `_climber`, `_seesaw`, `_notice`, `_fence_n`, `_fence_s`, `_fence_fl`, `_fence_fr`(정면 입구 5.2 m).
- 성당: `_apse`, `_fountain`, `_bench_1/2`, `_arbor_1/2`, `_lamp_1/2`.
- 도서관: `_bay_l/r`(창가 독서 자리 베이 창), `_bench_1/2`, `_pergola_1..4`, `_book_return`, `_lamp_1/2`.
- 절: `_iljumun_l/r`, `_wall_fl/fr/l/r/b`(돌담), `_lantern`, `_pagoda`, `_pond`, `_bell_pavilion`, `_pine_1..4`.
- 교회: `_porch_post_1/2`, `_bench_1/2`, `_lamp_1/2`, `_notice`.
- 정문: 75ab7df 그대로(21개).
등받이 없는 돌의자(절)는 상자 없음 → L5 `lotSeatFurnitureBoxes`가 만듦. 지붕 판(`LOT_ROOF_SLABS`, 카메라는 아래만): 학교 현관, 도서관 퍼걸러, 일주문 지붕,
대웅전 앞 처마(1.7 m), 범종각, 교회 현관 — **빌더가 모델에서 잰 밑면 높이를 보고에 적고**, 다르면 L5v2가 숫자를 고쳐요.
새 충돌을 더해야 하면 그 lot 목록 **끝에만** 덧붙이고 이 문서와 시험을 같이 고쳐요.

## 4. 좌석 — 끝에만 덧붙이기
`LOT_SEAT_ORDER` 12자리: `lot_school_bench_1/2`, `lot_chapel_bench_1/2`, `lot_library_bench_1/2`, `lot_temple_bench_1/2`(돌의자, 등받이 없음),
`lot_church_bench_1/2`, `lot_gate_bench_1/2`. 지금 main의 모든 좌석(폭포 돌 다음) 뒤, `lotVillageSeats()` 그대로(id `lot:<seat id>…`). 높이 0.45, 자리 2.
모델은 `seat__<id>` 빈 물체를 세계 좌표에. **탭 = 걸어가기만, 앉기는 버튼**(자동 앉기 없음).

## 5. 자리 (`slot__<lot>_<name>`, 빈 물체 · 부모 없음 · 세계 좌표 · yaw) — 돈 관련 없음
| 종류 | 자리 | 단계 |
|---|---|---|
| `clock` | 학교 `clock`(마을 시계 시간) | 1 |
| `bell` | 학교 `bell`, 성당 `bell`, 교회 `bell`(정시 종소리는 선택), 절 `bell`(범종, 눌러서 한 번) | 1 / 2 |
| `playground` | 학교 `swing_1/2`, `slide`, `seesaw` | 2 |
| `notice_board` · `nameplate` | 학교·성당·도서관·교회 게시판, 학교·성당·도서관·교회 이름판, 절 `hall_plaque`·`gate_plaque` | 1 |
| `garden` · `pond` · `lantern` | 성당 `fountain`, 절 `pond`, 절 `lantern`(밤 불) | 1 |
| `reading_nook` · `book_return` | 도서관 `nook_l/r`(베이 창 안), 실내 `armchair_nook`, `book_return` | 2 |
`tags`(가격표)는 v2에서 늘 0. 판매·가격·가게·ATM·창구·매표 종류는 다섯 건물에 **없음**(시험, 사장님 11-17 "그런거 없다"). 정문 75ab7df의 `booth_l/r`·`turnstile` 자리는
모델에 남아도 게임이 쓰지 않는 닫힌 장식이에요.
실내 방 원점(2단계): 교실 (410, 0), 성당 안 (440, 0), 열람실 (470, 0), 대웅전 (410, 40), 예배당 (440, 40) — 추모관(300)과 떨어짐, 서로 4 m 이상.

## 6. GLB · 노드 · 예산 (`LOT_TRIANGLES`, `LOT_GLB_BUDGET`, `LOT_DETAIL_LOD`)
- 파일: `client/public/models/village/lots/<lot id>.glb` 하나씩(L5 `lotModelUrl` 그대로). 노드: `lotshell__<lot>`(늘), `lotdetail__<lot>`(빈 물체) 아래
  `lotdetail__<lot>_mesh`(구조) + `lotgoods__<lot>`(작은 반복물: 울타리 살, 기와 끝, 공포, 책, 꽃, 연잎) + `lotinst__<lot>_<kind>`(GPU 인스턴스),
  `lotnight__<lot>_<part>`, `door__…`, `seat__…`, `slot__…`, `col__…`. village.glb에는 `lotproxy__<lot>`(vrb2).
- 삼각형: 껍데기 학교 3,000 · 성당 3,000 · 도서관 2,600 · 절 3,400 · 교회 2,400 · 정문 4,000 = 18,400. 디테일 18k/16k/18k/20k/14k/25k, 그 중 구조 ≤ 55%.
  인스턴스는 인스턴스마다 셈. 넘으면 실패(빌더 GLB 시험: `server/src/tools/lot<Name>Glb.test.ts`, v1 패턴).
- 파일 ≤ 0.6 MB(Draco), 재질 ≤ 10, 껍데기 그리기 ≤ 4, 디테일 ≤ 10, 인스턴스 ≤ 8종, 라이트맵 lot마다 낮 120 / 밤 100 KB(폰 60/50).
- **텍스처: KTX2만**(알베도 ETC1S sRGB, 노멀·ORM UASTC, 밉 전부). lot 자기 맵 GPU PC ≤ 6 MB · 폰 ≤ 1.5 MB. 공유 PBR 세트는 `pbrLibrary.ts`의 `getPbrSet`으로(다섯 채 합쳐
  서로 다른 ≤ 12세트, PC 60 MB · 폰 24 MB). GLB 안 이미지 0, 맵 목록은 `asset.extras`(L5 `manifestPaths` 형식 `lots/<dir>/<file>.json`).
- LOD: PC 35 m · 풀 40k, 폰 25 m · 풀 14k · 많아야 2채 · `lotgoods__` 15 m 안만, 되돌림 4 m, 폰 110 m 밖 대역 상자.
- 장면 한도 PC 310k / 폰 300k → 바탕 PC ≤ 233.6k · 폰 ≤ 249.6k(`maxBaseSceneTriangles`).

## 7. 질감 (`LOT_SURFACE_RULES`)
실사 PBR(albedo + normal + ORM), 3.5 m 아래·손 닿는 곳 ≥ 512 px/m, 위 ≥ 256, **단색 면 FAIL**(유리·색유리·등빛·빛나는 글자·물·꽃 카드만 예외).
**새것**: 때·이끼·녹·빗물 자국·바램·벗겨짐 없음, 매크로 얼룩 끔, 모서리 2–3 cm 모따기, 새 칠 거칠기 −0.1. 세트는 라이브러리(feat/pbr-library c654e09,
`art/materials/materials.json` + `scripts/build-materials.mjs`)에서; NEW 세트(design 6)는 처음 쓰는 빌더가 CC0 스캔을 **라이브러리에 더하고**(사본 금지) 보고에 적어요.
글자는 입체(두께 3–5 cm 조각·양각·금속 글자), `LOT_SIGN_WORDS`만.

## 8. vrb2(village.glb) 넘겨주기 — design 8장 그대로
`parts_buildings.py` `plots()`에서 다섯 부지의 `sign_post()`와 plot_w `construction()` 호출 빼기 → `col__construction` 빠짐 → 충돌 다시 뽑기,
발자국 안 땅(운동장 고무·모래, 판석, 벽돌 포장, 절 마사토·박석), 골목 → 문 패드 포장(절: (−38.5, −33) → (−39, −37)), `lotproxy__<lot>` 6개.
그 전까지 L5v2 `LotsVillagePatch`가 게임에서 지움(`replacedByLot`은 v2에서 모델이 없어도 참).

## 9. 빌더 덩어리 (파일 주인)
| 덩어리 | 하는 일 | 주인 파일(밖은 읽기만) | 먼저 |
|---|---|---|---|
| **B1 학교 + 도서관** | 두 건물 Blender 키트 + 룩데브 + GLB + 시험; NEW 세트 `roof_clay_tile`, `wood_painted`, `play_rubber`, `sand`, `stone_ashlar`, `roof_slate` | `docs/designs/village-lots-v2/tools/{school_kit,library_kit,parts_lot_school,parts_lot_library}.py`, `client/public/models/village/lots/{lot_school,lot_library}.glb`·`lots/school/`·`lots/library/`, `client/dev/{school,library}Lookdev.ts`, `e2e/{school,library}-lookdev.mjs`, `server/src/tools/lot{School,Library}Glb.test.ts`, 라이브러리의 그 세트 줄 | 이 약속 |
| **B2 성당 + 교회** | 두 건물 + 색유리 + 종; NEW `copper_new`(B1의 `stone_ashlar`·`roof_slate`·`wood_painted`를 씀 — 먼저 끝난 쪽이 더하고 다른 쪽은 기다리지 말고 같은 이름으로 씀) | `…/tools/{chapel_kit,church_kit,parts_lot_chapel,parts_lot_church}.py`, `lot_chapel.glb`·`lot_church.glb`·`lots/chapel/`·`lots/church/`, 룩데브·e2e·`lot{Chapel,Church}Glb.test.ts` | 〃 |
| **B3 절 + 정문 손질** | 한옥 절(일주문·대웅전·공포 인스턴스·단청 아틀라스·석탑·범종각·연못·돌담·소나무) + 정문 새것 손질(KTX2 변환, 가격판 떼기, 때 없애기 — 위치·충돌·좌석·자리 이름 그대로); NEW `dancheong_wood`, `wood_pine_natural`, `stone_wall_korean` | `…/tools/{temple_kit,parts_lot_temple}.py`, `gate_kit.py`(D:\ClaudeCode\caysonverse-l4 75ab7df에서 가져와 이 브랜치에서 고침), `lot_temple.glb`·`lot_gate.glb`·`lots/temple/`·`lots/martgate/`의 정문 몫, 룩데브·e2e·`lot{Temple,Gate}Glb.test.ts` | 〃 |
| **L5v2 연결** | feat/lots-wiring 모듈 재사용: `LOTS_WITH_MODEL`에 GLB가 들어온 lot 추가, 로더 GLB 목록·`LOT_TEXTURE_MANIFESTS`(KTX2 → pbrLibrary/KTX2Loader), `VillageLots.tsx` 탐침 표를 v2 lot으로, `lotVillageSeats` 그대로(12자리), `closedNote` 안내, 슬롯 훅(시계·종·놀이터만 1–2단계), `villageLayout.ts` 부지 팻말·공사 끄기, export `lots`, `e2e/lots-walk.mjs` 커밋 | `client/src/village/lots/*`, `shared/src/village/villageLots.ts`(넓히기만), `benchSeats.ts`·`villageLayout.ts`(그 줄만), `scripts/export-village-layout.ts`의 `lots` 줄, `PlotMarkers.tsx`·`plotSigns.ts` | 이 약속(대역 상자로 먼저 붙임), B1–B3 GLB |
| **L6 굽기·조립** | lot GLB마다 라이트맵 낮·밤 굽기(Blender 하나, `CV_CPU=1`), 충돌·좌석 뽑기 대조, 예산·KTX2 GPU MB·폰 fps·100명 측정, 광장 4방향·위 화면, 사진 나란히 시트 | `docs/designs/village-lots-v2/tools/bake_lots.py`, `client/public/models/village/lots/*_lm*.webp`, `docs/designs/village-lots-v2/shots/` | B1–B3, vrb2 village.glb |

순서: B1 · B2 · B3 동시에(서로 다른 파일, **Blender는 한 번에 하나씩 차례로** — PC 공유), L5v2는 동시에 시작 → L6. `art/`는 git 무시라 스크립트 사본은 `docs/designs/village-lots-v2/tools/`에.

## 10. 빌더 공통 규칙 (B1–B3·L5v2·L6 브리프에 그대로)
- **AUTHORIZATION 줄**(사장님 말씀 그대로): design 0장 다섯 줄을 브리프 맨 위에.
- **Aside 한 세션**(사장님 11-16 "쓸데없이 어사이드창을 여러개 띄우고 그러지 마", "사용이 끝난 어사이드는 닫아"): 세션 하나만 만들어 다시 쓰고, 끝나면
  `aside session stop <id>` + 창 닫기. 사진은 보고 적기(받아야 하면 먼저 여쭘). 브라우저 하나, Blender 하나.
- **실제 사진 먼저**: 건물마다 실제 사진 3장 이상 → 구성·비율·재질을 맞추고 → 완성품과 사진을 **나란히 놓은 비교 시트**(`shots/<lot>/compare_*.jpg`). 출처·라이선스는 `SOURCES_<lot>.md`.
- **새것 + 동화**: 때·이끼·녹·바램 0, 모서리 모따기, 파스텔·크림·짙은 지붕으로 이웃 집·카페·추모관과 한 마을. 단색 면 FAIL, 평면 카드 금지(글자·꽃·책·연잎 모두 입체), 최소 기준은 11-11 마을 버스.
- **겹침 검사**: `col__` = 이 약속의 사각형(0.01 m), 문짝 쓸기 안쪽, 모든 사물(나뭇가지·처마 포함)이 발자국 안 — 처마·나무 수관이 발자국 밖으로 나가면 실패. 고친 뒤 `npx vitest run shared/src/village/villageLots.test.ts --maxWorkers=2`.
- 꼬마 규모(문 ≥ 3.2 m 높이, 통로 ≥ 3 m), 좌석 P6, 좌석·충돌은 끝에만 덧붙이기.
- **돈 없음**: 가격·판매·가게·매표·ATM 자리나 글자 금지.
- 종교 건물: 종단·교구·실제 절 이름·경전 글귀·卍·성인 이름 없음, 공손하고 조용하게.
- design 9장 검토 표 T1–T12 전체를 처음부터(검토 때 처음 듣는 항목 없게).
- 커밋은 경로를 적어서(`git add -A` 금지), 꼬리말 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 푸시·배포 안 함.
- 다른 작업(vrb2·x1·m1·추모관·호수)의 파일은 고치지 않기 — 필요하면 요청서. 라이브러리에 세트 더하기만 예외(m1과 같은 형식).
