# caysonverse

웹 기반 3D 메타버스입니다. 클라이언트는 React Three Fiber, 서버는 Colyseus 0.17을 사용하며
npm workspaces 모노레포로 구성됩니다.

## 구조

- `shared/` — 서버·클라이언트 공용 코드
  - `schema.ts` — Colyseus 스키마(서버 전용 런타임). 클라이언트는 `import type`만 허용
  - `messages.ts` / `constants.ts` — 브라우저에서 안전하게 쓰는 상수·타입
- `server/` — Colyseus 게임 서버 (Express 헬스체크 + 프로덕션 정적 서빙)
- `client/` — Vite + React Three Fiber 클라이언트
- `loadtest/` — 100봇 부하 테스트 (@colyseus/loadtest 봇 + 측정 스크립트, docs/loadtest.md 참고)

## 요구 사항

- Node.js 24 이상 (개발 환경은 Node 24)

## 명령어

```bash
npm install       # 의존성 설치
npm run dev       # 서버(tsx watch) + 클라이언트(vite) 동시 실행
npm run build     # 서버 번들(server/dist/index.cjs) + 클라이언트 빌드(client/dist)
npm run typecheck # 전체 워크스페이스 타입 검사
npm run test      # vitest 테스트 실행 (스키마 스모크 테스트 포함)
npm start         # 빌드된 프로덕션 서버 실행 (client/dist가 있으면 SPA도 같은 오리진에서 서빙)
npm run loadtest  # 부하 테스트 봇 실행 (인자 pass-through, docs/loadtest.md 참고)
```

개발 시 클라이언트는 `client/.env.development`의 `VITE_SERVER_URL`(기본 `http://localhost:2567`)로
서버에 접속합니다. 프로덕션에서는 `VITE_SERVER_URL`이 없어 클라이언트가 `window.location.origin`을
사용하며, 서버가 클라이언트 정적 파일(`client/dist`)을 같은 오리진에서 서빙합니다. `npm run build` 후
`npm start`만 실행하면(별도 환경변수 불필요) SPA까지 서빙됩니다.

## 배포

Railway 배포 방법과 운영 팁은 [`docs/deploy.md`](docs/deploy.md)를 참고하세요.
배포 설정은 저장소 루트 `railway.toml`에 코드로 들어 있습니다.
