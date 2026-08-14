# 픽카이브 (Pickchive)

여러 커뮤니티(클리앙·뽐뿌·보배드림·82cook·인벤)의 인기글을 모아 보여주는 사이트.
이 문서는 Claude Code 외의 다른 에이전트/툴도 참조할 수 있도록 프로젝트 전체 맥락을 담는다.
새로운 결정/변경이 생기면 이 파일을 갱신할 것 (새 파일 만들지 말고).

- 라이브 사이트: https://pickchive.won0209.workers.dev
- GitHub: https://github.com/Jongseok0209/pickchive (public)
- Cloudflare 계정: won0209@gmail.com

## 아키텍처

```
GitHub Actions (5분마다) ─▶ pickchive-crawler (Workers) ─▶ D1 (pickchive-db)
                                                                  ▲
Astro SSR (pickchive, Workers+Assets) ────────────────────────────┘
  └─ 회원가입/로그인/댓글/신고도 같은 워커의 API 라우트
```

- **프론트+API**: `/` (루트) — Astro, `@astrojs/cloudflare` 어댑터, `output: "server"`. Worker 이름 `pickchive`.
- **크롤러**: `/workers/crawler` — 별도 Worker(`pickchive-crawler`), 5개 사이트 파서 + D1 upsert. HTTP로 수동/외부 트리거(`/crawl?site=X`, `/cleanup`) 가능.
- **DB**: Cloudflare D1 `pickchive-db` (`72c72958-3bcc-4c93-85c8-8f6e82c87022`). 마이그레이션은 루트 `/migrations`.
- **인증**: Astro Session(KV `SESSION`, 어댑터가 자동 프로비저닝) + 아이디/비밀번호(PBKDF2). 이메일·OAuth 없음, 비번 찾기 없음(의도적).
- **어뷰징 방지**: Cloudflare Turnstile(가입 시) + KV 기반 rate limit(`src/lib/ratelimit.ts`).

## 반드시 알아야 할 함정들

1. **`@astrojs/cloudflare` 최신 버전은 Pages가 아니라 Workers+Assets를 타겟팅한다.** `wrangler pages deploy`가 아니라 `wrangler deploy`로 배포. Pages 프로젝트를 따로 만들면 이름 충돌로 배포가 막힘(겪음 — 지움).
2. **빌드 캐시가 변경사항을 반영 안 할 때가 있다.** 배포 전 `rm -rf dist .astro node_modules/.vite` 후 재빌드하는 습관 들일 것. 실제로 이거 때문에 배포했는데 옛날 코드가 나간 적 있음.
3. **`cloudflare:workers`의 `env`는 전역 `Env`가 아니라 `Cloudflare.Env` 네임스페이스를 씀.** `src/env.d.ts`에서 `declare namespace Cloudflare { interface Env {...} }`로 확장해야 타입이 잡힘.
4. **Cloudflare Cron Trigger가 고장나있다 (2026-08 기준 알려진 플랫폼 버그).** API로는 정상 등록되는데 실제로 한 번도 발화 안 함 — 재배포/재등록/워커 삭제후재생성으로도 유저 쪽에서 못 고침. 그래서 **GitHub Actions(`.github/workflows/crawl.yml`, `cleanup.yml`)가 크롤러 HTTP 엔드포인트를 호출하는 방식으로 대체함.** `workers/crawler`의 `scheduled()` 핸들러 코드는 남겨뒀으니 Cloudflare가 버그를 고치면 `wrangler.jsonc`에 `triggers.crons`를 다시 추가하면 됨.
5. **`workers/crawler`에서 `wrangler` 명령 쓸 때 `--config wrangler.jsonc`를 명시해야 한다.** 상위 디렉토리(루트 프로젝트)의 `.wrangler/deploy/config.json`이랑 충돌해서 명시 안 하면 에러남.
6. **루리웹은 크롤링 대상에서 제외됨.** Cloudflare Workers 아웃바운드 IP를 차단하는지 HTTP 522가 계속 발생(로컬 curl은 정상 응답하는데 Workers에서만 막힘). 82cook으로 교체함.
7. **저작권 원칙: 본문/이미지 전체를 절대 가져오지 않는다.** 제목·링크·작성자·조회수·추천수·댓글수·시간 같은 메타데이터만 저장하고 원문은 항상 외부 링크로만 연결. "링크로 출처 표시하니 괜찮다"는 논리는 성립 안 함 — attribution과 저작권 라이선스는 별개. aagag(참고 모델)도 실제로 본문은 안 가져오고 목록만 미러링하는 것으로 확인됨(namu.wiki + 클리앙 유저 후기로 검증).
8. **fmkorea·MLBPark는 크롤링 대상에서 제외.** fmkorea는 robots.txt가 `anthropic-ai`/`ClaudeBot`을 명시적으로 차단(+ Cloudflare Turnstile로 실제 차단도 걸려있음). MLBPark는 robots.txt가 화이트리스트 봇 외 전체 차단. 신원 속여서 우회하지 않기로 함.
9. **82cook은 목록에 추천수 컬럼 자체가 없다.** `recommend_count`는 항상 0.

## 현재 상태 (2026-08-14 기준)

완료:
- [x] Astro+Cloudflare 스캐폴딩 (AstroPaper 테마 기반, 블로그 기능 제거)
- [x] D1 스키마 (sites/posts/rank_snapshots/users/comments/reports), 보관정책(글 30일/스냅샷 3일)
- [x] 5개 사이트 크롤러 (클리앙/뽐뿌/보배드림/82cook/인벤), GitHub Actions로 5분마다 자동 실행
- [x] 랭킹/시간필터 UI (3/6/12/24시간/주간 × 종합/급상승/조회수/추천수/댓글수)
- [x] 급상승(🔥) — 최근 2시간 조회수 증가량 기준, 임계값 300(가안)
- [x] 회원가입/로그인 (아이디+비번만) + Turnstile + rate limit
- [x] 댓글 + 신고(3회 누적시 자동 숨김) — `/p/[id]` 상세페이지
- [x] 제목 클릭 → 우리 상세페이지 이동 (원문은 상세페이지에서 새 탭으로 열도록 UX 개선)
- [x] 82cook 조회수 파싱 버그 수정 (날짜 셀이 조회수로 오인식되던 문제)

## 할 일 / 열린 질문

- [ ] **구글 애드센스 신청** — 모델 자체는 문제없다고 판단(제목+링크+자체 댓글 = Reddit/HN과 같은 카테고리). 다만 트래픽/콘텐츠(특히 댓글)가 어느 정도 쌓인 다음에 신청하는 게 현실적. 지금은 시기상조.
- [ ] **크롤링 사이트 추가 검토** — 오유(오늘의유머, robots.txt에 ClaudeBot 명시적 차단 있으나 anonymous UA는 허용된 것으로 판단됨, 미검증), SLR클럽(robots.txt 전체 차단, 제외 대상), 딴지일보 등. 사이트 늘릴 때마다 Workers 아웃바운드 차단 여부(루리웹 사례처럼) 반드시 실측 필요.
- [ ] **급상승 임계값(300) 튜닝** — 초기 추정치, 실데이터 쌓이면 재조정.
- [ ] **커스텀 도메인** — 현재 `pickchive.won0209.workers.dev` 무료 서브도메인만 사용 중. 트래픽 생기면 도메인 구매 고려.
- [ ] **git identity 설정** — 커밋이 자동 추정된 `삼호네 <tsh@...>`로 찍히고 있음. `git config user.name/email` 필요하면 설정.
- [ ] **Cloudflare Cron Trigger 버그 추이 확인** — Cloudflare가 플랫폼 버그를 고치면 GitHub Actions 대신 원래 방식(Cron Trigger)으로 되돌릴지 여부 재검토 (지금은 GitHub Actions로 잘 돌아가고 있어서 급하지 않음).
