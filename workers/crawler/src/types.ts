export interface RawPost {
  sourcePostId: string;
  title: string;
  url: string;
  author: string | null;
  viewCount: number;
  recommendCount: number;
  commentCount: number | null;
  category: string | null;
  thumbnailUrl: string | null;
  postedAtRaw: string | null;
}

export interface Env {
  DB: D1Database;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function fetchHtml(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });
}

export function parseIntSafe(text: string | null | undefined): number {
  if (!text) return 0;
  const cleaned = text.replace(/[^0-9-]/g, "");
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}
