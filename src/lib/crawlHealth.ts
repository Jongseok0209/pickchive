import { env } from "cloudflare:workers";

export interface SiteCrawlHealth {
  slug: string;
  name: string;
  postCount: number;
  lastAttemptAt: string | null;
  lastAttemptOk: number | null;
  lastAttemptCount: number | null;
  lastSuccessAt: string | null;
  fails24h: number;
  attempts24h: number;
  lastError: string | null;
}

// /workers/crawler/src/db.ts의 getCrawlHealth(크롤러 자체 /health용)와 같은
// crawl_runs 테이블을 보되, 여기서는 "시도조차 없었는지"까지 구분하려고
// 마지막 시도(성공/실패 무관)와 마지막 "성공"을 따로 뽑는다.
export async function getSiteCrawlHealth(): Promise<SiteCrawlHealth[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.slug, s.name,
            (SELECT COUNT(*) FROM posts p WHERE p.site_id = s.id) AS postCount,
            (SELECT r.ran_at FROM crawl_runs r WHERE r.slug = s.slug
              ORDER BY r.ran_at DESC LIMIT 1) AS lastAttemptAt,
            (SELECT r.ok FROM crawl_runs r WHERE r.slug = s.slug
              ORDER BY r.ran_at DESC LIMIT 1) AS lastAttemptOk,
            (SELECT r.post_count FROM crawl_runs r WHERE r.slug = s.slug
              ORDER BY r.ran_at DESC LIMIT 1) AS lastAttemptCount,
            (SELECT MAX(r.ran_at) FROM crawl_runs r
              WHERE r.slug = s.slug AND r.ok = 1) AS lastSuccessAt,
            (SELECT COUNT(*) FROM crawl_runs r WHERE r.slug = s.slug AND r.ok = 0
              AND r.ran_at >= datetime('now', '-1 day')) AS fails24h,
            (SELECT COUNT(*) FROM crawl_runs r WHERE r.slug = s.slug
              AND r.ran_at >= datetime('now', '-1 day')) AS attempts24h,
            (SELECT r.error FROM crawl_runs r WHERE r.slug = s.slug AND r.error IS NOT NULL
              ORDER BY r.ran_at DESC LIMIT 1) AS lastError
     FROM sites s ORDER BY s.slug`
  ).all<SiteCrawlHealth>();
  return results;
}

export interface CrawlRunLogEntry {
  slug: string;
  siteName: string;
  ranAt: string;
  ok: number;
  postCount: number;
  error: string | null;
  source: string | null;
}

// 사이트별 요약(getSiteCrawlHealth)만으로는 "몇 시 몇 분에 어느 사이트가
// 성공/실패했는지"라는 시간순 흐름이 안 보인다 — 크론 배치 진단이 Cloudflare
// Cron 쪽만 보여주는 것과 별개로, GitHub Actions 몫까지 포함한 전체 시도
// 이력을 그대로 시간순으로 보여준다.
export async function getRecentCrawlRuns(
  limit = 60
): Promise<CrawlRunLogEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.slug, s.name as siteName, r.ran_at as ranAt, r.ok,
            r.post_count as postCount, r.error, r.source
     FROM crawl_runs r
     JOIN sites s ON s.slug = r.slug
     ORDER BY r.ran_at DESC LIMIT ?`
  )
    .bind(limit)
    .all<CrawlRunLogEntry>();
  return results;
}
