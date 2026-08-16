import { describeLastFetch, resetLastFetchInfo, type Env } from "./types";
import {
  getSiteId,
  upsertPosts,
  cleanupOldData,
  recordCrawlRun,
  getCrawlHealth,
  getCronCursor,
  setCronCursor,
  startCronBatch,
  finishCronBatch,
  getRecentCronBatches,
} from "./db";
import { fetchClien } from "./parsers/clien";
import { fetchPpomppu } from "./parsers/ppomppu";
import { fetchBobaedream } from "./parsers/bobaedream";
import { fetchCook82 } from "./parsers/cook82";
import { fetchInven } from "./parsers/inven";
import { fetchTodayhumor } from "./parsers/todayhumor";
import { fetchDdanzi } from "./parsers/ddanzi";
import { fetchHumoruniv } from "./parsers/humoruniv";
import { fetchEtoland } from "./parsers/etoland";
import { fetchMlbpark } from "./parsers/mlbpark";
import { fetchSlrclub } from "./parsers/slrclub";
import { fetchFmkorea } from "./parsers/fmkorea";
import { fetchDamoang } from "./parsers/damoang";
import { fetchRuliweb } from "./parsers/ruliweb";

// 여러 사이트가 간헐적으로 "조용히 실패"한다 — HTTP 200인데 목록이 비어 0건
// 수집되는 케이스(mlbpark의 비결정적 응답, todayhumor 등에서 실제 관찰됨).
// 파서마다 재시도를 따로 넣는 대신 이 공통 경로에서 한 번에 처리하고,
// 결과를 crawl_runs에 남겨 /health로 조용한 실패를 바로 볼 수 있게 한다.
const CRAWL_ATTEMPTS = 3;

async function crawlSite(
  db: Env["DB"],
  slug: string,
  fetcher: () => Promise<Awaited<ReturnType<typeof fetchClien>>>,
  attempts: number = CRAWL_ATTEMPTS
) {
  const siteId = await getSiteId(db, slug);
  let posts: Awaited<ReturnType<typeof fetchClien>> = [];
  let lastError: string | undefined;

  resetLastFetchInfo();
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      posts = await fetcher();
      lastError = undefined;
      if (posts.length > 0) break;
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      posts = [];
    }
    if (attempt < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
    }
  }

  // 실패했는데 이유가 없으면(= 예외 없이 그냥 0건) /status에 아무 근거도 안 뜬다.
  // 대부분의 실패가 이 형태라 예전엔 "실패"라고만 뜨고 끝이었다. 마지막 응답의
  // 상태코드/콜로를 근거로 반드시 남긴다(types.ts 주석 참고).
  if (posts.length === 0) {
    const fetchDesc = describeLastFetch();
    lastError = lastError
      ? `${lastError} (${fetchDesc})`
      : `0건 수집 — 응답은 받았으나 목록이 비어있음 (${fetchDesc})`;
  }

  if (posts.length > 0) {
    await upsertPosts(db, siteId, posts as any);
  }
  await recordCrawlRun(db, slug, posts.length, lastError);
  console.log(
    `[${slug}] crawled ${posts.length} posts${lastError ? ` (error: ${lastError})` : ""}`
  );

  // 0건이면 워크플로가 성공으로 넘어가지 않도록 실패로 알린다.
  if (posts.length === 0) {
    throw new Error(`[${slug}] 0 posts${lastError ? `: ${lastError}` : ""}`);
  }
}

// HTTP로 직접 수집 가능한 사이트(= Playwright 불필요). Cron이 이 목록을 돈다.
//
// 오늘의유머는 이 목록에서 제외했다. 해외 IP를 HTTP 403으로 차단하는데
// (2026-08-16 확정 — 실패 기록에 "[colo=CDG status=403]"으로 파리 콜로에서의
// 403이 그대로 찍혔다), Cloudflare 크론은 어느 콜로에서 실행될지 제어할 수
// 없어서 한국 엣지에 걸릴 때만 우연히 성공하는 복불복 구조였다. 펨코와 같은
// 이유로 맥미니(한국 홈 IP) launchd 경로에서만 수집한다
// (scripts/crawl_todayhumor_home.mjs).
const HTTP_CRAWL_SITES = [
  "clien",
  "ppomppu",
  "bobaedream",
  "cook82",
  "inven",
  "ddanzi",
  "humoruniv",
  "etoland",
  "mlbpark",
  "slrclub",
  "damoang",
];

// scheduled()와 /crawl 라우트가 같이 쓰는 사이트별 크롤 함수 목록.
const CRAWL_FETCHERS: Record<string, (db: Env["DB"]) => Promise<void>> = {
  clien: db => crawlSite(db, "clien", fetchClien),
  ppomppu: db => crawlSite(db, "ppomppu", fetchPpomppu),
  bobaedream: db => crawlSite(db, "bobaedream", fetchBobaedream),
  cook82: db => crawlSite(db, "cook82", fetchCook82),
  inven: db => crawlSite(db, "inven", fetchInven),
  // 오늘의유머는 차단이 아니라 같은 요청도 서버가 비결정적으로 빈 목록/정상
  // 목록을 섞어서 준다(2026-08-14 확인). fetchTodayhumor 안에서 bestofbest/
  // humorbest 게시판마다 독립적으로 재시도(각 8회)하도록 옮겼으니, 여기 바깥
  // crawlSite 재시도는 곱연산으로 시간만 늘리는 셈이라 1회(재시도 없음)로 둔다.
  todayhumor: db => crawlSite(db, "todayhumor", fetchTodayhumor, 1),
  ddanzi: db => crawlSite(db, "ddanzi", fetchDdanzi),
  humoruniv: db => crawlSite(db, "humoruniv", fetchHumoruniv),
  etoland: db => crawlSite(db, "etoland", fetchEtoland),
  mlbpark: db => crawlSite(db, "mlbpark", fetchMlbpark),
  slrclub: db => crawlSite(db, "slrclub", fetchSlrclub),
  fmkorea: db => crawlSite(db, "fmkorea", fetchFmkorea),
  damoang: db => crawlSite(db, "damoang", fetchDamoang),
  ruliweb: db => crawlSite(db, "ruliweb", fetchRuliweb),
};

export default {
  // GitHub Actions의 schedule(*/5)은 실제로는 평균 1시간 간격으로만 실행된다
  // (2026-08-14 실측: 03:30 → 05:17 → 06:48 → 08:04 …). GitHub이 스케줄
  // 이벤트를 부하 상황에 따라 지연·병합하기 때문으로, 우리가 고칠 수 없다.
  // 그래서 Cloudflare Cron Trigger를 주 스케줄러로 되살린다.
  // GitHub Actions는 백업 경로로 그대로 둔다.
  //
  // (2026-08-14 확인: 예전엔 사이트별로 자기 자신의 workers.dev URL에
  //  subrequest를 보내 CPU 예산을 나눴는데, 이건 Cloudflare가 "Worker가
  //  자기 자신의 공개 URL로 fetch()"하는 걸 루프 방지로 차단해서(에러 1042)
  //  cron이 매번 발화는 하되 사이트마다 전부 404로 실패하고 있었다.
  //  GitHub Actions 쪽은 외부(GitHub 러너)에서 직접 curl하는 거라 이 제약을
  //  안 받아서 그동안 정상 동작해온 것. 그래서 subrequest 없이 같은
  //  invocation 안에서 crawlSite를 직접 호출하는 방식으로 바꿨다.)
  //
  // (2026-08-16 확인: 그런데 12개를 전부 한 invocation 안에서 돌리면 Cloudflare
  //  Workers CPU 시간 제한에 걸린다 — wrangler tail로 "Exceeded CPU Limit"을
  //  직접 확인했고, 매번 배열 첫 번째인 clien만 성공하고 그 뒤로는 통째로
  //  강제 종료돼서 나머지 사이트들이 한 시간 가까이 갱신이 끊겼다. CPU 시간
  //  제한은 catch로 못 잡는 강제 종료라 사이트별 타임아웃 가드로도 못 막는다.
  //  그래서 한 번의 실행에서는 몇 개만 처리하고 D1에 저장해둔 커서로 다음
  //  실행에 이어가는 방식으로 바꿨다 — 12개를 5분 안에 다 못 돌지만, 사이트당
  //  CPU 사용량이 매번 작게 고정되어 절대 중간에 죽지 않는다.)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log(`Scheduled event triggered: ${event.cron}`);
    ctx.waitUntil(
      (async () => {
        // 3개씩도 매번 안 끝나고 죽는 걸 확인해서(cron_batches에 finished_at
        // null만 계속 쌓임, 2026-08-16) 예전에 확실히 성공했던 단위인 1개로
        // 더 낮췄다. 12개를 다 도는 데 60분이 걸리지만, GitHub Actions가
        // 그 사이 별도 경로(사이트당 개별 HTTP 요청이라 CPU 누적이 안 됨)로
        // 더 자주 커버해준다.
        const BATCH_SIZE = 1;
        const PER_SITE_TIMEOUT_MS = 15000;
        const startedAt = Date.now();

        const cursor = await getCronCursor(env.DB);
        const batch: string[] = [];
        for (let i = 0; i < BATCH_SIZE; i++) {
          batch.push(HTTP_CRAWL_SITES[(cursor + i) % HTTP_CRAWL_SITES.length]);
        }
        const nextCursor = (cursor + BATCH_SIZE) % HTTP_CRAWL_SITES.length;

        const batchId = await startCronBatch(env.DB, batch);
        let sitesOk = 0;
        let batchError: string | undefined;
        try {
          for (const slug of batch) {
            try {
              await Promise.race([
                CRAWL_FETCHERS[slug](env.DB),
                new Promise((_, reject) =>
                  setTimeout(
                    () => reject(new Error(`timeout after ${PER_SITE_TIMEOUT_MS}ms`)),
                    PER_SITE_TIMEOUT_MS
                  )
                ),
              ]);
              sitesOk++;
              console.log(`[cron] ${slug} -> ok (+${Date.now() - startedAt}ms)`);
            } catch (err: any) {
              console.log(
                `[cron] ${slug} -> error ${err?.message ?? err} (+${Date.now() - startedAt}ms)`
              );
            }
          }
          // 커서는 이번 배치를 다 시도한 뒤에만 넘긴다 — 중간에 강제 종료되면
          // 커서가 그대로 남아 다음 실행이 같은 배치를 재시도한다.
          await setCronCursor(env.DB, nextCursor);
        } catch (err: any) {
          batchError = err?.message ?? String(err);
        }
        await finishCronBatch(env.DB, batchId, sitesOk, batchError);
        console.log(
          `[cron] batch [${batch.join(",")}] done in ${Date.now() - startedAt}ms, ok=${sitesOk}/${batch.length}`
        );
      })()
    );
  },

  // 로컬 테스트/수동 트리거용: /crawl?site=clien 로 개별 사이트 크롤링 실행
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/crawl") {
      const site = url.searchParams.get("site");
      if (!site || !CRAWL_FETCHERS[site]) {
        return new Response(
          "Usage: /crawl?site=" + Object.keys(CRAWL_FETCHERS).join("|"),
          { status: 400 }
        );
      }
      // 0건 수집이면 crawlSite가 throw한다. 지금까지는 이런 조용한 실패에도
      // 200이 나가서 GitHub Actions가 "성공"으로 넘어가버렸다 — 500으로 알린다.
      try {
        await CRAWL_FETCHERS[site](env.DB);
        return new Response(`Crawled ${site}`, { status: 200 });
      } catch (err: any) {
        return new Response(`Crawl failed: ${err?.message ?? err}`, { status: 500 });
      }
    }
    if (url.pathname === "/debug-fetch") {
      const target = url.searchParams.get("url");
      if (!target) return new Response("Usage: /debug-fetch?url=...", { status: 400 });
      try {
        const res = await fetch(target, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
        });
        const text = await res.text();
        return Response.json({
          target,
          status: res.status,
          cfRay: res.headers.get("cf-ray"),
          contentLength: text.length,
          titleMatch: text.match(/<title>([^<]*)<\/title>/)?.[1] ?? null,
          viewRowCount: (text.match(/class="view /g) || []).length,
          subjectCount: (text.match(/class="subject"/g) || []).length,
          snippet: text.slice(0, 500),
        });
      } catch (err: any) {
        return Response.json({ error: err?.message ?? String(err) });
      }
    }
    if (url.pathname === "/health") {
      const rows = await getCrawlHealth(env.DB);
      const stale = (rows as any[]).filter(
        r => r.mins_since_ok === null || r.mins_since_ok > 60
      );
      const cronBatches = await getRecentCronBatches(env.DB);
      return Response.json(
        {
          ok: stale.length === 0,
          staleSites: stale.map(r => r.slug),
          sites: rows,
          cronBatches,
        },
        { status: stale.length === 0 ? 200 : 503 }
      );
    }
    if (url.pathname === "/ingest" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          slug: string;
          posts: any[];
          error?: string;
        };
        if (!body.slug || !Array.isArray(body.posts)) {
          return new Response("Invalid body. Expected { slug, posts: [...] }", { status: 400 });
        }
        const siteId = await getSiteId(env.DB, body.slug);
        await upsertPosts(env.DB, siteId, body.posts);
        // Playwright 경유 사이트(펨코/루리웹/다모앙)도 /health·/status에서 같이 보이도록
        // 기록한다. 0건이어도 반드시 호출되므로(scripts/crawl_protected.ts 참고) 실패한
        // 시도도 "시도 안 함"이 아니라 정확히 "실패"로 남는다.
        // 외부 수집기가 error를 안 보냈는데 0건이면, 최소한 "이유 없음"이 아니라
        // 어느 경로에서 온 0건인지는 남긴다 — /status에 근거 없는 "실패"가 뜨지 않도록.
        const ingestError =
          body.error ??
          (body.posts.length === 0
            ? "0건 수집 — 외부 수집기(/ingest)가 빈 목록을 보냄"
            : undefined);
        await recordCrawlRun(env.DB, body.slug, body.posts.length, ingestError);
        console.log(`[${body.slug}] ingested ${body.posts.length} posts`);
        return new Response(`Ingested ${body.posts.length} posts for ${body.slug}`, { status: 200 });
      } catch (err: any) {
        return new Response(`Ingest error: ${err.message}`, { status: 500 });
      }
    }
    if (url.pathname === "/cleanup") {
      const result = await cleanupOldData(env.DB);
      return Response.json(result);
    }
    return new Response("pickchive crawler worker", { status: 200 });
  },
};
