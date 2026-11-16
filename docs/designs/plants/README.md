# 화분·화단·둥근 덤불 실사화 + 광장 느티나무 복원 (2026-11-16, feat/plants)

주인님 요청
- "이런 식물도 뭔가 실제랑 비슷한 느낌으로 만들어줘 꽃이나 둥근식물 같은 것도 벚꽃이나 나무와 비슷한 수준으로"
- (광장 가장자리의 빈 팔각 평상) "없애버리던가 아니면 뭔가 있게 하든가 해" → 느티나무를 다시 세우기로 결정

## 1. 알아낸 것 — 식물은 village.glb가 아니라 게임(클라이언트)에서 만들어짐

- 주인님이 보신 덤불·꽃은 `village.glb`의 카드가 아니라 **클라이언트의 veg3d**(`client/src/village/veg/`)가 실행 중에
  만든 것. `village.glb`의 옛 카드(`parts_trees.flower_patch`의 `T_flora` 줄 카드, `parts_trees.shrub` 카드,
  `inst__shrub_0`)는 **자리만 알려주고 숨겨짐**. 꽃 자리는 `flowerPlacement.ts`, 덤불 자리는 `shrubs.ts`가 카드에서 읽음.
- 옛 덤불(`vegGeometry.bushGeometry`): 초록 타원체 "심" 위에 10~15 cm 짜리 단색 잎 920장 → 큰 종이잎 + 초록 공.
- 옛 꽃: 텍스처 없는 단색 다각형 → 종이를 오려 붙인 느낌.
- 벚꽃·나무가 좋아 보이는 이유: 실제 크기의 작은 조각에 **그림(아틀라스) + 알파 컷**, 가지 구조, 안쪽 어둡게.
- 느티나무가 없어진 원인: 2026-11-12 커밋 `981b345`("문제 있는 광장 느티나무 제거", 당시 잎과 줄기가 땅에 제대로
  이어지지 않음)와 `d467ef9`의 `zelkova.ts removePlazaZelkova` — 도착하자마자 껍질 삼각형을 잘라내고 평상 가운데를
  판으로 막음. 즉 **일부러 지운 것**(TODO A2 "말씀대로 없애고 둥근 평상만 남겨요"). 11-13부터 모든 나무를 뼈대에서
  다시 키우므로, 그때의 연결 문제는 더 이상 없음.

## 2. 바꾼 것 (모두 클라이언트 코드 — village.glb 재빌드 필요 없음)

| 파일 | 내용 |
|---|---|
| `client/src/village/veg/plantCells.ts` (새) | 식물 아틀라스 4×4 칸 정의, `plantUv`, `SOLID_UV` |
| `client/src/village/veg/vegPlantAtlas.ts` (새) | 아틀라스를 캔버스에 코드로 그림(1024², 사진·외부 텍스처 없음): 회양목 잔가지 2종·안쪽 잔가지, 철쭉 잎·꽃송이, 팬지 얼굴(얼룩·수염), 페튜니아(그물맥·목 부분), 메리골드(주름 꽃잎 7겹), 무스카리 종 모양, 팬지·페튜니아 잎, 메리골드 깃꼴 잎, 바크 멀칭, 튤립 꽃잎, 끈 모양 잎. 투명 부분 색 번짐(밉맵 테두리 검게 안 됨) |
| `client/src/village/veg/vegPlants.ts` (새) | `bushPlant(boxwood/azalea, level)`: 울퉁불퉁한 껍질 위 잔가지 카드 1,150장(회양목 잎 1.5~2 cm) + 안쪽 어두운 380장 + 작은 검은 심, 아래·안쪽 어둡게(정점색 AO), 철쭉은 꽃송이 카드(덤불 색조가 꽃 색). 꽃: `petuniaPlant2`(나팔 모양에 무늬), `pansyPlant2`(오목한 얼굴, 꽃대), `muscariPlant2`(종 무늬 기둥), `tulipPlant2`, `marigoldPlant`(돔 폼폼 + 깃꼴 잎, 새 종), `mulchPatch`, `plantMeshes()` |
| `client/src/village/veg/flowerPlacement.ts` | 종 추가: 메리골드(6, 노란 줄에서 팬지와 무리 지어 섞임), 멀칭(7, 화단 식물의 절반 아래, 들판 야생화에는 없음) |
| `client/src/village/veg/villageVegetation.ts` | 꽃·덤불 재질에 아틀라스(알파 테스트) 사용, 덤불 2종(광장 사각 화분·옥상 = 회양목, 나머지 절반은 철쭉), **느티나무 복원**(`PLAZA_ZELKOVA_GROWN = true`: 지우지 않고, 껍질·잔가지·잎을 다른 나무와 같은 방식으로 키움, 전용 그리기 등급 `zelkova`) |
| `client/src/village/veg/treeCrown.ts` | `ZELKOVA_GROW`: 13.5 m 정자나무 수관을 마을 활엽수 한 그루 정도 비용으로 |
| `client/src/village/veg/vegGeometry.ts` | 옛 덤불·꽃 메시 삭제, `GeoBuilder.defaultUv`, 풀포기는 아틀라스 흰 칸 사용 |
| `client/src/village/veg/*.test.ts` | `vegPlants.test.ts`(예산·잎 크기·UV), `flowerPlacement.test.ts`(메리골드·멀칭) |
| `client/dev/plants-lookdev.html`, `plantsLookdev.ts`, `e2e/plants-lookdev.mjs` | DEV 전용 룩데브(빌드에 안 들어감) |
| `e2e/village-veg.mjs` | 촬영 각도 추가(`plants` 계획: 사각 화분 근접·덤불 근접·길가 덤불·느티나무 평상), 각도별 삼각형 수 기록, `--views` |

`zelkova.ts`(지우는 경로)는 `PLAZA_ZELKOVA_GROWN = false`로 되돌릴 때를 위해 남겨 둠.

## 3. 예산

메시(삼각형):

| | 전 | 후 |
|---|---|---|
| 덤불 근/중/원 | 7,480 / 720 / 96 | 6,288 / 920 / 220 (회양목·철쭉 같음) |
| 페튜니아 근/원 | 336 / 63 | 464 / 58 |
| 팬지 | 336 / 40 | 340 / 44 |
| 무스카리 | 292 / 32 | 394 / 82 |
| 튤립 | 192 / 64 | 192 / 68 |
| 메리골드 (새) | — | 약 420 / 80 |
| 멀칭 (새) | — | 8 / 8 |

화분 하나(광장 사각 화분, 근거리): 덤불 7,480 → 6,288, 꽃 약 25포기 ×(약 340 → 약 380) + 멀칭 약 12×8.
결과적으로 화분 하나 약 16k → 약 16k(같은 수준).

게임 화면 한 프레임(PC high, 낮, `e2e/village-veg.mjs --only plants`가 잰 `__cvVeg().tris`):

| 각도 | 전 | 후 |
|---|---|---|
| squareClose (주인님 스크린샷) | 419k | 464k |
| squarePlanter | 489k | 536k |
| fountainBed | 418k | 457k |
| houseBed | 574k | 646k |
| plazaWide | 462k | 501k |
| zelkovaDeck / Under (느티나무 바로 옆) | 462k / 480k | 1.23M / 1.25M |

느티나무 근거리 +0.77M은 마을 활엽수 한 그루 근거리와 비슷(처음 그대로 키웠을 때 4.1M → `ZELKOVA_GROW`와 일반 잎
가지로 낮춤). 텍스처: 1024² 아틀라스 1장(약 5.6 MB GPU, 밉맵 포함), 다운로드 0(코드로 그림). 드로콜 +6(꽃 2종 층,
덤불 종 2 × 3단계). **village.glb 영향: 0 바이트**(바뀌지 않음).

## 4. 마을 재빌드(W6)와 합치는 방법

1. W6의 village.glb 재빌드에는 **아무것도 넣을 필요 없음**. Blender 스크립트·텍스처 변경 없음.
2. 단, 클라이언트가 village.glb에서 읽는 것을 W6가 그대로 둬야 함:
   - 꽃 카드: `M_leaf_flora`(`T_flora.png` 4줄) 카드 — `flower_patch`/`planter`/`plaza_details`/`meadow_patch`.
   - 덤불 카드: `parts_trees.shrub` 카드와 `inst__shrub_0` 인스턴스.
   - 광장 느티나무: `parts_trees.plaza_trees`의 `tree(F, zx, zz, "zelkova", 13.5, 8.5, 7, trunk_r=0.62)`와 평상 —
     클라이언트가 `treeSkeleton.PLAZA_ZELKOVA_SPEC`(index 99, seed 7)로 똑같이 재생하고, 파일의 구운 껍질은
     `bakedBarkIndex`로 잘라 냄.
   - 화분 위치가 바뀌면 `flowerPlacement.PLAZA_BEDS`, 느티나무 위치가 바뀌면 `PLAZA_ZELKOVA_SPEC`를 같이 고칠 것.
3. 합치기: `feat/plants` 브랜치를 main에 병합(클라이언트만). 확인: `npm test -w client`, 그리고
   `node e2e/village-veg.mjs --url <client> --out <dir> --shots --modes new --only plants`.

## 5. 비교 시트

- `sheets/1_square_planter.jpg` — 주인님 스크린샷 각도 전/후 + 실제 회양목·페튜니아 사진
- `sheets/2_bush_close.jpg` — 덤불 근접 전/후, 회양목 잎·철쭉 생울타리 사진
- `sheets/3_flower_beds.jpg` — 벚나무 화분·분수 화단·집 앞 화단 전/후, 팬지·메리골드·무스카리 사진
- `sheets/4_lane_shrubs.jpg` — 길가 덤불 전/후, 철쭉 사진
- `sheets/5_zelkova.jpg` — 빈 평상 → 느티나무, 실제 마을 당산 느티나무 사진
- `sheets/6_lookdev_close.jpg` — 룩데브 근접, 아틀라스, 팬지·메리골드 사진
- 원본 촬영: `shots/before`, `shots/after`, `lookdev/`. 참고 사진 출처·라이선스: `refs_sources.json`
  (Wikimedia Commons CC/PD, 시트 하단에 저작자 표기). 원본 사진은 `art/village/refs/plants/`(git 제외).
- 시트 다시 만들기: `tools/make_sheets.py`, 참고 사진 받기: `tools/fetch_refs.py`.

## 6. 남은 것 / 확인 필요

- 실제 배포 화면에서 주인님 확인 전. 휴대폰(low)은 촬영으로만 확인(오류 0).
- 철쭉은 21그루(길가·부지 둘레 덤불의 약 절반), 꽃 색은 덤불마다 6색 중 하나.
- 느티나무는 4월(마을 계절) 기준으로 잎이 아직 성긴 편. 더 빽빽하게 하려면 `ZELKOVA_GROW.density`를 올리면 되지만
  근거리 삼각형이 비례해서 늘어남.
