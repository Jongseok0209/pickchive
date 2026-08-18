# 픽카이브 (Pickchive)

여러 커뮤니티(클리앙·뽐뿌·보배드림·82cook·인벤·오늘의유머·딴지일보·웃긴대학·이토랜드·엠팍·SLR클럽·펨코·다모앙·루리웹)의 인기글을 모아 보여주는 사이트.
이 문서는 Claude Code 외의 다른 에이전트/툴도 참조할 수 있도록 프로젝트 전체 맥락을 담는다.
새로운 결정/변경이 생기면 이 파일을 갱신할 것 (새 파일 만들지 말고).

- 라이브 사이트: https://pickchive.com (커스텀 도메인, 2026-08-15 연결) / https://pickchive.won0209.workers.dev (workers.dev, 계속 병행 유지)
- 크롤 상태 대시보드: https://pickchive.com/status — **크롤 문제 진단은 여기부터 볼 것.** 크론 배치 진단(스케줄러 정상/멈춤/중간 사망) + 최근 수집 시도 시간순 로그(전 경로 통합, 시:분:초·에러 메시지) + 사이트별 요약. 상세는 함정 18 참고.
- GitHub: https://github.com/Jongseok0209/pickchive (public)
- Cloudflare 계정: won0209@gmail.com

## 아키텍처

```
Cloudflare Cron (1분마다 1개씩 로테이션) ─▶ pickchive-crawler (Workers) ──▶ D1 (pickchive-db)
                                                                              ▲
GitHub Actions (백업, 실측 20~60분 간격) ─┬─▶ /crawl?site=... ────────────────┤
                                          └─▶ Playwright ─▶ /ingest ─────────┤
                                               (루리웹 WAF, 다모앙 Turnstile)  │
                                                                              │
맥미니 launchd (5분마다, 한국 가정용 IP) ──▶ /ingest ──────────────────────────┤
  └─ 펨코, 오늘의유머 (둘 다 해외/데이터센터 IP 차단이라 여기서만 수집)         │
                                                                              ▲
Astro SSR (pickchive, Workers+Assets) ────────────────────────────────────────┘
  └─ 회원가입/로그인/댓글/신고도 같은 워커의 API 라우트
```

**수집 경로별 담당 사이트 (2026-08-18 기준)**

| 경로 | 사이트 |
|---|---|
| Cloudflare Cron + GitHub Actions | 클리앙, 뽐뿌, 보배드림, 82cook, 인벤, 딴지일보, 웃긴대학, 이토랜드, 엠팍, 다모앙 (10개) |
| GitHub Actions Playwright | 루리웹, 다모앙 |
| **맥미니 launchd (한국 홈 IP)** | **펨코, 오늘의유머, SLR클럽** (2026-08-18에 SLR클럽 추가) |

- **프론트+API**: `/` (루트) — Astro, `@astrojs/cloudflare` 어댑터, `output: "server"`. Worker 이름 `pickchive`.
- **크롤러**: `/workers/crawler` — 별도 Worker(`pickchive-crawler`), 14개 사이트 파서 + D1 upsert + `/ingest` POST 라우트. HTTP 수동/외부 트리거 가능. **크론은 CPU 제한 때문에 한 번에 1개 사이트만 처리하고 D1 커서로 이어간다 (함정 16 참고).**
- **WAF 우회 수집기**: `scripts/crawl_protected.ts` — GitHub Actions 내 Playwright Headless 브라우저로 루리웹, 다모앙 수집 후 `/ingest` API로 업서트. 다모앙은 RSS(일반 크롤 경로, `fetchDamoang`)도 병행 — RSS는 title/author/date만 제공하니 Playwright가 조회수/추천수/댓글수를 덮어써서 보강하는 구조. (펨코는 데이터센터 IP 차단으로 100% 실패라 2026-08-16에 제거 — 함정 6-1 참고.)
- **IP 차단 우회 수집기(맥미니)**: `scripts/crawl_fmkorea_home.mjs`(펨코), `scripts/crawl_todayhumor_home.mjs`(오늘의유머) — 각각 `~/Library/LaunchAgents/com.pickchive.crawl-{fmkorea,todayhumor}.plist`로 5분 간격 실행, 로그는 `~/Library/Logs/pickchive/`. **두 사이트 모두 Workers/GitHub Actions IP로는 원천적으로 수집 불가**(함정 6-1, 11-1). 워커 파서는 HTMLRewriter(Workers 전용)라 이쪽은 Node용 정규식 파서로 따로 구현되어 있다 — **파서 수정 시 양쪽 다 손봐야 한다.**
- **DB**: Cloudflare D1 `pickchive-db` (`72c72958-3bcc-4c93-85c8-8f6e82c87022`). 마이그레이션은 루트 `/migrations`. D1 파라미터 제약(100개 이하)을 고려해 batch query는 40개 단위로 청킹.
- **인증**: Astro Session(KV `SESSION`, 어댑터가 자동 프로비저닝) + 아이디/비밀번호(PBKDF2). 이메일·OAuth 없음, 비번 찾기 없음(의도적).
- **어뷰징 방지**: Cloudflare Turnstile(가입 시) + KV 기반 rate limit(`src/lib/ratelimit.ts`).

## 반드시 알아야 할 함정들

1. **`@astrojs/cloudflare` 최신 버전은 Pages가 아니라 Workers+Assets를 타겟팅한다.** `wrangler pages deploy`가 아니라 `wrangler deploy`로 배포. Pages 프로젝트를 따로 만들면 이름 충돌로 배포가 막힘.
2. **빌드 캐시가 변경사항을 반영 안 할 때가 있다.** 배포 전 `rm -rf dist .astro node_modules/.vite` 후 재빌드하는 습관 들일 것.
3. **`cloudflare:workers`의 `env`는 전역 `Env`가 아니라 `Cloudflare.Env` 네임스페이스를 씀.** `src/env.d.ts`에서 `declare namespace Cloudflare { interface Env {...} }`로 확장해야 타입이 잡힘.
4. **주 스케줄러는 Cloudflare Cron이고, GitHub Actions는 백업이다.** (초기엔 함정 13번 버그 때문에 Cron이 죽은 것처럼 보여 GH Actions가 주도했으나 2026-08-15에 정정됨.) GH Actions의 `schedule`은 5분으로 설정해도 **실측 20~60분 간격으로만 실행된다**(GitHub이 스케줄 이벤트를 지연·병합, 우리가 못 고침). 다만 GH Actions는 사이트마다 개별 HTTP 요청이라 CPU 누적이 없어 한 번에 전 사이트를 돌 수 있다는 장점이 있어 백업으로 유지한다.
5. **`workers/crawler`에서 `wrangler` 명령 쓸 때 `--config wrangler.jsonc`를 명시해야 한다.** 상위 디렉토리(루트 프로젝트)의 `.wrangler/deploy/config.json`과 충돌 방지.
6-1. **펨코는 데이터센터 IP를 전부 차단한다 — GitHub Actions뿐 아니라 Cloudflare Workers도, 모바일(m.fmkorea.com)도 동일 (2026-08-15 확정).** `/debug-fetch`로 Workers에서 직접 찔러보면 HTTP 430 + "에펨코리아 보안 시스템" 페이지. **(2026-08-18 정정: 이걸 "순수 IP 평판 차단이라 Playwright로도 못 뚫음"으로 적어뒀던 건 틀렸다 — 실제로는 JS+WASM 챌린지이고 헤드리스 브라우저로 통과된다. 함정 6-2 참고.)** RSS/API 우회 경로도 없음(`act=rss`도 그냥 HTML로 리다이렉트). 가정용 IP는 안 막혀 있어서, **상시 켜져 있는 맥미니에서 `scripts/crawl_fmkorea_home.mjs`를 launchd(`~/Library/LaunchAgents/com.pickchive.crawl-fmkorea.plist`, 5분 간격)로 돌려 `/ingest`에 직접 전송하는 방식으로 해결함(2026-08-15).** 헤드리스 브라우저 불필요 — plain fetch로 서버가 완성된 HTML을 그대로 줌. 조회수는 "5만" 같은 만 단위 축약이라 숫자만 남기면 5로 잘못 읽히니 별도 파싱 필요.

    **(2026-08-16 추가) 펨코를 GitHub Actions Playwright 경로에서도 완전히 제거했다.** 러너가 데이터센터 IP라 100% 차단되는데(24시간 50회 시도 전부 실패, 성공 0회), 이 실패 기록이 맥미니(홈 IP) 성공 기록과 같은 `crawl_runs`에 뒤섞이면서 **펨코가 "됐다 안 됐다" 하는 것처럼 보이게 만들어 원인 파악을 크게 방해했다.** 실패 메시지로 두 경로를 구분할 수 있다 — 맥미니는 `HTTP 430`, GH Actions Playwright는 `0 posts after retries. url=...listStyle=list title=에펨코리아 보안 시스템`. **성공할 수 없는 수집 경로는 남겨두지 말 것 — 노이즈가 진짜 문제를 가린다.**
6-2. **(2026-08-18 정정) 펨코의 430은 "순수 IP 평판 차단"이 아니라 JS + WebAssembly DDoS 챌린지다 — 6-1의 "Playwright로도 못 뚫음"은 틀린 진단이었다.** 차단 페이지 HTML을 실제로 열어보니 `"잠시 기다리면 사이트에 자동으로 접속됩니다"` + `<noscript>자바스크립트를 켜시길 바랍니다</noscript>` 였다. 동작 방식:

    1. HTTP 430 + `retry-after: 300` 으로 챌린지 페이지를 준다
    2. 인라인 JS가 `lite_year` / `g_lite_year` 쿠키를 심는다
    3. `<script type="module">`이 `/mc/mc.php`(WASM 글루, 실제 바이너리는 `/mc/mcw.php`)를 불러 `fm5(token, md5)`를 실행 — **이 WASM이 `document.cookie`를 직접 건드려 진짜 통과 쿠키를 만든다**(글루 코드의 `__wbg_setcookie` import가 증거)
    4. `?ddosCheckOnly=1` 붙여 리다이렉트

    **plain fetch로는 3번을 절대 재현할 수 없다.** 반대로 헤드리스 Chromium은 그냥 통과한다 — 실측으로 430 → 6초 후 "포텐 터짐 최신순", 21행 파싱 확인.

    **더 중요한 건, 못 푸는 채로 계속 두드리면 상태가 악화된다는 점이다.** 챌린지를 한 번도 통과 못 하는 클라이언트가 5분마다 계속 오니까 HTTP 429 `[보안 시스템에 의한 자동 차단]`(차단 종류 `D C`)으로 승격됐다. 그 429 페이지는 `국가: KR / 접속 종류: 유선 / 통신사: SK Broadband`까지 정확히 찍어준다 — **한국 가정용 IP인 걸 알면서 막은 것이므로 지리/IP 평판 문제가 아니라는 결정적 증거다.** 게다가 `retry-after`가 300초인데 launchd 주기도 정확히 300초라, 매 요청이 차단 해제 시점을 칼같이 노리는 패턴으로 보였다.

    **해결(`scripts/crawl_fmkorea_home.mjs`)**: 쿠키는 브라우저로 한 번만 따고 그 다음엔 plain fetch로 싸게 쓴다. 저장된 쿠키로 plain fetch → 챌린지에 걸릴 때만 Playwright 헤드리스로 풀고 쿠키 갱신 후 재시도 → 쿠키는 `~/Library/Application Support/pickchive/fmkorea-cookies.txt`에 보관. 챌린지 통과 후엔 `PHPSESSID` + `idntm5` 만으로 plain fetch가 200이다(실측). launchd 주기와 retry-after가 겹치지 않도록 스크립트 시작에 0~90초 무작위 지연도 넣었다.

    **교훈: "차단당했다"고 판단하기 전에 차단 페이지 HTML을 끝까지 읽어라.** 6-1은 상태코드(430)와 제목("에펨코리아 보안 시스템")만 보고 IP 차단으로 단정했는데, 같은 페이지 아래쪽에 "자바스크립트를 켜라"와 WASM import가 그대로 적혀 있었다. 그 한 번의 오진 때문에 "못 뚫는다"고 기록이 굳었고, 이후 넉 달 가까이 아무도 다시 확인하지 않았다.

6-3. **SLR클럽도 데이터센터 IP를 차단한다 (2026-08-18 확정) — 2026-08-16까지는 워커에서 잘 되던 사이트다.** 24시간 102회 중 96회 성공하던 게 어느 순간 116회 연속 실패로 바뀌었다. SLR클럽이 최근 차단을 건 것으로 보인다.

    | 나가는 곳 | 결과 |
    |---|---|
    | Cloudflare Workers (HKG 콜로, `/debug-fetch`) | **HTTP 404** — openresty 기본 404 페이지 |
    | Cloudflare Cron (CDG 콜로, 기록) | **HTTP 521** |
    | 맥미니 (SK Broadband, 인천) | **HTTP 200**, 글 링크 31건 |

    **UA 문제가 아니라는 건 한 번에 갈렸다** — 한국 IP에서는 `User-Agent`를 아예 안 보내도, `curl/8.7.1`로 보내도 전부 200이다. 순수 IP 기반 차단이다. 펨코의 JS 챌린지(6-2)와는 다른 부류이니 헷갈리지 말 것 — **이쪽은 브라우저를 띄워도 소용없다. IP를 바꾸는 것 말고는 방법이 없다.**

    맥미니 launchd 경로(`scripts/crawl_slrclub_home.mjs`, `com.pickchive.crawl-slrclub.plist`)로 옮겼고, **크론 로테이션과 GitHub Actions 워크플로에서는 제거했다**(성공할 수 없는 경로는 남기지 않는다 — 6-1 교훈). `/crawl?site=slrclub`은 수동 진단용으로 남아 있다.

    **교훈: 잘 되던 사이트가 갑자기 안 되면 우리 코드부터 뒤지지 말고, 먼저 한국 IP에서 같은 URL을 찔러봐라.** 맥미니에서 `curl` 한 번이면 "상대가 막았다 vs 우리가 깨졌다"가 즉시 갈린다.

6. **펨코와 루리웹은 WAF(Cloudflare Turnstile/522 차단)로 인해 Worker 아웃바운드가 막힘.** GitHub Actions 내 Playwright 브라우저로 DOM 수집 후 `/ingest` API로 전달하는 방식으로 해결. 다모앙도 동일 — `/free` HTML 목록이 Cloudflare Turnstile로 막혀있어 일반 `fetch()`로는 우회 불가하지만 헤드리스 브라우저는 통과함(2026-08-14 확인).
7. **저작권 원칙: 본문/이미지 전체를 절대 가져오지 않는다.** 제목·링크·작성자·조회수·추천수·댓글수·시간 메타데이터만 저장하고 원문은 외부 링크로 연결.
8. **D1 SQL Variable 수 제한 (최대 100개 이하).** 140+ 개 이상의 포스트 업서트 시 40개 단위 `chunkArray`로 청킹하여 실행해야 에러 방지됨 (`workers/crawler/src/db.ts`).
9. **82cook은 목록에 추천수 컬럼 자체가 없음, ppomppu/todayhumor는 목록에 댓글수 컬럼 자체가 없음.** 해당 필드는 0/null이 정상이며 파싱 버그가 아니다.
10. **`scripts/crawl_protected.ts`는 CI에서 `npx tsx`로 실행되는데, `page.evaluate()` 콜백 안에 이름 붙은 함수(화살표 함수를 `const`에 대입하는 것 포함)를 선언하면 tsx(esbuild)가 브라우저 컨텍스트에 없는 `__name` 헬퍼를 참조해 매번 `ReferenceError`로 실패한다** (node로는 재현 안 됨, tsx 전용 버그, 2026-08-14 확인). evaluate 콜백 안에서는 텍스트만 추출하고, 숫자 변환 등은 콜백 바깥(일반 Node 스코프)에서 처리할 것.
11. **mlbpark(`mp/b.php?b=bullpen`)는 같은 요청을 반복해도 서버렌더링 HTML과 빈 클라이언트 렌더링 셸을 비결정적으로 번갈아 준다**(원인 미특정, 2026-08-14 재현 확인). `fetchMlbpark`가 빈 결과일 때 최대 3회 재시도하도록 되어있음. 추천수(`recommend_count`)는 정상 응답에서도 아직 셀렉터를 못 찾아 0으로 고정.
11-1. **오늘의유머는 해외 IP를 HTTP 403으로 차단한다 — "서버 비결정성"이 아니었다 (2026-08-16 확정).** 예전엔 "같은 요청에도 빈 목록/정상 목록을 랜덤하게 준다"고 기록해뒀는데 **틀린 진단이었다.** 실제 원인은 지리적 차단이고, 랜덤해 보였던 건 **Cloudflare 크론이 매번 다른 콜로에서 실행되기 때문**이다(한국/홍콩 콜로에 걸리면 성공, 해외 콜로면 403). 결정적 증거는 실패 기록에 실행 콜로를 남기도록 계측해서 얻었다:

    ```
    0 posts (empty list) [colo=CDG status=403]
    ```

    같은 시각 한국 엣지에서 실행되는 수동 `curl /crawl?site=todayhumor`는 24회 연속 전부 성공(60건). **Cloudflare 크론은 실행 콜로를 제어할 수 없으므로 워커에 두는 한 영구적으로 복불복이다.** 그래서 펨코와 같이 맥미니(한국 가정용 IP) launchd 경로로 옮겼다 — `scripts/crawl_todayhumor_home.mjs` + `~/Library/LaunchAgents/com.pickchive.crawl-todayhumor.plist`(5분 간격). 워커 파서는 HTMLRewriter(Workers 전용)라 Node용 정규식 파서로 다시 구현했다. 크론 로테이션과 GitHub Actions 워크플로에서는 제거함(성공할 수 없는 경로라 실패 기록만 쌓여 진단을 방해했음).

    **교훈: "랜덤하게 실패한다"고 보이면 실행 환경(콜로/IP)이 매번 다른 건 아닌지 먼저 의심할 것.** 실패 로그에 실행 위치를 남기지 않으면 이런 원인은 절대 못 찾는다.
12. **루트 `package.json`의 `deploy` 스크립트(`wrangler pages deploy ./dist`)는 함정 1번과 모순된다.** 실제로는 `wrangler deploy`를 써야 함 — 프론트 배포 시 스크립트를 그대로 믿지 말고 직접 확인할 것. (2026-08-15: `npm run deploy`를 아래 13번 패치까지 포함해 정리함. 이제 이 스크립트만 믿고 써도 됨.)
13. **Cloudflare Worker는 자기 자신의 공개 URL(`*.workers.dev`)로 `fetch()`할 수 없다 — 에러 1042(Worker to Worker Request 차단).** 크롤러의 `scheduled()`가 CPU 예산을 나누려고 사이트마다 자기 자신에게 subrequest를 보내던 방식이 이것 때문에 매번 전 사이트 404로 실패하고 있었음(Cloudflare Cron은 실제로 5분마다 발화하고 있었는데, 이 버그 때문에 GitHub Actions 백업만 동작하는 것처럼 보였던 것 — 2026-08-14/15 확인). subrequest 없이 같은 invocation 안에서 크롤 함수를 직접 호출하도록 수정(`CRAWL_FETCHERS` 맵).
14. **`@astrojs/cloudflare`가 빌드 시 만드는 `dist/server/wrangler.json`은 루트 `wrangler.jsonc`의 모든 필드를 옮기지 않는다 — `workers_dev`가 대표적으로 빠진다.** `routes`(custom_domain)를 추가하면 이 때문에 `workers.dev` 주소가 매 배포마다 조용히 꺼진다(에러 1042로 나타남, pickchive.com 연결 직후 확인). `scripts/patch-workers-dev.mjs`로 빌드 후 그 파일에 직접 주입해서 해결, `npm run deploy`에 포함됨.
15. **크롤러 워커에 `/debug-fetch?url=...` 진단 라우트가 있다.** Workers 쪽에서 특정 URL에 실제로 어떤 응답(상태코드/제목/본문 일부)을 받는지 바로 확인할 수 있음 — 사이트별 차단/비결정성 디버깅할 때 이것부터 찔러볼 것. **단, 이 라우트는 요청을 보낸 사람의 위치에 가까운 콜로에서 실행되므로 크론이 겪는 상황과 다를 수 있다**(11-1 참고) — 응답의 `cfRay` 끝자리로 어느 콜로에서 나간 요청인지 확인할 것.

16. **크론 `scheduled()`에서 12개 사이트를 한 invocation 안에 다 돌리면 Cloudflare Workers CPU 시간 제한에 걸려 강제 종료된다 (2026-08-16 확정).** 증상이 고약한데, **배열 첫 번째 사이트(clien)만 성공하고 나머지는 통째로 조용히 사라진다** — 예외가 아니라 런타임 강제 종료라 `try/catch`로 못 잡고, 사이트별 타임아웃 가드로도 못 막는다. `wrangler tail`로 실시간 로그를 봐야 `"Exceeded CPU Limit"`이 보인다. 3개씩 묶어도 여전히 죽는다.

    해결: **한 번의 실행에서 사이트 1개만 처리하고, D1(`cron_cursor`)에 저장한 커서로 다음 실행에 이어간다.** 처리량은 `BATCH_SIZE`를 올리는 대신 **1분 오프셋 크론을 5개 등록**해서 확보한다(`*/5`, `1-59/5`, `2-59/5`, `3-59/5`, `4-59/5`) — invocation당 CPU 사용량은 그대로 두고 빈도만 5배로 늘리는 방식. 전체 로테이션 주기 60분 → 12분.

17. **크론이 "아예 안 도는지" vs "돌긴 하는데 중간에 죽는지"는 `crawl_runs`만 봐서는 구분할 수 없다.** 위 16번을 진단할 때 사이트별 마지막 시도 시각을 일일이 역추적해야 했던 게 가장 큰 시간 낭비였다. 그래서 `cron_batches` 테이블을 추가해 **`scheduled()` 시작 시점에 행을 먼저 심고(`finished_at` = null) 끝나면 업데이트하는 2단계 기록** 방식을 쓴다 — CPU 제한처럼 잡을 수 없는 강제 종료가 나도 "시작은 했는데 안 끝난" 흔적이 그대로 남는다. `/status` 페이지의 "크론 배치 진단" 섹션이 이걸 보여준다.

18. **`/status` 페이지가 크롤 문제 진단의 1차 도구다.** 세 섹션으로 구성: (1) 크론 배치 진단 — 스케줄러 자체가 멈췄는지/중간에 죽었는지, (2) 최근 수집 시도 시간순 로그 — 전 경로를 합쳐 시:분:초 단위로 어느 사이트가 언제 성공/실패했는지 + **출처 배지** + 에러 메시지, (3) 사이트별 요약.

18-1. **모든 수집 시도에는 출처(`crawl_runs.source`)가 기록된다 (2026-08-16 추가).** 수집 경로가 셋인데 전부 같은 테이블에 쌓여서 어느 경로 결과인지 구분이 안 됐고, 그래서 펨코가 "됐다 안 됐다" 하는 것처럼 보였다(GH Actions는 100% 실패, 맥미니는 성공인데 뒤섞임). 출처 값은 다섯 가지:

    | 값 | 의미 |
    |---|---|
    | `cron` | Cloudflare Cron (워커 `scheduled()`) |
    | `gha` | GitHub Actions가 `/crawl` 호출 |
    | `gha-playwright` | GitHub Actions Playwright → `/ingest` |
    | `macmini` | 맥미니 launchd → `/ingest` |
    | `manual` | 사람이 직접 `/crawl` 호출 (디버깅용) |

    **`/crawl`은 GitHub Actions와 사람이 같이 쓰므로 워크플로가 `?src=gha`를 붙여 구분한다** — 안 붙으면 `manual`로 기록되니 워크플로에 크롤 스텝을 추가할 때 빠뜨리지 말 것. `/ingest` 쪽은 body의 `source` 필드로 받으며, 수집 실패 경로에서도 누락되지 않도록 **전송 시점에 한 번만** 붙인다. 참고: 평상시 `manual`이 계속 올라온다면 외부에서 엔드포인트를 직접 호출하고 있다는 신호다(엔드포인트는 인증 없이 공개돼 있음).

19. **크롤 실패를 기록할 때는 실패 "이유"를 반드시 남길 것.** 오늘의유머가 오래 미궁이었던 이유 중 하나가, 빈 목록을 받는 경우엔 예외가 발생하지 않아 `crawl_runs.error`가 `null`로 남아서 `/status`에 아무 이유도 안 뜬 것이었다(펨코는 HTTP 430 같은 명시적 에러라 메시지가 남는 것과 대조적). 빈 결과도 명시적으로 `throw`해서 이유를 남기고, **가능하면 실행 환경 정보(콜로/상태코드)까지 함께 기록할 것** — 11-1번 원인을 찾아낸 게 정확히 이것이다.

20. **Cloudflare Workers 무료 플랜의 일일 요청 한도(10만/일)는 계정 전체 합산이고, 넘기면 사이트가 통째로 에러 1027로 내려간다 (2026-08-17 실제 발생).** 범인은 사람 트래픽이 아니라 **AI 학습 크롤러**였다 — 12시간 동안 홈(`/`)에만 `meta-externalagent`(Meta AI) 77,051회 + `GPTBot`(OpenAI) 35,798회. 하루 총 `pickchive` 워커 148,137 요청(크롤러 워커는 2,480으로 결백).

    **왜 홈만 맞았나**: 홈의 필터 링크가 전부 서버 렌더링 `<a href>`인데 **기간(7) × 정렬(4) × 사이트(14개 다중선택 토글)** 조합이라 크롤러 입장에선 URL 공간이 사실상 무한하다. 전부 `prerender: false`라 한 번 한 번이 Worker 요청 + D1 쿼리이고 캐시도 안 탄다(`cacheStatus: none`).

    **연쇄 피해**: 한도가 계정 단위라 `pickchive-crawler`까지 같이 죽어서 GitHub Actions `/crawl`과 맥미니 `/ingest`가 전부 실패했다. **"크롤이 갑자기 전부 실패"할 때 크롤러 자체를 파기 전에 Workers 일일 한도부터 확인할 것.**

    **진단 방법 (재현 가능)** — 대시보드 말고 GraphQL Analytics API가 훨씬 빠르다. wrangler OAuth 토큰(`~/Library/Preferences/.wrangler/config/default.toml`의 `oauth_token`)으로 계정 단위 조회가 된다:
    - 워커별/시간별 요청 수: `workersInvocationsAdaptive` (account scope, `dimensions{scriptName datetimeHour}`)
    - 경로·UA·국가별 breakdown: `httpRequestsAdaptiveGroups` (zone scope, zone id는 `/zones?account.id=...`로 조회). **`clientAsn`/`clientIP`는 무료 존에서 권한 없음** — `userAgent`, `clientRequestPath`, `clientCountryName`, `edgeResponseStatus`, `cacheStatus`는 나온다.

    **대응**:
    - robots.txt에서 AI 학습 크롤러 25종 + SEO 분석 봇 11종 `Disallow: /`, 나머지 전체 봇에 `Disallow: /*?`(쿼리 URL 금지). 필터 링크 전부 `rel="nofollow"`, 쿼리 붙은 홈은 `<meta name="robots" content="noindex, follow">`.
    - **단, robots.txt만으로는 부족하다 — 봇이 규칙을 지켜서 안 오든 안 지켜서 오든, 일단 온 요청은 이미 Worker 요청으로 카운트된다.** 워커 코드에서 UA 보고 403 던지는 것도 마찬가지로 요청 수를 못 줄인다. **Cloudflare WAF는 Worker보다 먼저 실행돼서 여기서 막힌 요청만 카운트에서 빠진다** — Security → Bots → "Block AI Scrapers and Crawlers"(무료 제공) + WAF Custom rule(무료 5개)이 유일한 실질 방어선이다.
    - 참고: wrangler OAuth 토큰은 `zone (read)` 권한뿐이라 **WAF 설정은 API로 못 건드린다.** 대시보드에서 직접 하거나 `Zone WAF: Edit` 권한의 API 토큰을 따로 발급해야 한다.


21. **고아 `astro dev` / `workerd`가 쌓여 램을 수십 GB 먹는데, `ps`로는 안 보인다 (2026-08-18 확인).** 맥미니에 `astro dev` 17개(8/11~8/16 시작)와 `workerd` 15개가 부모 없이 남아 **실제 약 23GB**를 잡고 있었다. `compressor`가 6.9GB까지 올라가 머신이 계속 스왑을 치고 있었다.

    **`ps`의 RSS로 보면 개당 25MB로 찍힌다 — 그래서 몇 주간 아무도 못 알아챘다.** 놀고 있는 프로세스는 macOS가 압축해 치워두기 때문이다. 실제 점유는 `top -l 1 -o mem -stats pid,command,mem`의 **MEM 컬럼**으로 봐야 드러난다. 17개 RSS 합계는 0.44GB인데 실제는 21.5GB였다. **메모리 이상을 의심할 땐 RSS를 믿지 말 것.**

    **`astro dev` 1개 = `workerd` 1개**가 항상 세트다 — 로컬에서 D1/KV를 흉내내려면 진짜 Cloudflare 런타임(`workerd`)이 필요해서 miniflare가 자식으로 띄운다. **부모를 죽여도 자식은 따라 죽지 않는다** — astro dev 15개를 정리했더니 workerd 15개가 그대로 새 고아로 남았다. 수동으로 정리할 땐 자식까지 확인할 것.

    **정리는 재부팅이 정답이다.** 맥미니 launchd 3종(펨코·오늘의유머·SLR클럽)은 전부 `RunAtLoad=true`라 부팅 후 자동 복귀하므로, 수집이 끊기는 건 부팅 시간 몇 분뿐이다. 종류를 골라 죽이는 정리 스크립트도 만들어봤으나 **결국 아는 프로세스 종류만 잡는 반쪽짜리라 폐기했다** — 재부팅이 더 확실하고 관리 비용도 없다.

## 현재 상태 (2026-08-16 기준)

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

2026-08-16 작업:
- [x] **크론 CPU 시간 제한 문제 발견 및 수정** — 함정 16 참고. 12개 사이트를 한 invocation에 다 돌리다 매번 clien 직후 강제 종료되어 나머지 사이트가 몇 시간씩 갱신이 끊기고 있었음. 1개씩 처리 + D1 커서 + 1분 오프셋 크론 5개로 해결(전체 주기 60분 → 12분).
- [x] **`/status` 크롤 진단 대시보드 대폭 강화** — 함정 17·18 참고. `cron_batches` 테이블(2단계 기록)로 "크론이 멈췄는지 vs 중간에 죽었는지" 구분, 최근 수집 시도 시간순 로그(전 경로 통합, 시:분:초 + 에러 메시지) 추가.
- [x] **오늘의유머 실패 원인 규명 — 해외 IP 403 차단** — 함정 11-1 참고. 기존 "서버 비결정성" 진단이 틀렸음을 확인하고, 실패 로그에 실행 콜로를 남겨 `[colo=CDG status=403]`로 확정. 맥미니 수집으로 전환(`scripts/crawl_todayhumor_home.mjs`).
- [x] **펨코 중복 수집 경로 제거** — 함정 6-1 참고. GitHub Actions Playwright 경로가 100% 실패하면서 맥미니 성공 기록과 뒤섞여 진단을 방해하던 것을 제거.
- [x] **모든 크롤 실패에 이유 기록** — 함정 19 참고. 대부분의 실패가 예외가 아니라 "200인데 목록이 빈" 형태라 `error`가 null로 남아 `/status`에 근거 없이 "실패"만 떴다. 모든 fetch가 지나가는 공통 지점(`types.ts`의 `fetchTracked`)에 계측을 넣어 상태코드/콜로를 자동으로 남기도록 함 — 파서를 일일이 고치지 않아도 전 사이트 적용.
- [x] **수집 출처(`source`) 기록 및 `/status` 표시** — 함정 18-1 참고. 세 경로가 같은 테이블에 뒤섞여 진단을 방해하던 문제 해결.
- [x] **`/status` "실패 중" 오판정 수정** — 마지막 시도 한 건만 보고 판정해서, 24시간 102회 중 96회 성공하는 SLR클럽이 하필 마지막 시도가 실패라는 이유로 "실패 중"으로 찍혔다(그 4초 전엔 성공한 상태였음 — 크론과 GH Actions가 우연히 겹치는 경우가 하루 13회 정도 있다). 최근 30분 내 성공이 없을 때만 "실패 중"으로 판정하도록 변경. 상대 시간만 표시해 "3분 전 실패"와 "3분 전 성공"이 동시에 떠 모순돼 보이던 것도 정확한 시각 병기로 해결.
- [x] **사이트 필터 다중 선택** — 전체/개별 토글, 마지막 해제 시 전체 복귀. `getRankedPosts`의 site 필터를 `IN (...)`으로 변경.
- [x] **로그인 사용자 필터 기억** — `users.last_window/last_sort/last_site`. 필터 없이 홈 진입 시 마지막 필터 복원. "전체/기본값" 클릭이 이 복원 로직에 가로채이던 버그는 `reset=1` 마커로 해결.
- [x] **댓글 배지 `[원본 댓글 N]` → `(N)`** — 제목 끝에 이미 같은 숫자가 있으면 배지 숨김.
- [x] **네이버 서치어드바이저 소유 확인** + `site.url`을 커스텀 도메인으로 정정(sitemap/canonical이 옛 workers.dev를 가리키던 문제).

2026-08-18 작업:
- [x] **AI 크롤러 폭주로 Workers 일일 한도 초과 → 사이트 다운(에러 1027) 대응** — 함정 20 참고. robots.txt 전면 재작성(AI 크롤러 25종 + SEO 봇 11종 차단, 전체 봇 대상 `Disallow: /*?`), 홈 필터 링크 전부 `rel="nofollow"`, 쿼리 붙은 홈 `noindex, follow`. **Cloudflare WAF 차단은 미적용 — 대시보드 작업 필요(권한 없음).**
- [x] **펨코 25시간 중단 원인 규명 및 복구** — 함정 6-2 참고. 430이 IP 차단이 아니라 JS+WASM 챌린지였고, 못 푼 채 5분마다 두드리다 429 자동 차단까지 승격됐던 것. 쿠키 1회 취득 후 재사용 방식으로 재작성, 20건 수집 복구 확인.
- [x] **SLR클럽 11시간 중단 원인 규명 및 복구** — 함정 6-3 참고. 데이터센터 IP 차단(Workers 404/521, 한국 IP는 UA 없이도 200)으로 확인. 맥미니 launchd 경로로 이전하고 크론·GH Actions에서 제거, 30건 수집 복구.
- [x] **고아 개발 프로세스 23GB 정리** — 함정 21 참고. `astro dev` 17개 + `workerd` 15개 정리(compressor 6.9GB→0.7GB). 정리 스크립트는 반쪽짜리라 폐기하고 재부팅을 표준 대응으로 정함.

## 할 일 / 열린 질문

- [ ] **뽐뿌/다모앙 인기글 소스 전환 미완료** — 뽐뿌 `/hot.php`(사이트 전체 HOT, 컬럼 재사용이라 파서 재작성 필요), 다모앙 `/empathy`(공감글, 페이지 구조 파악은 끝났고 파서 미작성).
- [ ] **이토랜드/엠팍/82cook/인벤 인기글 소스 없음/보류** — 이토랜드 `/hit/list`는 핫딜(쇼핑 광고) 글이 섞여서 필터링 필요, 엠팍은 대안 자체를 못 찾음(기존 파싱 불안정 문제까지 있어 우선순위 낮음), 82cook은 애초에 추천/베스트 개념이 없는 사이트, 인벤은 현재(오픈이슈갤러리)도 어느 정도 큐레이션된 편이라 보류.
- [ ] **"종합" 정렬이 추천수 없는 사이트(82cook)에 불리한지 검증 필요** — `조회수 + 추천수×10` 공식상 recommend_count가 항상 0인 사이트는 view_count만으로 경쟁하게 되어 실제로 밀리는지 데이터로 확인 필요.
- [ ] **mlbpark 추천수 셀렉터 미확인** — 정상 응답을 받을 때의 실HTML을 확보해 클래스명 특정 필요.
- [x] ~~**오늘의유머 서버 비결정성 근본 원인 미확인**~~ — **2026-08-16 해결.** 비결정성이 아니라 해외 IP 403 차단이었고(콜로마다 결과가 갈렸던 것), 맥미니 수집으로 전환해 해소. 함정 11-1 참고.
- [ ] **맥미니가 단일 장애점(SPOF) — 2026-08-18로 의존 사이트가 3개로 늘었다** — 펨코·오늘의유머·SLR클럽이 맥미니 한 대의 launchd에만 의존한다. 한국 IP를 요구하는 사이트가 계속 늘어나는 추세라 이 항목의 우선순위도 같이 올라갔다. 맥미니가 꺼지거나 홈 IP가 차단되면(펨코는 실제로 몇 시간씩 HTTP 430으로 막힌 전력 있음) 대체 경로가 없다. 무료 대안으로 검토해볼 만한 것: 한국 리전 무료 티어 VM(오라클 클라우드 등)에 같은 스크립트를 이중화, 또는 맥미니 다운 감지 시 알림.
- [ ] **`/status`가 공개 페이지** — 크롤 실패 이유·콜로·에러 메시지가 그대로 노출된다. 운영 정보라 인증을 걸지, 아니면 이대로 둘지 결정 필요.
- [ ] **구글 애드센스 신청** — 개인정보처리방침은 완료. 애널리틱스 연동해서 실제 트래픽 확인 후 신청 검토 (사이트가 본문 없이 제목+링크만 있는 어그리게이터 구조라 콘텐츠 정책에 걸릴 수 있음도 염두에 둘 것).
- [ ] **인라인 댓글(펼쳐보기)** — 지금은 "댓글 보기" 누르면 `/p/[id]`로 이동. 목록에서 아코디언으로 바로 보고 쓰는 UX 아이디어 논의만 함(2026-08-15), 미착수. SSR용(PostRow.astro)/클라이언트 렌더링용(index.astro 무한스크롤·검색) 두 군데 다 손대야 함.
- [ ] **git identity 설정** — `git config user.name/email` 필요시 설정.
- [ ] **Cloudflare WAF AI 봇 차단 미적용** — 함정 20. robots.txt/nofollow는 코드로 넣었지만 규칙을 무시하는 봇은 그대로 들어오고, 지키는 봇도 반영까지 시간이 걸린다. Security → Bots → "Block AI Scrapers and Crawlers" 토글 + WAF Custom rule이 필요한데 wrangler 토큰 권한 밖이라 대시보드에서 직접 해야 한다. **이거 켜기 전까지 한도 재초과 위험은 그대로다.**
- [x] ~~**펨코 맥미니 홈 IP까지 차단됨**~~ — **2026-08-18 해결.** 홈 IP 차단이 아니라 JS+WASM 챌린지를 못 푼 것이었고, 못 푸는 채로 계속 두드려서 429 자동 차단까지 올라갔던 것. 함정 6-2 참고.
- [x] ~~**SLR클럽 원본 521**~~ — **2026-08-18 해결.** 원본 장애가 아니라 데이터센터 IP 차단이었다. 맥미니 경로로 이전. 함정 6-3 참고.
