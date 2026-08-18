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
}

export const TIME_WINDOWS = [
  { key: "1h", label: "1시간", hours: 1 },
  { key: "3h", label: "3시간", hours: 3 },
  { key: "6h", label: "6시간", hours: 6 },
  { key: "12h", label: "12시간", hours: 12 },
  { key: "24h", label: "24시간", hours: 24 },
  { key: "week", label: "주간", hours: 24 * 7 },
] as const;

export type WindowKey = (typeof TIME_WINDOWS)[number]["key"];

export const DEFAULT_WINDOW: WindowKey = "3h";

function hoursForWindow(key: string): number {
  return (
    TIME_WINDOWS.find(w => w.key === key)?.hours ??
    TIME_WINDOWS.find(w => w.key === DEFAULT_WINDOW)!.hours
  );
}

export type SortKey = "score" | "views" | "recommend" | "comments";

// 정렬 키가 동점이면 SQLite가 어떤 순서로 줄지 보장하지 않는다. OFFSET 페이지네이션에서
// 그 묶음이 페이지 경계에 걸치면 같은 글이 두 페이지에 다 실리거나(중복) 어느 쪽에도
// 안 실린다(누락). 실제로 같은 크롤 배치에 들어온 조회수 0인 글들은 점수와
// first_seen_at이 완전히 같아서 20개씩 묶음이 생긴다. 마지막에 고유 컬럼인 id를 붙여
// 순서를 확정한다.
const TIEBREAK = "p.first_seen_at DESC, p.id DESC";

function orderByClause(sort: SortKey): string {
  switch (sort) {
    case "views":
      return `p.view_count DESC, ${TIEBREAK}`;
    case "recommend":
      return `p.recommend_count DESC, ${TIEBREAK}`;
    case "comments":
      return `COALESCE(p.comment_count, 0) DESC, ${TIEBREAK}`;
    case "score":
    default:
      return `(p.view_count + p.recommend_count * 10) DESC, ${TIEBREAK}`;
  }
}

export async function getRankedPosts(options: {
  window: string;
  sort?: SortKey;
  // 복수 사이트 선택(다중 선택 필터) 지원. 비어있거나 undefined면 전체.
  site?: string[];
  // 제목 검색어. 넘기면 현재 기간/사이트/정렬 필터가 적용된 목록 "안에서" 제목에
  // 이 글자가 포함된 글만 추린다 (별도 검색 모드가 아니라 같은 필터의 연장선).
  titleQuery?: string;
  limit: number;
  offset: number;
}): Promise<PostWithSite[]> {
  const hours = hoursForWindow(options.window);
  const sort = options.sort ?? "score";
  const sites = options.site?.filter(Boolean) ?? [];
  const siteFilter = sites.length
    ? `AND s.slug IN (${sites.map(() => "?").join(",")})`
    : "";
  const titleQuery = options.titleQuery?.trim();
  const titleFilter = titleQuery ? "AND p.title LIKE ? ESCAPE '\\'" : "";

  const query = `
    SELECT p.id, p.title, p.url, p.author,
           p.view_count as viewCount, p.recommend_count as recommendCount,
           p.comment_count as commentCount, p.category,
           p.posted_at_raw as postedAtRaw, p.first_seen_at as firstSeenAt,
           p.crawled_at as crawledAt,
           s.slug as siteSlug, s.name as siteName
    FROM posts p
    JOIN sites s ON p.site_id = s.id
    WHERE p.first_seen_at >= datetime('now', ?)
    ${siteFilter}
    ${titleFilter}
    ORDER BY ${orderByClause(sort)}
    LIMIT ? OFFSET ?
  `;

  const binds: unknown[] = [`-${hours} hours`];
  if (sites.length) binds.push(...sites);
  if (titleQuery) {
    // % _ \ 는 LIKE 와일드카드로 해석되니 검색어에 그대로 들어있으면 이스케이프한다.
    binds.push(`%${titleQuery.replace(/[\\%_]/g, ch => `\\${ch}`)}%`);
  }
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
            s.slug as siteSlug, s.name as siteName
     FROM posts p
     JOIN sites s ON p.site_id = s.id
     WHERE p.id = ?`
  )
    .bind(id)
    .first<PostWithSite>();
  return row ?? null;
}
