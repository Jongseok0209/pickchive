import { parseIntSafe, type RawPost } from "../types";

const LIST_URL = "https://www.fmkorea.com/best";
const BASE_URL = "https://www.fmkorea.com";

export async function fetchFmkorea(): Promise<RawPost[]> {
  const res = await fetch(LIST_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
    },
  });

  const html = await res.text();
  const rows: RawPost[] = [];

  const regex = /<a [^>]*href=["']([^"']*\/(?:best\/)?(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const rawUrl = match[1];
    const sourcePostId = match[2];
    const rawText = match[3].replace(/<[^>]+>/g, "").trim();

    if (!sourcePostId || !rawText || rawText.length < 2 || rawText.includes("추천")) {
      continue;
    }

    if (rows.some(r => r.sourcePostId === sourcePostId)) {
      continue;
    }

    rows.push({
      sourcePostId,
      title: rawText,
      url: new URL(rawUrl, BASE_URL).toString(),
      author: null,
      viewCount: 0,
      recommendCount: 0,
      commentCount: 0,
      category: null,
      thumbnailUrl: null,
      postedAtRaw: null,
    });
  }

  return rows;
}
