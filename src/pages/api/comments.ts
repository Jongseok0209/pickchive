import type { APIRoute } from "astro";
import { addComment } from "@/lib/comments";
import { checkRateLimit, clientIp } from "@/lib/ratelimit";

export const prerender = false;

const MAX_COMMENT_LENGTH = 1000;

export const POST: APIRoute = async ({ request, session, redirect }) => {
  const userId = await session?.get("userId");
  const form = await request.formData();
  const postId = Number(form.get("postId"));
  const content = String(form.get("content") ?? "").trim();

  if (!userId) {
    return redirect("/login", 302);
  }
  if (!postId || !content) {
    return redirect(`/p/${postId}?error=내용을 입력해주세요.`, 302);
  }
  if (content.length > MAX_COMMENT_LENGTH) {
    return redirect(`/p/${postId}?error=댓글은 ${MAX_COMMENT_LENGTH}자 이하로 작성해주세요.`, 302);
  }

  const ip = clientIp(request);
  const allowed = await checkRateLimit(`comment:${userId}:${ip}`, 10, 60);
  if (!allowed) {
    return redirect(`/p/${postId}?error=너무 빨리 작성하고 있어요. 잠시 후 다시 시도해주세요.`, 302);
  }

  await addComment(postId, userId, content);
  return redirect(`/p/${postId}#comments`, 302);
};
