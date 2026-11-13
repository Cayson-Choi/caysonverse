# Model and brand assets

이 폴더(`client/public/models/`)의 캐릭터 모델과, 입장 화면 "캐릭터 조립실"이 쓰는 로고·배경 그림·글꼴의 출처와 라이선스입니다.

## character.glb — Cayson 토이 피규어

플레이어가 쓰는 캐릭터 모델 하나입니다. 부품(머리카락·모자·옷·신발·아이템·얼굴)은 같은 파일 안에 들어 있고, 입장 화면의 "캐릭터 조립실"에서 고른 부품만 남겨 그립니다.

- 메시·텍스처: 이 저장소의 오리지널 작업물입니다.
- 뼈대(`Rig_Medium`)와 기본 동작 클립 7개(`Idle`, `Walking_A`, `Running_A`, `Sit_Chair_Down`, `Sit_Chair_Idle`, `Sit_Chair_StandUp`, `Jump_Full_Short`)는 **KayKit Adventurers Character Pack (v1.0)** by **Kay Lousberg**(KayKit)에서 가져왔습니다.
  - License: **CC0 1.0 Universal** (public domain dedication) — 표기 의무는 없지만 감사의 뜻으로 적습니다.
  - Source: https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
  - Author site: https://kaylousberg.com/
- 변형 클립 6개는 위 KayKit 클립(CC0)을 바탕으로 이 저장소의 아트 작업에서 만든 파생 클립입니다.
  - 롱스커트용 3개(`Walking_A_LongSkirt`, `Running_A_LongSkirt`, `Jump_Full_Short_LongSkirt`): 다리 움직임만 줄였습니다.
  - 짧은 치마용 3개(`Walking_A_ShortSkirt`, `Running_A_ShortSkirt`, `Jump_Full_Short_ShortSkirt`): 보폭은 그대로 두고 뒤로 차올릴 때의 무릎 굽힘만 제한했습니다.

## 로고 — `../brand/cayson-logo-white.png`

입장 화면 조립실 제목에만 쓰는 흰색 "Cayson" 워드마크입니다. **Fredoka** 700 굵기(SIL Open Font License 1.1)로 만들었습니다. 1단계 텍스처 생성기 `gen.html`의 `meta.font`로 확인했습니다.

## 조립실 배경 그림 — `../entry/bg-desktop.{avif,webp}`, `../entry/bg-phone.{avif,webp}`

입장 화면 "캐릭터 조립실"의 케이슨 마을 광장 무대(받침대 뒤로 초승달 분수·벚꽃·집이 보이는 마을 광장) 그림입니다. 넓은 화면용(1600×900)과 세로 화면용(720×1280) 두 장이고, 화면마다 한 장만 받습니다.

- 출처: ChatGPT(OpenAI) 이미지 생성, 발주자 계정, 2026-11-10, 마을 1안. 2026-11-01 A안(밝은 하늘 정원) 그림을 받침대·화풍 참고로, 게임 속 케이슨 마을 화면을 풍경 참고로 함께 넣어 뒤 풍경만 마을로 바꿔 그리게 했습니다(그 A안 그림을 대신함).
- 손본 것: 받은 3:2 그림을 화면 비율(16:9, 9:16)로 잘라 받침대를 예전 자리에 맞추고(받침대 위치 값은 `client/src/ui/stageLayout.ts`), 배포용으로 크기를 줄여 AVIF·WebP로 다시 인코딩했습니다. 글자·사람·캐릭터·동물은 없습니다.
- 상업적 이용: 발주자의 출시 전 확인을 2026-11-02에 OpenAI 이용약관을 기준으로 마쳤습니다. 상업적 이용은 허용됩니다. 그림은 배타적이지 않아(다른 사용자도 비슷한 그림을 받을 수 있음) 독점권을 주장하지 않고, 사람이 만든 것처럼 소개하지 않습니다("AI로 만든 그림"이라고 밝힙니다). 자세한 내용은 `docs/licenses.md`의 "ChatGPT 생성 그림" 절입니다.

## 글꼴 — `../fonts/jua-builder.woff` (Jua)

조립실의 제목·묶음 이름·탭·프리셋 이름·버튼·안내에만 쓰는 제목용 글꼴입니다. 부품 카드 이름·닉네임 입력·알림은 본문 글꼴입니다.

- **Jua** — Copyright 2018 The Jua Project Authors (google/fonts). License: **SIL Open Font License 1.1** — 전문은 `../fonts/OFL-Jua.txt`.
- 조립실 고정 문구에 쓰인 글자만 남긴 부분집합(WOFF)입니다. `scripts/subset-builder-font.mjs`가 원본 `Jua-Regular.ttf`에서 만듭니다. 이름은 OFL의 예약 글꼴 이름이 없어 그대로 둡니다.
- 외부 글꼴 서버(Google Fonts 등)를 쓰지 않고 이 저장소에서 직접 보냅니다.
