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
                                (펨코 / 루리웹 WAF 보호 사이트)
                                                                             ▲
Astro SSR (pickchive, Workers+Assets) ───────────────────────────────────────┘
  └─ 회원가입/로그인/댓글/신고도 같은 워커의 API 라우트
```

- **프론트+API**: `/` (루트) — Astro, `@astrojs/cloudflare` 어댑터, `output: "server"`. Worker 이름 `pickchive`.
- **크롤러**: `/workers/crawler` — 별도 Worker(`pickchive-crawler`), 14개 사이트 파서 + D1 upsert + `/ingest` POST 라우트. HTTP 수동/외부 트리거 가능.
- **WAF 우회 수집기**: `scripts/crawl_protected.ts` — GitHub Actions 내 Playwright Headless 브라우저로 펨코, 루리웹 수집 후 `/ingest` API로 업서트.
- **DB**: Cloudflare D1 `pickchive-db` (`72c72958-3bcc-4c93-85c8-8f6e82c87022`). 마이그레이션은 루트 `/migrations`. D1 파라미터 제약(100개 이하)을 고려해 batch query는 40개 단위로 청킹.
- **인증**: Astro Session(KV `SESSION`, 어댑터가 자동 프로비저닝) + 아이디/비밀번호(PBKDF2). 이메일·OAuth 없음, 비번 찾기 없음(의도적).
- **어뷰징 방지**: Cloudflare Turnstile(가입 시) + KV 기반 rate limit(`src/lib/ratelimit.ts`).

## 반드시 알아야 할 함정들

1. **`@astrojs/cloudflare` 최신 버전은 Pages가 아니라 Workers+Assets를 타겟팅한다.** `wrangler pages deploy`가 아니라 `wrangler deploy`로 배포. Pages 프로젝트를 따로 만들면 이름 충돌로 배포가 막힘.
2. **빌드 캐시가 변경사항을 반영 안 할 때가 있다.** 배포 전 `rm -rf dist .astro node_modules/.vite` 후 재빌드하는 습관 들일 것.
3. **`cloudflare:workers`의 `env`는 전역 `Env`가 아니라 `Cloudflare.Env` 네임스페이스를 씀.** `src/env.d.ts`에서 `declare namespace Cloudflare { interface Env {...} }`로 확장해야 타입이 잡힘.
4. **Cloudflare Cron Trigger 버그로 인해 GitHub Actions가 수집을 주도한다.** `.github/workflows/crawl.yml`이 5분마다 `pickchive-crawler` HTTP 엔드포인트 및 Playwright script(`crawl_protected.ts`)를 호출함.
5. **`workers/crawler`에서 `wrangler` 명령 쓸 때 `--config wrangler.jsonc`를 명시해야 한다.** 상위 디렉토리(루트 프로젝트)의 `.wrangler/deploy/config.json`과 충돌 방지.
6. **펨코와 루리웹은 WAF(Cloudflare Turnstile/522 차단)로 인해 Worker 아웃바운드가 막힘.** GitHub Actions 내 Playwright 브라우저로 DOM 수집 후 `/ingest` API로 전달하는 방식으로 해결.
7. **저작권 원칙: 본문/이미지 전체를 절대 가져오지 않는다.** 제목·링크·작성자·조회수·추천수·댓글수·시간 메타데이터만 저장하고 원문은 외부 링크로 연결.
8. **D1 SQL Variable 수 제한 (최대 100개 이하).** 140+ 개 이상의 포스트 업서트 시 40개 단위 `chunkArray`로 청킹하여 실행해야 에러 방지됨 (`workers/crawler/src/db.ts`).
9. **82cook은 목록에 추천수 컬럼 자체가 없음.** `recommendCount`는 0.

## 현재 상태 (2026-08-14 기준)

완료:
- [x] Astro+Cloudflare 스캐폴딩 (AstroPaper 테마 기반, 블로그 기능 제거)
- [x] D1 스키마 (sites/posts/rank_snapshots/users/comments/reports), 보관정책(글 30일/스냅샷 3일)
- [x] 14개 커뮤니티 사이트 크롤러 연동 (클리앙/뽐뿌/보배드림/82cook/인벤/오늘의유머/딴지일보/웃긴대학/이토랜드/엠팍/SLR클럽/펨코/다모앙/루리웹)
- [x] WAF 보호 사이트(펨코, 루리웹) Playwright Headless 브라우저 수집 + `/ingest` 파이프라인 구축 및 GitHub Actions 연동
- [x] 14개 전체 사이트 조회수·추천수·댓글수·작성자 파서 전수 점검 및 개편 (웃대학, SLR클럽, 엠팍, 이토랜드, 루리웹, 클리앙, 인벤 등)
- [x] 글 수집 상대 시간 표시 (`N분 전 수집` / `방금 수집` UI)
- [x] 다중 패스 HTML Entity 디코딩 (`&amp;#039;`, `&#x...;` 이중 이스케이프 이스케이핑 해결)
- [x] 랭킹/시간필터 UI (3/6/12/24시간/주간 × 종합/급상승/조회수/추천수/댓글수)
- [x] 급상승(🔥) — 최근 2시간 조회수 증가량 기준
- [x] 회원가입/로그인 (아이디+비번만) + Turnstile + rate limit
- [x] 댓글 + 신고(3회 누적시 자동 숨김) — `/p/[id]` 상세페이지
- [x] 제목 클릭 → 상세페이지 이동 (원문은 상세페이지에서 새 탭 이동)

## 할 일 / 열린 질문

- [ ] **구글 애드센스 신청** — 트래픽 및 댓글 쌓인 후 신청 검토.
- [ ] **급상승 임계값(300) 튜닝** — 실데이터 쌓이면 재조정.
- [ ] **커스텀 도메인** — 트래픽 발생 시 구매 고려.
- [ ] **git identity 설정** — `git config user.name/email` 필요시 설정.

