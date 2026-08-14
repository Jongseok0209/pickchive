import type { Env } from "./types";
import { getSiteId, upsertPosts, cleanupOldData } from "./db";
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

async function crawlSite(
  db: Env["DB"],
  slug: string,
  fetcher: () => Promise<Awaited<ReturnType<typeof fetchClien>>>
) {
  const siteId = await getSiteId(db, slug);
  const posts = await fetcher();
  await upsertPosts(db, siteId, posts as any);
  console.log(`[${slug}] crawled ${posts.length} posts`);
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
      await fetchers[site]();
      return new Response(`Crawled ${site}`, { status: 200 });
    }
    if (url.pathname === "/ingest" && request.method === "POST") {
      try {
        const body = (await request.json()) as { slug: string; posts: any[] };
        if (!body.slug || !Array.isArray(body.posts)) {
          return new Response("Invalid body. Expected { slug, posts: [...] }", { status: 400 });
        }
        const siteId = await getSiteId(env.DB, body.slug);
        await upsertPosts(env.DB, siteId, body.posts);
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
