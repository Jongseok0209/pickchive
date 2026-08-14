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

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log(`Scheduled event triggered: ${event.cron}`);
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
