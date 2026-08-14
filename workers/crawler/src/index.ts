import type { Env } from "./types";
import {
  getSiteId,
  upsertPosts,
  cleanupOldData,
  recordCrawlRun,
  getCrawlHealth,
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
  fetcher: () => Promise<Awaited<ReturnType<typeof fetchClien>>>
) {
  const siteId = await getSiteId(db, slug);
  let posts: Awaited<ReturnType<typeof fetchClien>> = [];
  let lastError: string | undefined;

  for (let attempt = 0; attempt < CRAWL_ATTEMPTS; attempt++) {
    try {
      posts = await fetcher();
      lastError = undefined;
      if (posts.length > 0) break;
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      posts = [];
    }
    if (attempt < CRAWL_ATTEMPTS - 1) {
      await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
    }
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
const HTTP_CRAWL_SITES = [
  "clien",
  "ppomppu",
  "bobaedream",
  "cook82",
  "inven",
  "todayhumor",
  "ddanzi",
  "humoruniv",
  "etoland",
  "mlbpark",
  "slrclub",
  "damoang",
];

const WORKER_ORIGIN = "https://pickchive-crawler.won0209.workers.dev";

export default {
  // GitHub Actions의 schedule(*/5)은 실제로는 평균 1시간 간격으로만 실행된다
  // (2026-08-14 실측: 03:30 → 05:17 → 06:48 → 08:04 …). GitHub이 스케줄
  // 이벤트를 부하 상황에 따라 지연·병합하기 때문으로, 우리가 고칠 수 없다.
  // 그래서 Cloudflare Cron Trigger를 주 스케줄러로 되살린다.
  // (과거 커밋 a8ac805에서 "한 번도 발화하지 않는다"는 이유로 제거했었으나,
  //  이제 crawl_runs/health로 발화 여부를 객관적으로 검증할 수 있어 재도입.
  //  GitHub Actions는 백업 경로로 그대로 둔다.)
  //
  // 사이트별로 자기 자신에게 subrequest를 보내는 이유: 한 invocation에서
  // 12개 사이트 HTML을 모두 파싱하면 CPU 한도에 걸릴 수 있는데,
  // 요청을 나누면 각 사이트가 독립된 실행 예산을 갖는다.
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log(`Scheduled event triggered: ${event.cron}`);
    ctx.waitUntil(
      (async () => {
        for (const slug of HTTP_CRAWL_SITES) {
          try {
            const res = await fetch(`${WORKER_ORIGIN}/crawl?site=${slug}`);
            console.log(`[cron] ${slug} -> ${res.status}`);
          } catch (err: any) {
            console.log(`[cron] ${slug} -> error ${err?.message ?? err}`);
          }
        }
      })()
    );
  },

  // 로컬 테스트/수동 트리거용: /crawl?site=clien 로 개별 사이트 크롤링 실행
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/crawl") {
      const site = url.searchParams.get("site");
      const fetchers: Record<string, () => Promise<unknown>> = {
        clien: () => crawlSite(env.DB, "clien", fetchClien),
        ppomppu: () => crawlSite(env.DB, "ppomppu", fetchPpomppu),
        bobaedream: () => crawlSite(env.DB, "bobaedream", fetchBobaedream),
        cook82: () => crawlSite(env.DB, "cook82", fetchCook82),
        inven: () => crawlSite(env.DB, "inven", fetchInven),
        todayhumor: () => crawlSite(env.DB, "todayhumor", fetchTodayhumor),
        ddanzi: () => crawlSite(env.DB, "ddanzi", fetchDdanzi),
        humoruniv: () => crawlSite(env.DB, "humoruniv", fetchHumoruniv),
        etoland: () => crawlSite(env.DB, "etoland", fetchEtoland),
        mlbpark: () => crawlSite(env.DB, "mlbpark", fetchMlbpark),
        slrclub: () => crawlSite(env.DB, "slrclub", fetchSlrclub),
        fmkorea: () => crawlSite(env.DB, "fmkorea", fetchFmkorea),
        damoang: () => crawlSite(env.DB, "damoang", fetchDamoang),
        ruliweb: () => crawlSite(env.DB, "ruliweb", fetchRuliweb),
      };
      if (!site || !fetchers[site]) {
        return new Response(
          "Usage: /crawl?site=" + Object.keys(fetchers).join("|"),
          { status: 400 }
        );
      }
      // 0건 수집이면 crawlSite가 throw한다. 지금까지는 이런 조용한 실패에도
      // 200이 나가서 GitHub Actions가 "성공"으로 넘어가버렸다 — 500으로 알린다.
      try {
        await fetchers[site]();
        return new Response(`Crawled ${site}`, { status: 200 });
      } catch (err: any) {
        return new Response(`Crawl failed: ${err?.message ?? err}`, { status: 500 });
      }
    }
    if (url.pathname === "/health") {
      const rows = await getCrawlHealth(env.DB);
      const stale = (rows as any[]).filter(
        r => r.mins_since_ok === null || r.mins_since_ok > 60
      );
      return Response.json(
        { ok: stale.length === 0, staleSites: stale.map(r => r.slug), sites: rows },
        { status: stale.length === 0 ? 200 : 503 }
      );
    }
    if (url.pathname === "/ingest" && request.method === "POST") {
      try {
        const body = (await request.json()) as { slug: string; posts: any[] };
        if (!body.slug || !Array.isArray(body.posts)) {
          return new Response("Invalid body. Expected { slug, posts: [...] }", { status: 400 });
        }
        const siteId = await getSiteId(env.DB, body.slug);
        await upsertPosts(env.DB, siteId, body.posts);
        // Playwright 경유 사이트(펨코/루리웹/다모앙)도 /health에서 같이 보이도록 기록
        await recordCrawlRun(env.DB, body.slug, body.posts.length);
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
