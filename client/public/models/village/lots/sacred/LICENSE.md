# 성당·교회·대웅전 성물 소품 (B2s/B3s, 2026-11-17)

이 폴더의 GLB(KTX2 텍스처)는 아래 공개 자료로 만들었어요. AI로 만든 3D·그림은 없어요. 줄마다 원본 주소와 처리 방법은
`docs/designs/village-lots-v2/tools/sacred/SOURCES.md`, 한눈에 보는 목록은 `docs/licenses.md`.

- 성모상·성인상 2: 덴마크 국립미술관(SMK) 석고 주조 3D 스캔 KAS225, KAS1959, KAS82 — 퍼블릭 도메인(PDM 1.0)
- 협시보살: 국가유산청 "국가유산 3D 프린팅 데이터"(보물 제370호 울주 간월사지 석조여래좌상, 국보 제200호 금동보살입상) — **공공누리 제1유형(출처표시)**.
  표시 문구: "이 저작물은 국가유산청에서 공공누리 제1유형으로 개방한 '국가유산 3D 프린팅 데이터(국보 제200호 금동보살입상)'을 이용하였으며, 해당 저작물은 공공데이터포털(www.data.go.kr)에서 무료로 내려받을 수 있습니다."
- 색유리 사진: The Metropolitan Museum of Art Open Access 467933, 463649, 198995, 463580, 470299 — CC0
- 후불탱화: Cleveland Museum of Art 1998.120 — CC0
- 나무 십자가, 십자가의 길 판, 장미창 트레이서리, 납 테·철 띠, 탱화 틀, 대리석·금박 표면 굽기: 이 프로젝트에서 직접 제작
- 본존불 3D: "Gilt bronze statuette of Sakyamuni Buddha" by dluo — **CC BY 4.0** (https://zenodo.org/records/10225206)
- 십자고상 3D: "Crucified Christ" from St. Jadwiga's hospital, WirtualneMuzeaMalopolski — CC0 (https://zenodo.org/records/21567941)
- 대웅전 옆 벽 족자 2점: Cleveland Museum of Art 1918.542 "Tathagata Buddha" (조선, 19세기 후반) — CC0 (https://www.clevelandart.org/art/1918.542)
- 본존불 광배·두광(불꽃 모양 광배, 연꽃잎 두광): 이 프로젝트에서 직접 모델링 (`docs/designs/village-lots-v2/tools/sacred/build_mandorla.py`); 스캔에 붙어 있던 얇은 광배는 잘라냄

## 2026-11-18 성당·교회 실내 다듬기 (chapel/church pass)

- 성모상(`lotstatue__lot_chapel_nave_mary*.glb`)을 SMK KAS225의 **원본 해상도 스캔**(1.5M 삼각형, 76 MB STL,
  https://api.smk.dk/api/v1/download-3d/st74cw417_smk21-kas225-bruges-madonna.stl)에서 다시 구웠어요: PC 40,000 삼각형 · 2K 노멀/2K 색, 폰 9,000 삼각형 · 1K. 퍼블릭 도메인(PDM 1.0).
- 십자가의 길 14처(`lotart__lot_chapel_nave_station_01..14*.glb`): 조반니 도메니코 티에폴로 «십자가의 길» 동판화 14점(1749경), Cooper Hewitt, Smithsonian Design Museum — 퍼블릭 도메인(스미스소니언 오픈액세스 CC0).
  위키미디어 공용 «Print, Via Crucis - Station I … XIV, ca. 1749 (CH 18328435 … 18328471)»에서 받은 원본(2.6k x 4k)의 그림 부분을 잘라 틀에 넣었어요. 참나무 액자는 직접 제작.
- 교회 그림 3점(`lotart__lot_church_nave_*.glb`), 모두 퍼블릭 도메인(작가 사후 100년 이상):
  칼 블로흐 «산상수훈»(1877, 위키미디어 «Carl Bloch - The Sermon on the Mount.jpg»), 렘브란트 «탕자의 귀환»(약 1668, 위키미디어 «Rembrandt Harmensz. van Rijn - The Return of the Prodigal Son.jpg»),
  하인리히 호프만 «겟세마네의 그리스도»(위키미디어 «Christ in Gethsemane.jpg»). 도금 액자는 직접 제작.
- 만드는 스크립트: `docs/designs/village-lots-v2/tools/sacred/node/build_framed_art.mjs`(액자·그림 GLB), `tools/patch_room_art.py`(방 GLB에 자리·색유리 밝기 반영).
