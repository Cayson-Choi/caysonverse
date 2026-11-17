# 마을 절 · 케이슨랜드 정문 (lots v2 B3) — 출처

2026-11-17. 비교 시트(`compare_exterior.jpg`, `compare_interior.jpg`, `../lot_gate/compare_gate.jpg`)의 왼쪽 실제 사진은 위키미디어 공용에서
HTTPS로 미리보기 크기(가로 1024 px)만 받아 비교에만 썼어요(게임에는 들어가지 않음). 저작자·라이선스는 시트 아래 글에도 적었어요.
구성만 참고했고 실제 절 이름·현판 글씨·경전 글귀·卍은 옮기지 않았어요. 케이슨 마을 현판은 "케이슨산", "대웅전"뿐이에요.

| 키 | 사진 | 저작자 | 라이선스 |
|---|---|---|---|
| tp_iljumun | [Iljumun at Buseoksa.jpg](https://commons.wikimedia.org/wiki/File:Iljumun_at_Buseoksa.jpg) | Bernard Gagnon | CC0 |
| tp_hall_bulguksa | [Daeungjeon, Bulguksa 01.jpg](https://commons.wikimedia.org/wiki/File:Daeungjeon,_Bulguksa_01.jpg) | Bernard Gagnon | CC0 |
| tp_hall_beomeosa | [Daeungjeon Hall of Beomeosa Temple 20200522 001.jpg](https://commons.wikimedia.org/wiki/File:Daeungjeon_Hall_of_Beomeosa_Temple_20200522_001.jpg) | Mobius6 | CC BY-SA 4.0 |
| tp_pagoda | [Three-story stone pagoda at Buseoksa.jpg](https://commons.wikimedia.org/wiki/File:Three-story_stone_pagoda_at_Buseoksa.jpg) | Bernard Gagnon | CC0 |
| tp_pond | [Yeonhwamot lotus pond.png](https://commons.wikimedia.org/wiki/File:Yeonhwamot_lotus_pond.png) | Thomas Housieaux | CC BY-SA 4.0 |
| in_hall_1 | [대웅전 내부 모습.jpg](https://commons.wikimedia.org/wiki/File:%EB%8C%80%EC%9B%85%EC%A0%84_%EB%82%B4%EB%B6%80_%EB%AA%A8%EC%8A%B5.jpg) | Euchan0224 | CC BY-SA 4.0 |
| in_hall_daedun | [구미 대둔사 대웅전 내부.jpg](https://commons.wikimedia.org/wiki/File:%EA%B5%AC%EB%AF%B8_%EB%8C%80%EB%91%94%EC%82%AC_%EB%8C%80%EC%9B%85%EC%A0%84_%EB%82%B4%EB%B6%80.jpg) | Cultural Heritage Administration | KOGL Type 1 |
| in_hall_seonbon | [선본사 대웅전 내부.jpg](https://commons.wikimedia.org/wiki/File:%EC%84%A0%EB%B3%B8%EC%82%AC_%EB%8C%80%EC%9B%85%EC%A0%84_%EB%82%B4%EB%B6%80.jpg) | HwangHuang | CC BY-SA 4.0 |
| in_ceiling | [Plafond temple Bongeunsa.jpg](https://commons.wikimedia.org/wiki/File:Plafond_temple_Bongeunsa.jpg) | Solène Huille | CC BY-SA 4.0 |
| in_dancheong | [Dancheong.JPG](https://commons.wikimedia.org/wiki/File:Dancheong.JPG) | Jjw | CC BY-SA 3.0 |
| gt_everland | [Entrance of Everland.jpg](https://commons.wikimedia.org/wiki/File:Entrance_of_Everland.jpg) | Christophe95 | CC BY-SA 4.0 |

## 게임 자산
- 질감: PBR 라이브러리 세트(모두 CC0) — `roof_giwa`, `granite_flamed`, `rock`, `dirt_path`, `grass`, `cast_iron`, `fabric_upholstery`, 그리고 B3가 더한
  `dancheong_wood`(직접 그린 단청 아틀라스, temple_dancheong.py), `wood_pine_natural`(Poly Haven hinoki_planks), `stone_wall_korean`(Poly Haven japanese_stone_wall).
  출처는 `docs/licenses.md`.
- 성물: 본존불·협시보살·후불탱화는 B3s 작업(feat/lots2-sacred) 그대로 — 출처·라이선스(CC BY 4.0, 공공누리 제1유형, CC0)는
  `docs/designs/village-lots-v2/tools/sacred/SOURCES.md`. 대웅전 GLB는 자리 표시(`lotstatue__`, `lotart__`)와 파일 이름(asset.extras.sacred)만 가져요.
- 소나무 4그루: 마을 식생 시스템에 소나무 종이 없어(`TREE_KINDS`: cherry, zelkova, green, young, willow, orchard) 절 GLB 안에 직접 만들었어요
  (줄기 충돌 상자 안에서 곧게 2.2 m, 위로 휘며 붉은 껍질, 층층 솔잎 구름). 소나무 종을 식생 시스템에 더하면 바꿔 끼울 수 있어요.
- 정문: L4(feat/lot-mart-gate 75ab7df) 키트를 가져와 v2 규칙(KTX2 라이브러리 세트, 때 없음)으로 다시 세웠어요. 매표 가격판(입장권·어른·어린이·자유이용권)은
  글자 없는 그림 지도판으로 바꿨어요(gate_goods.py).
- AI로 만든 3D·그림 없음.
