import { parseIntSafe, fetchTracked, type RawPost } from "../types";

const LIST_URL = "https://www.etoland.co.kr/b/etohumor07/list";
const BASE_URL = "https://www.etoland.co.kr";

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export async function fetchEtoland(): Promise<RawPost[]> {
  const res = await fetchTracked(LIST_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });

  const html = await res.text();
  const rows: RawPost[] = [];

  // 목록은 <li class="flex h-9.5 items-center gap-1">...</li> 단위로 렌더링된다.
  const liMatches = html.match(/<li class="flex h-9\.5 items-center gap-1">[\s\S]*?<\/li>/g) || [];

  for (const li of liMatches) {
    const linkMatch = li.match(
      /<a[^>]*class="body-m[^"]*"[^>]*href="(\/b\/etohumor07\/view\/[^"]*-(\d+))"[^>]*>([\s\S]*?)<\/a>/
    );
    if (!linkMatch) continue;

    const href = linkMatch[1];
    const sourcePostId = linkMatch[2];
    const title = decodeEntities(linkMatch[3].replace(/<[^>]+>/g, "").trim());
    if (!title || title.length < 2) continue;
    if (rows.some(r => r.sourcePostId === sourcePostId)) continue;

    const categoryMatch = li.match(/href="\/b\/etohumor07\/list\?category=[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    const category = categoryMatch ? decodeEntities(categoryMatch[1].replace(/<[^>]+>/g, "").trim()) : null;

    const commentMatch = li.match(/class="comment-xs[^"]*"[^>]*>\(<!--\s*-->(\d+)<!--\s*-->\)/);
    const commentCount = commentMatch ? parseIntSafe(commentMatch[1]) : 0;

    const authorMatch = li.match(/class="nickname[^"]*">([\s\S]*?)<\/span>/);
    const author = authorMatch ? decodeEntities(authorMatch[1].replace(/<[^>]+>/g, "").trim()) : null;

    const timeMatch = li.match(
      /class="caption-s w-11 text-center font-tahoma text-etoText-2">([\s\S]*?)<\/div>/
    );
    const postedAtRaw = timeMatch ? timeMatch[1].trim() : null;

    const recoMatch = li.match(
      /class="caption-xs w-8 text-center font-bold font-tahoma text-good">([\s\S]*?)<\/div>/
    );
    const recommendCount = recoMatch ? parseIntSafe(recoMatch[1]) : 0;

    const viewMatch = li.match(
      /class="caption-s w-12 text-center font-tahoma text-etoText-2">([\s\S]*?)<\/div>/
    );
    const viewCount = viewMatch ? parseIntSafe(viewMatch[1]) : 0;

    rows.push({
      sourcePostId,
      title,
      url: new URL(href, BASE_URL).toString(),
      author,
      viewCount,
      recommendCount,
      commentCount,
      category,
      thumbnailUrl: null,
      postedAtRaw,
    });
  }

  return rows;
}
