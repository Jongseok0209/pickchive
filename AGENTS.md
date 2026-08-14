# 픽카이브 (Pickchive)

여러 커뮤니티(클리앙·뽐뿌·보배드림·82cook·인벤·오늘의유머·딴지일보·웃긴대학·이토랜드·엠팍·SLR클럽·펨코·다모앙·루리웹)의 인기글을 모아 보여주는 사이트.
이 문서는 Claude Code 외의 다른 에이전트/툴도 참조할 수 있도록 프로젝트 전체 맥락을 담는다.
새로운 결정/변경이 생기면 이 파일을 갱신할 것 (새 파일 만들지 말고).

- 라이브 사이트: https://pickchive.com (커스텀 도메인, 2026-08-15 연결) / https://pickchive.won0209.workers.dev (workers.dev, 계속 병행 유지)
- 크롤 상태 대시보드: https://pickchive.com/status — 사이트별 마지막 시도/성공, 24시간 실패 횟수를 심각도 순으로 보여줌
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
6-1. **펨코는 데이터센터 IP를 전부 차단한다 — GitHub Actions뿐 아니라 Cloudflare Workers도, 모바일(m.fmkorea.com)도 동일 (2026-08-15 확정).** `/debug-fetch`로 Workers에서 직접 찔러보면 HTTP 430 + "에펨코리아 보안 시스템" 페이지 — JS 챌린지가 아니라 순수 IP 평판 차단이라 Playwright로도 못 뚫음. RSS/API 우회 경로도 없음(`act=rss`도 그냥 HTML로 리다이렉트). 가정용 IP는 안 막혀 있어서, **상시 켜져 있는 맥미니에서 `scripts/crawl_fmkorea_home.mjs`를 launchd(`~/Library/LaunchAgents/com.pickchive.crawl-fmkorea.plist`, 5분 간격)로 돌려 `/ingest`에 직접 전송하는 방식으로 해결함(2026-08-15).** 헤드리스 브라우저 불필요 — plain fetch로 서버가 완성된 HTML을 그대로 줌. 조회수는 "5만" 같은 만 단위 축약이라 숫자만 남기면 5로 잘못 읽히니 별도 파싱 필요.
6. **펨코와 루리웹은 WAF(Cloudflare Turnstile/522 차단)로 인해 Worker 아웃바운드가 막힘.** GitHub Actions 내 Playwright 브라우저로 DOM 수집 후 `/ingest` API로 전달하는 방식으로 해결. 다모앙도 동일 — `/free` HTML 목록이 Cloudflare Turnstile로 막혀있어 일반 `fetch()`로는 우회 불가하지만 헤드리스 브라우저는 통과함(2026-08-14 확인).
7. **저작권 원칙: 본문/이미지 전체를 절대 가져오지 않는다.** 제목·링크·작성자·조회수·추천수·댓글수·시간 메타데이터만 저장하고 원문은 외부 링크로 연결.
8. **D1 SQL Variable 수 제한 (최대 100개 이하).** 140+ 개 이상의 포스트 업서트 시 40개 단위 `chunkArray`로 청킹하여 실행해야 에러 방지됨 (`workers/crawler/src/db.ts`).
9. **82cook은 목록에 추천수 컬럼 자체가 없음, ppomppu/todayhumor는 목록에 댓글수 컬럼 자체가 없음.** 해당 필드는 0/null이 정상이며 파싱 버그가 아니다.
10. **`scripts/crawl_protected.ts`는 CI에서 `npx tsx`로 실행되는데, `page.evaluate()` 콜백 안에 이름 붙은 함수(화살표 함수를 `const`에 대입하는 것 포함)를 선언하면 tsx(esbuild)가 브라우저 컨텍스트에 없는 `__name` 헬퍼를 참조해 매번 `ReferenceError`로 실패한다** (node로는 재현 안 됨, tsx 전용 버그, 2026-08-14 확인). evaluate 콜백 안에서는 텍스트만 추출하고, 숫자 변환 등은 콜백 바깥(일반 Node 스코프)에서 처리할 것.
11. **mlbpark(`mp/b.php?b=bullpen`)는 같은 요청을 반복해도 서버렌더링 HTML과 빈 클라이언트 렌더링 셸을 비결정적으로 번갈아 준다**(원인 미특정, 2026-08-14 재현 확인). `fetchMlbpark`가 빈 결과일 때 최대 3회 재시도하도록 되어있음. 추천수(`recommend_count`)는 정상 응답에서도 아직 셀렉터를 못 찾아 0으로 고정.
11-1. **오늘의유머도 mlbpark와 같은 비결정성이 있다** — 차단이 아니라 같은 요청도 서버가 빈 목록/정상 목록을 랜덤하게 섞어 줌(2026-08-14 밤 14시간 연속 0건이다가, 수동으로 두 번 연달아 찔러보니 그중 한 번은 정상 30건, `/debug-fetch`로 raw HTML 자체엔 데이터가 있는 것도 확인함). 기본 재시도 3회로는 실패율이 너무 높아 `todayhumor`만 6회로 늘림(`CRAWL_FETCHERS`의 `crawlSite` 네 번째 인자). 근본 원인(오늘의유머 서버 쪽)은 미해결.
12. **루트 `package.json`의 `deploy` 스크립트(`wrangler pages deploy ./dist`)는 함정 1번과 모순된다.** 실제로는 `wrangler deploy`를 써야 함 — 프론트 배포 시 스크립트를 그대로 믿지 말고 직접 확인할 것. (2026-08-15: `npm run deploy`를 아래 13번 패치까지 포함해 정리함. 이제 이 스크립트만 믿고 써도 됨.)
13. **Cloudflare Worker는 자기 자신의 공개 URL(`*.workers.dev`)로 `fetch()`할 수 없다 — 에러 1042(Worker to Worker Request 차단).** 크롤러의 `scheduled()`가 CPU 예산을 나누려고 사이트마다 자기 자신에게 subrequest를 보내던 방식이 이것 때문에 매번 전 사이트 404로 실패하고 있었음(Cloudflare Cron은 실제로 5분마다 발화하고 있었는데, 이 버그 때문에 GitHub Actions 백업만 동작하는 것처럼 보였던 것 — 2026-08-14/15 확인). subrequest 없이 같은 invocation 안에서 크롤 함수를 직접 호출하도록 수정(`CRAWL_FETCHERS` 맵).
14. **`@astrojs/cloudflare`가 빌드 시 만드는 `dist/server/wrangler.json`은 루트 `wrangler.jsonc`의 모든 필드를 옮기지 않는다 — `workers_dev`가 대표적으로 빠진다.** `routes`(custom_domain)를 추가하면 이 때문에 `workers.dev` 주소가 매 배포마다 조용히 꺼진다(에러 1042로 나타남, pickchive.com 연결 직후 확인). `scripts/patch-workers-dev.mjs`로 빌드 후 그 파일에 직접 주입해서 해결, `npm run deploy`에 포함됨.
15. **크롤러 워커에 `/debug-fetch?url=...` 진단 라우트가 있다.** Workers 쪽에서 특정 URL에 실제로 어떤 응답(상태코드/제목/본문 일부)을 받는지 바로 확인할 수 있음 — 사이트별 차단/비결정성 디버깅할 때 이것부터 찔러볼 것.

## 현재 상태 (2026-08-15 기준)

완료:
- [x] Astro+Cloudflare 스캐폴딩 (AstroPaper 테마 기반, 블로그 기능 제거)
- [x] D1 스키마 (sites/posts/rank_snapshots/users/comments/reports), 보관정책(글 30일/스냅샷 3일)
- [x] 14개 커뮤니티 사이트 크롤러 연동 (클리앙/뽐뿌/보배드림/82cook/인벤/오늘의유머/딴지일보/웃긴대학/이토랜드/엠팍/SLR클럽/펨코/다모앙/루리웹)
- [x] WAF 보호 사이트(펨코, 루리웹, 다모앙) Playwright Headless 브라우저 수집 + `/ingest` 파이프라인 구축 및 GitHub Actions 연동
- [x] 14개 전체 사이트 조회수·추천수·댓글수 파서 전수 점검 및 버그 수정 (2026-08-14) — humoruniv(중첩 `</tr>` 오매칭 + 속성값 섞임), etoland(크롤링 로직 부재), ddanzi(추천수가 항상 "16"으로 고정되던 버그), inven(댓글수 미추출), fmkorea(카드 레이아웃 셀렉터 불일치), damoang(RSS 한계 → Playwright 보강) 수정. mlbpark는 origin 비결정성으로 재시도 로직만 추가, 추천수는 미해결.
- [x] 글 수집 상대 시간 표시 (`N분 전 수집` / `방금 수집` UI) — 2026-08-15에 "게시 N시간 전 / 업데이트 N분 전"으로 대체됨, 아래 참고
- [x] 다중 패스 HTML Entity 디코딩 (`&amp;#039;`, `&#x...;` 이중 이스케이프 이스케이핑 해결)
- [x] 랭킹/시간필터 UI (3/6/12/24시간/주간 × 종합/조회수/추천수/댓글수)
- [x] 회원가입/로그인 (아이디+비번만) + Turnstile + rate limit
- [x] 댓글 + 신고(3회 누적시 자동 숨김) — `/p/[id]` 상세페이지
- [x] 제목 클릭 → 원문으로 바로 이동, "댓글 보기"는 별도 링크로 `/p/[id]` 상세페이지(픽카이브 자체 댓글) 이동 — 여러 방식(상세페이지 경유, 새 탭+상세페이지 동시 이동, 브라우저 히스토리를 이용한 "바운스") 실험 후 가장 단순한 이 방식으로 확정(2026-08-14)
- [x] 홈 피드 무한스크롤 상태 복원 — 탭이 메모리 부족 등으로 새로고침(discard)돼도 불러온 개수만큼 다시 불러오고 스크롤 위치 복원 (2026-08-14)
- [x] 소개(`/about`) 페이지 — 전체 14개 사이트 목록, 수집 방식, 필터 사용법, 종합 정렬 기준 설명 (2026-08-14)
- [x] 클리앙/딴지일보/웃긴대학을 진짜 "베스트/인기글" 소스로 전환 (2026-08-14) — 나머지 사이트(뽐뿌/다모앙/이토랜드/엠팍/82cook/인벤)는 미착수 또는 대안 없음, 아래 열린 질문 참고
- [x] 급상승(🔥) 기능 제거 (2026-08-14) — "정확히 2시간 전 스냅샷"이 있어야만 계산되는데 크롤 주기가 불규칙해서 대부분 글이 비교 자체가 안 되고(0으로 처리), 어쩌다 뜰 때도 어느 순간 스냅샷이 있고 없고에 따라 값이 들쭉날쭉해서 신뢰할 수 없었음. 관련 코드(TRENDING_THRESHOLD, viewGrowth, VIEW_GROWTH_SUBQUERY, sort=trending) 전부 제거.

- [x] SLR클럽 전 글 링크 깨짐 수정 (2026-08-14) — href의 `&amp;` 미디코딩으로 `?id=free&amp;no=123`이 저장돼 원문이 아닌 사이트 첫 화면으로 가던 문제(98/99건). 파서 수정 + upsert 시 URL 정규화 공통 적용 + 기존 71건 UPDATE 복구.
- [x] 크롤 "조용한 실패" 대응 (2026-08-14) — 0건 수집인데 HTTP 200이라 몇 시간씩 데이터가 멈춰도 몰랐던 문제. 공통 재시도(3회) + 0건이면 500 반환 + `crawl_runs` 기록 + `/health` 엔드포인트.
- [x] 크롤 스케줄러를 Cloudflare Cron(*/5)으로 전환 (2026-08-14) — GitHub Actions schedule이 실측상 평균 1시간 간격으로만 실행됨을 확인(GitHub의 스케줄 지연·병합 동작, 설정으로 해결 불가). Actions는 백업 및 Playwright 사이트 전용으로 유지.
- [x] 뒤로가기 시 목록/스크롤 복원 (2026-08-14) — 리스너 누수(뷰 트랜지션으로 제거 안 됨)와 Astro 자체 스크롤 복원 충돌 수정. 모바일·데스크톱, 외부·내부 링크 4경로 모두 실측 검증.

- [x] 홈 화면 제목 실시간 검색 (2026-08-15) — 페이지 이동 없이 타이핑 즉시 검색, 현재 걸린 기간/정렬/사이트 필터 범위 안에서만 동작(별도 검색 모드가 아니라 `getRankedPosts`에 제목 검색어를 추가 필터로 얹는 방식). 검색 중 필터를 바꿔도 검색어 유지, 검색 결과 글 눌렀다가 뒤로가기해도 검색 상태까지 복원. 기간 필터에 "1시간" 추가.
- [x] 필터 버튼 상호 오염 버그 수정 (2026-08-15) — 각 필터 버튼 href가 서버 렌더링 시점에 굳어있어서, 검색 중 JS로 필터 하나 바꾸면 다른 버튼들 href가 예전 조합으로 남아있던 문제("전체" 눌렀는데 기간이 엉뚱하게 바뀜). 필터 바뀔 때마다 현재 상태 전체 기준으로 모든 버튼 href 재계산하도록 수정.
- [x] 뒤로가기 bfcache 케이스 대응 (2026-08-15) — 외부 사이트 갔다가 브라우저가 페이지를 새로 안 불러오고 bfcache로 즉시 복원하면 `astro:page-load`가 재발화 안 해서 스크롤 복원 로직이 통째로 스킵되던 버그. `pageshow`(`event.persisted`) 감지로 수정.
- [x] 읽은 글 흐리게 표시 (2026-08-15) — localStorage 기반, 기기별로만 기억(로그인/DB 불필요).
- [x] "게시 N시간 전" / "업데이트 N분 전" 라벨 분리 (2026-08-15) — 기존 "N분 전 수집"이 실제로는 crawled_at(마지막 갱신 시각)인데 기간 필터는 first_seen_at 기준이라 화면 숫자와 필터 결과가 안 맞아 보이는 혼란이 있었음.
- [x] 크롤 상태 대시보드 `/status` 추가 (2026-08-15) — 사이트별 시도 안 함/실패 중/지연/정상을 심각도 순으로.
- [x] 크롤러 self-fetch 루프 차단(에러 1042) 수정 (2026-08-15) — 함정 13 참고. Cloudflare Cron이 5분마다 발화는 하고 있었는데 이 버그 때문에 매번 전 사이트 404였던 것. 고친 뒤 실측으로 5분 주기 정상 동작 확인.
- [x] 펨코 수집 재개 — 맥미니 launchd 우회 (2026-08-15) — 함정 6-1 참고. 데이터센터 IP 차단이라 Workers/GitHub Actions로는 원천적으로 불가능했던 것을, 상시 켜진 맥미니에서 직접 수집해 `/ingest`로 보내는 방식으로 해결.
- [x] 오늘의유머 재시도 6회로 증가 (2026-08-15) — 함정 11-1 참고. 근본 원인(서버 비결정성)은 미해결, 완화만 됨.
- [x] pickchive.com 커스텀 도메인 연결 (2026-08-15) — 함정 14 참고. `workers_dev` 유지되도록 빌드 후 패치 스크립트 추가.
- [x] 개인정보처리방침 `/privacy` 페이지 추가 (2026-08-15) — 구글 애드센스 신청 필수 요건 중 하나. 실제 수집 항목만 정확히 반영, 향후 광고 쿠키 조항 미리 포함.
- [x] 헤더 로그인/회원가입 링크 정렬 수정, 사이트 타이틀 "Pickchive"로 변경 (2026-08-15)

## 할 일 / 열린 질문

- [ ] **뽐뿌/다모앙 인기글 소스 전환 미완료** — 뽐뿌 `/hot.php`(사이트 전체 HOT, 컬럼 재사용이라 파서 재작성 필요), 다모앙 `/empathy`(공감글, 페이지 구조 파악은 끝났고 파서 미작성).
- [ ] **이토랜드/엠팍/82cook/인벤 인기글 소스 없음/보류** — 이토랜드 `/hit/list`는 핫딜(쇼핑 광고) 글이 섞여서 필터링 필요, 엠팍은 대안 자체를 못 찾음(기존 파싱 불안정 문제까지 있어 우선순위 낮음), 82cook은 애초에 추천/베스트 개념이 없는 사이트, 인벤은 현재(오픈이슈갤러리)도 어느 정도 큐레이션된 편이라 보류.
- [ ] **"종합" 정렬이 추천수 없는 사이트(82cook)에 불리한지 검증 필요** — `조회수 + 추천수×10` 공식상 recommend_count가 항상 0인 사이트는 view_count만으로 경쟁하게 되어 실제로 밀리는지 데이터로 확인 필요.
- [ ] **mlbpark 추천수 셀렉터 미확인** — 정상 응답을 받을 때의 실HTML을 확보해 클래스명 특정 필요.
- [ ] **오늘의유머 서버 비결정성 근본 원인 미확인** — 재시도 늘려서 완화만 한 상태, 원인 자체는 모름.
- [ ] **구글 애드센스 신청** — 개인정보처리방침은 완료. 애널리틱스 연동해서 실제 트래픽 확인 후 신청 검토 (사이트가 본문 없이 제목+링크만 있는 어그리게이터 구조라 콘텐츠 정책에 걸릴 수 있음도 염두에 둘 것).
- [ ] **인라인 댓글(펼쳐보기)** — 지금은 "댓글 보기" 누르면 `/p/[id]`로 이동. 목록에서 아코디언으로 바로 보고 쓰는 UX 아이디어 논의만 함(2026-08-15), 미착수. SSR용(PostRow.astro)/클라이언트 렌더링용(index.astro 무한스크롤·검색) 두 군데 다 손대야 함.
- [ ] **git identity 설정** — `git config user.name/email` 필요시 설정.

