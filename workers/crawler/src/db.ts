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
        p.url,
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
