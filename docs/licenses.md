# 자산 라이선스 목록

caysonverse가 배포하는 그림·모델·글꼴·디코더의 출처와 라이선스입니다. 폴더 안 상세 기록은 `client/public/models/LICENSE.md`(캐릭터·로고·조립실 배경·Jua)와 `client/public/models/furniture/LICENSE.md`(Kenney 가구)에 있고, 이 문서는 그 위에서 한눈에 보는 목록입니다.

규칙(방탈출 1단계 계획 전역 제약): 자산은 **직접 만든 것이거나 CC0**만 쓰고, 글꼴은 **OFL**, 코드 라이브러리는 **MIT/Apache-2.0**만 허용합니다. 외부 파일을 내려받기 전에는 파일명·출처·크기를 말하고 발주자 OK를 받습니다.

확인일은 이 문서의 한 줄을 저장소 안 기록(위 두 `LICENSE.md`와 케이슨 마을의 `client/public/models/village/LICENSE.md`, 폰트 `OFL-Jua.txt`, 설치된 three 패키지의 `README.md`)과 맞춰 본 날입니다. 원본 사이트를 다시 열어 본 날이 아닙니다(ChatGPT 줄만 약관 원문을 직접 확인했습니다). 케이슨 마을의 Poly Haven 줄들은 2026-11-03에 Poly Haven API(https://api.polyhaven.com)로 자산 이름과 CC0를 확인하고 내려받은 날이며, 같은 날 `client/public/models/village/LICENSE.md`에도 적었습니다.

## 표

| 자산 | 출처 | 라이선스 | 쓰는 곳 | 확인일 |
| --- | --- | --- | --- | --- |
| KayKit Adventurers Character Pack 1.0: 뼈대 `Rig_Medium`과 기본 동작 클립 7개 (`Idle`, `Walking_A`, `Running_A`, `Sit_Chair_Down`, `Sit_Chair_Idle`, `Sit_Chair_StandUp`, `Jump_Full_Short`) | Kay Lousberg(KayKit), https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 | CC0 1.0 Universal (표기 의무 없음, 감사의 뜻으로 적음) | `client/public/models/character.glb` (플레이어·AI 조교 캐릭터) | 2026-11-02 |
| 파생 동작 클립 6개 (`Walking_A`·`Running_A`·`Jump_Full_Short`의 롱스커트용 3개와 짧은 치마용 3개) | 위 KayKit 클립(CC0)을 바탕으로 이 저장소의 아트 작업에서 만든 변형. 다리 움직임만 줄이거나 무릎 굽힘만 제한함 | CC0 클립에서 만든 직접 제작물 | `client/public/models/character.glb` | 2026-11-02 |
| 캐릭터 메시·텍스처 (피규어 몸, 머리카락·모자·옷·신발·아이템·얼굴 부품) | 이 저장소의 오리지널 작업물 | 직접 제작 | `client/public/models/character.glb` | 2026-11-02 |
| Jua 글꼴 (조립실 고정 문구 글자만 남긴 부분집합 WOFF) | Copyright 2018 The Jua Project Authors (google/fonts). `scripts/subset-builder-font.mjs`가 원본 `Jua-Regular.ttf`에서 만듦 | SIL Open Font License 1.1, 전문은 `client/public/fonts/OFL-Jua.txt` | `client/public/fonts/jua-builder.woff` (캐릭터 조립실 제목·버튼·안내). 외부 글꼴 서버는 쓰지 않음 | 2026-11-02 |
| "Cayson" 흰색 워드마크 | Fredoka 700 굵기로 만든 로고 | SIL Open Font License 1.1 (글꼴), 로고는 직접 제작 | `client/public/brand/cayson-logo-white.png` (조립실 제목) | 2026-11-02 |
| Kenney Furniture Kit 2.0 중 9개 모델 | Kenney, https://kenney.nl/assets/furniture-kit | CC0 1.0 Universal | `client/public/models/furniture/` (기존 월드의 가구. 방탈출은 쓰지 않음) | 2026-11-02 |
| three.js Draco 디코더 (`draco_decoder.js`, `draco_decoder.wasm`, `draco_wasm_wrapper.js`) | 설치된 three 0.185.1 패키지의 `examples/jsm/libs/draco/gltf/` (Google Draco). 내려받지 않고 `node_modules`에서 복사해 우리 서버에서 직접 보냄 | Apache License 2.0 | `client/public/draco/` (`hub.glb` 읽기: drei `useGLTF(url, "/draco/")`가 `DRACOLoader`를 이 경로로 연다). Task 23이 2026-11-02에 설치된 three에서 그대로 복사함. 같은 폴더에 Apache License 2.0 전문 `client/public/draco/LICENSE.txt`가 디코더와 함께 배포되고(배포본 `/draco/LICENSE.txt`), `README.md`가 고지와 출처를 싣는다 | 2026-11-02 |
| 학교 부품 세트(벽·창·문·바닥·사물함·벤치·게시판 등 15개), 중앙 홀+복도 `hub.glb`, 상담실 `counsel.glb`, 라이트맵, 타일 텍스처 | 이 프로젝트에서 Blender로 직접 제작. 메시·텍스처는 `art/school/tools/`의 스크립트가 만들었다. 내려받은 모델·텍스처 없음 | 직접 제작 (이 프로젝트 소유) | `client/public/models/school/` (`hub.glb`와 `hub_lightmap.webp`는 Task 23이 `art/school/export/`에서 복사함. `counsel.glb`(1.86 MB, Draco 없음)와 `counsel_lightmap.webp`는 Task 24가 2026-11-02에 복사. 원본 `art/`는 저장소에 올리지 않음) | 2026-11-02 |
| 살펴보기 그림 11장(상담 화면·쪽지 상자·손전등·캐비닛·서랍 둘·분류판·금고·열쇠 스위치 둘·출구 문), 쪽지 앞면 1장, 반딧 초상화 | 위와 같은 스크립트로 만든 그림. 반딧은 이 프로젝트의 오리지널 작은 경비 로봇이다. 글자는 그림에 넣지 않음 | 직접 제작 (이 프로젝트 소유) | `client/public/models/school/inspect/`, `client/public/models/school/portraits/` | 2026-11-02 |
| 조립실 배경 그림 두 장(넓은 화면 1600x900, 세로 화면 720x1280)의 AVIF·WebP | ChatGPT(OpenAI) 이미지 생성, 발주자 계정, 2026-11-01, A안. 데스크톱 그림의 글자 같은 무늬는 손으로 흐리게 지우고 배포용으로 다시 인코딩함 | OpenAI 이용약관(2026-01-01 시행분)을 따름. 아래 "ChatGPT 생성 그림" 참고 | `client/public/entry/bg-desktop.{avif,webp}`, `bg-phone.{avif,webp}` (입장 화면 "캐릭터 조립실") | 2026-11-02 |
| AI 갤러리 그림 9점 (`art-1.jpg`~`art-9.jpg`) | 발주자가 제공한 AI 그림(`docs/design.md` 34장). 어떤 AI 서비스로 만들었는지 이 저장소에는 기록이 없다. 원본은 저장소 밖 `art/`에 있고 웹용 변환본만 커밋함 | 발주자 제공물. **상업 이용 조건은 확인한 기록이 없음 — 발주자 확인 필요** | `client/public/gallery/` (기존 월드의 AI 갤러리. 방탈출은 쓰지 않음) | 2026-11-02 (기록 없음을 확인) |
| Poly Haven `leafy_grass` 텍스처(색) | Poly Haven, https://polyhaven.com/a/leafy_grass (API https://api.polyhaven.com) | CC0 1.0 Universal | `client/public/models/village/village.glb` 안의 텍스처: 잔디 `T_grass`, 광장 바닥 그림 `T_plaza`의 풀 부분, 부지 잔디 `T_lawn` (색을 잔디 녹색으로 다시 맞춤) | 2026-11-03 |
| Poly Haven `rock_boulder_dry` 텍스처(색) | Poly Haven, https://polyhaven.com/a/rock_boulder_dry (API https://api.polyhaven.com) | CC0 1.0 Universal | `client/public/models/village/village.glb` 안의 텍스처: 화강암 `T_stone`, 바위 `T_rock`, 광장 판석 `T_plaza`, 폭포 절벽(배경 텍스처 `T_backdrop`에 구워 넣음) | 2026-11-03 |
| Poly Haven `clean_asphalt` 텍스처(색) | Poly Haven, https://polyhaven.com/a/clean_asphalt (API https://api.polyhaven.com) | CC0 1.0 Universal | `client/public/models/village/village.glb` 안의 텍스처: 순환 도로 아스팔트 (`T_plaza`) | 2026-11-03 |
| Poly Haven `concrete_pavers` 텍스처(색) | Poly Haven, https://polyhaven.com/a/concrete_pavers (API https://api.polyhaven.com) | CC0 1.0 Universal | `client/public/models/village/village.glb` 안의 텍스처: 보도 블록 (`T_plaza`) | 2026-11-03 |
| Poly Haven `asphalt_04` 텍스처(색) | Poly Haven, https://polyhaven.com/a/asphalt_04 (API https://api.polyhaven.com) | CC0 1.0 Universal | `client/public/models/village/village.glb` 안의 텍스처: 마을 길 콘크리트 `T_concrete` | 2026-11-03 |
| Poly Haven `white_plaster_02` 텍스처(색) | Poly Haven, https://polyhaven.com/a/white_plaster_02 (API https://api.polyhaven.com) | CC0 1.0 Universal | `client/public/models/village/village.glb` 안의 텍스처: 집·추모관 벽 `T_render` | 2026-11-03 |
| Poly Haven `wood_planks` 텍스처(색) | Poly Haven, https://polyhaven.com/a/wood_planks (API https://api.polyhaven.com) | CC0 1.0 Universal | `client/public/models/village/village.glb` 안의 텍스처: 나무 `T_wood` (데크·다리·벤치·카페·추모관 루버) | 2026-11-03 |
| Poly Haven `roof_slates_02` 텍스처(색) | Poly Haven, https://polyhaven.com/a/roof_slates_02 (API https://api.polyhaven.com) | CC0 1.0 Universal | `client/public/models/village/village.glb` 안의 텍스처: 지붕 `T_roof` | 2026-11-03 |
| Poly Haven `stone_wall` 텍스처(색) | Poly Haven, https://polyhaven.com/a/stone_wall (API https://api.polyhaven.com) | CC0 1.0 Universal | `client/public/models/village/village.glb` 안의 텍스처: 돌담 `T_wall` (둥근 막돌을 쌓은 담) | 2026-11-03 |
| Poly Haven `sakura_bark` 텍스처(색) | Poly Haven, https://polyhaven.com/a/sakura_bark (API https://api.polyhaven.com) | CC0 1.0 Universal | `client/public/models/village/village.glb` 안의 텍스처: 벚나무 껍질 (`T_bark` 왼쪽 절반) | 2026-11-03 |
| Poly Haven `japanese_zelkova_bark` 텍스처(색) | Poly Haven, https://polyhaven.com/a/japanese_zelkova_bark (API https://api.polyhaven.com) | CC0 1.0 Universal | `client/public/models/village/village.glb` 안의 텍스처: 느티나무·나무 껍질 (`T_bark` 오른쪽 절반) | 2026-11-03 |
| Poly Haven `island_tree_01` 모델의 잎 텍스처(`leaves_diff`, `leaves_alpha`) | Poly Haven, https://polyhaven.com/a/island_tree_01 (API https://api.polyhaven.com) | CC0 1.0 Universal | `client/public/models/village/village.glb` 안의 텍스처: 잎 한 장씩 잘라 낸 그림으로 잎 뭉치 카드 `T_leaf_green`, 벚꽃 카드 `T_leaf_cherry`의 잎, 꽃밭 카드 `T_flora`의 잎을 만듦 (모델은 쓰지 않음) | 2026-11-03 |
| Poly Haven `kloppenheim_06_puresky` HDRI (2k) | Poly Haven, https://polyhaven.com/a/kloppenheim_06_puresky (API https://api.polyhaven.com) | CC0 1.0 Universal | `client/public/models/village/village.glb` 안의 텍스처: 노을 무렵 하늘빛(굽기와 Cycles 비교 그림의 조명), 하늘 돔 텍스처 `T_sky` | 2026-11-03 |
| 케이슨 마을 모델 `village.glb`, 라이트맵 `village_lm.webp`, 직접 그린 텍스처(광장 판석·도로 무늬 `T_plaza`, 벚꽃·꽃·갈대·꽃잎 카드, 창·유리·버스·차양·현수막 그림 `T_atlas`·`T_glow`, 물·폭포 `T_water`·`T_falls`) | 이 프로젝트에서 Blender와 스크립트로 직접 제작(`art/village/tools/`의 `make_textures.py`, `build_village.py`, `bake_village.py`). 위 Poly Haven CC0 텍스처를 재료로 씀. AI 생성 모델·텍스처 없음 | 직접 제작 (이 프로젝트 소유) + 위 CC0 | `client/public/models/village/` (케이슨 마을 1단계 Task 6이 `art/village/export/`에서 복사. 원본 `art/`는 저장소에 올리지 않음) | 2026-11-03 |
| 케이슨 마을 안내원 음성 8개 (`plaza_guide_1~4.m4a` 마을 안내원, `hall_desk_1~4.m4a` 추모관 안내 데스크; 24 kHz 모노 AAC, 각 30~44 KB) | VoxCPM2(OpenBMB, https://github.com/OpenBMB/VoxCPM, 가중치 https://huggingface.co/openbmb/VoxCPM2)로 발주자 PC에서 오프라인 생성. 로컬 VoiceStudio 앱 + capcut-editor 스킬의 `narrate.py`, 생성 스크립트 `art/village/voice/make_voice.py`(저장소에 올리지 않음). **글로 적은 설명으로 새로 디자인한 목소리**이며 실제 사람의 목소리를 복제하지 않음 | 엔진 코드(`voxcpm` 2.0.3 패키지, License-Expression: Apache-2.0)와 모델 가중치(모델 카드 `license: apache-2.0`) 모두 **Apache License 2.0, "free for commercial use"**. 생성된 음성은 이 프로젝트의 결과물. 모델 카드의 사칭·사기·허위 정보 금지 규칙을 지킴(사람 목소리 복제 없음, 대화창에 "AI 음성" 표시). 아래 "VoxCPM2 음성" 참고 | `client/public/village/voice/` (케이슨 마을 1단계 Task 9A: 안내원에게 문의하면 그 사람에게만 재생. 채팅은 읽지 않음) | 2026-11-08 |

## AI 생성 자산

- **AI 이미지: 방탈출(학교)이 쓰는 것은 두 건.** 위 표의 조립실 배경 그림 두 장(넓은 화면용·세로 화면용, ChatGPT)입니다. 기존 월드의 AI 갤러리 그림 9점은 발주자가 제공한 AI 그림이며 방탈출은 쓰지 않습니다(출처 기록 없음, 위 표). 그 밖의 그림·텍스처·모델은 모두 직접 만들었거나 CC0입니다.
- **AI 3D 생성: 없음.** `generate_3d` 같은 AI 3D 생성은 1단계에서 쓰지 않았습니다(스펙 10·14장). 학교 모델과 케이슨 마을 모델은 Blender로 직접 만들었습니다(마을 텍스처는 직접 그린 것과 Poly Haven CC0뿐).
- **AI 음성: 케이슨 마을 안내원 음성 8개**(VoxCPM2, 위 표). 방탈출(학교)은 쓰지 않습니다.
- "AI 생성 자산 없음"이라고 통틀어 쓰지 않습니다. 위 자산들이 있기 때문입니다.

### ChatGPT 생성 그림 (조립실 배경)

2026-11-02에 OpenAI 이용약관(한국어 ko-KR 판)과 도움말 센터 "What is ChatGPT?"를 확인한 내용입니다.

- 2026-01-01 시행 약관은 결과물에 대한 권리를 사용자(여기서는 발주자 계정)에게 넘깁니다. **상업적 이용이 허용됩니다.**
- 결과물은 **배타적이지 않습니다.** 다른 사용자가 비슷한 그림을 받을 수 있으므로 이 그림에 독점권을 주장하지 않습니다.
- AI가 만든 그림을 **사람이 만든 것처럼 소개해서는 안 됩니다.** 소개 글·크레딧에 쓸 때는 "AI로 만든 그림"이라고 밝힙니다.
- 발주자의 출시 전 상업적 이용 확인은 2026-11-02에 위 OpenAI 이용약관을 기준으로 끝났습니다. 상업적 이용은 허용되고, 그림은 배타적이지 않으며, 사람이 만든 것처럼 소개하지 않습니다. `client/public/models/LICENSE.md`의 배경 그림 절도 같은 내용으로 맞췄습니다. 약관이 바뀌면 다시 확인하고, 학교 판매 계약 같은 최종 판단은 발주자가 합니다.

### VoxCPM2 음성 (케이슨 마을 안내원)

2026-11-08에 설치된 `voxcpm` 2.0.3 패키지의 메타데이터와 Hugging Face 모델 카드(openbmb/VoxCPM2)를 확인한 내용입니다.

- 코드와 모델 가중치 모두 **Apache License 2.0**이고, 모델 카드에 **"free for commercial use"**라고 적혀 있습니다. Apache-2.0 전문: https://www.apache.org/licenses/LICENSE-2.0 (모델 자체는 배포하지 않고, 만든 음성 파일만 배포합니다).
- 모델 카드는 **사칭(impersonation)·사기·허위 정보에 쓰는 것을 엄격히 금지**하고, AI로 만든 콘텐츠에 표시를 권합니다. 이 프로젝트는 실제 사람의 목소리를 복제하지 않고 글로 적은 설명("30대의 따뜻하고 친근한 여성", "추모관에 어울리는 부드럽고 차분한 목소리")으로 새 목소리를 디자인했으며, 안내원 대화창에 "AI 음성" 표시를 붙였습니다.
- 생성은 발주자 PC에서 오프라인으로 했고 호출 비용은 없습니다. 엔진이나 약관이 바뀌면 다시 확인합니다.

## 새 자산을 넣을 때

1. 위 표에 한 줄을 더합니다(자산, 출처, 라이선스, 쓰는 곳, 확인일). 직접 만든 것도 적습니다.
2. 직접 만든 것이거나 CC0, 글꼴은 OFL, 코드는 MIT/Apache-2.0만 씁니다. 그 밖의 라이선스는 먼저 발주자와 정합니다.
3. AI가 만든 것이면 "AI 생성 자산" 절에도 적습니다.
4. 폴더 안 상세 기록(`LICENSE.md`)이 따로 있으면 그쪽도 맞춥니다.

마지막 갱신: 2026-11-08 (케이슨 마을 1단계 Task 9A: 안내원 음성 8개, VoxCPM2 Apache-2.0). 그 전: 2026-11-03 (케이슨 마을 1단계 Task 6과 그 수정: `village.glb`·`village_lm.webp`, 폴더 기록 `client/public/models/village/LICENSE.md`, Poly Haven CC0 텍스처·HDRI 13건 — 돌담은 `granite_wall` 대신 `stone_wall`). 그 전: 2026-11-02 (Task 24: `counsel.glb`·`counsel_lightmap.webp` 복사, 살펴보기 그림·반딧 초상화는 Task 18에서 들어와 있음). **최종 확인일: 2026-11-03** (케이슨 마을 Task 6 수정; 그 전 2026-11-02 Task 27) — 표의 파일 위치·크기를 그날 저장소와 맞춰 보았고, 표에 빠져 있던 AI 갤러리 그림 9점을 더했습니다.
