# 자산 라이선스 목록

caysonverse가 배포하는 그림·모델·글꼴·디코더의 출처와 라이선스입니다. 폴더 안 상세 기록은 `client/public/models/LICENSE.md`(캐릭터·로고·조립실 배경·Jua)와 `client/public/models/furniture/LICENSE.md`(Kenney 가구)에 있고, 이 문서는 그 위에서 한눈에 보는 목록입니다.

규칙(방탈출 1단계 계획 전역 제약): 자산은 **직접 만든 것이거나 CC0**만 쓰고, 글꼴은 **OFL**, 코드 라이브러리는 **MIT/Apache-2.0**만 허용합니다. 외부 파일을 내려받기 전에는 파일명·출처·크기를 말하고 발주자 OK를 받습니다.

확인일은 이 문서의 한 줄을 저장소 안 기록(위 두 `LICENSE.md`, 폰트 `OFL-Jua.txt`, 설치된 three 패키지의 `README.md`)과 맞춰 본 날입니다. 원본 사이트를 다시 열어 본 날이 아닙니다(ChatGPT 줄만 약관 원문을 직접 확인했습니다).

## 표

| 자산 | 출처 | 라이선스 | 쓰는 곳 | 확인일 |
| --- | --- | --- | --- | --- |
| KayKit Adventurers Character Pack 1.0: 뼈대 `Rig_Medium`과 기본 동작 클립 7개 (`Idle`, `Walking_A`, `Running_A`, `Sit_Chair_Down`, `Sit_Chair_Idle`, `Sit_Chair_StandUp`, `Jump_Full_Short`) | Kay Lousberg(KayKit), https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 | CC0 1.0 Universal (표기 의무 없음, 감사의 뜻으로 적음) | `client/public/models/character.glb` (플레이어·AI 조교 캐릭터) | 2026-11-02 |
| 파생 동작 클립 6개 (`Walking_A`·`Running_A`·`Jump_Full_Short`의 롱스커트용 3개와 짧은 치마용 3개) | 위 KayKit 클립(CC0)을 바탕으로 이 저장소의 아트 작업에서 만든 변형. 다리 움직임만 줄이거나 무릎 굽힘만 제한함 | CC0 클립에서 만든 직접 제작물 | `client/public/models/character.glb` | 2026-11-02 |
| 캐릭터 메시·텍스처 (피규어 몸, 머리카락·모자·옷·신발·아이템·얼굴 부품) | 이 저장소의 오리지널 작업물 | 직접 제작 | `client/public/models/character.glb` | 2026-11-02 |
| Jua 글꼴 (조립실 고정 문구 글자만 남긴 부분집합 WOFF) | Copyright 2018 The Jua Project Authors (google/fonts). `scripts/subset-builder-font.mjs`가 원본 `Jua-Regular.ttf`에서 만듦 | SIL Open Font License 1.1, 전문은 `client/public/fonts/OFL-Jua.txt` | `client/public/fonts/jua-builder.woff` (캐릭터 조립실 제목·버튼·안내). 외부 글꼴 서버는 쓰지 않음 | 2026-11-02 |
| "Cayson" 흰색 워드마크 | Fredoka 700 굵기로 만든 로고 | SIL Open Font License 1.1 (글꼴), 로고는 직접 제작 | `client/public/brand/cayson-logo-white.png` (조립실 제목) | 2026-11-02 |
| Kenney Furniture Kit 2.0 중 9개 모델 | Kenney, https://kenney.nl/assets/furniture-kit | CC0 1.0 Universal | `client/public/models/furniture/` (기존 월드의 가구. 방탈출은 쓰지 않음) | 2026-11-02 |
| three.js Draco 디코더 (`draco_decoder.js`, `draco_decoder.wasm`, `draco_wasm_wrapper.js`) | 설치된 three 0.185.1 패키지의 `examples/jsm/libs/draco/gltf/` (Google Draco). 내려받지 않고 `node_modules`에서 복사해 우리 서버에서 직접 보냄 | Apache License 2.0 | `hub.glb` 읽기(`DRACOLoader`). 복사는 Task 23이 `client/public/draco/`로 한다(그 전에는 아직 없음) | 2026-11-02 |
| 학교 부품 세트(벽·창·문·바닥·사물함·벤치·게시판 등 15개), 중앙 홀+복도 `hub.glb`, 상담실 `counsel.glb`, 라이트맵, 타일 텍스처 | 이 프로젝트에서 Blender로 직접 제작. 메시·텍스처는 `art/school/tools/`의 스크립트가 만들었다. 내려받은 모델·텍스처 없음 | 직접 제작 (이 프로젝트 소유) | `client/public/models/school/` (Task 23·24가 `art/school/export/`에서 복사. 원본 `art/`는 저장소에 올리지 않음) | 2026-11-02 |
| 살펴보기 그림 11장(상담 화면·쪽지 상자·손전등·캐비닛·서랍 둘·분류판·금고·열쇠 스위치 둘·출구 문), 쪽지 앞면 1장, 반딧 초상화 | 위와 같은 스크립트로 만든 그림. 반딧은 이 프로젝트의 오리지널 작은 경비 로봇이다. 글자는 그림에 넣지 않음 | 직접 제작 (이 프로젝트 소유) | `client/public/models/school/inspect/`, `client/public/models/school/portraits/` | 2026-11-02 |
| 조립실 배경 그림 두 장(넓은 화면 1600x900, 세로 화면 720x1280)의 AVIF·WebP | ChatGPT(OpenAI) 이미지 생성, 발주자 계정, 2026-11-01, A안. 데스크톱 그림의 글자 같은 무늬는 손으로 흐리게 지우고 배포용으로 다시 인코딩함 | OpenAI 이용약관(2026-01-01 시행분)을 따름. 아래 "ChatGPT 생성 그림" 참고 | `client/public/entry/bg-desktop.{avif,webp}`, `bg-phone.{avif,webp}` (입장 화면 "캐릭터 조립실") | 2026-11-02 |

## AI 생성 자산

- **AI 이미지: 한 건.** 위 표의 조립실 배경 그림(ChatGPT)입니다. 그 밖의 그림·텍스처·모델은 모두 직접 만들었거나 CC0입니다.
- **AI 3D 생성: 없음.** `generate_3d` 같은 AI 3D 생성은 1단계에서 쓰지 않았습니다(스펙 10·14장). 학교 모델은 Blender로 직접 만들었습니다.
- "AI 생성 자산 없음"이라고 통틀어 쓰지 않습니다. 위 한 건이 있기 때문입니다.

### ChatGPT 생성 그림 (조립실 배경)

2026-11-02에 OpenAI 이용약관(한국어 ko-KR 판)과 도움말 센터 "What is ChatGPT?"를 확인한 내용입니다.

- 2026-01-01 시행 약관은 결과물에 대한 권리를 사용자(여기서는 발주자 계정)에게 넘깁니다. **상업적 이용이 허용됩니다.**
- 결과물은 **배타적이지 않습니다.** 다른 사용자가 비슷한 그림을 받을 수 있으므로 이 그림에 독점권을 주장하지 않습니다.
- AI가 만든 그림을 **사람이 만든 것처럼 소개해서는 안 됩니다.** 소개 글·크레딧에 쓸 때는 "AI로 만든 그림"이라고 밝힙니다.
- `client/public/models/LICENSE.md`의 "상업 판매에 써도 되는지는 출시 전에 발주자가 확인할 항목"은 약관상 허용 여부를 위처럼 확인한 것으로 갈음합니다. 약관이 바뀌면 다시 확인하고, 학교 판매 계약 같은 최종 판단은 발주자가 합니다.

## 새 자산을 넣을 때

1. 위 표에 한 줄을 더합니다(자산, 출처, 라이선스, 쓰는 곳, 확인일). 직접 만든 것도 적습니다.
2. 직접 만든 것이거나 CC0, 글꼴은 OFL, 코드는 MIT/Apache-2.0만 씁니다. 그 밖의 라이선스는 먼저 발주자와 정합니다.
3. AI가 만든 것이면 "AI 생성 자산" 절에도 적습니다.
4. 폴더 안 상세 기록(`LICENSE.md`)이 따로 있으면 그쪽도 맞춥니다.

마지막 갱신: 2026-11-02 (Task 22). Task 23·24가 `hub.glb`, `counsel.glb`, 디코더를 실제로 복사할 때 쓰는 곳 칸을 확정하고, Task 27이 마지막에 확인일을 맞춥니다.
