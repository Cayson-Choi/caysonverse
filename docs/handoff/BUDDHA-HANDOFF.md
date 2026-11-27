# 대웅전 본존불 얼굴 작업 — 다른 컴퓨터용 인수인계

이 문서는 케이슨 마을 대웅전 본존불(주불) 얼굴을 원본 참고 사진과 닮게 다듬는 작업을 다른 컴퓨터에서 이어 가기 위한 안내다.
작업 브랜치는 `feat/buddha-codex`이고, 이 브랜치만 건드린다. `main`에 합치거나 배포하지 않는다.

## 1. 지금 상태 (2026-11-21)

- 실제 사이트(cayson.xyz)에 올라가 있는 불상은 **13차**(커밋 `123f5db5`의 GLB)다.
- 이 브랜치의 최신은 **20차**(커밋 `28b71402`)다. 배포한 적 없다.
- 오너가 승인한 부분과 아직 남은 부분:

| 부위 | 상태 |
|---|---|
| 귀와 귀뿌리 주변 나발 | 16차에서 승인. **잠금** |
| 코 측면 윤곽(콧대선, 코끝 앞선) | 17차에서 승인. **잠금** |
| 콧대와 코 위·중간 | 18차 기준 유지 |
| 코밑 폭, 콧구멍 그림자 크기, 코끝 공 | 19차에서 원본과 거의 일치. 유지 |
| 양쪽 콧방울 | 20차에서 딱딱한 고리 홈은 없앴지만, 원본의 "통통한 공"보다 납작하고 경계가 흐리다. **다음 작업 대상** |
| 얼굴 윤곽, 볼, 턱, 눈, 눈썹, 입, 콧수염, 머리, 백호 | 13차 그대로. 오너가 따로 지적하기 전에는 손대지 않는다 |
| 협시보살 두 분 | 손대지 않는다 |

- 14차와 15차는 얼굴 전체를 넓히고 코를 뭉개서 폐기했다("얼굴을 더 엉망으로 만들어놓았네"). 16차는 13차에서 다시 시작했다.

## 2. 오너가 정한 방식 (꼭 지킨다)

1. **한 번에 한 부위만** 고친다. 그 부위 밖은 이전 차수와 픽셀 단위로 같아야 한다(차분 이미지로 증명).
2. 고치기 전에 원본의 그 부위를 2배 이상 확대해서 우리 것과 나란히 놓고, 무엇이 다른지 글로 정확히 적는다.
3. 결과는 **오너가 보는 배율**(코밑을 화면 가득 확대한 정면·측면)로 원본 | 이전 | 이번을 나란히 비교한다. 수치만 맞고 눈으로 다르면 실패다.
4. 승인된 부위는 잠근다. 이후 차수에서 다시 건드리지 않는다.
5. 오너가 직접 보고 승인하기 전에는 배포하지 않는다.
6. 이미지 → 3D 자동 생성이나 내려받은 스캔 모델은 쓰지 않는다(오너가 거절).

오너의 원본 코 관찰(브리프에 그대로 쓴 내용):
- 정면: 코 아래쪽은 둥근 덩어리 셋이다. 가운데 코끝 공, 양옆에 코끝만큼 큰 둥근 콧방울. 콧방울은 볼록한 살덩이이고 경계는 선이 아니라 넓고 부드러운 그림자다. 코밑 윤곽은 콧방울–코끝–콧방울로 세 번 볼록하다. 콧구멍은 콧방울과 코끝 사이 아래쪽의 작은 어두운 점이다.
- 측면: 콧방울이 아래 코 옆면 대부분을 차지하는 둥근 공이고, 그 뒤와 위로 부드러운 초승달 그림자가 있다. 코끝은 그 앞에 둥글게 있다.
- 금박은 한 가지 색으로 이어진다. 덧댄 조각처럼 색이 달라지면 안 된다.

## 3. 파일 위치

- 게임용 모델(이 네 파일이 결과물이다):
  - `client/public/models/village/lots/sacred/lotstatue__lot_temple_hall_buddha.glb` (PC)
  - `client/public/models/village/lots/sacred/lotstatue__lot_temple_hall_buddha_phone.glb` (폰)
  - 협시보살: 같은 폴더의 `..._bodhisattva.glb`, `..._bodhisattva_phone.glb` — **수정 금지**
- 제작·검증 스크립트: `docs/designs/village-lots-v2/tools/sacred/`
  - 차수별 조형: `node/buddha_nose16.mjs` … `node/buddha_nose20.mjs` (이전 차수 GLB의 정점을 직접 옮기는 방식)
  - 잠금 검증: `node/buddha_proof17.mjs` … `node/buddha_proof20.mjs` (정점·픽셀 차분)
  - 비교판: `node/buddha_board18.mjs` … `node/buddha_board20.mjs`
  - 묶기: `buddha_pack.mjs`, 측정: `buddha_measure.mjs`, 렌더: `buddha_studio.py` (Blender)
- 20차는 19차 GLB를 입력으로 삼아 `buddha_nose20.mjs`가 콧방울 정점 95개(PC)·23개(폰)만 옮겼다. 다음 차수도 같은 방식으로 `buddha_nose21.mjs`를 새로 만든다.

## 4. 저장소에 없는 것 (공개 저장소라서 뺐다)

원본 참고 사진과 오너가 보낸 확대 사진, 차수별 비교판은 **깃허브에 없다**. 저작권 확인 전이라 공개 저장소에 올리지 않는다.
오너가 `buddha-handoff` 폴더를 따로 옮겨 준다. 그 안에:

- `reference/` — 원본 사진과 부위별 확대(`ref-turnaround-face.webp`, `owner-reference-face.png`, `ref-nose.png`, `o-ref-front.png`, `o-ref-side.png`, `owner-ref-nose.png` 등)
- `passes/face16` … `passes/face20` — 차수별 비교판(`owner-crops.png`, `nose-pairs.png`, 차분), 보고서(`report.md`), 측정값
- `passes/codex_nose16.md` … `codex_nose20.md` — 차수별로 내렸던 지시문 원문

이 폴더는 저장소 밖(예: `D:\buddha-handoff`)에 두고, **절대 커밋하지 않는다.**

## 5. 한 차수를 진행하는 순서

1. `git checkout feat/buddha-codex && git pull`, `npm ci --allow-git=all`.
2. 원본과 최신 차수의 대상 부위를 같은 구도·배율로 확대해 나란히 놓고 차이를 글로 적는다.
3. `node/buddha_noseNN.mjs`를 새로 만들어 대상 부위 정점만 옮긴다(PC와 폰 둘 다, 좌우 대칭).
4. `buddha_proofNN.mjs`로 대상 부위 밖이 이전 차수와 같은지 증명한다(정점, 고정광 렌더 픽셀, 측면 윤곽 0px).
5. 비교판을 만든다: 원본 | 이전 차수 | 이번 차수, 정면 코밑과 측면 코밑, 오너 확대 배율. 고리선·덧댄 느낌·색 조각이 보이면 보고 전에 다시 고친다.
6. 게임 확인: 대웅전 걷기 e2e(`e2e/lots2-walk.mjs`)를 PC, 폰 순서로 **하나씩** 돌린다. 사찰 GLB 검사 `server/src/tools/lotTempleGlb.test.ts`도 돌린다. 게임 안에서 낮·밤, PC·폰 화면을 찍는다.
7. 커밋한다(아래 규칙). 푸시는 `feat/buddha-codex`로만.

주의:
- Blender는 `-t 4` 이하로 돌린다. 게임 e2e는 한 번에 하나만 돌린다(헤드리스 크롬이 CPU로 그려서 PC가 100%가 된다).
- 띄운 서버, vite, 크롬, Blender, 로그 감시 명령은 끝나면 바로 PID로 닫는다. 이름으로 한꺼번에 죽이지 않는다.
- `git stash`는 쓰지 않는다.

## 6. 결과를 돌려주는 방법

- 커밋 작성자: `Cayson-Choi <cayson0127@gmail.com>`. 커밋 메시지는 한국어로 무엇을 고쳤는지 한 줄.
- 커밋에 넣는 것: 바뀐 본존불 GLB 두 개, 새 스크립트.
- 커밋에 넣어도 되는 사진: **우리 모델만** 나온 렌더. `docs/designs/village-lots-v2/shots/buddha_passes/passNN/` 아래에 `front-nose.png`, `left-nose.png`, `right-nose.png`, `front-face.png`(고정광, 20차 비교판과 같은 구도·배율)와 `report.md`(무엇을 고쳤는지, 측정값, 잠금 검증 결과, 테스트 결과)를 넣는다.
- 커밋에 넣으면 안 되는 것: 원본 사진, 오너 사진, 원본이 들어간 비교판. 비교판은 `buddha-handoff/passes/faceNN/`에만 둔다.
- `git push origin feat/buddha-codex` 후 오너에게 "NN차 올렸어요"라고 알리면, 원래 컴퓨터의 Claude가 받아서 원본과 나란히 비교하고 오너에게 보여 준다.
