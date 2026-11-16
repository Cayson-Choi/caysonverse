# 화단 흙·멀칭·돌 테두리 + 나무 줄기 실사화 (2026-11-16, feat/plants2)

주인님 요청
- (밤, 광장 사각 화분) "여기 화단에 흙들도 너무 엉성해 실제와 비슷한 느낌이 나야지"
- (밤, 벚나무 줄기) "나무 줄기도 좀 실제느낌 나도록 해봐"
- "전체 건물 땅 사물들이 모두 실제와 비슷한 느낌의 질감이 느껴져야해" — 이번 범위는 화단 흙·멀칭·돌 테두리·나무 껍질

## 원인
- 화분 흙은 village.glb의 평평한 갈색 판 하나였고, 첫 식물 작업(feat/plants)의 바크 조각은 그 위에 놓인 평면 오린 그림이라
  돌 테두리 위까지 들쭉날쭉 넘어갔습니다. 광장 사각 화분은 속이 꽉 찬 돌 블록 위에 흙판이 얹힌 구조라, 흙이 테두리보다 높았습니다.
- 줄기는 128×256 회색 절차 텍스처를 정점 조명으로만 칠한 매끈한 원통이었습니다(요철·뿌리·이끼 없음).

## 바꾼 것 (모두 클라이언트, village.glb 변경 없음)
| 파일 | 내용 |
|---|---|
| `client/src/village/veg/vegSoil.ts` (새) | 화단마다 실제 흙 표면: 광장 둥근 화분(안쪽 벽 r 1.3 안, 테두리보다 4~7 cm 아래), 사각 화분(새 화강암 테두리 10 cm 안, 테두리 위로 안 넘침), 분수 모서리 화단(돌 윗면 1~2 cm 아래), 그 밖의 화단(집 앞, 순환도로 녹지, 창문 화분, 추모관, 키오스크)은 식물 둘레를 부드러운 경계로 자동 생성. 8~9 cm 격자, 가운데로 봉긋, 울퉁불퉁. 테두리·식물 밑동·나무줄기·덤불 밑은 접촉 그늘. 식물은 그 흙 위에 세움 |
| 〃 `COPING` | 사각 화분 4개에 화강암 테두리(폭 13 cm, 높이 10 cm, 모서리 모따기). 마을 돌과 같은 사진(rock_boulder_dry), 노멀맵 |
| `client/public/models/village/veg/*.jpg` (새, 3.5 MB) | 흙 타일 1 m(1 mm/픽셀): 젖은 흙 사진 위에 실제 나무껍질 사진을 잘라 만든 바크 칩 1,850개, 작은 자갈·벚꽃잎·마른 잎, 접촉 그림자 + 노멀맵. 껍질 5종(벚나무 sakura_bark, 느티나무·활엽수 japanese_zelkova_bark, 버드나무 bark_willow, 어린 나무 japanese_hackberry_bark, 과수원 bark_brown_02) 색+노멀맵. 모두 Poly Haven CC0 |
| `docs/designs/plants2/tools/make_veg_textures.py` | 위 텍스처 생성 스크립트(재현 가능) |
| `client/src/village/veg/vegMaterial.ts` | 픽셀 단위 표면: 노멀맵(OpenGL) + 같은 조명식(환경·하늘·해), 벚나무 껍질 광택, 오래된 줄기 그늘 쪽(북쪽) 밑동 이끼(골에 먼저), 흙 가장자리 알파 컷 |
| `client/src/village/veg/barkGeometry.ts` | 줄기·큰 가지: 사진 텍스처 실제 크기(굵은 줄기는 여러 번 감음, 늘어남 없음), 불규칙 단면·굵기 변화, 뿌리 부분 더 넓게 퍼짐 + 표면 뿌리 4~6개(땅속으로), 밑동 접촉 그늘 강화, 껍질 색을 사진 평균색으로 |
| `client/src/village/veg/villageVegetation.ts` | 흙·테두리 메시 연결, 껍질 사진 비동기 로드(로드 전엔 기존 그림) |
| `flowerPlacement.ts`, `vegPlants.ts` | 평면 멀칭 조각(종 7) 삭제, 야생화 표시 `wild` |
| 테스트 | `vegSoil.test.ts`(흙이 테두리 안·아래, 야생화 제외, 뿌리), 기존 테스트 갱신 |

## 성능
- 흙: 화단 190개, 전체 118k 삼각형을 16 m 구역별 메시로 묶음(화면 밖 구역은 그리지 않음). 근거리 화분 하나 약 900~1,000 삼각형.
- 테두리: 4개 합쳐 약 200 삼각형. 줄기: 16면(PC) / 8면(휴대폰), 뿌리 7면.
- 텍스처는 종류별 1장씩 공유. GPU: PC 약 28 MB(벚나무·느티나무 1024², 나머지 512², 노멀 512²), 휴대폰 약 7 MB(512²/256²).
  다운로드: PC 약 2.3 MB, 휴대폰 약 1.2 MB(처음 한 번, 이후 캐시).
- 드로콜: 흙 구역 수 +약 20(화면 안에 있는 것만), 테두리 +1.

## 계절 대응
꽃 색은 `flowerPlacement.PALETTES`, 꽃 종류는 `speciesFor`, 그림은 `vegPlantAtlas.ts`, 덤불 종은 `BUSH_SPECIES`,
껍질·흙은 `make_veg_textures.py`의 파일 하나씩이라, 계절 변형(가을 메리골드·국화, 겨울 빈 화단 흙 등)은 데이터 교체로 할 수 있습니다.

## 확인
- `npm run typecheck -w client`, `npx vitest run src/village --maxWorkers=2`
- `node e2e/village-veg.mjs --url <client> --out <dir> --shots --modes new --only soilnight,soilday,soilphone,soilphonenight`
- 시트: `sheets/1_planter_soil_pc.jpg`, `sheets/2_trunks_pc.jpg`, `sheets/3_phone.jpg` (원본: `shots/before`, `shots/after`)

## 남은 것
- "전체 건물·땅·사물" 실사 질감은 이번 범위 밖입니다. 대부분 village.glb(W6 재빌드)의 구운 텍스처라 따로 작업이 필요합니다.
- 배포 안 함.
