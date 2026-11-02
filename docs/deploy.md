# 배포 가이드

caysonverse(웹 3D 메타버스)의 배포·운영 방법입니다. DevOps 경험이 없어도 따라 할 수 있도록
단계별로 정리했습니다. **지금 운영은 Oracle Micro VM(서버) + Vercel(클라이언트)이고, 0장이 그
절차입니다.** 처음에 쓰던 Railway 방식은 1·2·4·6장에 "(예전 방식)"으로 남겨 두었습니다.
3·5·7·8장은 어느 쪽에나 해당합니다.

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

- **Node가 듣는 곳**: 서버는 `PORT` 환경변수(없으면 2567)로 듣습니다. 코드는 `server.listen(PORT)`처럼 **포트만** 넘기고 호스트(`HOST`·localhost)를 지정하는 설정이 없어서, 별도로 막지 않으면 모든 네트워크 주소에서 받습니다(`server/src/index.ts`). 그래서 2567은 방화벽(Oracle 보안 목록·iptables)에서 바깥으로 닫고 80/443(Caddy)만 열어 두세요. 이유는 8장 "보안 규칙"(시도 제한이 `X-Forwarded-For`를 믿기 때문)입니다.
- **Caddy**: 80/443에서 받아 인증서를 알아서 발급·갱신하고(자동 HTTPS) 같은 주소의 HTTP·WebSocket을 모두 Node `:2567`로 넘깁니다. sslip.io는 주소 속 IP를 그대로 이름으로 풀어 주는 무료 DNS라 도메인을 따로 사지 않아도 인증서가 나옵니다.
- **서버는 화면(SPA)을 주지 않습니다.** 서버 체크아웃에서는 클라이언트를 빌드하지 않으므로 `client/dist`가 없고(서버는 그 폴더가 있을 때만 SPA를 줍니다), 화면은 Vercel이 줍니다. 서버는 API·WebSocket만 맡습니다.

### 0.1 환경변수 (이름만)

서버가 읽는 변수입니다. 값은 `/etc/caysonverse.env`에 있고, 바꾸려면 `sudo`로 그 파일을 편집한 뒤 서비스를 다시 시작합니다(파일을 `cat`으로 화면에 찍지 마세요).

| 변수 | 뜻 | 없으면 |
|---|---|---|
| `ADMIN_CODE` | 관리자(강사) 로그인 코드이자 **운영자 키**(`POST /api/operator/status`, 선생님 키 칸) | 관리자·운영자 기능이 꺼짐 |
| `TEACHER_KEYS_FILE` | 선생님 키 파일(sha256만 든 JSON)의 절대 경로 또는 저장소 루트 기준 경로. 8장 참고 | `server/teacher-keys.json` |
| `GROQ_API_KEY` | AI 조교(`/api/npc-chat`)와 반딧 힌트 다듬기가 쓰는 Groq 키 | 조교 대화 요청이 503으로 막히고, 반딧 AI 다듬기는 켤 수 없음 |
| `GROQ_MODEL` (선택) | Groq 모델 이름 바꾸기 | 코드의 기본 모델 |
| `NPC_VOICE` (선택) | AI 조교(여성) 낭독 음성 바꾸기 | 코드의 기본 음성 |
| `BANDIT_AI` | 반딧 힌트 AI 다듬기. 정확히 `1`일 때만 켜짐 | 꺼짐 |
| `CV_MAX_CLASSES` (선택) | 서버 하나가 동시에 여는 반 수 한도 | 10 (`MAX_CLASSES_DEFAULT`) |
| `PORT` | Node가 듣는 포트 | 2567 |

- **시험 전용 변수는 운영에서 설정하지 않습니다**: `CV_MAX_CLIENTS`, `CV_RECONNECT_WINDOW_S`, `CV_CLASS_END_GRACE_MS`, `CV_CLASS_EMPTY_CLOSE_MS`, `CV_ESCAPE_INTRO_MS`, `CV_ESCAPE_EMPTY_DISPOSE_MS`, `CV_ESCAPE_END_GRACE_MS`는 테스트가 시간 규칙을 짧게 바꾸려고 쓰는 덮어쓰기입니다.
- **`BANDIT_AI`는 기본이 꺼짐**입니다(`.env.example`의 `BANDIT_AI=0`). 켜면(`BANDIT_AI=1`이고 `GROQ_API_KEY`도 있을 때만) 반딧 힌트를 Groq가 같은 뜻의 다정한 한 문장으로 **다시 말해 줍니다.** 힌트의 내용은 늘 정해진 문구가 기준이고, Groq에는 그 정해진 힌트 문장 한 개만 보냅니다(닉네임·채팅·학생 정보는 보내지 않습니다). 1.5초 안에 답이 없거나, 120자를 넘거나, 한글이 없거나, 정답·다른 힌트가 섞였으면 정해진 문구를 그대로 씁니다. 그러니 켜도 힌트마다 최대 1.5초가 더 걸릴 수 있고 Groq 요청이 한 번씩 나갈 뿐입니다. 판매 전에는 정식 상용 계약이나 대체 수단을 정합니다(기획 §10).
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

   `git reset --hard`는 커밋되지 않는 파일(선생님 키 파일, 환경 파일)을 건드리지 않습니다. `git clean -x`는 쓰지 마세요(키 파일이 지워집니다).

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
- 코드가 바뀐 배포는 **수업이 없을 때** 합니다. 서버를 다시 시작하면 열려 있던 반과 교실이 모두 사라지고, 선생님은 반을 다시 열어야 합니다(진행은 처음부터입니다).
- 학교 GLB·라이트맵 주소에는 내용 해시(`?v=`)가 없어서(캐릭터 GLB에는 있습니다) GLB와 충돌 목록이 어긋난 채로 오래 두지 않도록 이 둘을 같은 시간에 올립니다.

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
   | `ADMIN_CODE` | *(강사만 아는 비밀 코드)* | 관리자(강사) 로그인 코드. 미설정 시 관리자 기능이 비활성화됩니다. |

   > ⚠️ **`PORT`는 직접 설정하지 마세요.** Railway가 런타임에 **`PORT=8080`** 을
   > 주입하며(Variables 탭에는 표시되지 않습니다 — 거기 보이는 건 `RAILWAY_*` 뿐),
   > 서버는 `process.env.PORT` 로 그 값을 그대로 사용합니다. 실제 배포 로그에서
   > `[caysonverse] listening on http://localhost:8080` 으로 확인했습니다.
   >
   > 따라서 아래 5번의 도메인 생성 시 **타깃 포트는 반드시 `8080`** 이어야 합니다.
   > (2567은 로컬 개발용 폴백값일 뿐입니다. 타깃 포트를 2567로 두면 배포는
   > 성공해도 공개 URL이 **502 Application failed to respond** 로 뜹니다 —
   > 실제로 겪고 고친 사항입니다.)

   > `ADMIN_CODE`는 서버에서만 비교되며 클라이언트 번들에는 절대 포함되지
   > 않습니다(코드가 브라우저로 전송되지 않음). 값은 커밋하지 말고 Railway
   > 대시보드에만 넣으세요.
   >
   > **코드 강도 권장**: 무차별 대입은 분당 5회로 제한되지만, 코드 자체도
   > 16자 이상의 무작위 문자열을 쓰세요 (사전 단어·생일·전화번호 금지).
   > 생성 예: `node -e "console.log(require('crypto').randomBytes(16).toString('base64url'))"`

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

## 7. 보안 노트 — 관리자 로그인 시도 제한 (IP 기반)

관리자 코드 무차별 대입 방어는 **IP별 시도 제한**(분당 5회 실패)으로 되어
있습니다(`docs/design.md` 8장 참고). 이 제한이 IP별로 제대로 동작하려면 서버가
각 접속의 클라이언트 IP를 알아야 합니다.

- Colyseus 0.17에서 클라이언트 IP는 **소켓이 아니라 프록시 헤더**
  (`x-forwarded-for` / `x-client-ip` / `x-real-ip`)로만 얻을 수 있습니다.
  서버는 `onAuth`에서 `context.ip`를 이 헤더들로부터 해석합니다.
  근거(코드): 각 방의 `onAuth`(`WorldRoom`·`ClassRoom`)와 HTTP 경로(`/api/class/teacher` 등)가 모두
  `server/src/rooms/clientIp.ts`의 `resolveClientIp`를 씁니다. `resolveClientIp`은
  `context.ip`를 읽어 `x-forwarded-for`의 **맨 오른쪽** 값(바로 앞 프록시 Caddy가 붙인 실제 접속 IP)을
  사용합니다. 맨 앞(왼쪽) 값은 클라이언트가 마음대로 넣을 수 있어 믿지 않습니다(8장 "보안 규칙"과 같은 규칙).
- **프록시가 없는 로컬 환경**에서는 이 헤더가 없어 IP를 얻지 못하므로, 시도
  제한이 **전역 카운터**로 동작합니다(설계상 알려진 한계).
- **Railway(예전)와 Oracle(지금, Caddy)은 모두 프록시 뒤에서 동작**하므로 실제 배포에서는 `x-forwarded-for`가
  전달되고, 따라서 `context.ip`가 채워져 **IP별 제한이 정상 작동**합니다. 즉
  운영 환경에서는 이 방어가 의도대로 동작합니다.

> 로컬 프로덕션 검증(3장) 시에는 프록시가 없으므로 `context.ip`가 비어 전역
> 카운터로 동작하는 것이 정상입니다. IP별 동작은 프록시(=Caddy 또는 Railway)가 있어야
> 관측됩니다.

---

## 8. 선생님 키 발급

"AI 학교 탈출"에서 반을 여는 선생님은 **선생님 키**로 들어옵니다. 운영자가
선생님마다 키를 하나씩 만들어 전달합니다.

### 키 만들기

서버가 도는 컴퓨터에서, 저장소 루트에서 실행합니다(일반 `node`로 돌아갑니다).

```bash
node scripts/teacher-key.mjs --id saebit-4-2 --label "새빛초 4-2" --group saebit
```

| 옵션 | 뜻 |
|---|---|
| `--id` | 키 이름표. 영문·숫자·`-`·`_`, 40자 이내. 파일 안에서 겹치면 안 되고 `operator`는 쓸 수 없습니다. |
| `--label` | 운영자 현황에 보이는 이름(예: 학교·반). |
| `--group` (선택) | 같은 그룹 선생님끼리는 서로의 반 코드로 그 반에 선생님으로 들어갈 수 있습니다(교사 교대·보조 교사). `*`는 쓸 수 없습니다. |
| `--file` (선택) | 키 파일. 기본은 `TEACHER_KEYS_FILE`, 없으면 `server/teacher-keys.json`. |

스크립트는 `XXXX-XXXX-XXXX-XXXX` 모양의 키를 터미널에 **한 번만** 보여 주고,
파일에는 그 키의 **sha256 해시만** 덧붙입니다. 키를 잃어버리면 다시 볼 방법이
없으니 새 키를 만드세요.

선생님은 키를 **대·소문자, 띄어쓰기, `-`를 신경 쓰지 않고** 입력해도 됩니다
(`k7qx 2mpa 9trw 4hez`도 `K7QX-2MPA-9TRW-4HEZ`와 같은 키). 서버와 스크립트 모두
대문자로 바꾸고 띄어쓰기·`-`를 지운 뒤 해시를 비교합니다.

### 키 파일

- 형식: `{ "keys": [{ "id", "label", "group"?, "sha256" }] }` — 키 원문은 어디에도
  저장되지 않습니다.
- 위치: `TEACHER_KEYS_FILE`(절대 경로, 또는 **저장소 루트 기준** 상대 경로), 없으면
  `server/teacher-keys.json`. 서버를 어느 폴더에서 실행하든(`npm start`는 루트,
  `npm run dev`는 `server/`) 같은 파일을 읽고, 스크립트도 같은 규칙을 씁니다.
- `.gitignore`로 제외됩니다(`teacher-keys*.json`, e2e 픽스처만 예외). 커밋하지 말고
  서버에서 직접 만드세요.
- 서버는 요청마다 파일을 다시 읽습니다. 키를 더하거나 지울 때 서버를 다시 시작할
  필요가 없습니다.
- **키 회수**: 파일에서 그 항목을 지우면 그 키로는 더 이상 반을 열거나 들어갈 수
  없습니다(이미 진행 중인 수업은 그대로 둡니다).
- 배포할 때마다 디스크를 새로 만드는 곳(예: Railway)에서는 파일이 사라집니다.
  유지되는 디스크(볼륨)에 두고 `TEACHER_KEYS_FILE`을 그 절대 경로로 지정하세요.
  `git reset --hard`로 갱신하는 서버에서는 파일이 남지만 `git clean -x`는 지웁니다.

### 운영자 키와 현황

`ADMIN_CODE`(관리자 코드)는 운영자 키로도 쓰입니다.

- 선생님 키 칸에 넣으면 운영자로 어느 반이든 열거나 들어갈 수 있습니다.
- `POST /api/operator/status`에 `{ "operatorKey": "<ADMIN_CODE>" }`를 보내면 열린
  반(코드·이름·진행 단계·인원·팀·교실 수)과 서버 상태(메모리·CPU·이벤트 루프 지연·
  가동 시간) JSON을 받습니다. 1단계에서는 이 JSON이 운영자 "화면"입니다.
  코드가 셸 기록에도, 다른 사용자가 볼 수 있는 프로세스 인자(`ps`)에도 남지 않게,
  입력받은 값을 `printf`(셸 내장)로 표준 입력에 흘려 보내세요.

  ```bash
  read -rs OPKEY && printf '{"operatorKey":"%s"}' "$OPKEY" \
    | curl -s -X POST https://<서버 주소>/api/operator/status \
        -H 'content-type: application/json' --data-binary @-; unset OPKEY
  ```

  (권장 형식인 무작위 base64url 코드에는 `"`·`\`가 없어 위 JSON이 그대로 맞습니다.)

### 보안 규칙

- 키는 HTTP 요청 본문으로만 오고, 서버는 해시와만 비교합니다. 키·입장권·요청
  본문은 로그에 찍히지 않습니다(형식이 잘못된 JSON도 로그 없이 400).
- 게임 접속(Colyseus)에는 키 대신 **2분짜리 1회용 입장권**(`teacherPass`)만 실립니다.
- 틀린 키는 IP당 1분에 5번까지입니다(선생님 키·운영자 키 합산). 넘으면 1분 동안
  "시도가 너무 많아요"(429)로 막힙니다. IP는 관리자 로그인과 같은 코드
  (`resolveClientIp`)로, 프록시가 붙인 `X-Forwarded-For`의 맨 오른쪽 값을 씁니다.
- **Node 서버는 Caddy(리버스 프록시) 뒤에서만 받게 하세요.** 위 제한은
  `X-Forwarded-For`를 믿기 때문에, 바깥에서 Node 포트(기본 2567)로 바로 들어오면
  누구나 그 헤더를 지어내 IP를 바꿔 가며 제한을 피할 수 있습니다. 서버는 지금 모든
  네트워크 주소에서 듣고 있으므로, 방화벽(Oracle 보안 목록·iptables 등)에서 Node
  포트를 닫고 80/443(Caddy)만 열어 두세요(또는 Node를 localhost에만 묶으세요).
- 한 서버가 여는 반 수에는 한도가 있습니다(`CV_MAX_CLASSES`, 기본 10).

---

## 참고

- 배포 설정 파일(예전 방식, Railway): 저장소 루트 `railway.toml`
- 환경변수 예시: 저장소 루트 `.env.example`
- 설계 문서: `docs/design.md` (8장 보안, 9장 안정성)
