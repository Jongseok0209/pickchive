import type { APIRoute } from "astro";

export const prerender = false;

export const POST: APIRoute = async ({ session, redirect }) => {
  session?.destroy();
  return redirect("/", 302);
};
