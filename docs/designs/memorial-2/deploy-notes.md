# 추모관 B단계 + 2차 W0 — Oracle 서버 준비 (배포 메모)

- 작성: 2026-11-16, 브랜치 `feat/mem-b`. **아직 배포하지 않았어요.** 이 메모는 서버에 무엇을 해 두어야 하는지예요.
- 이 저장소는 공개라서 값(비밀)은 하나도 적지 않았어요. 변수 이름만 있어요. 값은 `/etc/caysonverse.env`에만 넣고 화면에 찍지 마세요.

## 1. 무엇이 새로 생기나요

| 무엇 | 어디 | 메모 |
|---|---|---|
| SQLite 데이터베이스 | `/var/lib/caysonverse/caysonverse.db` (+ `-wal`, `-shm`) | Node 내장 `node:sqlite` 사용. 따로 설치하거나 컴파일할 것이 없어요. WAL 모드 |
| 사진 저장소 | `/var/lib/caysonverse/media/<2글자>/<id>_{1600,512,128}.webp` | EXIF(위치 포함)를 지운 WebP 세 크기 |
| 백업 | `/var/lib/caysonverse/backups/caysonverse-YYYYMMDD-HHMMSS.db` | `node scripts/backup-db.mjs` (아래 4장) |
| 새 HTTP 경로 | `/api/memorial/*`, `/media/p/*`, `/media/s/*`, `/admin/memorial` | Caddy는 지금처럼 모두 Node로 넘기면 돼요(설정 변경 없음) |
| 새 npm 패키지 | `sharp` 0.34 (server 워크스페이스) | 미리 빌드된 linux-x64 / linux-arm64 바이너리가 `package-lock.json`에 있어요. `npm ci --workspace=server`로 같이 깔려요 |

데이터 폴더는 **git 체크아웃(`/opt/caysonverse`) 밖**이라서 `git reset --hard`나 다시 받기로 지워지지 않아요.

## 2. 한 번만 할 일 (SSH)

1. **Node 버전 확인:** `node -v`가 **22.13 이상**(권장 24.x)이어야 `node:sqlite`가 플래그 없이 돼요. 24.x에서는 시작할 때 `ExperimentalWarning: SQLite`가 한 줄 찍힐 수 있는데 정상이에요.
2. **데이터 폴더 만들기** (서비스를 돌리는 사용자 이름은 `systemctl cat caysonverse`의 `User=`로 확인):
   ```bash
   sudo install -d -m 0750 -o <서비스사용자> -g <서비스사용자> /var/lib/caysonverse
   sudo install -d -m 0750 -o <서비스사용자> -g <서비스사용자> /var/lib/caysonverse/media /var/lib/caysonverse/backups
   ```
   - systemd 유닛에 `ProtectSystem=strict` 같은 막기가 있으면 `ReadWritePaths=/var/lib/caysonverse`를 더해 주세요(지금 유닛에 없으면 그대로 두세요).
   - 대신 `StateDirectory=caysonverse`를 유닛에 넣어도 같은 폴더를 systemd가 만들어 줘요.
3. **`/etc/caysonverse.env`에 변수 넣기** (`sudo nano`로 편집, `cat` 금지):

   | 변수 | 꼭? | 뜻 / 기본값 |
   |---|---|---|
   | `CV_DATA_DIR` | 선택 | 데이터 폴더. 기본 `/var/lib/caysonverse` |
   | `CV_DB_PATH` | 선택 | DB 파일. 기본 `$CV_DATA_DIR/caysonverse.db` |
   | `CV_MEDIA_DIR` | 선택 | 사진 폴더. 기본 `$CV_DATA_DIR/media` |
   | `CV_ADMIN_KEY_SHA256` | 검토하려면 꼭 | 운영자 검토 키의 **SHA-256(16진수 64자)**. 키 원문은 넣지 않아요. 없으면 검토 화면과 API가 404예요(사진은 쌓이고 공개만 안 돼요) |
   | `CV_MEDIA_SECRET` | 권장 | 검토 중 사진 서명 주소의 비밀(32자 이상 무작위). 없으면 켤 때마다 새로 만들어요(그때까지 나간 10분 주소만 끊겨요) |
   | `CV_MEMORIAL_OFF` | 비상용 | `1`이면 저장 없이 켜져요(추모관은 견본 칸·촛불만, 모시기는 "잠시 뒤에") |
   | `CV_FAKE_NOW` | **절대 넣지 않기** | 시험용 시계. 운영 서버에 있으면 시작 로그에 `TEST CLOCK ACTIVE`가 찍혀요 |

   검토 키 만들기(서버나 내 PC 어디서든, 키는 비밀번호 관리자에 보관):
   ```bash
   KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")
   printf '%s' "$KEY" | sha256sum | cut -d' ' -f1   # 이 64자만 CV_ADMIN_KEY_SHA256 에
   ```
   `KEY`는 그 터미널에만 남기고 어디에도 붙여 넣지 마세요(이 저장소, 채팅, 커밋 금지).
4. 배포 순서는 지금과 같아요(`docs/deploy.md` 0.2: 접속자 0명 확인 → `git fetch --depth 1` → `git reset --hard FETCH_HEAD` → `npm ci --workspace=server` → `npm run build -w server` → `sudo systemctl restart caysonverse`).
5. 켜진 뒤 확인:
   ```bash
   journalctl -u caysonverse -n 30 --no-pager | grep -E "memorial|TEST CLOCK"   # "[memorial] data store ready (0 claims)" 이어야 함
   curl -s https://<서버>/api/memorial/hall | head -c 120                       # {"claims":[],...}
   ls -l /var/lib/caysonverse                                                    # caysonverse.db, -wal, -shm, media/
   ```
   `[memorial] persistence unavailable: ...`가 찍히면 폴더 권한 문제예요. 게임은 그대로 돌아가고 모시기만 안 돼요.

## 3. 운영자 사진 검토

- 주소: `https://<서버>/admin/memorial` (Vercel이 아니라 **Oracle 서버 주소**). 검색엔진 막힘(noindex).
- 화면에서 검토 키(원문)를 넣으면 그 탭에만 기억돼요(sessionStorage). 사진마다 [공개하기] / [거절하기].
- 키가 틀리면 401, 10분에 10번 넘게 틀리면 잠시 막혀요(429).
- 공개 전 사진은 그 가족 기기와 운영자에게만 10분짜리 서명 주소로 보여요.

## 4. 백업 (매일 밤)

- DB: `node /opt/caysonverse/scripts/backup-db.mjs` — 실행 중에도 안전한 복사(`VACUUM INTO`), 무결성 검사, 최근 14개만 남김(`--keep=`).
- 사진: 파일이라 그대로 복사하면 돼요. 같은 VM의 디스크만으로는 백업이 아니므로 **Object Storage**로 보내는 걸 권장해요(설계 4-3). 무료 용량은 OCI 콘솔에서 확인한 뒤 정해요(확인 전 숫자는 적지 않았어요).
- 예시 (서비스 사용자의 crontab, 매일 새벽 4시 KST — VM 시간대가 UTC면 `0 19 * * *`):
  ```cron
  0 19 * * * CV_DATA_DIR=/var/lib/caysonverse /usr/bin/node /opt/caysonverse/scripts/backup-db.mjs >> /var/lib/caysonverse/backups/backup.log 2>&1
  10 19 * * * tar -C /var/lib/caysonverse -czf /var/lib/caysonverse/backups/media-$(date +\%u).tgz media
  ```
  Object Storage로 보내려면 `oci os object bulk-upload` 또는 `rclone`을 같은 시간에 더해요(자격 증명은 서버에만, 저장소에 넣지 않기).
- 되살리기: 서비스를 멈추고 → `caysonverse.db`, `-wal`, `-shm`을 옮겨 두고 → 백업 파일을 `caysonverse.db`로 복사 → 서비스 시작.
- **live DB 파일을 `cp`로 복사하지 마세요**(WAL 때문에 깨진 복사본이 될 수 있어요).

## 5. 용량과 메모리

- 사진 1장 ≈ 0.33 MB(세 크기 합). 무료 5장 × 368칸이 다 차도 약 0.6 GB.
- `df -h /var/lib/caysonverse`로 가끔 확인(70% 넘으면 정리 계획). 자동 경고는 memorial-2 W1에서 붙여요.
- 사진 처리는 서버 전체에서 한 번에 한 장(sharp 캐시 끔)이라 1 GB VM에서도 안전해요. 올리는 파일은 2 MB까지.

## 6. 클라이언트(Vercel)

- 바꿀 설정 없어요. `VITE_SERVER_URL`은 지금처럼 Oracle 서버 주소.
- 가족 초대 링크는 `https://<클라이언트>/?f=<12자>`라서 Vercel에 rewrite가 필요 없어요. `/f/<코드>` 모양도 쓰고 싶으면 배포 폴더의 `vercel.json`에 `{"source": "/f/:code", "destination": "/index.html"}`를 더하면 앱이 알아서 읽어요.
- 공유 링크 `/m/:code` → 서버 rewrite는 memorial-2 W5에서 더해요(설계 F6).

## 7. 2026-11-17 추모관 실내 다시 짓기

- 기억의 자리(아치 제단)를 없애고 그 자리에 C 구역(6열 x 8단, 48칸)을 넣었어요. 칸 id는 `M1-C-r<단>-c<열>`이고 마이그레이션 003이 `slot`에 넣어요(서버를 켜면 저절로). 기존 A·B·E 칸 id와 모신 기록은 그대로예요(A 구역은 5 cm 서쪽으로 옮겨졌지만 id로 찾으므로 영향 없음).
- 새 클라이언트 파일: `memorial.glb`, 라이트맵 4장, `memorial_props.glb`, `village/sample-photos/sample_1.webp`. 안내원 음성 `hall_desk_1~4.m4a`는 빠졌어요.
- 서버 쪽 새 설정은 없어요.

## 8. 접속 끊김·재시작

- 서버를 다시 켜도 모신 칸·사진·가족 기기는 DB에 남아요. 방(Colyseus)은 예전처럼 새로 시작해요.
- 기기 키는 브라우저 localStorage + IndexedDB 두 곳에 있어요. 둘 다 지워지면 복구 코드(모실 때 한 번 보여 줌)로 다시 연결해요.
