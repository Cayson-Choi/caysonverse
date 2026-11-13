# 집·카페·키오스크 외관 다시 짓기 — 1단계(M1)

`feat/houses-m1` (main `59fd947` 기준). 설계: `scratchpad/houses/design/design.md`(승인), 카페는 `handoff-codex/buildscale/cafe/cafe_options.md`의 **안 2**(20 × 15 m, 2층, 테라스 12석).

## 무엇이 바뀌었나

- **village.glb를 B안으로 다시 빌드**했어요. 집 10채(6·8번은 B안 자리), 카페(안 2), 꽃 키오스크, 추모관 바깥(20 × 16)이 새 모델이에요.
  - 벽은 창·문 자리를 실제로 비워 만들고(벽 두께 0.30 m, 안쪽 옆면 보임), 창틀(짙은 회색/흰 PVC)·미서기 두 짝·유리·커튼·돌 창대·테두리·인방을 달았어요.
  - 현관문은 1.8 × 2.9 m 유리 양문(참나무 틀, 긴 바 손잡이, 키패드 불이 들어오는 도어락).
  - 지붕은 두께 0.2 m, 처마 밑판, 처마 판, 박공판, 둥근 홈통, 선홈통, 용마루 갓, 굴뚝(갓·토관). 포치 지붕 꼭대기는 2층 창대 판보다 0.2 m 이상 낮아 "지붕에 잘린 창"이 없어요(빌드 스크립트에서 assert).
  - 집마다 색은 그대로, 창틀 색·포치(박공/캐노피/넓은 데크)·굴뚝(벽돌/철)·커튼·방 색이 달라요.
  - 충돌 = 보이는 것: 몸체 둘레 0.57 m 띠와 포치 양옆은 돌 테두리 화단(꽃·관목)으로 채워서 `col__house_*` 상자가 곧 보이는 모습이에요.
- **카페(안 2)**: `SCENERY_SIZES.cafe` 20 × 15, 중심 (50.6, −15.1), `SCENERY_TERRACE.cafe = 6`. 충돌 상자는 테라스를 뺀 본채 `solidBox` (x 46.6 ~ 60.6)라서 테라스(3 cm 데크)는 걸을 수 있어요. 테라스에 파라솔 테이블 4개, 의자 12개(`seat__cafe_terrace_*` 표시)와 낮은 충돌(테이블·화단).
- **좌석 표시**: 포치 벤치(2·9·10번), 카페 테라스 의자 12개에 빈 물체 `seat__<id>__<값들>`을 GLB에 넣었어요(이름에 seatTop·길이·자리 수·자세·등받이·접근 방향이 들어 있어요). 실제 앉기 연결은 뒤 단계예요.
- **삼각형 예산**(마을 ≤ 260k, 마을 장면 ≤ 300k): 새 건물이 늘린 만큼 눈에 안 띄는 곳을 줄였어요. 바깥 땅의 평지 격자를 5 m로(개울가·가장자리는 2.5 m 그대로), 먼 산 격자를 40/28/14 m로, 텃밭 울타리 말뚝을 28 cm 간격에 4면으로. 결과 마을 247,464 / 장면 294,468.
- 나무: B안 건물에 가지가 파고드는 나무 9그루를 가장 가까운 빈 자리로 옮기고, 가로수는 문 앞 3.6 m 안에 심지 않아요(`parts_fill.door_clear`).

## 빌드 순서 (art/는 git이 무시해요)

`D:/Codex/cayson-games/caysonverse-houses/art/village/tools` (원본 `caysonverse-village/art/village/tools`를 복사해 고친 것).

```
npx tsx scripts/export-village-layout.ts art/village/layout.json
CV_CPU=1 blender -b --factory-startup -P tools/build_village.py
CV_CPU=1 blender -b work/village_authoring.blend -P tools/bake_village.py -- --samples 384
CV_CPU=1 blender -b work/village_lmprep.blend  -P tools/bake_village.py -- --night --samples 384
python tools/post_village.py --lm-quality 82 ; python tools/post_village.py --night --lm-quality 82   # 달 패치(patch-village-moon.mjs) 포함
node scripts/village-lm-uvmap.mjs <glb> <dir>/lmmap.bin ; python tools/post_lightmap_busbay.py <dir> <lm.webp> <out.webp>   # 낮·밤 둘 다, 다시 WebP 82
npx tsx --tsconfig server/tsconfig.json scripts/extract-colliders.ts client/public/models/village/village.glb VILLAGE_COLLIDERS shared/src/village/generated/villageColliders.ts
npx tsx --tsconfig server/tsconfig.json scripts/check-school-glb.ts client/public/models/village/village.glb village
```

새 스크립트: `parts_houses.py`(도구: 벽 조각·창·문), `parts_house_body.py`(벽·지붕·홈통), `parts_house_extras.py`(포치·굴뚝·화단·집 조립), `parts_cafe.py`, `parts_kiosk.py`, `parts_memorial_ext.py`, 점검 `check_visual_collider.py`, 미리보기 `prev_houses.py`·`prev_scene.py`. 고친 것: `parts_buildings.py`, `parts_fill.py`, `parts_trees.py`, `build_village.py`(땅 격자), `parts_nature.py`(먼 산 격자), `bake_village.py`(`CV_CPU`, 라이트맵 섬 간격 0.0014, 접두사가 가장 긴 밀도, 좌석 표시 내보내기).

## 라이트맵 주의

창틀·난간처럼 얇은 부품이 수천 개의 아주 작은 UV 섬이 되면 섬마다 테두리(0.003)가 아틀라스를 다 채워서 모든 면의 해상도가 30배로 떨어져요. 섬 간격을 0.0014로 줄이고, 얇은 부품 덩어리(`house_detail` 등)에는 밀도 2.5를 줘서 해결했어요.

## 아직 안 한 것 (뒤 단계)

- 집 실내 GLB와 번호키 열기(`HOUSE_INTERIORS_OPEN=false` 그대로). 창 안쪽은 방 한 칸짜리 껍데기와 커튼이에요.
- 좌석 표시를 읽어 앉기로 잇기. 카페 테라스 의자에는 충돌을 주지 않았어요(옆에서 다가가야 해서).
- 추모관 안(`build_memorial.py`)은 다른 작업이라 건드리지 않았어요.
