# 집 실내 공용 텍스처 (realism pass 2026-11-17)

`hi/` (PC) · `lo/` (폰, 절반 크기)의 `T_h_*.webp`는 집 10채가 함께 쓰는 알베도예요. 각 `house_N.glb`에는 같은 이름의 128 px 사본만 들어 있고,
게임이 들어갈 때 이 파일로 바꿔 끼워요(`client/src/village/houseModelPrep.ts` `applyHouseTextures`). 만드는 법: `art/village/tools/houses/make_house_textures_real.py`.

| 파일 | 원본 | 라이선스 |
| --- | --- | --- |
| `T_h_floor_oak` (헤링본 원목 마루) | Poly Haven `herringbone_parquet` (https://polyhaven.com/a/herringbone_parquet) | CC0 1.0 |
| `T_h_floor_oakL` | Poly Haven `laminate_floor_02` (https://polyhaven.com/a/laminate_floor_02) | CC0 1.0 |
| `T_h_floor_dark` | Poly Haven `dark_wooden_planks` | CC0 1.0 |
| `T_h_plaster`, `T_h_wp*` (라임워시 벽 + 아래 판넬 몰딩(웨인스코팅)은 직접 그림) | Poly Haven `plastered_wall` + ambientCG `Wallpaper001A` 노멀 | CC0 1.0 |
| `T_h_wood_oak` | Poly Haven `oak_veneer_01` | CC0 1.0 |
| `T_h_wood_walnut` | Poly Haven `natural_walnut_veneer` | CC0 1.0 |
| `T_h_wood_dark` | Poly Haven `dark_wood` | CC0 1.0 |
| `T_h_wood_pine`, `T_h_logwall` (통나무 벽은 결만 쓰고 통나무 모양·틈은 직접 그림) | Poly Haven `coated_pine_02` | CC0 1.0 |
| `T_h_tile_white` (흰 서브웨이 타일) | Poly Haven `long_white_tiles` | CC0 1.0 |
| `T_h_tile_grey` (무늬 시멘트 타일, 무늬는 직접 그림) | 직접 제작(절차 생성) | 직접 제작 |
| `T_h_leather` | Poly Haven `brown_leather` | CC0 1.0 |
| `T_h_stone` (대리석·석재 상판, 난로 앞 받침) | Poly Haven `marble_01` | CC0 1.0 |
| `T_h_floral` (다마스크 리넨: 커튼·퀼트·쿠션) | Poly Haven `floral_jacquard` | CC0 1.0 |
| `T_h_check` (깅엄 체크 리넨: 체크 안락의자·쿠션·커튼, 체크 무늬는 직접 그림) | ambientCG `Fabric030` 노멀(짜임 요철) | CC0 1.0 |
| `T_h_fabric` | ambientCG `Fabric030` (https://ambientcg.com/view?id=Fabric030) | CC0 1.0 |
| `T_h_rattan` | ambientCG `Wicker007B` | CC0 1.0 |
| `T_h_rug` | ambientCG `Carpet016` | CC0 1.0 |
| `T_h_jangpan`, `T_h_paper`, `T_h_bamboo`, `T_h_jagae`, `T_h_leaf`, `T_h_atlas` | 직접 제작(절차 생성) | 직접 제작 |

게임은 집을 조명 없이(unlit) 라이트맵으로 그려서 노멀·거칠기 맵을 실시간으로 쓰지 않아요. 대신 스캔의 노멀과 AO로 만든 요철(널빤지 틈, 천의 짜임, 돌 줄눈)을
알베도에 구워 넣었어요.


## 집 액자 그림 (2026-11-20)

집 10채의 모든 액자(벽 액자, 갤러리 벽, 작은 탁상 액자)는 아래의 **퍼블릭 도메인** 명화예요. 작가는 모두 1954년 이전에 세상을 떠난 분들이고(저작권 만료), 그림 사진은 박물관·위키미디어 커먼즈가 CC0 / 퍼블릭 도메인으로 공개한 파일이에요. `T_h_art_<id>.webp`: `hi/` 긴 변 2048 px (PC), `lo/` 1024 px (폰). 만드는 법: `art/village/tools/houses/make_paintings.py` (원본 목록 `paintings_src.json`).

| 파일 (`T_h_art_…`) | 작가 | 작품 | 연도 | 출처 | 라이선스 |
| --- | --- | --- | --- | --- | --- |
| `starry_night` | Vincent van Gogh | The Starry Night | 1889 | https://commons.wikimedia.org/wiki/File:Vincent_van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg | Public domain (Wikimedia Commons, PD-Art) |
| `bedroom_arles` | Vincent van Gogh | Bedroom in Arles | 1888 | https://commons.wikimedia.org/wiki/File:Vincent_van_Gogh_-_De_slaapkamer_-_Google_Art_Project.jpg | Public domain (Wikimedia Commons, PD-Art) |
| `irises` | Vincent van Gogh | Irises | 1889 | https://commons.wikimedia.org/wiki/File:Irises-Vincent_van_Gogh.jpg | Public domain (Wikimedia Commons, PD-Art) |
| `cafe_terrace` | Vincent van Gogh | Cafe Terrace at Night | 1888 | https://commons.wikimedia.org/wiki/File:Vincent-van-gogh-cafe-terrace-on-the-place-du-forum-arles-at-night-the.jpg | CC0 1.0 (Wikimedia Commons; the painting is public domain) |
| `wheat_cypresses_met` | Vincent van Gogh | Wheat Field with Cypresses | 1889 | https://www.metmuseum.org/art/collection/search/436535 | CC0 1.0 (The Met Open Access, public domain) |
| `madame_roulin` | Vincent van Gogh | Madame Roulin and Her Baby | 1888 | https://www.metmuseum.org/art/collection/search/459123 | CC0 1.0 (The Met Open Access, public domain) |
| `la_berceuse` | Vincent van Gogh | La Berceuse | 1889 | https://www.metmuseum.org/art/collection/search/437984 | CC0 1.0 (The Met Open Access, public domain) |
| `vg_straw_hat` | Vincent van Gogh | Self-Portrait with a Straw Hat | 1887 | https://www.metmuseum.org/art/collection/search/436532 | CC0 1.0 (The Met Open Access, public domain) |
| `water_pitcher` | Johannes Vermeer | Young Woman with a Water Pitcher | ca. 1662 | https://www.metmuseum.org/art/collection/search/437881 | CC0 1.0 (The Met Open Access, public domain) |
| `dance_class` | Edgar Degas | The Dance Class | 1874 | https://www.metmuseum.org/art/collection/search/438817 | CC0 1.0 (The Met Open Access, public domain) |
| `woman_vase_flowers` | Edgar Degas | A Woman Seated beside a Vase of Flowers | 1865 | https://www.metmuseum.org/art/collection/search/436121 | CC0 1.0 (The Met Open Access, public domain) |
| `by_the_seashore` | Auguste Renoir | By the Seashore | 1883 | https://www.metmuseum.org/art/collection/search/437430 | CC0 1.0 (The Met Open Access, public domain) |
| `girls_at_piano` | Auguste Renoir | Two Young Girls at the Piano | 1892 | https://www.metmuseum.org/art/collection/search/459112 | CC0 1.0 (The Met Open Access, public domain) |
| `madame_charpentier` | Auguste Renoir | Madame Georges Charpentier | 1878 | https://www.metmuseum.org/art/collection/search/438815 | CC0 1.0 (The Met Open Access, public domain) |
| `card_players` | Paul Cézanne | The Card Players | 1890–92 | https://www.metmuseum.org/art/collection/search/435868 | CC0 1.0 (The Met Open Access, public domain) |
| `apples_primroses` | Paul Cézanne | Still Life with Apples and a Pot of Primroses | ca. 1890 | https://www.metmuseum.org/art/collection/search/435882 | CC0 1.0 (The Met Open Access, public domain) |
| `jas_de_bouffan` | Paul Cézanne | Trees and Houses Near the Jas de Bouffan | 1885–86 | https://www.metmuseum.org/art/collection/search/459092 | CC0 1.0 (The Met Open Access, public domain) |
| `great_wave` | Katsushika Hokusai | Under the Wave off Kanagawa (The Great Wave) | ca. 1830–32 | https://www.metmuseum.org/art/collection/search/39799 | CC0 1.0 (The Met Open Access, public domain) |
| `rembrandt_self_portrait` | Rembrandt van Rijn | Self-Portrait | 1660 | https://www.metmuseum.org/art/collection/search/437397 | CC0 1.0 (The Met Open Access, public domain) |
| `aristotle_homer` | Rembrandt van Rijn | Aristotle with a Bust of Homer | 1653 | https://www.metmuseum.org/art/collection/search/437394 | CC0 1.0 (The Met Open Access, public domain) |
| `jalais_hill` | Camille Pissarro | Jalais Hill, Pontoise | 1867 | https://www.metmuseum.org/art/collection/search/437299 | CC0 1.0 (The Met Open Access, public domain) |
| `manet_boating` | Edouard Manet | Boating | 1874 | https://www.metmuseum.org/art/collection/search/436947 | CC0 1.0 (The Met Open Access, public domain) |
| `haystacks_autumn` | Jean-François Millet | Haystacks: Autumn | ca. 1874 | https://www.metmuseum.org/art/collection/search/437097 | CC0 1.0 (The Met Open Access, public domain) |
| `village_ladies` | Gustave Courbet | Young Ladies of the Village | 1851–52 | https://www.metmuseum.org/art/collection/search/438820 | CC0 1.0 (The Met Open Access, public domain) |
| `harvesters` | Pieter Bruegel the Elder | The Harvesters | 1565 | https://www.metmuseum.org/art/collection/search/435809 | CC0 1.0 (The Met Open Access, public domain) |
| `view_of_toledo` | El Greco | View of Toledo | ca. 1599–1600 | https://www.metmuseum.org/art/collection/search/436575 | CC0 1.0 (The Met Open Access, public domain) |
| `repast_lion` | Henri Rousseau | The Repast of the Lion | ca. 1907 | https://www.metmuseum.org/art/collection/search/438822 | CC0 1.0 (The Met Open Access, public domain) |
| `ia_orana_maria` | Paul Gauguin | Ia Orana Maria | 1891 | https://www.metmuseum.org/art/collection/search/438821 | CC0 1.0 (The Met Open Access, public domain) |
| `circus_sideshow` | Georges Seurat | Circus Sideshow | 1887–88 | https://www.metmuseum.org/art/collection/search/437654 | CC0 1.0 (The Met Open Access, public domain) |
| `spanish_singer` | Edouard Manet | The Spanish Singer | 1860 | https://www.metmuseum.org/art/collection/search/436944 | CC0 1.0 (The Met Open Access, public domain) |
| `red_boy` | Francisco de Goya | Manuel Osorio Manrique de Zuñiga | 1787–88 | https://www.metmuseum.org/art/collection/search/436545 | CC0 1.0 (The Met Open Access, public domain) |
| `irises_met` | Vincent van Gogh | Irises | 1890 | https://www.metmuseum.org/art/collection/search/436528 | CC0 1.0 (The Met Open Access, public domain) |
