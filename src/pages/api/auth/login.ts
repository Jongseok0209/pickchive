import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { verifyPassword } from "@/lib/auth";
import { checkRateLimit, clientIp } from "@/lib/ratelimit";

export const prerender = false;

type RedirectFn = (path: string) => Response;

function fail(redirect: RedirectFn, message: string): Response {
  return redirect(`/login?error=${encodeURIComponent(message)}`);
}

export const POST: APIRoute = async ({ request, session, redirect }) => {
  const ip = clientIp(request);
  const allowed = await checkRateLimit(`login:${ip}`, 10, 60 * 60);
  if (!allowed) {
    return fail(redirect, "너무 많이 시도했어요. 잠시 후 다시 시도해주세요.");
  }

  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");

  const user = await env.DB.prepare(
    "SELECT id, username, password_hash FROM users WHERE username = ?"
  )
    .bind(username)
    .first<{ id: number; username: string; password_hash: string }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return fail(redirect, "아이디 또는 비밀번호가 올바르지 않아요.");
  }

  session?.set("userId", user.id);
  session?.set("username", user.username);

  return redirect("/", 302);
};
