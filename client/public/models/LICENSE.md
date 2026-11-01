# Model and brand assets

이 폴더(`client/public/models/`)의 캐릭터 모델과, 조립실 제목에 쓰는 로고의 출처와 라이선스입니다.

## character.glb — Cayson 토이 피규어

플레이어와 AI 조교가 모두 쓰는 캐릭터 모델 하나입니다. 부품(머리카락·모자·옷·신발·아이템·얼굴)은 같은 파일 안에 들어 있고, 입장 화면의 "캐릭터 조립실"에서 고른 부품만 남겨 그립니다.

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

## 가구 — `furniture/`

가구 모델의 출처와 라이선스는 `furniture/LICENSE.md`에 따로 적혀 있습니다.
