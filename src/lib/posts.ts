import { env } from "cloudflare:workers";

export interface PostWithSite {
  id: number;
  title: string;
  url: string;
  author: string | null;
  viewCount: number;
  recommendCount: number;
  commentCount: number | null;
  category: string | null;
  postedAtRaw: string | null;
  firstSeenAt: string;
  crawledAt: string;
  siteSlug: string;
  siteName: string;
  viewGrowth: number;
}

// 급상승 배지를 띄울 최소 조회수 증가량 (rank_snapshots 기준 최근 2시간 내)
export const TRENDING_THRESHOLD = 300;

export const TIME_WINDOWS = [
  { key: "3h", label: "3시간", hours: 3 },
  { key: "6h", label: "6시간", hours: 6 },
  { key: "12h", label: "12시간", hours: 12 },
  { key: "24h", label: "24시간", hours: 24 },
  { key: "week", label: "주간", hours: 24 * 7 },
] as const;

export type WindowKey = (typeof TIME_WINDOWS)[number]["key"];

export const DEFAULT_WINDOW: WindowKey = "24h";

function hoursForWindow(key: string): number {
  return (
    TIME_WINDOWS.find(w => w.key === key)?.hours ??
    TIME_WINDOWS.find(w => w.key === DEFAULT_WINDOW)!.hours
  );
}

export type SortKey = "score" | "views" | "recommend" | "comments" | "trending";

function orderByClause(sort: SortKey): string {
  switch (sort) {
    case "views":
      return "p.view_count DESC, p.first_seen_at DESC";
    case "recommend":
      return "p.recommend_count DESC, p.first_seen_at DESC";
    case "comments":
      return "COALESCE(p.comment_count, 0) DESC, p.first_seen_at DESC";
    case "trending":
      return "viewGrowth DESC, p.first_seen_at DESC";
    case "score":
    default:
      return "(p.view_count + p.recommend_count * 10) DESC, p.first_seen_at DESC";
  }
}

// 최근 2시간 내 가장 오래된 스냅샷 대비 조회수 증가량 (없으면 0 — 갓 들어온 글이거나 변화 없음)
const VIEW_GROWTH_SUBQUERY = `
  (p.view_count - COALESCE(
    (SELECT rs.view_count FROM rank_snapshots rs
     WHERE rs.post_id = p.id AND rs.crawled_at >= datetime('now', '-2 hours')
     ORDER BY rs.crawled_at ASC LIMIT 1),
    p.view_count
  ))
`;

export async function getRankedPosts(options: {
  window: string;
  sort?: SortKey;
  site?: string;
  limit: number;
  offset: number;
}): Promise<PostWithSite[]> {
  const hours = hoursForWindow(options.window);
  const sort = options.sort ?? "score";
  const siteFilter = options.site ? "AND s.slug = ?" : "";

  const query = `
    SELECT p.id, p.title, p.url, p.author,
           p.view_count as viewCount, p.recommend_count as recommendCount,
           p.comment_count as commentCount, p.category,
           p.posted_at_raw as postedAtRaw, p.first_seen_at as firstSeenAt,
           p.crawled_at as crawledAt,
           s.slug as siteSlug, s.name as siteName,
           ${VIEW_GROWTH_SUBQUERY} as viewGrowth
    FROM posts p
    JOIN sites s ON p.site_id = s.id
    WHERE p.first_seen_at >= datetime('now', ?)
    ${siteFilter}
    ORDER BY ${orderByClause(sort)}
    LIMIT ? OFFSET ?
  `;

  const binds: unknown[] = [`-${hours} hours`];
  if (options.site) binds.push(options.site);
  binds.push(options.limit, options.offset);

  const { results } = await env.DB.prepare(query)
    .bind(...binds)
    .all<PostWithSite>();
  return results;
}

export interface SiteRow {
  slug: string;
  name: string;
}

export async function getSites(): Promise<SiteRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT slug, name FROM sites ORDER BY name"
  ).all<SiteRow>();
  return results;
}

export async function getPostById(id: number): Promise<PostWithSite | null> {
  const row = await env.DB.prepare(
    `SELECT p.id, p.title, p.url, p.author,
            p.view_count as viewCount, p.recommend_count as recommendCount,
            p.comment_count as commentCount, p.category,
            p.posted_at_raw as postedAtRaw, p.first_seen_at as firstSeenAt,
            p.crawled_at as crawledAt,
            s.slug as siteSlug, s.name as siteName,
            ${VIEW_GROWTH_SUBQUERY} as viewGrowth
     FROM posts p
     JOIN sites s ON p.site_id = s.id
     WHERE p.id = ?`
  )
    .bind(id)
    .first<PostWithSite>();
  return row ?? null;
}
