# 집 외관 A8 — X0 약속 (contract)

2026-11-16 · `feat/exterior` · 사장님 승인 "추천대로"(A안 · 현관 0.3 m 올림 + 2단 · PC 310k) + "전체 건물 땅 사물들이 모두 실제와 비슷한 느낌의 질감이 느껴져야해".
설계는 `design.md`, **숫자는 코드가 정답**이에요(이 문서는 길잡이). 코드:

| 파일 | 내용 |
|---|---|
| `shared/src/village/houseExterior.ts` | 집 로컬 좌표·크기(`HOUSE_A8`), 포치 3종(`PORCH_SPECS`), 충돌 상자, 높이 구역(`houseLiftZones`, `houseStepLift`), 포치 벤치 좌석, 주인 자리(`houseSlots`), 노드 이름, 예산(`HOUSE_GLB_BUDGET`, `HOUSE_DETAIL_LOD`, `VILLAGE_SCENE_TRIANGLE_CAP`), 질감 규칙(`HOUSE_SURFACE_RULES`) |
| `shared/src/village/villageLayout.ts` | 10채 자리·방향·발자국(`sceneryHouses`), `solidBox`(집 = 몸체 + 기초 단), 레이아웃 충돌 목록에 포치·LPG·텃밭 상자, `layout.json`의 `houseExteriors` |
| `shared/src/village/a8Staging.ts` | village.glb를 다시 빌드하기 전까지: 옛(A7) 집 상자를 A8 상자로 바꿔 끼움(서버·클라 같은 지도), 나무 7그루 옮김(`A8_TREE_MOVES`), 포치 벤치 좌석 교체 |
| `shared/src/village/exteriorWindows.ts` + `generated/exterior_windows.json` | 창 표 형식·읽기·검사, 설계값 표, 실내 ↔ 바깥 좌표 |
| `shared/src/village/houseOwnership.ts` | 문패·팻말 상태(`HOUSE_EXTERIOR_DEFAULT`) |
| `scripts/export-exterior-windows.ts` | 창 표를 설계값으로 다시 쓰기 |
| `scripts/lib/schoolGlb.ts`, `e2e/village-perf.mjs` | 장면 삼각형 한도 PC 310k / 폰 300k |

## 1. 집 로컬 좌표 (parts_houses.py `Frame`과 같음)
원점 = 발자국 가운데, 로컬 x = 문으로 들어가는 사람의 오른쪽, 로컬 z = 문 밖 쪽. 세계 = `houseLocalToWorld`(vlib `loc`).

| | 로컬 값 |
|---|---|
| 발자국 | x ±5.6, z −5.375 ~ +5.375 (정면 11.2 × 깊이 10.75) |
| 몸체(벽 바깥 면) | x ±5.6, z −5.275(뒤) ~ +3.125(앞, 문) — 11.2 × 8.4, 벽 0.30 |
| 충돌 몸체 `col__house_N` | 몸체 + 기초 단 0.08: x ±5.68, z −5.355 ~ 3.205 (11.36 × 8.56), 카메라 상자 높이 12 |
| 보이는 높이 | 1층 바닥·포치·데크 윗면 **+0.30**, 계단 2단: 디딤 0.20 / 0.10, 챌판 0.10, 디딤 깊이 0.34 → 발자국 앞으로 0.68 나옴 |
| 문 | x ±0.9, 높이 2.9, 앞벽(z 3.125). 번호키 패드 = 문 앞 0.65 (z 3.775) |

설계 문서의 "챌판 0.15"는 "0.30 올림 + 2단"과 맞지 않아(0.45가 됨) **챌판 0.10 · 디딤 2개**로 정했어요(발자국 앞 0.68 m = 설계 거리 계산의 0.7 m).

## 2. 배치 (A안, `VILLAGE_LAYOUT.sceneryHouses`)
앞선(발자국 앞 가장자리)은 지금 자리 그대로, 몸체가 뒤로 2.35 m 깊어짐. 문 동쪽 집은 발자국을 돌려 넓은 11.2 m 쪽이 길을 봐요.

| 집 | 가운데(세계) | 크기 x × z | 문 | 바뀐 것 |
|---|---|---|---|---|
| 1 | (21, −43.175) | 11.2 × 10.75 | s | 깊어짐 |
| 2 | (−21, −43.175) | 11.2 × 10.75 | s | 깊어짐 |
| 3 | (29, 38.775) | 11.2 × 10.75 | n | 깊어짐 |
| 4 | (−32.4, 40.575) | 11.2 × 10.75 | n | 서쪽 0.8 |
| 5 | (−46.775, −8) | 10.75 × 11.2 | e | 돌림 |
| 6 | (42, 43.675) | 11.2 × 10.75 | n | 깊어짐 |
| 7 | (31, −58.375) | 11.2 × 10.75 | s | 북쪽 1.2 |
| 8 | (−49.775, 40.6) | 10.75 × 11.2 | e | 돌림, 남쪽 0.6 |
| 9 | (−31, −58.375) | 11.2 × 10.75 | s | 북쪽 1.2 |
| 10 | (−40.375, 26.4) | 10.75 × 11.2 | e | 돌림, 북쪽 0.6 |

나무 옮김(X4가 `parts_fill.py`에서 같은 자리로): `tree_15` → (34, 49), `tree_16` → (21.5, 46.5), `tree_17` → (−39.8, 48.5), `tree_19` → (−50.05, 0.4), `tree_26` → (23, −66), `tree_27` → (−38.5, −66), `bush_15` → (−45.4, 18.6).

## 3. 포치 (로컬, `PORCH_SPECS`) — 충돌 id 순서 고정
| 종류(집) | 판(+0.30) | 계단 | 기둥(0.24 상자) | 그 밖 |
|---|---|---|---|---|
| 박공 gable (1·5·6·7) | x ±2.6 | x ±1.6 | x ±2.3, z 5.155(앞 단에 붙임) | 계단 옆 단 x 1.6~2.6 (깊이 0.10) |
| 캐노피 canopy (3·4·8) | x ±1.6 | x ±1.6 | 없음(철 브래킷) | — |
| 데크 deck (2·9·10) | x ±3.4 | x ±1.2 | x ±3.28, ±1.575, z 5.155(앞 난간·화단에 붙임) | 앞 난간 x 1.2~3.4 (깊이 0.10), 벤치 x −3.4~−2.2, z 3.205~3.705(기초 단에 붙임) |

`col__house_N_porch_1/2` = 왼/오른 화단(판 가장자리 ~ 발자국 옆선, z 3.205~5.375), `_3/_4` 계단 옆 단(있을 때), 그다음 기둥 왼→오, 마지막 데크 벤치. `col__house_N_lpg` = LPG 망(x 3.5~4.9, z −6.005~−5.355, 10번은 x −4.9~−3.5, 뒷벽). `col__garden_house_N` = 텃밭(x ±3, z −8.375~−5.775; 10번은 x −3.6~2.4), **9번은 텃밭 대신 평평한 뒤 데크**. 평평한 데크(높이 0, 걷는 곳): 3번 옆(x 5.6~7.6, z −2.005~3.125), 9번 뒤(x ±3, z −7.375~−5.355).

- 포치 벤치 좌석(`housePorchSeatMarker`): 2·9·10번, 길이 1.2, **seatTop 0.75**, 길을 보고 앉음, id `house_N_porch`(좌석 번호 그대로).
- 높이 구역(`houseLiftZones`): 포치 판 0.30, 디딤 0.20·0.10. 화단·벤치·기둥은 막힌 곳이라 구역 아님.

## 4. 주인 자리 (`houseSlots`, 빈 물체 · 부모 없음 · 세계 좌표 · 방향 = 문 쪽 yaw)
| 노드 | 로컬 (x, z), 높이 y(잔디 위) | 판 |
|---|---|---|
| `slot__house_N_nameplate` | (1.45, 3.145), 1.90 | 0.42 × 0.16 — "N번 집" |
| `slot__house_N_mailbox` | (−1.55, 3.325), 1.45 | 0.20 × 0.06 — 비움 |
| `slot__house_N_sign` | (4.2, 4.775), 0.925 | 0.90 × 0.55 — 숨김 |

상태: `houseOwnership.ts` `HOUSE_EXTERIOR_DEFAULT`(label "N번 집", sign "hidden").

## 5. GLB·예산
- `village_houses.glb`: `houseshell__house_N`(≤ 1,800, 늘 그림, 10채 합쳐 그리기 ≤ 8) + `housedetail__house_N`(≤ 6,000, 그리기 ≤ 6) + `slot__…` 30개. 합 ≤ 78k, ≤ 1.2 MB(지오메트리), 재질 ≤ 10.
- village.glb에는 `houseproxy__house_N` 대역 상자(12 삼각형) 10개.
- 디테일 거리: PC 35 m(한 점에서 최대 4채), 폰 25 m 안 가까운 2채, 숨길 때 +4 m.
- 장면 한도: **PC 310k / 폰 300k** (`VILLAGE_SCENE_TRIANGLE_CAP`, `worstSceneTriangles`). check-school-glb는 집 파일이 없을 땐 폰 한도 300k로 봐요.

## 6. 질감 (사장님 2026-11-16, `HOUSE_SURFACE_RULES`)
벽·기초·지붕·테두리(처마판·창대·인방·홈통·선홈통)·문·창틀·포치·데크·계단은 **모두 실사 PBR**(albedo + normal + roughness, CC0 스캔 가능 — 출처는 `refs/exterior/SOURCES.txt`). **단색 면은 검토에서 FAIL**(유리·등·꽃 카드·방충망만 예외). 텍셀 밀도: 손 닿는 곳·1~3 m에서 보이는 곳(높이 3.5 m 아래) ≥ **512 px/m**, 길에서만 보이는 곳(윗벽·지붕·굴뚝·홈통) ≥ 256 px/m. 반복 세트 7종(`render, granite, shingle, oak, pvc_frame, metal_painted, timber_cladding`), 한 장 ≤ 1024, 세트 전체 ≤ 3 MB, 집 색은 셰이더 틴트. 라이트맵은 따로.
**예산 영향(검토 필요):** 첫 접속 +≈ 3 MB(PC)라 설계 5.1의 +1.6 MB보다 커요 — 세트를 마을이 보인 뒤에 받기로 D3(마을 보이는 시간 변화 없음)는 지켜요.

## 7. 창 표 (`exterior_windows.json`)
```json
{ "format": "caysonverse-exterior-windows", "version": 1, "source": "design" | "build",
  "houses": { "house_1": [ { "wall": "front|back|left|right", "floor": 1|2, "kind": "window|patio|door",
                              "at": 2.0, "width": 1.4, "height": 2.0, "sill": 0.9 } ] } }
```
실내 로컬 좌표(x 0~10.6 = 들어오는 사람의 왼→오, z 0~7.8 = 앞벽 안쪽 면 → 뒷벽, y = 1층 바닥 위; 2층은 4.0 포함). `at` = 앞·뒤 벽은 x, 옆벽은 z. 바깥 ↔ 실내: x = lx + 5.3, z = 2.825 − lz (1:1). 빌드(X4)가 실제 개구부로 `source: "build"`로 덮어쓰고, 모든 값은 설계 표와 ±2 cm(`WINDOW_TOLERANCE`). 실내 쪽 변경 요청: `interior-contract-change.md`.

## 8. 지금 상태와 넘겨주기
- village.glb·좌석 생성 파일은 **아직 옛 집**이에요. `a8Staging.ts`가 게임 지도에서 옛 집 상자를 A8 상자로 바꿔 끼워서 서버·클릭 이동·좌석은 이미 A8로 움직여요(화면만 옛 집). X4가 마을을 다시 빌드해 모델에 A8 상자가 다 있으면 바꿔 끼우기는 자동으로 꺼지고(`modelHasA8Houses`), 그때 `a8Staging.ts`를 지워요.
- 8번 정면 탭 이동이 4번 포치에서 멈춘 것: 걷기 격자(충돌) 문제가 아니에요 — A8 지도에서 광장 스폰 → 10채 패드 길 찾기가 모두 도착해요(`houseExterior.test.ts`). 화면에서 4번 집 모델을 눌러 그 자리로 간 것(클릭 광선)이라 X3가 새 모델로 B4를 다시 확인해요.

| 덩어리 | 이 약속에서 쓸 것 |
|---|---|
| X1 몸체 | 1장 몸체·기초 단, 7장 창 표(설계값) → 개구부, 6장 질감, 5장 노드·예산 |
| X2 포치·설비 | 3장 포치·충돌 상자(정확히 같은 사각형, 0.01 m), LPG·텃밭·평평한 데크, 4장 주인 자리, 6장 질감 |
| X3 게임 | `houseStepLift`·`houseLiftZones`, 포치 좌석 0.75, `houseSlots` + `houseOwnership.ts`, 5장 LOD·한도, A8 지도에서 B4 |
| X4 빌드 | `layout.json`의 `houseExteriors`, 나무 옮김, `exterior_windows.json` 쓰기, 좌석·충돌 다시 뽑기, 그 뒤 `a8Staging.ts` 지우기 |

## 9. 빌더 공통 규칙 (X1~X4 브리프에 그대로 넣기)
- **Aside(사장님 2026-11-16 "쓸데없이 어사이드창을 여러개 띄우고 그러지 마", "사용이 끝난 어사이드는 닫아")**: 세션은 하나만 만들고 다시 쓰기, 쓸 일이 끝나면 `aside session stop <id>`로 멈추고 창을 닫기. 새 창·새 세션을 여러 개 띄우지 않기.
- 브라우저는 한 번에 하나, Blender도 한 번에 하나(PC가 바빠요). 굽기는 `CV_CPU=1`.
- 8장 시험 표 전체(`design.md`)와 6장 질감 규칙을 처음부터 지키기. 단색 면은 FAIL.

## 10. X1 몸체 키트 결과 (2026-11-17, `feat/exterior-x1`)
| 파일 | 내용 |
|---|---|
| `docs/designs/house-exteriors/tools/house_kit.py` | 몸체 키트(bpy 없음, X2·X4가 import): 기초 단, 벽(창 표 그대로 뚫음), 창(PVC 틀·미서기 2짝·크레센트·방충망·화강석 창대 + 물끊기·인방 몰딩), 현관문(오크 유리 양문·바 손잡이·도어락), 띠 몰딩, 방·커튼·밤 창(M_window), 지붕(아스팔트 슁글 줄마다 2.8 cm 턱 / 4·8·10번 징크 돌출이음), 삼나무 처마 밑판, 처마판·박공판·물끊기, 각진 홈통 + 걸이쇠, 선홈통 4개(꺾임·밴드 5·신발·화강석 낙수 받침), 굴뚝(스타코 / 스테인리스 연통), 환기 후드 |
| `docs/designs/house-exteriors/tools/build_house_body.py` | Blender 5.3 빌드: `village_houses.glb`(Draco), 창 표(`--table-out`, `source: "build"`), 예산 보고, 렌더 |
| `docs/designs/house-exteriors/tools/make_house_textures.py`, `SOURCES.md` | PBR 세트 7종 → 재질 5개(WebP 1024, albedo·normal·rough), CC0 출처 |
| `client/public/models/village/village_houses.glb` | 껍데기 + 몸체 디테일 + `slot__` 30개 (X2 포치는 아직 없음) |
| `client/public/models/village/houses/` | `house_{render,granite,shingle,wood,metal}_{albedo,normal,rough}.webp` + `house_textures.json` |
| `client/dev/houses-lookdev.html`, `e2e/houses-lookdev.mjs` | 게임 미리보기(DEV): 재질 이름으로 세트를 붙이는 법, 낮·밤, PC·폰 |
| `server/src/tools/houseBodyGlb.test.ts` | A1·A4·A6·6장 검사 |

**넘겨주기**
- **재질 ↔ 세트(X3):** GLB에는 그림이 없어요. `house_textures.json`의 `materials[이름].maps`를 재질 이름으로 붙여요(`flipY = false`, Repeat, albedo만 sRGB, `normalScale (1, −1)` — 접선 없는 glTF). 색(집 파스텔·물때)은 `COLOR_0`(정점색, 선형)이라 `vertexColors` 그대로. `LM_wood`(위 = 오크, 아래 = 삼나무)·`LM_metal`(위 = 도장 금속, 아래 = PVC)은 띠 두 개짜리 지도(UV가 띠를 넘지 않음). **LM_ 재질을 unlit(MeshBasic)로 바꾸면 normal·roughness가 사라져요** — 집은 버스처럼 lit(MeshStandard) + 라이트맵(X4)으로. `M_window`는 `KHR_materials_emissive_strength` 0(낮), 밤에 켜기. `M_glass`·`M_screen` BLEND.
- **그리기:** 껍데기 재질 ≤ 7, 몸체 디테일 재질 5개(LM_metal·LM_stone·LM_wood·M_lamp·M_screen) → **X2는 디테일에 M_leaf_flora 하나만 더할 수 있어요**(6장). 렌더(LM_render)·지붕이 필요한 X2 부품은 껍데기 쪽에.
- **삼각형:** 껍데기 1,582 ~ 1,756(≤ 1,800), 몸체 디테일 2,968 ~ 3,116 → **X2 몫은 집마다 ≈ 2,900**(디테일 ≤ 6,000). 10채 합 ≈ 47.2k.
- **포치(X2):** 기초 단 앞면 = z 3.205, 윗면 0.30. 포치 판은 z 3.205부터(겹치지 않게), 윗면 0.30. 현관 문턱(화강석)은 문 개구부 안 y 0.28 ~ 0.315. 앞 모서리 선홈통 낙수 받침은 x ±5.28 (폭 0.5), z 3.255 ~ 3.855 (화단 안).
- **창 표:** `exterior_windows.json`을 빌드 값(`source: "build"`)으로 썼어요 — 설계값과 차이 0.
- **치수 메모:** 벽 꼭대기 8.30(바닥 +0.30 + 4.0 × 2), 처마 끝 아래 7.75, 용마루 갓 위 ≈ 11.97 (< 카메라 상자 12). 굴뚝·연통만 12 위로.

## 11. X2 포치·설비 키트 결과 (2026-11-17, `feat/exterior-x2`)
| 파일 | 내용 |
|---|---|
| `docs/designs/house-exteriors/tools/porch_kit.py` | 포치 키트(bpy 없음): 박공 포치(1·5·6·7: 화강석 타일 판 + 줄눈, 기둥 0.20 + 철 받침·U 철물·볼트, 버팀대, 보, 삼나무 천장 + 매입등, 25° 슁글 박공 지붕·처마판·물끊기·벽 후레싱), 캐노피(3·4: 철 상자 캐노피 + 브래킷, 4번 당김봉 / 8번: 접합유리 캐노피 + 철 팔·스테인리스 지지구·당김봉), 데크(2·9·10: 138 mm 판재·6 mm 틈·엇갈린 이음·판마다 장선마다 나사 2개, 치마판, 앞 난간·동자 0.12, 벤치), 화강석 계단 2단(챌판 0.10·디딤 0.34, 2 cm 코·논슬립 홈 2줄), 화단(화강석 연석 0.45, 흙 0.29, 선홈통 집수 칼라), 벽등, 문패 판, 우편함, LPG 보호망(용기 2 + 조정기·노란 가스관·가스 계량기·전기 계량함·수도꼭지), 텃밭 상자 2개(파 줄 / 콩 지지대·끈), 평평한 데크(3번 옆·9번 뒤) |
| `docs/designs/house-exteriors/tools/check_porch.py` → `x2/porch_check.json` | 숫자 검사 C1~C9: 약속 사각형 = `layout.json`(0.01 m), 모든 고체가 자기 충돌 상자(또는 집 상자) 안, 걷는 판 = 높이 구역, 머리 위 ≥ 2.1 m, 벽 부착물 ≤ 0.15 m, **서로·몸체와 겹침 없음**, **현관문 두 짝 0~95° 회전(손잡이·도어락 포함)이 모든 것과 ≥ 5 cm**(지금 최소 0.314 m), 예산, 텍셀 밀도 |
| `house_kit.py` (수정) | 앞 선홈통 2개는 화단 흙으로 바로 들어감(`FRONT_PIPES_INTO_BEDS`, 묻히던 낙수 받침 없앰) |
| `build_house_body.py` (수정) | 포치 키트 호출(`--no-porch`로 끔), `M_leaf_flora` 재질(MASK 0.5, 양면), 포치 근접 시점 10개 |
| `client/dev/housesLookdev.ts` | 포치 시점, 마을 3D 식물(`createVegetation`)로 화단 카드 키우기, 밤 포치등 |

**넘겨주기**
- **X3 — 화단·텃밭 식물:** 디테일의 `M_leaf_flora` 카드는 **심는 자리 표시**예요(마을 화단과 같은 방식). 게임은 village.glb와 똑같이 `createVegetation`/`placeFlowers`로 3D 꽃(줄 0 페튜니아, 1 팬지·메리골드, 2 무스카리·제비꽃·튤립)과 풀 포기(줄 3: 텃밭의 파·콩)를 키우고 카드는 숨겨요. 텍스처는 village.glb `M_leaf_flora`(T_flora)를 이름으로 붙여요(집 GLB에는 그림 없음). 화단 흙 사각형: 판 가장자리 + 0.10 ~ ±5.5, z 3.205 ~ 5.275, y 0.29.
- **X3 — 등:** 포치 등 렌즈는 `M_window`(껍데기, 낮 0 / 밤 켜짐) — 창 불과 같은 스위치. `M_lamp`는 번호키 패드뿐.
- **X3 — 팻말:** 오른쪽 화단의 팻말 자리(말뚝 + 판 y 0.65~1.2)는 비워 두고 그 아래엔 낮은 꽃(≤ 0.25)만.
- **X4 — 라이트맵:** 포치 등 4곳(박공 천장 (0, 3.5, 4.19) / 캐노피 (±0.65, 3.5, 3.975) / 벽등 (±1.3, 2.4, 3.2))의 밤 빛 웅덩이를 구워 주세요.
- **예산(집마다):** 껍데기 1,630 ~ **1,800**(4번이 딱 한도 — 더 넣을 자리 없음), 디테일 4,572 ~ 5,928(≤ 6,000), 디테일 재질 6, 10채 합 ≈ 68.5k(≤ 78k), GLB ≈ 0.77 MB(≤ 1.2 MB). 질감 세트는 3 MB 한도라 **새 텍스처 없이** 기존 세트(화강석·오크·삼나무·도장 철·PVC)를 틴트해서 써요.
- **결정:** 8번은 설계의 상자 캐노피 대신 유리 캐노피(브리프의 "유리/폴리카보네이트 + 브래킷"). 9번 뒤 데크(지면 높이)는 뒤 파티오 문턱(0.30)보다 0.255 낮게 그대로 — 계단을 두면 충돌 없는 걸림돌이 돼서 안 넣었어요. 집별 소품(장독·흔들의자·장작)은 X2 범위 밖이라 안 넣었어요.

## 12. X3 게임 연결 결과 (2026-11-17, `feat/exterior-x3`)
`feat/exterior-x1` + `release/2`(fa2645a: houses-g 실내·sun-shadows, 충돌 6곳 둘 다 살림) + `feat/exterior-x2`(25e8e22) 위에서 했어요.

| 파일 | 내용 |
|---|---|
| `client/src/village/houses/housesPrep.ts` | 재질 이름으로 세트 붙이기(10장 넘겨주기 그대로), **MeshStandard(밝은 재질)** + 마을 실시간 해·달 그림자(`ssLive`)로 해 빛만 가림 — 두 등급 다, 밤 창(M_window 발광)·포치 등·가까운 가로등 빛. 껍데기 10채를 재질별로 합침(그리기 7), 디테일은 집마다 그룹. 옛 A7 집 잘라내기(`oldHouseFootprints`: 몸체 + 처마 1 m, 포치 띠 = 새 계단 0.68 m까지·2.5 cm 위, 텃밭), 나무 6그루 옮김(`a8TreeShift`) |
| `client/src/village/houses/VillageHouses.tsx`, `housesLoader.ts` | 따로 불러오기(로딩 화면 안 막음, 실패하면 옛 집 그대로 = 대체 길), 그려진 뒤에만 옛 집 잘라냄, 디테일 고르기(`pickDetail`), `window.__cvHouses()`(DEV) |
| `client/src/village/houses/houseLift.ts` | `houseStepLift` 0.12 s 완화: 내 아바타·남의 아바타(이름표·말풍선은 아바타 그룹 안)·발 그림자·1인칭 눈·따라가는 카메라(`followRig` 머리 높이). **모델에 그 집 포치 판(+0.30 윗면)이 있을 때만**(`hasPorchSlab`) — X2 전엔 0. 벤치 자리 높이와 겹치지 않음(`withSeatLift` = 큰 쪽) |
| `client/src/village/houses/houseSigns.ts` | 주인 자리: 문패 글자 "N번 집"을 X2 아크릴 판(0.42 × 0.16) 위 0.5 mm에 붙임(0.40 × 0.14, 모서리 로제트 피함, 한 번 그리기), 우편함 이름띠·팻말은 주인/분양 상태에서만 |
| `villageVegetation.ts` `flowersOnly` | 집 GLB의 `M_leaf_flora` 심는 자리 카드 → 마을과 같은 3D 꽃·풀 포기(카드 숨김, 흙은 X2 모델 것), 카드 그림은 마을 T_flora |
| `client/public/models/village/houses/house_*_normal_512.webp` | 저사양 등급 normal(512, q 92). 저사양 = albedo 1024 + normal 512 + roughness 없음(재질별 상수) |

**X2 결과 반영(25e8e22)**
- 10채 포치 모두 모델에서 찾아 높이가 켜져요(포치 판 +0.30 윗면). 계단 0.042 → 0.138 → 0.21 → 0.30, 0.12 s 완화.
- 포치 등: 렌즈는 M_window(창 불과 같은 스위치), 밤 빛은 X2 표 자리(박공 천장 / 캐노피 둘 / 벽등 둘)에서 벽·포치에 비춤. M_lamp(번호키 화면)는 은은하게(낮 0.25, 밤 0.9).
- 팻말 자리: 팻말은 숨김 상태라 비어 있어요(분양/주인일 때만 말뚝 + 판).
- 카메라: 포치 지붕엔 카메라 상자가 없어요(몸체만). 24 궤도 자세에서 몸체 안 0번.

**X4가 알 것**
- 라이트맵(UV2)이 생기면 `houseSurfaceMaterial`에 lightMap + 해 빛 나누기(sunShadows의 `SS_DAY_FUNCTION`처럼)만 더하면 돼요. village.glb를 A8로 다시 빌드하면 `modelHasA8Houses`로 잘라내기·나무 옮김이 꺼지고 `houseproxy__`만 숨겨요.
- 정적 장면 검사(`check-school-glb`)는 옛 집 삼각형(런타임에 ~36–40k 잘라냄)을 셀 수 없어서, 집 파일을 넣으면 PC 한도를 넘게 나와요(옛 집 포함 정적 294,761). X4 빌드 뒤엔 맞아요.
