import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { hashPassword, isValidUsername, isValidPassword } from "@/lib/auth";
import { verifyTurnstile } from "@/lib/turnstile";
import { checkRateLimit, clientIp } from "@/lib/ratelimit";

export const prerender = false;

type RedirectFn = (path: string) => Response;

function fail(redirect: RedirectFn, message: string): Response {
  return redirect(`/signup?error=${encodeURIComponent(message)}`);
}

export const POST: APIRoute = async ({ request, session, redirect }) => {
  const ip = clientIp(request);
  const allowed = await checkRateLimit(`signup:${ip}`, 5, 60 * 60);
  if (!allowed) {
    return fail(redirect, "너무 많이 시도했어요. 잠시 후 다시 시도해주세요.");
  }

  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const turnstileToken = String(form.get("cf-turnstile-response") ?? "");

  if (!(await verifyTurnstile(turnstileToken, ip))) {
    return fail(redirect, "자동입력 방지 인증에 실패했어요.");
  }
  if (!isValidUsername(username)) {
    return fail(redirect, "아이디는 한글/영문/숫자/_ 2~20자여야 해요.");
  }
  if (!isValidPassword(password)) {
    return fail(redirect, "비밀번호는 8자 이상이어야 해요.");
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE username = ?"
  )
    .bind(username)
    .first();
  if (existing) {
    return fail(redirect, "이미 사용 중인 아이디예요.");
  }

  const passwordHash = await hashPassword(password);
  const result = await env.DB.prepare(
    "INSERT INTO users (username, password_hash) VALUES (?, ?)"
  )
    .bind(username, passwordHash)
    .run();

  const userId = result.meta.last_row_id;
  session?.set("userId", userId);
  session?.set("username", username);

  return redirect("/", 302);
};
