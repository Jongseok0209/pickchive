import type { RawPost, Env } from "./types";

export async function getSiteId(
  db: D1Database,
  slug: string
): Promise<number> {
  const row = await db
    .prepare("SELECT id FROM sites WHERE slug = ?")
    .bind(slug)
    .first<{ id: number }>();
  if (!row) throw new Error(`Unknown site slug: ${slug}`);
  return row.id;
}

// HTML 속성값에서 뽑아낸 URL에는 &amp; 같은 엔티티가 그대로 남아있을 수 있다.
// 그대로 저장하면 "?id=free&amp;no=123"처럼 되어 쿼리 파라미터가 깨지고
// 글이 아닌 엉뚱한 페이지로 연결된다(slrclub에서 실제로 98/99건 발생).
// 파서마다 놓치기 쉬운 실수라 저장 직전에 한 번 더 정규화한다.
function normalizeUrl(url: string): string {
  return url
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/g, "&")
    .replace(/&#x0*26;/gi, "&");
}

export async function upsertPosts(
  db: D1Database,
  siteId: number,
  posts: RawPost[]
): Promise<void> {
  if (posts.length === 0) return;

  // D1 SQL 변수 제한(100개) 초과 방지를 위해 40개 단위 둔크 분할
  const CHUNK_SIZE = 40;
  for (let i = 0; i < posts.length; i += CHUNK_SIZE) {
    const chunk = posts.slice(i, i + CHUNK_SIZE);

    const upsertStmt = db.prepare(`
      INSERT INTO posts (
        site_id, source_post_id, title, url, author,
        view_count, recommend_count, comment_count, category,
        thumbnail_url, posted_at_raw, first_seen_at, crawled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT (site_id, source_post_id) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        author = excluded.author,
        view_count = excluded.view_count,
        recommend_count = excluded.recommend_count,
        comment_count = excluded.comment_count,
        category = excluded.category,
        thumbnail_url = excluded.thumbnail_url,
        posted_at_raw = excluded.posted_at_raw,
        crawled_at = datetime('now')
    `);

    const upsertBatch = chunk.map(p =>
      upsertStmt.bind(
        siteId,
        p.sourcePostId,
        p.title,
        normalizeUrl(p.url),
        p.author,
        p.viewCount,
        p.recommendCount,
        p.commentCount,
        p.category,
        p.thumbnailUrl,
        p.postedAtRaw
      )
    );
    await db.batch(upsertBatch);

    const ranked = [...chunk].sort((a, b) => b.viewCount - a.viewCount);
    const placeholders = chunk.map(() => "?").join(",");
    const idRows = await db
      .prepare(
        `SELECT id, source_post_id FROM posts WHERE site_id = ? AND source_post_id IN (${placeholders})`
      )
      .bind(siteId, ...chunk.map(p => p.sourcePostId))
      .all<{ id: number; source_post_id: string }>();

    const idBySourcePostId = new Map(
      idRows.results.map(r => [r.source_post_id, r.id])
    );

    const snapshotStmt = db.prepare(
      `INSERT INTO rank_snapshots (post_id, crawled_at, rank, view_count) VALUES (?, datetime('now'), ?, ?)`
    );
    const snapshotBatch = ranked
      .map((p, idx) => {
        const postId = idBySourcePostId.get(p.sourcePostId);
        if (!postId) return null;
        return snapshotStmt.bind(postId, idx + 1, p.viewCount);
      })
      .filter((s): s is D1PreparedStatement => s !== null);

    if (snapshotBatch.length > 0) {
      await db.batch(snapshotBatch);
    }
  }
}

export async function recordCrawlRun(
  db: D1Database,
  slug: string,
  postCount: number,
  error?: string
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO crawl_runs (slug, post_count, ok, error) VALUES (?, ?, ?, ?)`
      )
      .bind(slug, postCount, postCount > 0 ? 1 : 0, error ?? null)
      .run();
  } catch {
    // 기록 실패가 크롤 자체를 막지 않도록 삼킨다
  }
}

/** 한 번의 scheduled() 실행에서 어느 사이트부터 처리할지 가리키는 커서.
 * 12개를 한 번에 다 돌리면 CPU 시간 제한에 걸려 매번 clien 직후 강제
 * 종료됐다(2026-08-16 확인) — 실행마다 일부만 처리하고 커서를 이어간다. */
export async function getCronCursor(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT next_index FROM cron_cursor WHERE id = 1`)
    .first<{ next_index: number }>();
  return row?.next_index ?? 0;
}

export async function setCronCursor(
  db: D1Database,
  nextIndex: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO cron_cursor (id, next_index) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET next_index = excluded.next_index`
    )
    .bind(nextIndex)
    .run();
}

// 시작 시점에 먼저 기록해두고 끝나면 업데이트하는 2단계 방식. CPU 시간 제한처럼
// JS 예외로 안 잡히는 강제 종료가 나도 "시작은 했는데 안 끝난" 행이 그대로
// 남아서, /status에서 "배치가 도중에 죽었다"를 바로 알아볼 수 있다.
export async function startCronBatch(
  db: D1Database,
  sites: string[]
): Promise<number | null> {
  try {
    const row = await db
      .prepare(`INSERT INTO cron_batches (sites) VALUES (?) RETURNING id`)
      .bind(sites.join(","))
      .first<{ id: number }>();
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export async function finishCronBatch(
  db: D1Database,
  id: number | null,
  sitesOk: number,
  error?: string
): Promise<void> {
  if (id === null) return;
  try {
    await db
      .prepare(
        `UPDATE cron_batches SET finished_at = datetime('now'), sites_ok = ?, error = ? WHERE id = ?`
      )
      .bind(sitesOk, error ?? null, id)
      .run();
  } catch {
    // 기록 실패가 크롤 자체를 막지 않도록 삼킨다
  }
}

/** 최근 크론 배치 실행 이력 (/health, /status 용) */
export async function getRecentCronBatches(
  db: D1Database,
  limit = 10
): Promise<unknown[]> {
  const { results } = await db
    .prepare(
      `SELECT id, started_at, finished_at, sites, sites_ok, error
       FROM cron_batches ORDER BY started_at DESC LIMIT ?`
    )
    .bind(limit)
    .all();
  return results;
}

/** 사이트별 최근 크롤 상태 요약 (/health 용) */
export async function getCrawlHealth(db: D1Database): Promise<unknown[]> {
  const { results } = await db
    .prepare(
      `SELECT s.slug,
              (SELECT CAST((julianday('now') - julianday(MAX(p.crawled_at))) * 1440 AS INT)
                 FROM posts p WHERE p.site_id = s.id) AS mins_since_post_update,
              (SELECT COUNT(*) FROM posts p WHERE p.site_id = s.id) AS posts,
              (SELECT r.post_count FROM crawl_runs r WHERE r.slug = s.slug
                ORDER BY r.ran_at DESC LIMIT 1) AS last_count,
              (SELECT CAST((julianday('now') - julianday(MAX(r.ran_at))) * 1440 AS INT)
                 FROM crawl_runs r WHERE r.slug = s.slug AND r.ok = 1) AS mins_since_ok,
              (SELECT COUNT(*) FROM crawl_runs r
                WHERE r.slug = s.slug AND r.ok = 0
                  AND r.ran_at >= datetime('now', '-1 day')) AS fails_24h,
              (SELECT r.error FROM crawl_runs r WHERE r.slug = s.slug AND r.error IS NOT NULL
                ORDER BY r.ran_at DESC LIMIT 1) AS last_error
       FROM sites s ORDER BY s.slug`
    )
    .all();
  return results;
}

export async function cleanupOldData(db: Env["DB"]): Promise<{
  postsDeleted: number;
  snapshotsDeleted: number;
}> {
  // 목록에서 밀려나 더 이상 재수집되지 않는(=crawled_at이 갱신을 멈춘) 글은
  // 지운다. 단, 홈 화면 시간필터에 "주간"(TIME_WINDOWS의 week, 7일)이 있어서
  // 그보다 짧게 잡으면(예: 24시간) 대부분의 글이 하루 안에 지워져 주간 필터가
  // 사실상 텅 비어버린다(대부분 사이트 목록에서 몇 시간 안에 밀려나므로).
  // 그래서 가장 긴 필터 창(7일)과 맞춰서, 어떤 필터로도 더는 보일 수 없는
  // 시점에만 지운다. 처음 본 지 30일 지난 글도 별도로 지운다(둘 중 하나만
  // 걸려도 삭제).
  const postsResult = await db
    .prepare(
      `DELETE FROM posts WHERE first_seen_at < datetime('now', '-30 days')
        OR crawled_at < datetime('now', '-7 days')`
    )
    .run();
  const snapshotsResult = await db
    .prepare(
      `DELETE FROM rank_snapshots WHERE crawled_at < datetime('now', '-3 days')`
    )
    .run();

  return {
    postsDeleted: postsResult.meta.changes ?? 0,
    snapshotsDeleted: snapshotsResult.meta.changes ?? 0,
  };
}
