import { env } from "cloudflare:workers";

const REPORT_HIDE_THRESHOLD = 3;

export interface CommentRow {
  id: number;
  content: string;
  createdAt: string;
  username: string;
  reportCount: number;
}

export async function getComments(postId: number): Promise<CommentRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.content, c.created_at as createdAt, u.username,
            (SELECT COUNT(*) FROM reports r WHERE r.comment_id = c.id) as reportCount
     FROM comments c
     JOIN users u ON c.user_id = u.id
     WHERE c.post_id = ? AND c.hidden = 0
     ORDER BY c.created_at ASC`
  )
    .bind(postId)
    .all<CommentRow>();
  return results;
}

export async function addComment(
  postId: number,
  userId: number,
  content: string
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)"
  )
    .bind(postId, userId, content)
    .run();
}

export async function reportComment(
  commentId: number,
  reporterUserId: number,
  reason: string | null
): Promise<void> {
  const comment = await env.DB.prepare(
    "SELECT user_id FROM comments WHERE id = ?"
  )
    .bind(commentId)
    .first<{ user_id: number }>();
  if (!comment || comment.user_id === reporterUserId) return; // 자기 댓글 신고 방지

  const existing = await env.DB.prepare(
    "SELECT id FROM reports WHERE comment_id = ? AND reporter_user_id = ?"
  )
    .bind(commentId, reporterUserId)
    .first();
  if (existing) return; // 중복 신고 방지

  await env.DB.prepare(
    "INSERT INTO reports (comment_id, reporter_user_id, reason) VALUES (?, ?, ?)"
  )
    .bind(commentId, reporterUserId, reason)
    .run();

  const { results } = await env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM reports WHERE comment_id = ?"
  )
    .bind(commentId)
    .all<{ cnt: number }>();

  if ((results[0]?.cnt ?? 0) >= REPORT_HIDE_THRESHOLD) {
    await env.DB.prepare("UPDATE comments SET hidden = 1 WHERE id = ?")
      .bind(commentId)
      .run();
  }
}
