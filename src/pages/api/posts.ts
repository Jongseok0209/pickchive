import type { APIRoute } from "astro";
import { getRankedPosts, type SortKey } from "@/lib/posts";

export const prerender = false;

const PAGE_SIZE = 20;

export const GET: APIRoute = async ({ url }) => {
  const offset = Number(url.searchParams.get("offset") ?? "0") || 0;

  const posts = await getRankedPosts({
    window: url.searchParams.get("window") ?? "24h",
    sort: (url.searchParams.get("sort") ?? "score") as SortKey,
    site: url.searchParams.get("site") ?? undefined,
    titleQuery: url.searchParams.get("q") ?? undefined,
    limit: PAGE_SIZE,
    offset,
  });

  return Response.json({
    posts,
    nextOffset: posts.length === PAGE_SIZE ? offset + PAGE_SIZE : null,
  });
};
