import { env } from "cloudflare:workers";

export async function verifyTurnstile(
  token: string,
  remoteIp: string
): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  body.set("remoteip", remoteIp);

  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body }
  );
  const data = (await res.json()) as { success: boolean };
  return data.success === true;
}
