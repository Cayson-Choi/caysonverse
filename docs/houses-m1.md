# 집·카페·키오스크 외관 다시 짓기 — 1단계(M1)

`feat/houses-m1` (main `59fd947` 기준). 설계: `scratchpad/houses/design/design.md`(승인), 카페는 `handoff-codex/buildscale/cafe/cafe_options.md`의 **안 2**(20 × 15 m, 2층, 테라스 12석).

## 무엇이 바뀌었나

- **village.glb를 B안으로 다시 빌드**했어요. 집 10채(6·8번은 B안 자리), 카페(안 2), 꽃 키오스크, 추모관 바깥(20 × 16)이 새 모델이에요.
  - 벽은 창·문 자리를 실제로 비워 만들고(벽 두께 0.30 m, 안쪽 옆면 보임), 창틀(짙은 회색/흰 PVC)·미서기 두 짝·유리·커튼·돌 창대·테두리·인방을 달았어요.
  - 현관문은 1.8 × 2.9 m 유리 양문(참나무 틀, 긴 바 손잡이, 키패드 불이 들어오는 도어락).
  - 지붕은 두께 0.2 m, 처마 밑판, 처마 판, 박공판, 둥근 홈통, 선홈통, 용마루 갓, 굴뚝(갓·토관). 포치 지붕 꼭대기는 2층 창대 판보다 0.6 m 이상 낮아 "지붕에 잘린 창"이 없어요(빌드 스크립트에서 assert, 박공 포치 경사 15도).
  - 집마다 색은 그대로, 창틀 색·포치(박공/캐노피/넓은 데크)·굴뚝(벽돌/철)·커튼·방 색이 달라요.
  - 충돌 = 보이는 것: 몸체 둘레 0.57 m 띠는 돌 테두리 화단(꽃·관목)이고 `col__house_*` 상자는 몸체(+둘레 화단)만이에요(발자국 − 문 쪽 2.25 m). 포치는 걸을 수 있고, 포치의 난간·기둥·양옆 화단·벤치·소품은 작은 `col__house_N_porch_k` 상자예요.
- **카페(안 2)**: `SCENERY_SIZES.cafe` 20 × 15, 중심 (50.6, −15.1), `SCENERY_TERRACE.cafe = 6`. 충돌 상자는 테라스를 뺀 본채 `solidBox` (x 46.6 ~ 60.6, 정면 벽까지)라서 테라스(3 cm 데크)와 문 앞 돌 디딤판은 걸을 수 있어요. 문 양옆 0.4 m 돌 단은 `col__cafe_step_1/2`. 테라스에 파라솔 테이블 4개, 의자 12개(`seat__cafe_terrace_*` 표시)와 낮은 충돌(테이블·의자·화단).
- **좌석 표시**: 포치 벤치(2·9·10번), 카페 테라스 의자 12개에 빈 물체 `seat__<id>__<값들>`을 GLB에 넣었어요(이름에 seatTop·길이·자리 수·자세·등받이·접근 방향이 들어 있어요). 실제 앉기 연결은 뒤 단계예요.
- **삼각형 예산**(마을 ≤ 260k, 마을 장면 ≤ 300k): 새 건물이 늘린 만큼 눈에 안 띄는 곳을 줄였어요. 바깥 땅의 평지 격자를 5 m로(개울가·가장자리는 2.5 m 그대로), 먼 산 격자를 40/28/14 m로, 텃밭 울타리 말뚝을 28 cm 간격에 4면으로. 결과(4차 검토 반영 뒤) 마을 252,259 / 장면 299,263 (2차 247,464 / 294,468, 3차 250,699 / 297,703).
- 나무: B안 건물에 가지가 파고드는 나무 9그루를 가장 가까운 빈 자리로 옮기고, 가로수는 문 앞 3.6 m 안에 심지 않아요(`parts_fill.door_clear`).

## 빌드 순서 (art/는 git이 무시해요)

`D:/Codex/cayson-games/caysonverse-houses/art/village/tools` (원본 `caysonverse-village/art/village/tools`를 복사해 고친 것).

```
python tools/make_textures.py atlas      # 간판 그림(sign_cafe, sign_kiosk)이 든 T_atlas (art/village 안에서)
npx tsx scripts/export-village-layout.ts art/village/layout.json
CV_CPU=1 blender -b --factory-startup -P tools/build_village.py
CV_CPU=1 blender -b work/village_authoring.blend -P tools/bake_village.py -- --samples 384
CV_CPU=1 blender -b work/village_lmprep.blend  -P tools/bake_village.py -- --night --samples 384
python tools/post_village.py --lm-quality 82 ; python tools/post_village.py --night --lm-quality 76   # 달 패치(patch-village-moon.mjs) 포함
node scripts/village-lm-uvmap.mjs <glb> <dir>/lmmap.bin ; python tools/post_lightmap_busbay.py <dir> <lm.webp> <out.webp>   # 낮·밤 둘 다, 다시 WebP 낮 82 / 밤 76
npx tsx --tsconfig server/tsconfig.json scripts/extract-colliders.ts client/public/models/village/village.glb VILLAGE_COLLIDERS shared/src/village/generated/villageColliders.ts
npx tsx --tsconfig server/tsconfig.json scripts/extract-seat-markers.ts client/public/models/village/village.glb shared/src/village/generated/villageSeatMarkers.ts
npx tsx --tsconfig server/tsconfig.json scripts/check-school-glb.ts client/public/models/village/village.glb village
```

새 스크립트: `parts_houses.py`(도구: 벽 조각·창·문), `parts_house_body.py`(벽·지붕·홈통), `parts_house_extras.py`(포치·굴뚝·화단·집 조립), `parts_cafe.py`, `parts_kiosk.py`, `parts_memorial_ext.py`, 점검 `check_visual_collider.py`, 미리보기 `prev_houses.py`·`prev_scene.py`. 고친 것: `parts_buildings.py`, `parts_fill.py`, `parts_trees.py`, `build_village.py`(땅 격자), `parts_nature.py`(먼 산 격자), `bake_village.py`(`CV_CPU`, 라이트맵 섬 간격 0.0014, 접두사가 가장 긴 밀도, 좌석 표시 내보내기).

## 라이트맵 주의

창틀·난간처럼 얇은 부품이 수천 개의 아주 작은 UV 섬이 되면 섬마다 테두리(0.003)가 아틀라스를 다 채워서 모든 면의 해상도가 30배로 떨어져요. 섬 간격을 0.0014로 줄이고, 얇은 부품 덩어리(`house_detail` 등)에는 밀도 2.5를 줘서 해결했어요.

## 아직 안 한 것 (뒤 단계)

- 집 실내 GLB와 번호키 열기(`HOUSE_INTERIORS_OPEN=false` 그대로). 창 안쪽은 방 한 칸짜리 껍데기와 커튼이에요.
- 좌석 표시를 읽어 앉기로 잇기. 카페 테라스 의자는 충돌 상자가 있고, 앞이 탁자라서 옆(등받이 앞쪽 반평면)에서 앉아요: 표시에 `approach side`, `frontEdge 0.21`, 일어설 자리 `standX/standZ`가 있어요.
- 추모관 안(`build_memorial.py`)은 다른 작업이라 건드리지 않았어요.


## 2차 검토 반영 (2026-11-13)

- **포치는 걸어갈 수 있는 판석 바닥**: `SCENERY_TERRACE.house = 2.25`, 집의 `col__house_*`는 몸체만(발자국 − 2.25 m). 포치의 난간·기둥·양옆 화단·벤치는 작은 `col__house_N_porch_k` 상자로 따로 있어요. 번호키 패드는 실제 문 앞 0.65 m(포치 위).
- **카페** `SCENERY_TERRACE.cafe = 5.55`(돌 받침 0.45 m가 충돌 안), 테라스 의자 12개에 `col__cafe_terrace_chair_k`, 탁자·파라솔을 바깥쪽으로 옮기고 차양을 1.1 m로 줄였어요. **키오스크** `SCENERY_TERRACE.kiosk = 0.7`, 화단 2개는 따로 상자.
- 앉기 표시 이름에 방향(`_face<n|s|e|w>`)을 넣고, 등받이 있는 의자는 `approach front`.
- 박공 포치 지붕 경사 15도, 창대와 0.6 m 이상 띄움(assert). 10번 집 벤치는 문 옆, 가운데 기둥은 문짝과 안 겹침.
- 벽 조각이 T자 이음 없이 이어지도록 꼭짓점을 맞춰(`wall_pieces`) 한 벽이 한 UV 섬이 되고, 라이트맵 조각보가 사라졌어요.
- 밤 유리: `M_glass`가 창 불(`litUniform`)에 따라 어두워져요(`nightGlass`). 유리 알파도 낮춤.
- 집마다: 벽등 2개, 번지판(7세그먼트), 우편함, 에어컨 실외기, 1번 장미 격자, 3번 2층 파티오창+쥘리엣 난간, 5번 유리 온실, 6번 장독, 9번 1층 뒤 큰 파티오창, 10번 화로대. 8번 노란 줄 제거. 화분 상자에 꽃을 더 심고 밝은 나무색으로.
- 다른 작업 공간(caysonverse-village/art/village/tools)에 덮어썼던 내 스크립트를 백업 원본으로 되돌렸어요(추모관 쪽 파일은 그대로).


## 3차 검토 반영 (2026-11-15)

- **카페 1층 큰 창**: 유리(맑은 `M_glass`)를 세 칸 창살과 위 채광창으로 나누고, 아래쪽에 놋쇠 봉에 건 주름 카페 커튼(높이 1.2 m)을 달았어요. 창 1.3 m 뒤에 1층 실내 그림판(`T_glow`의 `cafe_room`: 판벽·카운터·에스프레소 머신·케이크 진열장·컵 선반·칠판 메뉴·펜던트 등 3개·화분)을 `M_window`로 세워서 낮에는 실내가, 밤에는 불 켜진 가게가 보여요. 옆면 1층 불 켜진 창도 같은 그림을 창 전체에 이어 붙였어요(`window(span=True)`).
- **카페 문 앞**: 잔디 띠 대신 문턱과 데크 사이에 평평한 돌 디딤판을 깔고, `SCENERY_TERRACE.cafe = 6`(본채 상자가 정면 벽에서 끝남) + 문 양옆 돌 단 상자 `col__cafe_step_1/2`. 보이는 대로 문턱까지 걸어갈 수 있어요.
- **카페 테라스 의자**: 4인 탁자를 x ±5.0으로 옮기고 의자를 탁자에서 조금 더 뺐어요(정면 0.88 m). 의자마다 옆(이웃 의자 반대쪽)에 몸(반지름 0.4)이 설 자리 `standX/standZ`를 표시에 넣고(`approach side`, `frontEdge 0.21`), 12곳 모두 충돌 밖인 것을 점검했어요. 탁자 앞은 원래 막혀 있으니 정면으로 다가가는 대신, 게임의 `approachesSeat`처럼 등받이 앞쪽 반평면(옆 포함)에서 앉는 방식이에요.
- **키오스크**: 판매창 뒤에 작은 실내(바닥·천장·옆벽)와 뒷벽 그림판(`kiosk_room`: 꽃 양동이 선반 두 줄, 포장지 롤, 칠판)을 넣고, 안에 펜던트 등, 간판 위에 거위목 등을 달았어요(밤 굽기에 불 2개 + 등 1개).
- **박공 창(모든 집)**: 창 뒤에 방 색의 작은 다락 벽감(깊이 0.9 m)을 만들고 커튼 폭을 넓혀(`curtain_frac 0.42`) 지붕 속 갈색이 안 보여요.
- **5번 집 온실**: 폭 2.6 m, 흰 나무 밑단, 흰 창살 7줄, 벽에서 처마로 내려오는 유리 지붕, 안에 선반과 화분 5개.
- **2번 집**: 포치(벤치 반대쪽)에 빨간 세발자전거와 노란 공(낮은 충돌 상자). 그네는 집 둘레 여유(0.57 m)가 없어 넣지 않았어요.
- shared 시험: 0.1 m 격자 시험 묶음에 제한 30초(병렬에서 5초를 넘음). 번호키 e2e는 포치 위 패드(21, −39.3)까지 걸어가요.
- 용량: 낮 라이트맵은 WebP 82(407,766 B), **밤 라이트맵은 WebP 76(341,126 B)**로 줄였어요. 밤 첫 접속(village.glb 5,466,024 + 낮 407,766 + 밤 341,126 = 6,214,916 B)이 main(5,645,048 + 340,796 + 240,230 = 6,226,074 B)보다 11 KB 적고, 낮 첫 접속은 main보다 약 112 KB 적어요. 밤 라이트맵에 82를 쓰면 main보다 약 60 KB 늘어요. (`village-perf --mode load`의 총합은 휴대폰 15.7 MB로 15 MB 한도를 넘는데, 이건 main도 같은 방식으로 넘는 기존 값이에요.)
- 굽기 스크립트(`bake_village.py`)가 좌석 표시의 사용자 속성(`approach`, `frontEdge`, `standX/standZ`…)을 GLB 노드 `extras`로 넣어요(`export_extras`는 꺼 둔 채 좌석 노드에만). 점검: `seats.mts` 15곳 통과.
- 창 화단(2·9·10번 앞 1층 창)이 포치 데크 위로 0.3 m 튀어나와 충돌 상자 밖이었어요. 데크 위 창은 화단 깊이를 0.12 m로 줄였어요(`window(flowerbox=0.12)`, 다른 장식 띠와 같은 0.13 m 이내).
- 횡단보도는 이 브랜치의 `make_textures.py`가 이미 한 줄 얼룩말로 그려서(`XW_SKIP`) 굽기의 `T_plaza`가 곧 새 그림이에요(main의 패치된 그림과 361 픽셀만 달라요). 버스 칸 라이트맵 후처리(`village-lm-uvmap.mjs` → `post_lightmap_busbay.py`)는 낮·밤 모두 했어요.
- 카페 1층 방 껍데기의 앞벽을 뺐어요(LM_ 재질은 양면이라 가게 유리 뒤를 가렸어요). 이제 낮에 선반·칠판 메뉴·펜던트·화분이 보여요. 카페·키오스크 실내 그림은 낮은 값으로 어둡게(감마 1.7) 그렸어요. 밤에는 창 불 셰이더가 밝기 2.1배라 키오스크 안쪽 꽃이 여전히 허옇게 떠요(4차에서 `M_shop`으로 고침).


## 4차 검토 반영 (2026-11-15)

- **밤 가게 창**: 카페 1층 실내 그림판·옆 1층 창과 키오스크 꽃 선반 그림을 새 재질 `M_shop`(작업 재질 `A_shop_glass`, `window(lit_mat=...)`)으로 뺐어요. 게임은 창 불처럼 밝기로 색을 덮지 않고 그림 × 따뜻한 빛(`LIT.shop`, 색 1.0/0.88/0.70 × 2.3)으로 켜서, 밤에도 선반·칠판 메뉴·펜던트·꽃 양동이가 보여요(크림색 판이 사라짐). 마을 GLB 재질 한도는 25 → 26(`MATERIAL_LIMITS.village`, 이유는 주석).
- **앉기**: GLB의 좌석 표시를 `scripts/extract-seat-markers.ts`가 `shared/src/village/generated/villageSeatMarkers.ts`로 뽑고, `benchSeats.ts`가 카페 의자 12개와 포치 벤치 3개(2·9·10번)를 `VILLAGE_SEATS` 끝(60~74번)에 붙여요. 벤치·집 좌석 번호는 그대로예요.
  - 포치 벤치: 앞에서만, 일어서면 앞으로(표시에 `frontEdge 0.22` 추가).
  - 카페 의자: 앞이 탁자라 옆에서 앉아요. 등받이 뒷면(의자 중심 뒤 0.26 m)보다 앞이면 E 안내가 뜨고, 의자 폭에서 몸 하나만큼 옆(0.56 m 이상)이면 탭 이동이 멈추는 여유(0.35 m)만큼 뒤까지 허용해요(`Seat.approachEdge`, `Seat.beside`). 바로 뒤에서는 안 떠요. 일어설 자리는 표시의 `standX/standZ`에서 가장 가까운, 몸 둘레 0.55 m가 빈 곳(5 cm 격자, 0.5 m 안). 모서리 의자(1·3·6·8번, 탁자 끝과 화단 사이 1.08 m)는 그런 곳이 없어 표시 자리 그대로예요.
  - 게임에서 확인: 카페 1·2·10번 의자, 10번 집 포치 벤치에 E로 앉고 일어섰어요.
  - `clickPlanSweep` 시험: 카페 의자는 테라스 안, 몸이 들어가는 곳만 탭 대상으로 봐요(의자·탁자 사이 0.2~0.8 m 틈은 몸 0.8 m가 못 들어가요).
- **간판**: 카페 박공 간판 "케이슨 카페 / COFFEE · DESSERT"(짙은 초록 바탕, 크림 글씨, 금색 테), 키오스크 간판 "케이슨 꽃집"(크림 바탕, 초록 글씨, 꽃 두 송이). `T_atlas`의 빈 오른쪽 아래(`sign_cafe` 1024×352, `sign_kiosk` 1024×208, 맑은 고딕 굵게). 키오스크 간판은 차양 뒤에 가려져 있어서 차양 위(3.0~3.5 m)로 올렸어요. 이름은 임시라 사장님이 정하면 바꿔요.
- **테라스 가구**: 의자는 실제 카페 테라스의 곡목(Thonet풍) 의자 — 모서리를 깎은 참나무 좌판, 살짝 벌어진 다리 4개, 옆·앞 가로대, 뒤로 기운 등받이 기둥, 휜 윗 등판, 살 3개. 긴 탁자는 모서리를 깎은 참나무 상판 + 검은 철제 다리 2개(기둥·발·윗 가로대), 2인 탁자는 둥근 상판 + 받침 기둥 + 십자 발. 좌석 높이 0.46 m.
- 용량: village.glb 5,500,628 B, 낮 라이트맵 409,822 B(WebP 82), 밤 331,330 B(WebP 76). 낮 첫 접속 5,910,450 B(main보다 약 75 KB 적음), 밤 첫 접속 6,241,780 B(main 6,226,074 B보다 약 16 KB 많음: 의자·간판 형상과 간판 그림만큼).
- 키오스크 앞 쉘터(쉘터 동쪽 끝 x 41.65, 키오스크 판매창 x 46.1): main의 정류장 배치 그대로라 이번에도 옮기지 않았어요. 판매창까지는 쉘터를 돌아 걸어가요.

