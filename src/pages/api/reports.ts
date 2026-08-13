import type { APIRoute } from "astro";
import { reportComment } from "@/lib/comments";
import { checkRateLimit, clientIp } from "@/lib/ratelimit";

export const prerender = false;

export const POST: APIRoute = async ({ request, session, redirect }) => {
  const userId = await session?.get("userId");
  const form = await request.formData();
  const commentId = Number(form.get("commentId"));
  const postId = Number(form.get("postId"));
  const reason = String(form.get("reason") ?? "").trim() || null;

  if (!userId) {
    return redirect("/login", 302);
  }
  if (!commentId || !postId) {
    return redirect("/", 302);
  }

  const ip = clientIp(request);
  const allowed = await checkRateLimit(`report:${userId}:${ip}`, 20, 60 * 60);
  if (!allowed) {
    return redirect(`/p/${postId}?error=너무 많이 신고했어요. 잠시 후 다시 시도해주세요.`, 302);
  }

  await reportComment(commentId, userId, reason);
  return redirect(`/p/${postId}?notice=신고가 접수됐어요.#comments`, 302);
};
