import { env } from "cloudflare:workers";

// 간단한 고정 윈도우 rate limit (KV 기반). 정확한 슬라이딩 윈도우는 아니지만
// 어뷰징 방지 목적의 MVP 수준으로는 충분하다.
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const kvKey = `ratelimit:${key}`;
  const current = await env.SESSION.get(kvKey);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= limit) return false;
  await env.SESSION.put(kvKey, String(count + 1), {
    expirationTtl: windowSeconds,
  });
  return true;
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
