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
        view_count = excluded.view_count,
        recommend_count = excluded.recommend_count,
        comment_count = excluded.comment_count,
        category = excluded.category,
        thumbnail_url = excluded.thumbnail_url,
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
  const postsResult = await db
    .prepare(
      `DELETE FROM posts WHERE first_seen_at < datetime('now', '-30 days')`
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
