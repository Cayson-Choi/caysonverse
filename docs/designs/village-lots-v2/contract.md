# 마을 부지 건물 v2 — 약속 (contract)

2026-11-17 · `feat/lots2-design` · 설계는 `design.md`, **숫자는 코드가 정답**: `shared/src/village/villageLots.ts`(시험 `villageLots.test.ts` 30개 + `villageLotsInteriors.test.ts` 6개).
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
`door__<id>_l`/`_r`(경첩 = 문설주, 0 → 90°). 문은 1단계부터 실내로(11장); `closedNote`는 실내를 받는 동안·실패 때 안내.

## 3. 충돌 상자 (`lotColliders`) — id 순서 고정, 모델 `col__<id>`와 0.01 m까지 같게
몸체 `col__<lot>`(카메라 상자, 높이 = `cameraHeight`) 다음 순서대로:
- 학교: `_porch_post_1/2`, `_bench_1/2`, `_swings`, `_climber`, `_seesaw`, `_notice`, `_fence_n`, `_fence_s`, `_fence_fl`, `_fence_fr`(정면 입구 5.2 m), `_tree_1/2`(B1이 덧붙임: 운동장 보리수 두 그루 줄기).
- 성당: `_apse`, `_fountain`, `_bench_1/2`, `_arbor_1/2`, `_lamp_1/2`.
- 도서관: `_bay_l/r`(창가 독서 자리 베이 창), `_bench_1/2`, `_pergola_1..4`, `_book_return`, `_lamp_1/2`, `_topiary_1/2`(B1이 덧붙임: 문 양옆 화분 토피어리).
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
| **B1 학교 + 도서관** (진행 중) | 두 건물 외관 + **실내 2개**(교실·복도, 열람실: 11장 구성·좌석 22·solids 그대로) + 룩데브 + GLB + 시험; NEW 세트 `roof_clay_tile`, `wood_painted`, `play_rubber`, `sand`, `stone_ashlar`, `roof_slate`. 나뉠 수 있음: B1a 외관, B1b 실내 | `docs/designs/village-lots-v2/tools/{school_kit,library_kit,parts_lot_school,parts_lot_library,school_room_kit,library_room_kit}.py`, `client/public/models/village/lots/{lot_school,lot_library,lot_school_class,lot_library_reading}.glb`·`lots/school/`·`lots/library/`, `client/dev/{school,library}Lookdev.ts`, `e2e/{school,library}-lookdev.mjs`, `server/src/tools/lot{School,Library}Glb.test.ts`, 라이브러리의 그 세트 줄 | 이 약속 |
| **B2 성당 + 교회** | 두 건물 외관 + **실내 2개**(성당: 장의자·제대·감실·십자고상·14처·성모상·성인상·구상 색유리·리브 볼트·오르간 로프트; 교회: 장의자·강대상·성찬상·십자가·찬송판·오르간) — 성상은 CC0/PD 스캔 먼저(11장); NEW `copper_new`(B1 세트는 같은 이름으로 씀). 나뉠 수 있음: B2a 외관 둘, B2b 성당 실내, B2c 교회 실내, B2s 성상·색유리 조달·굽기 | `…/tools/{chapel_kit,church_kit,parts_lot_chapel,parts_lot_church,chapel_room_kit,church_room_kit}.py`, `lot_chapel.glb`·`lot_church.glb`·`lot_chapel_nave.glb`·`lot_church_nave.glb`·`lots/chapel/`·`lots/church/`, 룩데브·e2e·`lot{Chapel,Church}Glb.test.ts`, `SOURCES_lot_chapel.md`·`SOURCES_lot_church.md` | 〃 |
| **B3 절 + 정문 손질** | 한옥 절 외관(일주문·대웅전·공포 인스턴스·단청 아틀라스·석탑·범종각·연못·돌담·소나무) + **대웅전 실내**(수미단·본존불·협시보살 2·닫집·후불탱화·단청 우물반자·공양상·연등·방석 12) — 불상·보살상은 CC0/PD 스캔 먼저 + 정문 새것 손질(KTX2, 가격판 떼기, 때 없애기 — 위치·충돌·좌석·자리 이름 그대로); NEW `dancheong_wood`, `wood_pine_natural`, `stone_wall_korean`. 나뉠 수 있음: B3a 절 외관, B3b 대웅전 실내 + 불상 조달, B3c 정문 손질 | `…/tools/{temple_kit,parts_lot_temple,temple_room_kit}.py`, `gate_kit.py`(D:\ClaudeCode\caysonverse-l4 75ab7df에서 가져와 이 브랜치에서 고침), `lot_temple.glb`·`lot_temple_hall.glb`·`lot_gate.glb`·`lots/temple/`·`lots/martgate/`의 정문 몫, 룩데브·e2e·`lot{Temple,Gate}Glb.test.ts`, `SOURCES_lot_temple.md` | 〃 |
| **L5v2 연결** | feat/lots-wiring 모듈 재사용: `LOTS_WITH_MODEL`, 로더 GLB 목록·`LOT_TEXTURE_MANIFESTS`(KTX2 → pbrLibrary/KTX2Loader), `VillageLots.tsx` 탐침 표를 v2 lot으로, `lotVillageSeats` 그대로(바깥 12), **실내 영역 5개**(`AreaId`에 `lot:<unit>`, 문 패드 → 방, 나가기 → 문 도착점, 들어갔을 때만 받고 나오면 놓기, 집 실내 카메라 규칙, 방 좌석 52 `lotin:`), 슬롯 훅(시계·종·놀이터), `villageLayout.ts` 팻말·공사 끄기, export `lots`, `e2e/lots-walk.mjs` + 실내 걷기·앉기 e2e | `client/src/village/lots/*`, `shared/src/village/villageLots.ts`(넓히기만), `benchSeats.ts`·`villageLayout.ts`·영역 목록(그 줄만), `scripts/export-village-layout.ts`의 `lots` 줄, `PlotMarkers.tsx`·`plotSigns.ts` | 이 약속(대역 상자·빈 방으로 먼저 붙임), B1–B3 GLB |
| **L6 굽기·조립** | lot GLB와 실내 GLB마다 라이트맵 낮·밤 굽기(Blender 하나, `CV_CPU=1`; 실내는 색유리 빛 무늬 포함, 구경하기 충분히 밝게), 충돌·좌석 뽑기 대조, 예산·KTX2 GPU MB·폰 fps·100명 측정, 광장 4방향·위 화면, 방마다 입구·중심·앉은 자리 화면 + 사진 나란히(T13 감동 기준) | `docs/designs/village-lots-v2/tools/bake_lots.py`, `client/public/models/village/lots/*_lm*`, `docs/designs/village-lots-v2/shots/` | B1–B3, vrb2 village.glb |

**B1 넘겨주기(이미 진행 중, 2026-11-17 추가)**: 학교·도서관도 **들어가서 앉는 실내**가 1단계예요. 외관 키트는 그대로 계속하고, 실내 2개를
`school_room_kit.py`·`library_room_kit.py`로 따로 만들어 `lot_school_class.glb`·`lot_library_reading.glb`로 내보내요. 방 크기·문·`solids`·좌석 22(`lot_school_chair_1..12`,
`lot_library_chair_1..8`, `lot_library_nook_1/2`)는 `LOT_INTERIORS` 숫자 그대로(시험 `villageLotsInteriors.test.ts`), 외관 베이 창 안 창가 자리와 실내 창가 자리는 같은 물건으로 보이게.
11장 예산(학교 60k/25k, 도서관 90k/35k)·KTX2·T13 감동 기준(층 있는 빛, 책벽·벽난로·칠판·창가 같은 중심, 고른 디테일)을 지켜요. 외관이 먼저 끝나면 B1a로 넘기고 실내를 B1b로 이어 가도 돼요.

**B1이 덧붙인 것 (2026-11-17)**: 실내 `solids` 끝에 학교 `shelf_back`(뒤 창 아래 낮은 장: 책·화분·어항), 도서관 `armchair_w/e`(벽난로 안락의자, 자리 `armchair_nook`),
`ladder`(동쪽 책장 굴림 사다리), `book_cart`(책 수레), `catalogue`(목록함). 검토 뒤(같은 날) 더함: 도서관 `side_table_w/e`(안락의자 옆 협탁·스탠드), `globe`(바닥 지구본), `plant_1/2`(큰 화분), 학교 `reading_shelf`·`easel`·`globe_stand`·`plant_tall`(읽기 모퉁이).
학교 운동장 나무 두 그루는 lot 파일에 그리지 않고 마을 식생 시스템(`client/src/village/veg`, `createVegetation`의 `green` 종)이 키워요: 자리는 `lot_school.glb`의 `asset.extras.vegetation`(세계 x·z, H, R, seed), 줄기 충돌은 `tree_1/2` — L5v2·vrb2가 식생 목록에 넣어요.
**열람실 그림·불 (B1, L5v2 연결 고리)**: `M_painting`은 lot 자기 맵(퍼블릭 도메인 풍경화 아틀라스 `lots/library/lot_library_reading_paintings.ktx2`, 1024², ETC1S sRGB, GPU 약 1.4 MB, UV는 아틀라스 그대로).
불은 노드 `fire__lot_library_reading_hearth`(재질 `M_fire`: 더하기 섞기·빛 안 받음·양면, COLOR_0.rgb = 빛 색, COLOR_0.a = 부드러운 가장자리, TEXCOORD_0.y = 불꽃 높이 0..1 — 노이즈를 y로 흘려 깜빡이게)와
`fire__lot_library_reading_light`(따뜻한 점광 2200 K 위치, 같이 깜빡임; L6는 고정 부분을 바닥·벽난로 바닥에 구움). 텍스처 목록의 `M_fire` 메모에 같은 내용.
**PBR GPU 예산 메모(L5v2·설계자)**: `LOT_SURFACE_RULES.families`대로면 학교 외관만 9세트(PC 2K 약 72 MB / 폰 1K 약 30 MB), B1 네 모델 합 15세트로 `pbrSets`(다섯 채 12세트·PC 60 / 폰 24 MB)를 넘어요. 설계자가 맞출 예정. 실내 GLB `lot_school_class.glb`·`lot_library_reading.glb`는 노드 `lotroom__<unit>` 아래
`_shell`·`_furniture`·`_goods` 메시와 `lotinst__<unit>_<kind>`, 창밖 풍경은 `M_screen`(빛 받지 않는 정점색), 재질은 lot과 같은 PBR 세트(`lots/<dir>/<unit>_textures.json`).

**B3가 덧붙인 것 (2026-11-17)**: 대웅전 실내 `solids` 끝에 벽 기둥 10개(`col_f1..4`, `col_b1..4`, `col_l`, `col_r`: 반지름 0.24 배흘림 기둥이 벽에 반쯤 묻힘, 칸 3.8 m).
성물은 `lot_temple_hall.glb` 안 빈 물체 `lotstatue__lot_temple_hall_buddha`·`_bodhisattva_l`·`_bodhisattva_r`(scale x −1)·`lotart__lot_temple_hall_taenghwa`(게임 yaw, 원점 = 받침 가운데)와
`asset.extras.sacred`(노드 → `sacred/…glb` PC·폰 파일, mirrorX): L5v2가 들어갔을 때 그 자리에 불러요. 실내의 창호지·촛불은 `M_screen`.
`dancheong_wood`는 **아틀라스**(tileMeters 1, `process.atlas`, 영역은 `tools/temple_atlas.py`): UV가 곧 아틀라스 좌표예요(반복 없음; 금박은 ORM 금속).
정문은 `gate_kit.py`(75ab7df) → `gate_base.py`로 라이브러리 세트(`LM_martgate_*`) + 자기 맵 `lots/martgate/lot_gate_goods.ktx2`(글자 없는 그림 지도) + `M_lamp`/`M_sign_emit`,
문짝은 가운데에서 나눈 `door__lot_gate_main_l/_r`(탑 면 경첩, B11 전까지 닫힘). `LOT_SURFACE_RULES.families.lot_gate`를 실제 세트 이름으로 고침.
지붕 판 잰 값(L5v2 확인용): 일주문 처마 밑면 ≈ 4.9(창방 3.72–4.1이 그 아래 x ±2.95), 대웅전 앞 처마 밑면 ≈ 4.9(서까래 끝)·모서리 5.4, 끝 z −3.15·x ±7.6,
범종각 처마 밑면 ≈ 3.5, 끝 x −11.85..−7.55·z −10.6..−6.4.

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
- design 9장 검토 표 T1–T12와 11.3장 T13(감동 기준)–T15 전체를 처음부터(검토 때 처음 듣는 항목 없게).
- 커밋은 경로를 적어서(`git add -A` 금지), 꼬리말 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 푸시·배포 안 함.
- 다른 작업(vrb2·x1·m1·추모관·호수)의 파일은 고치지 않기 — 필요하면 요청서. 라이브러리에 세트 더하기만 예외(m1과 같은 형식).

## 11. 실내 약속 (사장님 2026-11-17 추가 — design 11장)
- 다섯 채 모두 **1단계에 들어가는 실내**(문 phase 1, 방 phase 1). 숫자: `LOT_INTERIORS`(방 틀·문·고정 가구 `solids`·좌석·예산·필수 구성 `program`), 시험 `villageLotsInteriors.test.ts`.
- 틀: 방 원점 = `units[].interior.origin`, x = 들어서서 왼쪽 벽부터 가로, z = 문 벽 안쪽 면부터 안으로, 바닥 y = 0. 문 = z 0 벽의 `doorX`.
  나가기 패드 (doorX, 0.8, r 1.0), 들어올 때 도착점 (doorX, 1.6), 노드 `door__<unit>_exit`.
- 모델: 방마다 `client/public/models/village/lots/<unit>.glb`(실내 따로, 들어갔을 때만 받음), 노드 `lotroom__<unit>`, 충돌 `col__<unit>_<solid name>`(0.01 m),
  좌석 `seat__<seat id>`(방 틀 좌표), 밤·낮 라이트맵 `<unit>_lm*.ktx2`, 성상 `lotstatue__<unit>_<name>`(LOD 2단: PC/폰).
- 좌석 52: 학교 의자 12 → 도서관 의자 8 + 창가 2 → 성당 장의자 10 → 교회 장의자 8 → 대웅전 방석 12. 덧붙이기만. 앞 0.6 m 비움(방석 제외), 장의자는 3명, 창가 2명.
  L5v2: `lotin:<seat id>:<place>` 좌석을 그 방 영역 좌석 목록에(집 실내 좌석과 같은 방식), 탭 = 걷기, 버튼 = 앉기.
- 예산(방 하나 안에서 그리는 전부): 학교 60k/25k, 도서관 90k/35k, 성당 140k/55k, 교회 70k/28k, 대웅전 140k/55k 삼각형(PC/폰), KTX2 GPU MB 24/8 · 32/10 · 48/14 · 28/8 · 48/14,
  그리기 40/25 · 45/28 · 60/35 · 40/25 · 60/35. 반복물(책·장의자·연등·초)은 인스턴스. 폰 30 fps(방 가운데·앉은 자리에서 측정).
- **사실적 성상·그림·색유리**(design 11.2): CC0/퍼블릭 도메인 실제 스캔 먼저(Smithsonian 3D Open Access CC0, Scan The World, Sketchfab CC0만) → 라이선스·출처 기록 →
  디시메이트 + 노멀/AO 굽기; 없으면 Blender 고해상 조각 + 퍼블릭 도메인 사진 질감 + 굽기. 색유리 = 퍼블릭 도메인 작품, 입체 납 띠, 투과 빛 무늬.
  **AI 3D 금지**, 실제 단체 이름·로고·경전 글귀·卍 금지, 공손하게. 빛은 구워서 사실적으로, 구경하기 충분히 밝게.
- **감동 기준 T13**: 실제 같고 깨끗하며 아름답고 세련, 층 있는 빛, 강한 중심, 고른 디테일. "맞기만 한" 결과는 검토에서 돌려보냄.

## 12. L5v2 연결 결과 (2026-11-17, `feat/lots2-wiring`)
- **방 자리 옮김**: 교실 (410, 0) · 성당 안 (440, 0) · 열람실 (470, 0)이 집 실내 G의 집 20칸 구역(x 359.7..586.9, z −8.1..30.3) 안이라 게임에서는
  `LOT_ROOM_AT`대로 z 40 줄로 옮겼어요: 교실 (470, 40), 성당 안 (500, 40), 열람실 (530, 40). 대웅전 (410, 40)·예배당 (440, 40)은 그대로.
  모델은 다시 굽지 않고 게임이 `LotRoom.shift`만큼 옮겨 그려요(방 틀 숫자 · solids · 좌석 · 문은 그대로, GLB 시험도 그대로). 방마다 벽(0.5 m)과
  집들의 단단한 땅(`housesBlockers`)을 방 크기만큼 파낸 구멍(`carveBlockers`)이 서버·클라이언트 같은 `villageGeometry`에 있어요.
- **지붕 판**: B3가 잰 밑면으로 고침 — 일주문 4.4 → 3.6(창방 3.72 아래), 대웅전 앞 처마 z −3 → −3.2, 범종각 3.6 → 3.4 · x −11.9..−7.5 · z −10.65..−6.35.
- **장의자 발 자리**: 장의자의 걷기 상자는 앉는 판 앞 끝에서 0.1 m 짧게(`LOT_PEW_KNEE`) — 몸 반지름 0.4로 장의자 사이 0.9 m에 설 수 있게.
- **좌석 순서**: main의 마지막 좌석(h9_1_10) 뒤 → 바깥 12자리(32칸, `lot:`) → 실내 52자리(90칸, `lotin:<seat id>:<place>`): 교실 12 · 열람실 8 + 창가 2×2 ·
  성당 장의자 10×3 · 예배당 장의자 8×3 · 대웅전 방석 12. 같은 장의자의 이웃 자리는 1.12 m 이상(앉은 손 너비 1.107 m), 등받이 자리는 늘 앞에서 앉고 앞에 서요.
- **문**: 키트의 문짝은 두께 가운데를 경첩으로 돌아 안쪽 반이 문설주에 2–3 cm 파고들었어요 — 게임은 문짝 안쪽 면 경첩 모서리를 축으로 돌려요
  (`innerHingePivot`). 대웅전 꽃살문(0.94–4.04 m)은 뒤 문지방(0.96)·머리 인방(4.02)에 걸려 0.965–4.015 m로 맞춤(`LEAF_FIT`). 바닥 없는 현관(학교·도서관·
  교회)에는 3 cm 높이 바닥을 깔았어요(village.glb의 빈 부지 잔디가 2 cm 위라서). 문짝 다섯 쌍 × 20단계 쓸기 검사(`lotDoorCheck.ts`) 겹침 0.
- **질감 GPU**: 바깥 여섯 채가 쓰는 라이브러리 세트가 27개(약속 ≤ 12)라 한꺼번에는 PC 216 MB / 폰 90 MB예요. 게임은 모든 세트를 1K 알베도만(PC 36 MB /
  폰 18 MB) 먼저, 자세히 그리는 부지의 세트만 전체로(PC 2K) 불러요. 설계자가 세트 수를 줄이면 그대로 줄어요.
- **아직**: 방의 빛은 L6 굽기 대신 재질 안 등불 항(`roomLamps`, three 빛 없음 — 프로그램 다시 컴파일 없음)과 은은한 앰비언트예요. 폰 110 m 대역 상자는
  vrb2의 `lotproxy__`가 오면 붙여요(지금은 여섯 채 껍데기를 합친 메시라 부지별로 끌 수 없음).

### 12.1 release 4 위 2차 (2026-11-17, origin/main 5c3e870 + 70f6451·8e5c038 합침)
- **좌석**: main의 마지막(release 4가 더한 집 좌석) 뒤 — 바깥 270–301, 실내 302–391(합 392). 시험 `lotsWiring.test.ts`가 270·302를 고정.
- **카메라**: 성당·교회 문 앞 사진은 카메라가 거리 쪽에서 문을 보도록(머리 속 아님). 도서관 모퉁이 사진은 시험 눈이 건물 쪽으로 미끄러져 제 날개 안에
  들어갔던 것(게임 카메라 아님) — 바깥으로 밀고, 옆집 안이면 반대 모퉁이에서. 거리·모퉁이 사진은 이제 여섯 채를 모두 자세히(`__cvLotsForce(2)`) 그려요 —
  예전 시트는 게임이 플레이어·게임 카메라 기준으로 고른 먼 껍데기(알베도 하나, 장식 없음)를 찍은 것이라 "평평한 갈색 상자·검은 판"으로 보였어요.
- **바깥 껍데기 양면**: `LM_*` 면을 양면으로 — 장미창·문 위 채광창·열린 문으로 반대쪽 벽 뒷면 너머 하늘·잔디가 비치던 것.
- **방 텍스처 (PC / 폰, MB = 10⁶ B, 압축 1 B/텍셀 · mip 4/3)**: 교실 23.8 (≤ 24) · 열람실 32.2 → 29.4 (≤ 32, 칠한 나무도 알베도만) · 성당 72.6 → **26.8** (≤ 28) ·
  교회 43.9 → 26.3 · 대웅전 34.4 → 17.5 / 폰 성당 11.0 → **7.1** (≤ 8) · 폰 교회 7.7.
  방법: `ROOM_TEXTURES`(방마다 전체 세트 / 알베도만), 성상·색유리 맵을 KTX2 mip 단계로 상한(`SACRED_MAP_MAX` 색 1024 · 노멀 512(폰 256) · ORM 256,
  4×4 블록 크기만), 같은 성물 파일은 한 번 읽고 복제(교회 투명 lancet 6개가 맵 6벌이었음).
- **방에서 나올 때 1.3–1.7 s 한 프레임**: 마을 전체가 다시 붙는 main 공통 구조(집·회관도 같음). 문 커튼이 새 장소를 3프레임 그린 뒤 열리게(`ARRIVE_FRAMES`)
  해서 그 프레임은 검은 화면 뒤에 지나가요. 근본(마을을 붙여 둔 채 방 그리기)은 main 전체 일이라 따로.
- **아직 (설계·굽기 몫)**: 바깥 질감 세트 27개(약속 ≤ 12), 정적 삼각형 — release 4 village.glb 239,150 + 버스 35,530 + 집 75,803 = 350,483으로
  부지 껍데기·자세히 풀을 넣기 전에 이미 PC 310k 위. 콜마르 기준 바깥 다듬기(창 깊이·창턱·꽃상자·차양·몰딩, 성당 색조), L6 굽기(실내 낮/밤 라이트맵,
  성상 AO, 부지별 바깥 라이트맵)는 Blender 키트(`tools/*_kit.py`)에서 다시 구워야 해요.
- **회귀 (release 4 + 이번 고침, PC·해 질 녘·밤·폰)**: 153/154 — 남은 하나는 폰에서 "glGetProgramiv: Program object expected" 경고 12줄(main의
  70f6451 뒤에도 남음). 둘러보기 PC 59.8 fps(최대 233 ms) · 폰 59.8 fps(최대 150 ms), 방 들어가기 최대 133 ms(PC) / 100 ms(폰).
  시트: `shots/l5v2/sheet_ref_exterior.jpg`·`sheet_ref_interior.jpg`(빌더의 실제 사진 비교 시트 옆에 지금 게임), `sheet_day_sunset_night.jpg`, `sheet_rooms_*.jpg`.
  성당은 게임에서 B2 렌더(크림빛 석회암)보다 갈색으로 짙어요 — 꼭짓점 색 × stone_ashlar 알베도 조합, 바깥 다듬기 때 같이 맞출 것.

### 12.2 3차 — 성당 색·콜마르 다듬기 (2026-11-17, 코디네이터 결정: 정적 삼각형 310k 넘어도 됨 · 바깥 세트 12개 넘어도 됨)
- **성당 색**: 꼭짓점 색(F6E7C8 → 0.97/0.87/0.68)은 거의 흰색이었고, 어둡던 건 stone_ashlar의 꿀색 알베도(선형 평균 0.43/0.34/0.23) × 그늘 쪽 빛(흰 면 ≈ 0.5)이었어요.
  매니페스트에 `albedoGain`(재질 색, 선형 RGB 배수)을 새로 두고 성당 돌에 2.0/2.15/2.6 — 해 받는 면이 B2 렌더의 크림빛 석회암. 키트(`chapel_kit.py` `gain`)와
  `b1_blender.py`가 다음 굽기에도 같은 값을 써요. 실내 성당(별도 매니페스트)은 그대로.
- **교회** (`church_kit.py`): 첨두창마다 세이지 루버 덧문 한 쌍, 제라늄 창상자, 세이지빛 물끊기·처마 아래 띠. 창 간격(z −1.2/−3.8/−6.4)을 넓혀 덧문이
  모서리판 안에 들어가게. 창상자 충돌 띠 `window_boxes_w/e`(벽에서 0.22 m). 구조 7,611 (≤ 7,700) · 자세히 11,549 · 겹침 0.
- **학교** (`school_kit.py`): 1층 거리 쪽 창에도 초록 덧문, 거리 쪽 창마다 크림 몰딩(1층 0.18 · 2층 0.12 m), 덧문은 몰딩 바깥(`sash_window(shutter_gap)`).
  자세히 16,824 (≤ 18,000) · 겹침 0.
- **그대로 둔 것**: 성당(고딕 돌 성당 — 창상자 대신 벽 따라 라벤더·장미가 이미 있음, 색만), 도서관(차양·꽃상자·목조 박공 이미 있음), 절(자세히 그리면
  기와 얹은 돌담·단청 — "검은 판"은 먼 껍데기였음), 정문(자세히 그리면 깃발·전구·띠 장식).
- **L6 굽기**: 아직 — 아래 계획.
- **회귀 (3차 뒤, PC 낮·해 질 녘·밤 + 폰)**: 153/154 — 남은 하나는 같은 폰 "glGetProgramiv" 경고. 둘러보기 PC 59.5 fps(최대 333 ms) · 폰 57.3 fps(최대 533 ms,
  100 ms 넘는 프레임 25 — 2차 때 3), 방 들어가기 최대 PC 50 ms · 폰 67 ms. 방 텍스처는 2차 그대로(교실 23.8 · 열람실 29.4 · 성당 26.8 · 폰 성당 7.1 MB).
- **L6 굽기 계획** (안 함): `tools/bake_lots.py` — 방 GLB마다 UV2(라이트맵 펼침), Cycles CPU(`CV_CPU=1`)로 낮·밤 간접광+AO를 1K로 굽고 KTX2(UASTC)로,
  매니페스트 `lightmap: {day, night}`; 게임은 `LotRoom`에서 `lightMap`(channel 1)을 낮/밤 섞기(uniform 하나, 프로그램 그대로), 지금의 `roomLamps` 항은
  움직이는 불꽃 몫만. 성상 AO는 스캔의 ORM에 이미 있음. 바깥은 부지마다 같은 방식(껍데기 + 자세히, 1K). 방 하나에 Blender 굽기 20–40분 × 5 + 바깥 6.

### 12.3 L6 굽기 — 실내 라이트맵 (2026-11-18)
- **도구**: `tools/bake_lots.py` — 방 키트(`parts_lot_<unit>.py`)를 `--lightmap <폴더> [--lm-size 1024] [--lm-samples 128]`로 돌리면
  내보내기 직전에 방 껍데기(`lotroom__<unit>_shell`: 벽·바닥·천장·고정 구조)에 두 번째 UV `lm`을 한 장으로 펼치고, Cycles CPU(`CV_CPU=1`)로
  낮(하늘·창으로 든 해·방 등)과 밤(등·촛불·채움 빛, 밤 세기) 확산 조도(직접+간접, 색 없음)를 굽고, 8-bit sRGB PNG(공통 `scale`)로 써요.
  `png2ktx2.mjs`로 ETC1S KTX2. GLB extras `lightmap {day, night, scale, channel: 1}`. 가구·인스턴스 장의자는 굽는 장면에 그대로 있어
  바닥에 그 접촉 그림자가 들어가요(가구 자체는 라이트맵 없음, 실시간 빛). 폰 파일(`--phone`)은 512 px, `<unit>_phone_lm_*`.
  방 하나 4–5분(1024 px, 128 샘플). 다시 구운 GLB는 노드·삼각형이 이전과 같고 TEXCOORD_1만 늘어요.
- **게임** (`LotRoom.tsx`): 낮 지도는 `lightMap`(channel 1), 밤 지도는 라이트맵 청크 안에서 uniform 하나(`uLmMix`)로 섞어요 — 낮밤이 바뀌어도
  프로그램 그대로. `LIGHTMAP_GAIN` 0.8, 방 앰비언트 30 %, 구운 방 안의 실시간 하늘 50 %·햇빛 60 %(`roomBaked`, DayNight).
  두 지도는 입장 커튼 아래에서 미리 올리고(`gl.initTexture`), 커튼은 `compileSafely`가 끝난 뒤(최대 2.5 s) 열려요.
- **예산 (PC / 폰, MB)**: 구운 방에서는 회벽(plaster_painted)이 PC에서도 알베도만(벽 음영은 라이트맵이): 교실 23.8 · 열람실 29.4 · 성당 26.8 ·
  예배당 26.3 · 대웅전 20.3 / 폰 성당 7.8.
- **입장 프레임 (PC, 최대 ms, 낮·밤)**: 교실 117/33 · 열람실 33/17 · 성당 33/17 (시험 때 183–250) · 예배당 17/83 · 대웅전 133/50.
- **시트**: `shots/l5v2/lm_before_after_rooms_day.jpg`, `lm_before_after_rooms_night.jpg`, `lm_before_after_phone_chapel.jpg`, `lm_before_after_chapel.jpg`.
- **아직**: 바깥 부지별 라이트맵(껍데기 + 자세히), 폰 예배당 파일.
- **폰 둘러보기 재측정 (2026-11-18 새벽, Caysonland 합친 뒤)**: 100 ms 넘는 프레임 — 이 브랜치 5 · 11 · 16 · 0 · 16, main d3b0706(라이트맵 없음)과
  번갈아 5 · 4. 같은 브랜치가 0과 16(최대 1.2 s)을 오가요: 다른 에이전트 e2e(동시 1개)와 GPU를 나눠 쓰는 잡음이 커서 이 PC로는 판정 불가.
  라이트맵 변경은 방 안에서만 작동(DayNight 조건부, 둘러보기는 방에 들어가지 않음).

### 12.4 L6 바깥 라이트맵 + 폰 예배당 (2026-11-18)
- **바깥** (`bake_lots.bake_lot`, `parts_lot_<lot>.py --lightmap <폴더>`): 부지마다 껍데기(`lotshell__`)와 자세히 구조(`lotdetail__<lot>_mesh`)를 한 장
  (1024)에 펼쳐 두 번 구워요 — `ao`: 하늘이 닿는 정도(Cycles AO, 땅 없이: 게임의 하늘빛이 이미 땅 쪽을 어둡게 하니 열린 벽은 1, 처마·창 안쪽·모서리만
  어두워짐), `night`: 해와 하늘을 끈 밤 조명(등·창·현관 빛, 땅 반사 포함)의 조도, `scale`. 부지 하나 1–2분(64 샘플).
- **게임**: `patchLotLightmap` — 하늘·앰비언트 빛(irradiance)에 `mix(1, ao, LOT_AO_STRENGTH 0.6)`을 곱하고(실시간 해와 그림자는 그대로),
  밤 지도 × scale × `LOT_LM_NIGHT_GAIN` 0.7 × 등이 켜진 정도를 더해요. 셰이더 하나(낮밤 uniform). 껍데기 합치기(`mergeReady`)는 구운 부지의
  `LM_` 면에서 uv1을 지켜요. 지도 12장은 부지들이 보이기 전에 한 프레임에 한 장씩 올리고(`gl.initTexture`), 다 올라가야 부지가 그려져요 —
  걷는 중에 올라가는 일 없음. 폰은 위 mip을 떼어 512(`capMips`).
- **GPU**: PC 12 × 1.4 = 16.8 MB, 폰 4.2 MB (바깥 세트 36 / 18 MB에 더해). GLB는 노드·삼각형 그대로, 파일 +40–80 KB(TEXCOORD_1).
- **폰 예배당**: 512 px 라이트맵, 바닥 세트도 알베도만 → 5.6 MB (≤ 8).
- **시트**: `shots/l5v2/lm_before_after_exterior_day.jpg`, `lm_before_after_exterior_night.jpg` (여섯 채 × 거리·모퉁이).

### 12.5 대웅전 다시 다듬기 (2026-11-18, `feat/temple-interior`) — 사장님 "절이 너무 허접해 … 고화질로 선명하게 … 진짜 입체적으로"
- **본존불**: 같은 dluo 스캔(CC BY 4.0)을 바로 세우고(옆으로 23도 돌아가 있었음) 얇은 사진측량 광배를 잘라, **직접 모델링한 광배**(불꽃 테 + 연꽃잎 두광 + 구슬 띠,
  `tools/sacred/build_mandorla.py`, 별도 GLB `lotstatue__lot_temple_hall_buddha_halo`, 방 노드 같은 자리)를 뒀어요. 3.6만 삼각형 · 노멀 4096에서 구워 2048 · 색 2048
  (예전 2만 · 노멀 1K · 표시 상한 512라 얼굴이 뭉개졌어요). 금박은 환경맵이 없는 방에서 하얗게 타지 않게 채도를 높이고 금속 0.75로 다시 구웠어요.
- **협시보살**: 국가유산청 금동보살입상(공공누리 제1유형) 1.3만 삼각형 · 노멀 2048 · 새 금박.
- **후불탱화**: 같은 CC0 그림(Cleveland 1998.120) **3072 px**(전엔 2048), 금박 구슬·옻칠 틀·금 모서리·금 처마. 폰은 1536.
- **족자 2점**(뒤 벽 좌우, 오른쪽은 거울): Cleveland 1918.542 (CC0) — `make_scroll.py` + `build_scroll.py`. **연등**: 연꽃봉오리 모양(두 줄 꽃잎, 능선) 38개 인스턴스.
- **선명도**: `SACRED_MAP_MAX_BY_UNIT.lot_temple_hall`(PC 색 3072 · 노멀 2048 · ORM 512 / 폰 1536 · 1024 · 256), 성물·방 질감 이방성 16배(전엔 1배), mip 그대로.
- **굽기**: 방 키트를 다시 돌려 낮·밤 라이트맵을 새로 구웠어요(`b1_blender.load_png`: 디코딩한 PBR PNG가 없어도 평평한 회색으로 굽는 대체 — 단, 노멀 대체는 (0.5,0.5,1)이어야
  해요, 회색이면 길이 0 노멀로 새까맣게 구워져요). 좌석·충돌·문은 그대로(노드·`solids` 변화 없음).
- **숫자 (PC / 폰)**: 정적 삼각형 방 52.9k + 성물 94.2k = 147k / 52.9k + 32.4k = 85k (계약 140k / 55k 위 — 성물 몫을 늘린 값), 방 자체 질감 GPU 33.1 MB + 방 세트 12.6 =
  45.7 MB (≤ 48) / 9.0 + 7.0 = 16.0 MB (> 14), 내려받기 PC 13.4 MB · 폰 약 6.0 MB. 방 들어갈 때 가장 긴 프레임은 전과 같은 잡음 안(전 283–467 ms, 후 266–316 ms, 이 PC는 다른 에이전트와 같이 써서 ±).
- **금박 반사 (2차)**: 원인은 "환경맵이 안 먹는 것"이 아니라 **환경맵이 너무 어두웠던 것**(8비트 파노라마라 복사 밝기 ≤ 1 → envMapIntensity 30으로도 안 보임). 이제 절 안을
  본뜬 128x64 반 부동소수 파노라마(문 종이창·등 1.5–3, 벽·바닥 0.4–0.8)를 PMREM으로 한 번 만들어(지우지 않음) 금박 재질(`gilt` 이름 · 본존불·보살 금속 맵)만 써요
  (`SACRED_ENV_INTENSITY` 0.45; 0.9는 광배가 하얗게 타요). 단청·탱화·방 표면은 그대로. 보살은 금속 0.62로 다시 구웠어요(0.92는 반사만 남아 어두웠어요).
- **광배 (2차)**: 전부 금박 금속(본존불과 같은 재질) — 불꽃 테, 연꽃 덩굴(잎·꽃), 화불 5개, 두광은 붉은 가운데 + 초록 + 파랑 띠(금 줄·구슬). 스캔의 깨진 육계는 잘라내고
  남색 육계와 나발을 직접 모델링해 얹었어요. 삼각형 광배 2.9만.
- **폰 질감**: 보살 폰 색 768 · 노멀 512, 탱화 폰 색 1024 → 폰 GPU 방 6.8 + 세트 7.0 = 13.8 MB (≤ 14).
- **직접 만든 불상 시도 (버림)**: 소유자 허락("니가 멋지게 불상을 제작해도 돼")으로 `tools/sacred/build_buddha.py`(메타볼 + 복셀 합치기 + 주름·얼굴 변위, 몸통·머리/손 두 장)를
  만들어 봤지만 결과가 마네킹 같아(기둥 같은 몸통, 장난감 얼굴) 스캔 본존불보다 못해서 쓰지 않았어요. 스크립트는 기록으로만 남겨요.
- **아직**: 본존불 배의 가는 가로선(스캔의 얇은 판; 가는 삼각형 걸러내기로 못 잡음)과 새 육계 가장자리가 머리와 만나는 선.

### 12.6 본존불 v2 — 직접 만든 원작 (2026-11-18, `feat/temple-interior`) — 사장님 "그냥 블렌더로 니가 입체적인 불상을 니가 만들어. 여러 부처님 불상을 찾아보고 비슷하게 만들면 되잖아"
- **무엇**: 석굴암 본존불을 본보기로 한 금동 좌불 + 연화대, 전부 이 프로젝트의 원작(바탕 몸·발만 Blender Studio Human Base Meshes, CC0). 결가부좌(오른발 위, 발바닥이 보임),
  항마촉지인, 우견편단, 반쯤 감은 긴 눈·높은 눈썹·백호·긴 귓불·삼도, 나발 ~950개(군청빛 검정, 무광) + 육계, 나머지는 모두 금. 연화대는 팔각 하대석 · 복련 · 중대석(기둥 8) · 2단 겹잎 앙련 · 구슬 테.
  만드는 법·참고 사진은 `tools/sacred/SOURCES.md` "본존불 v2", 스크립트 `tools/sacred/bv2_pose.py` → `bv2_sculpt.py` → `bv2_bake.py` (+ `bv2_regrade.py`, `bv2_look.py`).
- **자리**: 같은 파일 이름·같은 방 노드(`lotstatue__lot_temple_hall_buddha`): 원점 = 연화대 바닥 가운데, 앞 = glTF +Z, 높이 2.0 m(연화대 0.60 + 앉은 몸 1.40), 폭 1.47 · 깊이 1.29 m
  (수미단 안: 앞 끝 z 5.65 > 5.6). 머리 축 (0, 0.14) — 예전 광배 자리 그대로. 광배는 같은 `build_mandorla.py`를 `MANDORLA_CAP=0`(스캔용 남색 모자 뺌), 두광 중심 높이 1.74로 다시 만듦.
  석굴암식 둥근 두광(`MANDORLA_STYLE=round`)도 비교했지만(`shots/temple_v3/turntable/halo_options.jpg`) 탱화·단청과 어울리는 불꽃 광배를 유지.
- **숫자**: PC 4만 삼각형 · 노멀/색 2048 · ORM 1024(표시 상한 512) · 파일 4.17 MB(전 4.70), 폰 1만 · 1024 maps · 1.69 MB(전 2.02); 광배 2.69만/0.94만 삼각형, 0.54/0.20 MB(전 0.61/0.23).
  방 GPU 질감(e2e 측정, `__cvLotRoom().textures`): PC 방 자체 33.1 + 세트 12.6 = **45.7 MB (≤ 48)**, 폰 6.8 + 7.0 = **13.8 MB (≤ 14)** — 전과 같음(같은 맵 크기). 성물 삼각형 PC 10.1만 · 폰 3.4만.
  내려받기: 본존불+광배 PC −0.60 MB, 폰 −0.36 MB(방 전체 PC 약 12.8 MB, 폰 약 5.6 MB).
- **들어갈 때 끊김 (A/B, 같은 설정 `CV_NO_TOUR=1 CV_NO_STREET=1`, 매번 서버 다시 켬, 2회씩)**: 가장 긴 프레임 PC 전 367 / 333 ms → 후 283 / 333 ms, 폰 전 5817 / 167 ms → 후 1467 / 333 ms
  (폰의 첫 회 큰 값은 전·후 모두 나오는 첫 셰이더 준비 — 이 PC는 다른 에이전트와 GPU를 같이 써서 ±). 회귀 없음.
- **사진**: `shots/temple_v3/` — `before/`·`after/`(lots2-walk `CV_TEMPLE_SHOTS`, PC 1280x800 · 폰 375x812), `compare_{pc,phone}_{altar_front,buddha_face,buddha_hands,buddha_lap,hall_wide}.jpg`,
  `turntable/`(Blender 렌더: 앞 · 3/4 · 옆 · 얼굴 · 손), 실제 사진과 나란히 놓은 시트는 저장소 밖에만 둠(공개 저장소라 남의 사진은 넣지 않음). 새 본존불은 낮게 앉아 `buddha_hands` 카메라에는 어깨가 나와서
  `buddha_lap` 카메라를 더했어요(e2e/lots2-walk.mjs).
- **솔직한 차이**: 석굴암보다 어깨·가슴이 덜 두툼하고 목이 가늘며, 무릎의 옷자락이 매끈한 덩어리에 가까워요(앞으로 늘어진 옷자락 시도는 방석처럼 보여 뺌). 얼굴은 이상화했지만
  실사 바탕 머리의 흔적(콧방울·입술 모양)이 남아 있어요. 방의 평평한 밝은 빛에서는 금이 밝은 살구빛으로 보여 색을 한 번 더 깊게(AO 섞기) 다듬었어요.
- **2차 손질 (같은 날 밤, 사장님 "얼굴을 더 온화한 불상 얼굴로 고치고 몸을 더 둥글고 넉넉하게 방 안 금빛도 살려")**: 얼굴은 바탕 머리의 콧방울·입술·광대를 지우고
  둥근 달걀형·통통한 볼·곧은 콧날·작고 도톰한 입(살짝 웃음), 몸은 근육 없이 둥글게 부풀리고 어깨를 넓히고 무릎 덩어리와 옷주름을 굵게, 금은 밝은 금(금속 1.0,
  거칠기 0.20 ± 얼룩, 주름 AO 깊게, 선형 0.80 / 0.52 / 0.13) + 방에서 본존불 재질만 환경맵 1.0(`LotRoom.tsx` `SACRED_STATUE_ENV_INTENSITY`; 광배는 0.45).
  **방 안 금이 칙칙한 황토색이던 진짜 원인**: 방 등불 셰이더(`LAMP_FRAG`)가 금속에도 알베도 전체를 확산광으로 더해서 금박이 무광 페인트처럼 평평했어요.
  이제 등불은 `material.diffuseContribution`(금속이면 0)으로 확산광을 주고, 금속에는 넓은 GGX 하이라이트(거칠기 ≥ 0.55, ×0.35 × 금속도)로 들어가요 —
  비금속(나무·단청·탱화·벽)은 그대로, 금속(본존불·보살·광배·족자 금구)은 반짝이는 금속으로 보여요. 소매·손목 얼룩은 AO 도달 거리(기본 10 m) 탓 → 4.5 cm,
  빗나간 광선 자리는 기본값으로 채움. 숫자: PC 4만 · 4.02 MB, 폰 1만 · 1.60 MB, 방 GPU 질감 PC 45.7 / 폰 13.8 MB(그대로), 들어갈 때 가장 긴 프레임 낮 PC 400 ms ·
  폰 1167 ms, 밤 PC 450 ms(1차 A/B의 전·후 범위 안). 사진 `shots/temple_v3/after2/`(낮, PC·폰), `after2_night/`(밤, PC), `compare2_*.jpg`, `turntable/`(2차로 덮어씀).
- **3차 (같은 날 밤, 사장님이 보낸 6면 사진 "이거랑 똑같이 만들어봐", 다음 "오른손 중지와 엄지를 다시 한번 확인해봐")**: 기준을 석굴암에서 사장님 참고 사진
  (`art/sacred/ref/owner_buddha_turnaround_v2.webp`, 저장소 밖)으로 바꿨어요.
  - **손**: 오른손은 어깨 앞으로 들어 손바닥이 밖을 보고, **엄지 끝과 중지 끝이 맞닿아 작은 고리**, 검지는 곧게 위로, 약지·새끼는 위로 살짝 굽음(설법인/중품인).
    기본 케이지의 손가락을 연결 성분으로 나눠(무릎선 아래에서 네 손가락이 따로 떨어짐) 관절마다 굽히고 벌어짐을 모으고, 엄지는 중지 끝을 향해 돌림(`bv2_sculpt.py` `mudra`).
    왼손은 무릎 위 손바닥 위로. 항마촉지인은 버림.
  - **머리**: 머리를 24% 크게, 높은 육계, 정수리 금 계주와 육계 앞 금 장식, 무광 검정 나발을 가지런한 줄로(이마선을 따라 줄 → 육계는 위도 줄), 깨끗한 이마선.
    얼굴에 칠: 초록 눈썹·콧수염 선·턱 점, 붉은 입술(고면 재질 → 색 맵, 금속 0).
  - **몸·가사**: 몸통을 넓고 두툼하게(가로 13%, 앞뒤 8%), 가사 두께 2.6 cm와 또렷한 단, 배를 가로지르는 가로 주름, 등은 왼어깨에서 흘러내리는 평행 주름.
  - **연화대**: 사진처럼 둥근 2단 — 통통한 꽃잎 두 겹씩(아래 18+18, 위 18+18), 잘록한 허리 띠, 평평한 둥근 받침, 밑면 12잎 연꽃 부조. 높이 0.42 m(전체의 21%), 앉은 몸 1.58 m.
  - **금**: 밝은 노란 금(선형 0.88 / 0.60 / 0.07), 거울 같은 거칠기 0.13, 그늘 쪽은 덜 어둡고 따뜻하게(0.58 + 0.42 AO, 노랑 쪽으로),
    방에서 본존불만 환경맵 1.5 + 자기 색 맵으로 약한 따뜻한 채움빛(`SACRED_STATUE_FILL` — 갈색 청동처럼 보이던 그늘을 금박으로).
  - 광배는 그대로(사진에는 없지만 대웅전 구성) — 두광 중심만 새 머리 높이 1.64로. 원하면 빼기 쉬워요(방 GLB의 `_halo` 마커).
  - 등불 셰이더 수정(2차)의 다른 방 확인: 성당·교회·학교 교실 전/후 사진(`shots/temple_v3/rooms_lamp_check.jpg`) — 나무·벽·바닥은 같고, 놋쇠 촛대·샹들리에만 살짝 금속답게.
  - 사진: 게임 자산 6면 `turntable/six_*.jpg`(참고 사진과 나란히 놓은 시트는 저장소 밖에만), `after3/`·`after3_night/`, `compare3_*.jpg`.
