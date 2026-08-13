import type { Env } from "./types";
import { getSiteId, upsertPosts, cleanupOldData } from "./db";
import { fetchClien } from "./parsers/clien";
import { fetchPpomppu } from "./parsers/ppomppu";
import { fetchBobaedream } from "./parsers/bobaedream";
import { fetchCook82 } from "./parsers/cook82";
import { fetchInven } from "./parsers/inven";

// 무료 플랜 Cron Trigger 5개 한도에 맞춘 배분:
// 그룹A(뽐뿌+클리앙, 가장 가벼운 두 곳) / 보배드림 / 82cook / 인벤 / 청소
const CRON_GROUP_A = "1,11,21,31,41,51 * * * *";
const CRON_BOBAEDREAM = "2,12,22,32,42,52 * * * *";
const CRON_COOK82 = "3,13,23,33,43,53 * * * *";
const CRON_INVEN = "4,14,24,34,44,54 * * * *";
const CRON_CLEANUP = "0 19 * * *"; // UTC 19:00 = KST 04:00

async function crawlSite(
  db: Env["DB"],
  slug: string,
  fetcher: () => Promise<Awaited<ReturnType<typeof fetchClien>>>
) {
  const siteId = await getSiteId(db, slug);
  const posts = await fetcher();
  await upsertPosts(db, siteId, posts);
  console.log(`[${slug}] crawled ${posts.length} posts`);
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    switch (event.cron) {
      case CRON_GROUP_A:
        ctx.waitUntil(
          Promise.all([
            crawlSite(env.DB, "clien", fetchClien),
            crawlSite(env.DB, "ppomppu", fetchPpomppu),
          ])
        );
        break;
      case CRON_BOBAEDREAM:
        ctx.waitUntil(crawlSite(env.DB, "bobaedream", fetchBobaedream));
        break;
      case CRON_COOK82:
        ctx.waitUntil(crawlSite(env.DB, "cook82", fetchCook82));
        break;
      case CRON_INVEN:
        ctx.waitUntil(crawlSite(env.DB, "inven", fetchInven));
        break;
      case CRON_CLEANUP:
        ctx.waitUntil(
          cleanupOldData(env.DB).then(result =>
            console.log(
              `[cleanup] posts=${result.postsDeleted} snapshots=${result.snapshotsDeleted}`
            )
          )
        );
        break;
      default:
        console.log(`Unknown cron: ${event.cron}`);
    }
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
      };
      if (!site || !fetchers[site]) {
        return new Response(
          "Usage: /crawl?site=clien|ppomppu|bobaedream|cook82|inven",
          { status: 400 }
        );
      }
      await fetchers[site]();
      return new Response(`Crawled ${site}`, { status: 200 });
    }
    if (url.pathname === "/cleanup") {
      const result = await cleanupOldData(env.DB);
      return Response.json(result);
    }
    return new Response("pickchive crawler worker", { status: 200 });
  },
};
