# 픽카이브 (Pickchive)

여러 커뮤니티(클리앙·뽐뿌·보배드림·82cook·인벤·오늘의유머·딴지일보·웃긴대학·이토랜드·엠팍·SLR클럽·펨코·다모앙·루리웹)의 인기글을 모아 보여주는 사이트.
이 문서는 Claude Code 외의 다른 에이전트/툴도 참조할 수 있도록 프로젝트 전체 맥락을 담는다.
새로운 결정/변경이 생기면 이 파일을 갱신할 것 (새 파일 만들지 말고).

- 라이브 사이트: https://pickchive.won0209.workers.dev
- GitHub: https://github.com/Jongseok0209/pickchive (public)
- Cloudflare 계정: won0209@gmail.com

## 아키텍처

```
GitHub Actions (5분마다) ─┬─▶ pickchive-crawler (Workers /crawl) ──────▶ D1 (pickchive-db)
                           │                                                 ▲
                           └─▶ Playwright Headless Browser ─▶ (/ingest) ────┘
                                (펨코 / 루리웹 WAF 보호, 다모앙 Turnstile 챌린지)
                                                                             ▲
Astro SSR (pickchive, Workers+Assets) ───────────────────────────────────────┘
  └─ 회원가입/로그인/댓글/신고도 같은 워커의 API 라우트
```

- **프론트+API**: `/` (루트) — Astro, `@astrojs/cloudflare` 어댑터, `output: "server"`. Worker 이름 `pickchive`.
- **크롤러**: `/workers/crawler` — 별도 Worker(`pickchive-crawler`), 14개 사이트 파서 + D1 upsert + `/ingest` POST 라우트. HTTP 수동/외부 트리거 가능.
- **WAF 우회 수집기**: `scripts/crawl_protected.ts` — GitHub Actions 내 Playwright Headless 브라우저로 펨코, 루리웹, 다모앙 수집 후 `/ingest` API로 업서트. 다모앙은 RSS(일반 크롤 경로, `fetchDamoang`)도 병행 — RSS는 title/author/date만 제공하니 Playwright가 조회수/추천수/댓글수를 덮어써서 보강하는 구조.
- **DB**: Cloudflare D1 `pickchive-db` (`72c72958-3bcc-4c93-85c8-8f6e82c87022`). 마이그레이션은 루트 `/migrations`. D1 파라미터 제약(100개 이하)을 고려해 batch query는 40개 단위로 청킹.
- **인증**: Astro Session(KV `SESSION`, 어댑터가 자동 프로비저닝) + 아이디/비밀번호(PBKDF2). 이메일·OAuth 없음, 비번 찾기 없음(의도적).
- **어뷰징 방지**: Cloudflare Turnstile(가입 시) + KV 기반 rate limit(`src/lib/ratelimit.ts`).

## 반드시 알아야 할 함정들

1. **`@astrojs/cloudflare` 최신 버전은 Pages가 아니라 Workers+Assets를 타겟팅한다.** `wrangler pages deploy`가 아니라 `wrangler deploy`로 배포. Pages 프로젝트를 따로 만들면 이름 충돌로 배포가 막힘.
2. **빌드 캐시가 변경사항을 반영 안 할 때가 있다.** 배포 전 `rm -rf dist .astro node_modules/.vite` 후 재빌드하는 습관 들일 것.
3. **`cloudflare:workers`의 `env`는 전역 `Env`가 아니라 `Cloudflare.Env` 네임스페이스를 씀.** `src/env.d.ts`에서 `declare namespace Cloudflare { interface Env {...} }`로 확장해야 타입이 잡힘.
4. **Cloudflare Cron Trigger 버그로 인해 GitHub Actions가 수집을 주도한다.** `.github/workflows/crawl.yml`이 5분마다 `pickchive-crawler` HTTP 엔드포인트 및 Playwright script(`crawl_protected.ts`)를 호출함.
5. **`workers/crawler`에서 `wrangler` 명령 쓸 때 `--config wrangler.jsonc`를 명시해야 한다.** 상위 디렉토리(루트 프로젝트)의 `.wrangler/deploy/config.json`과 충돌 방지.
6. **펨코와 루리웹은 WAF(Cloudflare Turnstile/522 차단)로 인해 Worker 아웃바운드가 막힘.** GitHub Actions 내 Playwright 브라우저로 DOM 수집 후 `/ingest` API로 전달하는 방식으로 해결. 다모앙도 동일 — `/free` HTML 목록이 Cloudflare Turnstile로 막혀있어 일반 `fetch()`로는 우회 불가하지만 헤드리스 브라우저는 통과함(2026-08-14 확인).
7. **저작권 원칙: 본문/이미지 전체를 절대 가져오지 않는다.** 제목·링크·작성자·조회수·추천수·댓글수·시간 메타데이터만 저장하고 원문은 외부 링크로 연결.
8. **D1 SQL Variable 수 제한 (최대 100개 이하).** 140+ 개 이상의 포스트 업서트 시 40개 단위 `chunkArray`로 청킹하여 실행해야 에러 방지됨 (`workers/crawler/src/db.ts`).
9. **82cook은 목록에 추천수 컬럼 자체가 없음, ppomppu/todayhumor는 목록에 댓글수 컬럼 자체가 없음.** 해당 필드는 0/null이 정상이며 파싱 버그가 아니다.
10. **`scripts/crawl_protected.ts`는 CI에서 `npx tsx`로 실행되는데, `page.evaluate()` 콜백 안에 이름 붙은 함수(화살표 함수를 `const`에 대입하는 것 포함)를 선언하면 tsx(esbuild)가 브라우저 컨텍스트에 없는 `__name` 헬퍼를 참조해 매번 `ReferenceError`로 실패한다** (node로는 재현 안 됨, tsx 전용 버그, 2026-08-14 확인). evaluate 콜백 안에서는 텍스트만 추출하고, 숫자 변환 등은 콜백 바깥(일반 Node 스코프)에서 처리할 것.
11. **mlbpark(`mp/b.php?b=bullpen`)는 같은 요청을 반복해도 서버렌더링 HTML과 빈 클라이언트 렌더링 셸을 비결정적으로 번갈아 준다**(원인 미특정, 2026-08-14 재현 확인). `fetchMlbpark`가 빈 결과일 때 최대 3회 재시도하도록 되어있음. 추천수(`recommend_count`)는 정상 응답에서도 아직 셀렉터를 못 찾아 0으로 고정.
12. **루트 `package.json`의 `deploy` 스크립트(`wrangler pages deploy ./dist`)는 함정 1번과 모순된다.** 실제로는 `wrangler deploy`를 써야 함 — 프론트 배포 시 스크립트를 그대로 믿지 말고 직접 확인할 것.

## 현재 상태 (2026-08-14 기준)

완료:
- [x] Astro+Cloudflare 스캐폴딩 (AstroPaper 테마 기반, 블로그 기능 제거)
- [x] D1 스키마 (sites/posts/rank_snapshots/users/comments/reports), 보관정책(글 30일/스냅샷 3일)
- [x] 14개 커뮤니티 사이트 크롤러 연동 (클리앙/뽐뿌/보배드림/82cook/인벤/오늘의유머/딴지일보/웃긴대학/이토랜드/엠팍/SLR클럽/펨코/다모앙/루리웹)
- [x] WAF 보호 사이트(펨코, 루리웹, 다모앙) Playwright Headless 브라우저 수집 + `/ingest` 파이프라인 구축 및 GitHub Actions 연동
- [x] 14개 전체 사이트 조회수·추천수·댓글수 파서 전수 점검 및 버그 수정 (2026-08-14) — humoruniv(중첩 `</tr>` 오매칭 + 속성값 섞임), etoland(크롤링 로직 부재), ddanzi(추천수가 항상 "16"으로 고정되던 버그), inven(댓글수 미추출), fmkorea(카드 레이아웃 셀렉터 불일치), damoang(RSS 한계 → Playwright 보강) 수정. mlbpark는 origin 비결정성으로 재시도 로직만 추가, 추천수는 미해결.
- [x] 글 수집 상대 시간 표시 (`N분 전 수집` / `방금 수집` UI)
- [x] 다중 패스 HTML Entity 디코딩 (`&amp;#039;`, `&#x...;` 이중 이스케이프 이스케이핑 해결)
- [x] 랭킹/시간필터 UI (3/6/12/24시간/주간 × 종합/급상승/조회수/추천수/댓글수)
- [x] 급상승(🔥) — 최근 2시간 조회수 증가량 기준
- [x] 회원가입/로그인 (아이디+비번만) + Turnstile + rate limit
- [x] 댓글 + 신고(3회 누적시 자동 숨김) — `/p/[id]` 상세페이지
- [x] 제목 클릭 → 상세페이지 이동 (원문은 상세페이지에서 새 탭 이동)

## 할 일 / 열린 질문

- [ ] **mlbpark 추천수 셀렉터 미확인** — 정상 응답을 받을 때의 실HTML을 확보해 클래스명 특정 필요.
- [ ] **프론트(pickchive 루트) 재배포** — 상대시간 표시 등 프론트 변경사항이 커밋만 되고 아직 배포 안 됨. 배포 시 함정 12번(`wrangler pages deploy`가 아니라 `wrangler deploy`) 주의.
- [ ] **구글 애드센스 신청** — 트래픽 및 댓글 쌓인 후 신청 검토.
- [ ] **급상승 임계값(300) 튜닝** — 실데이터 쌓이면 재조정.
- [ ] **커스텀 도메인** — 트래픽 발생 시 구매 고려.
- [ ] **git identity 설정** — `git config user.name/email` 필요시 설정.

