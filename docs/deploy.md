# 배포 가이드

caysonverse(웹 3D 메타버스)의 배포·운영 방법입니다. DevOps 경험이 없어도 따라 할 수 있도록
단계별로 정리했습니다. **지금 운영은 Oracle Micro VM(서버) + Vercel(클라이언트)이고, 0장이 그
절차입니다.** 처음에 쓰던 Railway 방식은 1·2·4·6장에 "(예전 방식)"으로 남겨 두었습니다.
3·5·7장은 어느 쪽에나 해당합니다.

(예전 방식) Railway의 배포 설정은 저장소 루트 `railway.toml`에 코드로 들어 있습니다. 대시보드에서
따로 만질 필요가 거의 없고, 있는 경우 이 파일의 값이 대시보드보다 우선합니다.

---

## 0. 지금 운영 구성 (Oracle + Vercel)

운영은 **서버 = Oracle Cloud Micro VM, 클라이언트 = Vercel**로 나뉘어 있습니다. 서버를 올리는 일과 클라이언트를 올리는 일이 따로이고, 둘 다 사람이 손으로 합니다. 이 장의 값 중 비밀은 **변수 이름만** 적었습니다(값은 서버의 `/etc/caysonverse.env`에만 있고, 어디에도 출력하거나 붙여 넣지 않습니다).

| 부분 | 어디에 | 비고 |
|---|---|---|
| 서버 (Colyseus 방 + `/api/*`) | Oracle Micro VM, systemd 서비스 `caysonverse`, 체크아웃 `/opt/caysonverse` | `npm start`와 같은 `server/dist/index.cjs`를 실행 |
| 앞단 | Caddy 리버스 프록시 (자동 HTTPS) | `https://152-69-238-178.sslip.io` → Node `:2567` |
| 클라이언트 (정적 SPA) | Vercel | 빌드할 때 `VITE_SERVER_URL`로 서버 주소를 구워 넣음 |

- **Node가 듣는 곳**: 서버는 `PORT` 환경변수(없으면 2567)로 듣습니다. 코드는 `server.listen(PORT)`처럼 **포트만** 넘기고 호스트(`HOST`·localhost)를 지정하는 설정이 없어서, 별도로 막지 않으면 모든 네트워크 주소에서 받습니다(`server/src/index.ts`). 그래서 2567은 방화벽(Oracle 보안 목록·iptables)에서 바깥으로 닫고 80/443(Caddy)만 열어 두세요. 이유는 7장 "보안 노트"입니다.
- **Caddy**: 80/443에서 받아 인증서를 알아서 발급·갱신하고(자동 HTTPS) 같은 주소의 HTTP·WebSocket을 모두 Node `:2567`로 넘깁니다. sslip.io는 주소 속 IP를 그대로 이름으로 풀어 주는 무료 DNS라 도메인을 따로 사지 않아도 인증서가 나옵니다.
- **서버는 화면(SPA)을 주지 않습니다.** 서버 체크아웃에서는 클라이언트를 빌드하지 않으므로 `client/dist`가 없고(서버는 그 폴더가 있을 때만 SPA를 줍니다), 화면은 Vercel이 줍니다. 서버는 API·WebSocket만 맡습니다.

### 0.1 환경변수 (이름만)

서버가 읽는 변수입니다. 값은 `/etc/caysonverse.env`에 있고, 바꾸려면 `sudo`로 그 파일을 편집한 뒤 서비스를 다시 시작합니다(파일을 `cat`으로 화면에 찍지 마세요).

| 변수 | 뜻 | 없으면 |
|---|---|---|
| `PORT` | Node가 듣는 포트 | 2567 |

- **시험 전용 변수는 운영에서 설정하지 않습니다**: `CV_RECONNECT_WINDOW_S`(재접속 대기 시간 시험용 줄임)는 테스트에서만 씁니다.
- 예전에 있던 `ADMIN_CODE`·`TEACHER_KEYS_FILE`·`GROQ_*`·`NPC_VOICE`·`BANDIT_AI`는 방탈출·옛 월드 전용이라 코드와 함께 없앴습니다. 서버가 읽는 변수는 `PORT`(와 시험용 `CV_RECONNECT_WINDOW_S`)뿐입니다.
- **`DEBUG=colyseus:*`는 운영에서 절대 켜지 마세요.** Colyseus의 디버그 로그에는 입장 요청과 입장권이 찍힙니다.

### 0.2 서버 올리기 (Oracle)

서버에 SSH로 접속해서 합니다. `/opt/caysonverse`는 **얕은 복제(shallow clone)**라서 `git merge`·`git pull`이 "unrelated histories"로 실패합니다. 아래처럼 받아서 맞추세요.

1. **접속자가 없는지 먼저 봅니다.** 서비스를 다시 시작하면 모든 연결이 끊기고 열려 있던 반·교실이 사라집니다(5장).

   ```bash
   ss -Htn state established '( sport = :2567 )' | wc -l
   ```

   0이면 아무도 없는 것입니다(HTTP 요청이 지나가는 순간에는 1~2가 잠깐 보일 수 있으니 몇 초 뒤 다시 확인합니다). 계속 0이 아니면 사람이 있다는 뜻이니 수업 중인지 확인하고, 수업 중이면 기다립니다.

2. **코드를 맞추고 다시 만들고 다시 시작합니다.**

   ```bash
   cd /opt/caysonverse
   git fetch --depth 1 origin main && git reset --hard FETCH_HEAD
   npm ci --workspace=server --no-audit --no-fund
   npm run build -w server
   sudo systemctl restart caysonverse
   ```

   `git reset --hard`는 커밋되지 않는 파일(환경 파일)을 건드리지 않습니다. `git clean -x`는 쓰지 마세요(환경 파일이 지워집니다).

3. **확인합니다.**

   ```bash
   sudo systemctl status caysonverse --no-pager
   curl -s https://152-69-238-178.sslip.io/healthz      # {"ok":true}
   sudo journalctl -u caysonverse -n 50 --no-pager      # [caysonverse] listening on ... 한 줄이 보여야 함
   ```

### 0.3 클라이언트 올리기 (Vercel)

저장소 루트에서 합니다. 클라이언트는 빌드할 때 서버 주소를 번들에 굽습니다.

1. **빌드합니다.**

   ```bash
   VITE_SERVER_URL=https://152-69-238-178.sslip.io npm run build -w client
   ```

   (PowerShell이면 `$env:VITE_SERVER_URL = "https://152-69-238-178.sslip.io"; npm run build -w client`)

2. **번들에 정답이 새지 않았는지 검사합니다.** 종료 코드가 0이어야 올립니다.

   ```bash
   npx tsx --tsconfig server/tsconfig.json scripts/check-bundle-secrets.ts
   ```

3. **`client/dist`를 배포 폴더에 거울처럼 복사합니다.** 배포 폴더는 Vercel 프로젝트가 연결된 폴더입니다. `.vercel`(프로젝트 연결 정보)과 `vercel.json`은 지키고 나머지를 `client/dist`와 똑같이 맞춥니다.

   ```powershell
   robocopy client\dist <배포 폴더> /MIR /XD .vercel /XF vercel.json
   ```

   `/MIR`은 원본에 없는 파일을 지우므로 배포 폴더의 `.gitignore`(내용 한 줄: `.vercel`)도 지워집니다. 복사한 뒤 다시 만드세요.

4. **배포합니다.**

   ```powershell
   vercel deploy --prod --yes --scope caysons-projects-75ebc440 --cwd <배포 폴더>
   ```

   `--scope`를 빼면 "Not authorized"로 실패한 적이 있습니다.

   막히면 배포 폴더로 이동해서 `vercel deploy --prod --yes --scope caysons-projects-75ebc440`를 실행하세요(2026-11-02 배포에서 `--cwd` 형태가 실패하고 이 형태가 됐습니다).

   ```powershell
   cd <배포 폴더>
   vercel deploy --prod --yes --scope caysons-projects-75ebc440
   ```

5. **확인합니다.** 운영 주소의 `index.html`이 새로 만든 `assets/index-*.js`를 가리키는지 봅니다.

### 0.4 서버와 클라이언트는 연달아 올립니다

- 둘 사이에 틈을 두지 마세요. 서버만 새것이면 옛 번들 탭이 옛 형식으로 입장을 요청하고, 서버는 이를 거절하며 "새 버전이 나왔어요. 페이지를 새로고침(F5)해 주세요"라고 안내합니다(5장). 열어 둔 탭은 이 "새 버전" 안내가 뜨면 F5로 새로고침하면 됩니다.
- 코드가 바뀐 배포는 **수업이 없을 때** 합니다. 서버를 다시 시작하면 접속해 있던 사람은 잠시 재접속 화면을 거칩니다.
- 학교 GLB·라이트맵 주소에는 내용 해시(`?v=`)가 없어서(캐릭터 GLB에는 있습니다) GLB와 충돌 목록이 어긋난 채로 오래 두지 않도록 이 둘을 같은 시간에 올립니다.

### 0.5 케이슨 마을 (VillageRoom)

케이슨 마을 1단계(`docs/design.md` 38장)를 올릴 때 알아 둘 것입니다. 올리는 순서는 0.2~0.4와 같습니다: ① Oracle 얕은 복제 갱신 후 서버 다시 시작(0.2), ② 클라이언트 빌드(0.3), ③ Vercel 운영 배포(`D:/Codex/cayson-games/deploy/caysonverse`에서 `vercel deploy --prod --yes --scope caysons-projects-75ebc440`). 환경변수는 새로 필요한 것이 없습니다.

- **VillageRoom**: Colyseus 방 이름 `village`(`VILLAGE_ROOM`). 입장 때 반 코드가 없고, 마을 광장과 추모관이 **같은 방**(구역만 다름)입니다.
- **샤드 크기 30**: 한 방은 최대 30명(`VILLAGE_MAX_CLIENTS = 30`)이고, 가득 차면 새 방(샤드)이 열립니다. 가장 많이 찬 방부터 채우며, 31번째부터는 다음 방으로 갑니다. 방은 미리 만들어 두지 않고 첫 입장 때 열리며 비면 사라집니다. 재접속 창은 20초입니다.
- **서버 시각 동기**: 마을의 낮과 밤은 실제 한국 시간을 따릅니다. 서버가 입장 때와 5분마다(`SERVER_TIME_INTERVAL_MS`), 재접속 때도 현재 시각을 보내고 클라이언트는 그 차이로 자기 시계를 맞춥니다. 그래서 **서버 시계(Oracle의 NTP)가 맞아야** 합니다. 확인은 `timedatectl`에서 `System clock synchronized: yes`입니다.
- **새 정적 자산**(모두 `client/dist`에 들어가 Vercel이 줍니다, 서버는 주지 않습니다):
  - `models/village/`: `village.glb`(5.41 MB), `memorial.glb`, `memorial_props.glb`, 라이트맵 `village_lm.webp`·`village_lm_night.webp`·`memorial_lm.webp`
  - `audio/village/village_bgm1.mp3`(96 kbps, 약 2.16 MB, 첫 터치 뒤에 받음)
  - `village/voice/*.m4a`(안내원 음성 8개, 각 30~44 KB, 문의할 때만 받음)
  - 추모관 파일은 추모관에 들어갈 때만 받습니다. 마을 GLB 주소에는 내용 해시(`?v=`)가 없으므로 0.4처럼 서버와 클라이언트를 연달아 올립니다.
- **예산**(`e2e/village-perf.mjs`가 판정, 값은 `docs/loadtest.md` 10장): 첫 접속(배포 모양, gzip, BGM 포함) ≤ 15,000,000 B(측정 14,152,333~14,400,461 B, 최악 14,678,471 B), `village.glb` ≤ 8 MB·≤ 260k 삼각형, 메인 스레드 바쁜 시간 ≤ 33 ms/프레임. 에셋을 바꾸면 이 값을 다시 잽니다.
- **루트 주소가 케이슨 마을입니다.** "AI 학교 탈출"과 예전 월드(`?experience=escape`, `?world=legacy`)는 코드에서 없앴습니다. 그 링크로 들어와도 그냥 케이슨 마을이 열립니다.

---

## 1. 사전 준비 (예전 방식)

1. **GitHub 저장소**: 이 프로젝트를 GitHub 저장소에 푸시합니다.
   ```bash
   git push origin main
   ```
2. **Railway 계정**: <https://railway.com> 에서 GitHub 계정으로 가입합니다.
   (Railway는 사용량 기반 과금입니다. 무료 크레딧이 소진되면 유료 플랜이
   필요할 수 있으니 아래 6장 "사용량·비용 관리"를 먼저 읽어 두세요.)

---

## 2. 배포 절차 (예전 방식)

1. Railway 대시보드에서 **New Project → Deploy from GitHub repo** 를 선택하고
   이 저장소를 고릅니다.

   > ⚠️ **서비스는 반드시 1개여야 합니다.** Railway는 npm workspaces 모노레포를
   > 자동 감지해 `@caysonverse/server` 와 `@caysonverse/client` **두 개의 서비스**를
   > 만들자고 제안합니다(클라이언트 서비스의 시작 명령을 `npm run dev` 로 잡는
   > 잘못된 설정까지 포함). caysonverse 는 **서버 하나가 클라이언트 정적 파일까지
   > 같은 오리진에서 서빙**하는 단일 서비스 구조이므로, 배포 전 `Details` 화면에서
   > **`@caysonverse/client` 서비스는 Discard** 하세요.
   >
   > 남은 `@caysonverse/server` 서비스에서도 Railway가 자동으로 채워 넣는
   > **Build Command / Start Command / Watch Patterns 는 모두 Discard** 하세요.
   > 이 값들은 워크스페이스 스코프(`--workspace=@caysonverse/server`)라 잘못됐고,
   > 지우면 아래 `railway.toml` 값이 그대로 적용됩니다. (특히 Watch Patterns
   > `["/server/**"]` 를 남기면 클라이언트 코드를 고쳐도 재배포되지 않습니다.)
   >
   > 최종적으로 남길 설정은 **Branch(main) / Repo / Builder(RAILPACK)** 3개뿐입니다.

2. Railway가 저장소의 `railway.toml`을 자동으로 읽어 다음을 설정합니다. 별도
   입력이 필요 없습니다.
   - 빌더: **Railpack** (Railway의 현재 기본 빌더)
   - 빌드 명령: `npm run build`
     (의존성 설치는 Railpack의 install 단계가 이미 `npm ci`로 처리합니다.
     여기서 `npm ci`를 또 부르면 이미 설치된 node_modules를 지우려다
     `EBUSY ... rmdir '/app/client/node_modules/.vite'` 로 빌드가 실패합니다 —
     실제 배포에서 확인된 사항입니다.)
   - 시작 명령: `npm start`
   - 헬스체크 경로: `/healthz`
   - Node 버전: `package.json`의 `engines.node`(`>=24`)를 Railpack이 읽어
     최신 **Node 24.x**를 설치합니다.
3. **환경변수 설정** — 서비스의 **Variables** 탭에서 아래를 추가합니다.

   | 변수 | 값 | 설명 |
   |---|---|---|
   | *(없음)* | | 케이슨 마을 서버는 필수 환경변수가 없습니다. |

   > ⚠️ **`PORT`는 직접 설정하지 마세요.** Railway가 런타임에 **`PORT=8080`** 을
   > 주입하며(Variables 탭에는 표시되지 않습니다 — 거기 보이는 건 `RAILWAY_*` 뿐),
   > 서버는 `process.env.PORT` 로 그 값을 그대로 사용합니다. 실제 배포 로그에서
   > `[caysonverse] listening on http://localhost:8080` 으로 확인했습니다.
   >
   > 따라서 아래 5번의 도메인 생성 시 **타깃 포트는 반드시 `8080`** 이어야 합니다.
   > (2567은 로컬 개발용 폴백값일 뿐입니다. 타깃 포트를 2567로 두면 배포는
   > 성공해도 공개 URL이 **502 Application failed to respond** 로 뜹니다 —
   > 실제로 겪고 고친 사항입니다.)


4. **헬스체크 경로**: `railway.toml`에 `/healthz`로 이미 지정되어 있습니다.
   Railway는 배포 후 이 경로가 HTTP 200을 반환할 때까지 기다렸다가, 200이
   확인되면 새 배포를 활성화합니다(기본 타임아웃 300초).

5. **도메인 발급 & 배포 확인**:
   - 서비스 **Settings → Networking → Generate Domain** 으로 공개 URL을
     만듭니다. **포트를 물어보면 `8080` 을 입력하세요** (Railway가 주입하는
     `PORT` 값 — 위 3번 설명 참고). WebSocket은 기본 HTTP 서비스에서 그대로
     동작합니다(추가 설정 불필요).
   - 브라우저에서 `https://<발급된-도메인>/healthz` 를 열어 `{"ok":true}`가
     보이면 서버가 정상입니다.
   - 루트 `https://<발급된-도메인>/` 에 접속하면 입장 화면(닉네임·캐릭터 선택)이
     나옵니다. 이 URL을 수강생들에게 공유하면 됩니다.

---

## 3. 로컬에서 프로덕션 모드 검증하기

배포 전에 프로덕션 실행 경로를 로컬에서 그대로 재현할 수 있습니다.
(Railway가 하는 일과 동일: 빌드 → `npm start` → 서버가 SPA를 같은 오리진에서
서빙.)

```bash
npm ci            # 깨끗한 설치 (node_modules 재생성, 워크스페이스 링크 포함)
npm run build     # server/dist/index.cjs + client/dist 생성
npm start         # 빌드된 서버 실행 (환경변수 없이 그대로)
```

그런 다음 확인합니다.

- `http://localhost:2567/healthz` → `{"ok":true}`
- `http://localhost:2567/` → 입장 화면이 뜨고, 입장 후 이동·채팅이 동작
- 포트를 바꿔서도 동작하는지: `PORT=8080 npm start` → `http://localhost:8080/`

> `npm start`는 `NODE_ENV`를 설정하지 않습니다. 서버는 `client/dist`가 존재하면
> 무조건 SPA를 서빙하므로, 별도 환경변수 없이 바로 동작합니다.

이 저장소에는 위 과정을 자동화한 E2E 스크립트가 있습니다(참고용):
`node e2e/task-13.mjs` — 빌드된 번들을 바로 실행해 `/healthz`, SPA 서빙,
입장·이동·채팅, `PORT=8080` 재기동까지 검증하고 스크린샷을 남깁니다.

---

## 4. 로그 보는 법 (예전 방식)

> 지금 운영(Oracle)의 로그는 0.2절의 `journalctl -u caysonverse`로 봅니다.

- Railway 대시보드에서 서비스를 열고 **Deployments** 탭 → 해당 배포의
  **View Logs** (또는 **Observability**)에서 빌드 로그와 런타임 로그를 볼 수
  있습니다.
- 서버는 부팅 시 `[caysonverse] listening on http://localhost:<PORT>` 를 출력합니다.
  이 줄이 보이면 서버가 정상적으로 떴다는 뜻입니다.

---

## 5. 배포 시 주의 — 전원 접속이 끊깁니다

> ⚠️ **새 배포(또는 재시작)는 접속 중인 모든 수강생의 연결을 끊고 월드를
> 초기화합니다.**

이 서버는 단일 월드 룸을 프로세스 메모리에 유지합니다(외부 DB 없음). 새 버전을
배포하거나 서비스가 재시작되면 새 프로세스가 뜨면서 기존 룸과 접속이 사라지고,
빈 월드가 새로 만들어집니다. 클라이언트는 자동 재접속을 시도하지만, 진행 중이던
위치·대화는 사라집니다.

**그래서 코드 변경 배포는 강의 시간이 아닐 때 하세요.** 강의 도중 푸시하면 전원이
튕깁니다.

**서버와 클라이언트는 강의 시간이 아닐 때 연달아 배포하고, 강사들에게 열어 둔 탭을
새로고침(F5)하라고 알려 주세요.** 서버와 클라이언트를 따로 올리는 구성이면 둘 사이에
틈을 두지 마세요. 배포 전 번들이 남은 탭은 재접속할 때 옛 형식으로 입장을 요청하고,
서버는 이를 거절하며 "새 버전이 나왔어요. 페이지를 새로고침(F5)해 주세요"라고 안내합니다
(캐릭터 3단계부터 입장 형식이 바뀌었습니다).

---

## 6. 사용량·비용 관리 (예전 방식)

Railway는 **사용량 기반 과금**입니다. 특히 이 프로젝트처럼 WebSocket으로
실시간 트래픽이 오가는 서비스는 **egress(하위 전송) 요금**(대략 GB당 $0.05)에
유의해야 합니다. 접속자가 많고 오래 켜 둘수록 비용이 늘어납니다.

- 대시보드 계정 설정의 **Usage / Billing** 에서 현재 사용량을 확인하고,
  **Usage alerts(사용량 알림)** 또는 **budget(예산 한도)** 를 설정해 두세요.
  한도에 가까워지면 알림을 받도록 하면 예상치 못한 청구를 막을 수 있습니다.
- 강의가 없는 동안에는 서비스를 **중지(sleep/remove)** 하거나 삭제해 두면
  비용이 발생하지 않습니다(단, 중지 후 다시 켜면 새 월드로 시작합니다).

---

## 7. 보안 노트

- 관리자 로그인·공지·강퇴, 선생님 키, 운영자 현황은 방탈출·옛 월드와 함께 없앴습니다(케이슨 마을에는 관리자가 없습니다).
- 서버는 Node 포트(기본 2567)를 직접 열어 두지 말고, 방화벽에서 80/443(Caddy)만 열어 두세요(또는 Node를 localhost에만 묶으세요).

---

## 참고

- 배포 설정 파일(예전 방식, Railway): 저장소 루트 `railway.toml`
- 환경변수 예시: 저장소 루트 `.env.example`
- 설계 문서: `docs/design.md` (8장 보안, 9장 안정성)
