# caysonverse 기획문서 (설계 스펙)

- 작성일: 2026-07-14
- 상태: 1차 버전(v1) 확정 — 구현 착수 기준 문서
- 작성 경위: 발주자(AI 강사)와의 브레인스토밍 대화로 요구사항을 확정하고, 기술 검증 리서치(라이브러리 버전·네트워크 설계·에셋 라이선스)를 거쳐 작성함

---

## 1. 프로젝트 개요

**caysonverse**는 웹 브라우저에서 링크 클릭만으로 접속하는 3D 메타버스다. 접속자는 닉네임과 캐릭터를 고르고 3D 공간에 입장해, 다른 접속자들과 함께 돌아다니고 머리 위 말풍선으로 대화한다.

- **운영자**: AI 강사 (1인 운영)
- **용도**: ① 강의/수업 공간 ② 수강생·커뮤니티 상시 라운지
- **핵심 가치**: 설치·가입 없는 즉시 입장, 실시간 현장감(아바타+말풍선), 강의 도구(공지·강퇴, 향후 화면공유)

### 1.1 v1 범위 (이번에 만드는 것)

| 기능 | 내용 |
|---|---|
| 게스트 입장 | 닉네임(2~12자) + 프리셋 캐릭터 4종 + 색상 선택 → 즉시 입장. 회원가입/DB 없음 |
| 3D 월드 | 하나의 맵에 라운지 + 강의실 두 구역, 걸어서 이동 |
| 실시간 동기화 | 최대 100명 동접, 아바타 위치·방향 실시간 표시 |
| 말풍선 채팅 | 채팅 시 머리 위 말풍선 6초 + 접이식 채팅 로그 |
| 이모지 리액션 | 👍 ❤️ 😂 👏 🎉 🙋 6종, 머리 위 3초 표시 |
| 강사용 관리 | 관리자 코드 입력 → 전체 공지 배너, 사용자 강퇴 |
| 모바일 | 가상 조이스틱 + 터치 카메라, 저사양 자동 최적화 |
| 재접속 | 순단 시 20초 내 자동 복귀 (같은 위치·캐릭터) |

### 1.2 v2 이후로 미루는 것

- 화면 공유/발표 (WebRTC) — 강의실 스크린 오브젝트는 v1에 미리 배치
- 음성 대화
- 계정/영속 저장(DB), 지속 밴
- 룸 분할·수평 확장 (100명 초과)

---

## 2. 사용자 시나리오

### 2.1 수강생 (게스트)
1. 강사가 공유한 링크 클릭 → 입장 화면
2. 닉네임 입력, 캐릭터 4종 중 선택, 색상(파스텔 팔레트) 선택 → [입장하기]
3. 라운지 스폰 지점에 등장. PC는 WASD/방향키 + 마우스 드래그 카메라, 모바일은 좌하단 조이스틱 + 터치 드래그
4. Enter(또는 채팅 버튼)로 채팅 → 내 머리 위 말풍선 + 로그 기록
5. 이모지 버튼으로 리액션
6. 강의 시간엔 강의실 구역으로 걸어가 착석 지점 근처에서 수업 참여

### 2.2 강사 (관리자)
1. 입장 화면에서 닉네임 등 입력 + [관리자 코드] 필드에 코드 입력
2. 서버가 환경변수 `ADMIN_CODE`와 대조(클라이언트 번들에 코드 미포함, 시도 5회/분 제한)
3. 관리자 UI 활성화: 전체 공지 작성(모든 화면 상단 배너, 늦게 입장해도 보임), 접속자 목록에서 강퇴
4. 강퇴된 사용자는 세션 denySet에 등록되어 즉시 재입장 차단(서버 재시작 전까지)

---

## 3. 기술 스택 (2026-07-14 기준 버전 검증 완료)

| 패키지 | 버전 | 핵심 주의사항 |
|---|---|---|
| Node.js | 24.x (Active LTS) | `engines: >=24`, Railway 빌드에도 고정 |
| colyseus (서버) | ^0.17.10 | 0.17 API: `defineServer`/`defineRoom`, `onDrop`/`onReconnect` 라이프사이클 |
| @colyseus/schema | ^4.0.27 | ⚠️ tsconfig `experimentalDecorators: true` + `useDefineForClassFields: false` 필수 — 누락 시 상태 동기화가 **조용히** 실패 |
| @colyseus/sdk (브라우저) | ^0.17.43 | ⚠️ 구 `colyseus.js`는 0.16에서 중단(개명). 0.17 서버와 프로토콜 비호환 |
| @colyseus/loadtest | ^0.17.8 | 100봇 부하 테스트 공식 도구 |
| react / react-dom | ~19.2.7 (틸드 고정) | fiber peer `<19.3` — 캐럿 금지 |
| @react-three/fiber | ^9.6.1 | 9.6 미만은 React 19.2 reconciler 불일치 |
| @react-three/drei | ^10.7.7 | v9는 React 18용 — 반드시 v10 |
| three (+@types/three) | ~0.185.0 | 0.x semver — three/fiber/drei 세트로만 업그레이드 |
| vite / @vitejs/plugin-react | ^8.1.4 / ^6.0.3 | Vite 8 = Rolldown 기반. `build.rolldownOptions` 사용 |
| typescript | ~5.9.3 | npm latest는 TS 7(API 미안정) — 5.9 고정 |
| zustand | ^5.0.14 | per-frame 데이터는 hook selector 금지 — transient subscribe/ref |
| nipplejs | ^1.0.4 | React 래퍼 없이 ref+useEffect 직접 통합 |

---

## 4. 아키텍처

```
브라우저 (React 19 + R3F 9)                Railway 단일 서비스 (Node 24)
┌──────────────────────────────┐  WebSocket  ┌──────────────────────────────┐
│ 입장화면(닉네임·캐릭터·색·관리자코드)   │◄──────────►│ Colyseus WorldRoom (단일 룸)      │
│ 3D 월드 (R3F, 60fps 렌더)         │ @colyseus/sdk│  · 서버 권위 상태, 10Hz patch      │
│ UI 오버레이(채팅·이모지·조이스틱·배너) │             │  · 이동 검증·채팅·공지·강퇴          │
│ 네트워크 상태는 React 밖 mutable Map│             │ express: 클라 dist 정적 서빙+SPA    │
└──────────────────────────────┘             └──────────────────────────────┘
                                               DB 없음(메모리만), PORT=env, 헬스체크
```

**모노레포 (npm workspaces)**

```
caysonverse/
├─ docs/           # 이 기획문서 등
├─ shared/         # 스키마 클래스(서버 전용 실행) + 메시지 타입/상수 (브라우저 안전 엔트리 분리)
├─ server/         # Colyseus 서버 (CJS/NodeNext, 데코레이터 tsconfig)
├─ client/         # Vite 8 + React 19 + R3F
└─ loadtest/       # @colyseus/loadtest 봇
```

- shared의 엔트리 분리 원칙: `shared/schema`(데코레이터 실행 — 서버 전용, 클라는 `import type`만), `shared/messages`·`shared/constants`(플레인 TS — 클라·서버 공용). 클라이언트 번들에 스키마 런타임 코드가 들어가지 않도록 배럴(barrel) 재수출 금지.
- 개발: vite dev(5173)에서 `/matchmake`·WS를 localhost:2567로 프록시, 서버는 tsx watch.
- 프로덕션: `vite build` → 서버가 `client/dist` 정적 서빙(+SPA fallback, `/matchmake`·모니터 경로 제외).

---

## 5. 네트워크 설계 (수치 검증됨)

- **patchRate = 100ms (10Hz)** — 기본 20Hz의 절반 비용. 보간으로 체감 차이 없음. 부족하면 66ms로 한 줄 변경
- **입력 모델**: 클라이언트가 자기 위치를 로컬에서 통합(조이스틱 즉각 반응) → 이동 중 10Hz로 `move {x, z, yaw}` 전송 + 정지 시 마지막 1회. 서버 검증:
  - NaN/비유한값 거부
  - 변위 ≤ maxSpeed × 경과시간 × 1.5 (순간이동 차단)
  - 보행 가능 AABB로 클램프 (맵 밖 차단)
  - 30 msg/s 초과 드롭
  - y는 서버 고정 (비행 원천 차단)
- **Player 스키마**: `nickname`(string, 입장 시 1회), `character`(uint8), `tint`(uint8), `x`·`z`(float32), `yaw`(float32), `connected`(boolean). 애니메이션 상태 필드 없음 — 클라가 보간 속도로 walk/idle 유도. 채팅은 상태 저장 금지(안티패턴)
- **대역폭**: 전원(100명) 이동 시 클라당 다운 ~24KB/s(≈200kbps) — 모바일 OK. 강의 모드(대부분 정지)는 델타 인코딩 덕에 5~20% 수준. 초과 시 int16 양자화 예비안
- **원격 보간**: 스냅샷 링버퍼(~10개) + 150ms 렌더 지연, yaw 최단호 lerp, 버퍼 고갈 시 250ms 외삽 후 idle, 3m 초과 이탈 시 스냅
- **기능별 전송 메커니즘**:

| 기능 | 메커니즘 | 제한 |
|---|---|---|
| 채팅 | `broadcast` | 200자, 5초당 3회(초과 시 조용히 드롭+개인 알림) |
| 이모지 | `broadcast` (uint8 인덱스) | 500ms당 1회 |
| 공지 | 루트 상태 필드 (`announcement`, `announcedAt`) | 늦게 입장해도 보여야 하므로 상태 |
| 강퇴 | `client.leave(4001)` + 메모리 denySet | onJoin에서 denySet 확인 |

- **재접속**: `onDrop`에서 `allowReconnection(client, 20)` — 20초 창(유령의 정원 점유 최소화). `reconnectionToken`은 sessionStorage, 실패 시 localStorage의 닉네임·캐릭터로 조용히 재입장. 접속 끊긴 아바타는 50% 투명 렌더
- **정원**: maxClients 110 (100 + 재접속 여유), 초과 시 "정원이 가득 찼습니다" 안내

---

## 6. 렌더링·성능 설계 (100 아바타, 모바일 30fps 목표)

- 캐릭터 GLB 4종을 1회 로드 → 플레이어마다 **SkeletonUtils.clone()** (일반 clone은 SkinnedMesh 파손)
- **색상 틴트**: 클론별 `material.clone()` + `material.color.set(tint)` — 텍스처는 공유(GPU 메모리 불변). multiply 틴트는 어두워지기만 하므로 프리셋 팔레트는 **밝은 파스텔 8색**(순백 = 원본)
- **AnimationMixer 스로틀**: 카메라 <10m 매 프레임 / 10~25m 3프레임당 1회(누적 delta 전달) / >25m·프러스텀 밖·정지·착석 시 정지. 강의실 최악 케이스(전원 착석·전원 화면 안)를 이 규칙이 구제
- **닉네임표·말풍선**: canvas 텍스처 THREE.Sprite (drei `<Html>` 100개는 모바일 사망). 20m 밖 닉네임 숨김, 동시 말풍선 30개 캡
- `<Canvas dpr={[1, 1.5]}>`, 모바일 그림자 전면 off + 블롭 섀도 쿼드, 데스크톱은 1024px directional 1개까지
- 조명: hemisphere + directional 2개, Lambert/Toon 계열 머티리얼 (멀티라이트 PBR 금지)
- SkinnedMesh `boundingSphere` 수동 지정 (애니메이션 중 팝아웃 방지)
- **네트워크 상태를 React state에 넣지 않는다** — React 밖 mutable Map에 기록, useFrame에서 ref로 읽어 Object3D에 직접 반영. React state는 입장/퇴장(마운트/언마운트)과 UI 전용. (100명×10Hz = 초당 1,000 setState 방지 — 최다 실수 포인트)

---

## 7. 월드·에셋 (전부 CC0, 출처·라이선스 검증됨)

### 7.1 월드 구성
- 단일 맵: **라운지**(야외 광장 감성 — 소파, 커피테이블, 화분) ↔ 통로 ↔ **강의실**(대형 스크린 + 책상·의자 열)
- 스폰: 라운지 입구. 충돌: 맵 경계 + 가구/벽 AABB (물리엔진 없음, 클라·서버 동일 상수 사용)
- 강의실 대형 스크린 = 일반 box mesh (v2 화면공유 텍스처 대비)

### 7.2 에셋

| 용도 | 에셋 | 라이선스 | 출처 |
|---|---|---|---|
| 캐릭터 4종 | KayKit Adventurers — Knight, Barbarian, Mage, Rogue (Ranger 예비) | CC0 1.0 | kaylousberg.itch.io/kaykit-adventurers (GLB 미러: github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) |
| 캐릭터 애니메이션 | 각 GLB에 ~75클립 내장 (Idle/Walking/Running/Sit/Wave/Cheer 등), 4종 공통 Rig_Medium 스켈레톤 | CC0 1.0 | 동일 팩 |
| 가구/환경 | Kenney Furniture Kit (140개, 네이티브 GLTF) | CC0 | kenney.nl/assets/furniture-kit |
| 스타일 보충(선택) | KayKit Furniture Bits | CC0 | kaylousberg.itch.io/furniture-bits |

---

## 8. 보안·어뷰징 대응 (익명 게스트 공간)

| 위협 | 대응 |
|---|---|
| 순간이동/스피드핵 | 서버 변위 클램프 + AABB + NaN 거부 |
| 채팅 도배 | 5초당 3회 + 200자 + 제어문자 제거 |
| 부적절 닉네임 | 길이 2~12자 + 문자셋 필터 (onJoin) |
| 관리자 코드 무차별 대입 | 서버 측 비교만(타이밍 세이프) + 시도 5회/분 제한 (IP별) |
| 강퇴 후 재입장 | 세션 denySet — 완전 차단은 계정 필요(v2 한계로 수용) |

**알려진 한계 (v1 수용):**
- 클라이언트 IP는 프록시 헤더(x-forwarded-for 등)로만 얻을 수 있어, **프록시 없는 환경(로컬 등)에서는 시도 제한이 전역 카운터로 동작**한다. 이 경우 공격자가 분당 5회 오답을 보내면 진짜 강사도 로그인이 잠길 수 있다. **Railway는 프록시 뒤에서 동작하므로 실배포에서는 IP별 제한이 정상 작동**한다 — 배포 문서에 명시할 것. **단, x-forwarded-for는 클라가 좌측 항목을 위조할 수 있으므로 서버는 신뢰 프록시(Railway 단일 홉)가 append한 _맨 오른쪽_ 홉을 실제 클라 IP로 선택한다**(server `clientIp.ts`). 신뢰 프록시가 2개 이상으로 늘면 이 "마지막 홉 = 클라" 가정을 재검토해야 한다.
- 강퇴 denySet은 **닉네임 키만** 사용한다(IP는 밴 키로 쓰지 않음). Railway 뒤에서 IP는 교실 전체가 공유하는 NAT 공인 IP이므로, IP로 밴하면 한 명 강퇴에 같은 IP를 쓰는 반 전체가 차단된다(F7). 닉네임 키는 강퇴당한 사용자의 동일 닉네임 재입장을 막으면서 다른 학생을 과차단하지 않는다. 대신 강퇴당한 사용자가 닉네임을 바꾸면 재입장이 가능하다(계정 없는 v1의 구조적 한계). IP는 관리자 코드 시도 제한(brute-force limiter)에만 계속 쓰인다.

---

## 9. 에러 처리·안정성

- 연결 끊김: "재연결 중..." 토스트 → reconnectionToken으로 자동 복귀 → 실패 시 조용히 신규 재입장 (지수 백오프)
- 서버 배포/크래시: 전원 접속 종료 + 상태 소실 (DB 없음 — v1 수용 리스크). 강의 시간 외 배포 원칙
- 정원 초과: 입장 화면에서 안내
- 헬스체크: express 라우트 (WS 엔드포인트 아님)

---

## 10. 비기능 요구사항

| 항목 | 목표 |
|---|---|
| 동시 접속 | 단일 룸 100명 (1 vCPU / 1GB에서 여유) |
| 프레임 | 데스크톱 60fps, 중급 모바일 30fps |
| 클라 다운스트림 | 최악 ≤30KB/s |
| 비용 | Railway usage 과금 — 월 $10~25 예상, 사용량 알림 설정 |
| 브라우저 | 최신 Chrome/Edge/Safari (WebGL2), 모바일 Safari/Chrome |

---

## 11. 구현 로드맵

1. 기획문서 저장 + git 초기화 (이 문서)
2. 모노레포 스캐폴딩 (workspaces, tsconfig, 버전 고정, dev/build 파이프라인)
3. 서버 코어 (WorldRoom, Player 스키마, move 검증) + 단위 테스트
4. 클라 코어 (입장 화면 → R3F 월드, 내 캐릭터 이동)
5. 원격 아바타 (보간, 클론/틴트, 닉네임표)
6. 월드 맵 (라운지+강의실, AABB 충돌)
7. 말풍선 채팅 → 8. 이모지 → 9. 관리자 → 10. 모바일 → 11. 안정성
12. 테스트 (단위 + 100봇 부하)
13. Railway 배포

## 12. 검증 계획

- 다중 브라우저 탭: 이동/말풍선/이모지/공지/강퇴 실시간 동기화 육안 확인
- 서버 단위 테스트: 이동 검증, rate limit, 강퇴, 정원, 재접속
- **부하 게이트**: loadtest 100봇 랜덤워크 30분 — CPU <50%(1vCPU), RSS <400MB, 클라당 ≤30KB/s
- 실기기: 중급 안드로이드에서 강의실 100 아바타 씬 30fps 근접 확인
- 배포 후: 외부 URL 접속 + 모바일 실기기 조이스틱 확인

## 13. 알려진 리스크 (발주자 고지 완료)

1. 배포/크래시 시 전원 끊김+상태 소실 (DB 없음) — 강의 외 시간 배포로 완화
2. 익명 어뷰징 완전 차단 불가 (계정 없음) — rate limit·denySet으로 완화, v2에서 계정 검토
3. 구형 폰 프레임 저하 가능 — 30fps 목표 설계, 상용 서비스도 동일 한계
4. Railway egress 과금 변동 — 사용량 알림 설정
