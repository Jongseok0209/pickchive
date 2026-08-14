import { parseIntSafe, type RawPost } from "../types";

const LIST_URL = "https://www.slrclub.com/bbs/zboard.php?id=best_article";
const BASE_URL = "https://www.slrclub.com";

export async function fetchSlrclub(): Promise<RawPost[]> {
  const res = await fetch(LIST_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });

  const html = await res.text();
  const rows: RawPost[] = [];
  const trMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const tr of trMatches) {
    const linkMatch = tr.match(/href=["'](\/bbs\/vx2\.php\?[^"']*no=(\d+)[^"']*)["']/i);
    if (!linkMatch) continue;

    const rawUrl = linkMatch[1];
    const sourcePostId = linkMatch[2];

    const titleMatch = tr.match(/<td[^>]*class=["']sbj["'][^>]*>([\s\S]*?)<\/td>/i);
    if (!titleMatch) continue;

    let title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
    // 댓글수 [27] 분리
    const commentMatch = title.match(/\[(\d+)\]$/);
    const commentCount = commentMatch ? parseIntSafe(commentMatch[1]) : 0;
    title = title.replace(/\[\d+\]$/, "").trim();

    if (!title || title.length < 2 || rows.some(r => r.sourcePostId === sourcePostId)) continue;

    const authorMatch = tr.match(/<td[^>]*class=["']list_name["'][^>]*>([\s\S]*?)<\/td>/i);
    const author = authorMatch ? authorMatch[1].replace(/<[^>]+>/g, "").trim() : null;

    const categoryMatch = tr.match(/<td[^>]*class=["']list_ctgry["'][^>]*>([\s\S]*?)<\/td>/i);
    const category = categoryMatch ? categoryMatch[1].replace(/<[^>]+>/g, "").trim() : null;

    const voteMatch = tr.match(/<td[^>]*class=["']list_vote[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const recommendCount = voteMatch ? parseIntSafe(voteMatch[1]) : 0;

    const clickMatch = tr.match(/<td[^>]*class=["']list_click[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const viewCount = clickMatch ? parseIntSafe(clickMatch[1]) : 0;

    const dateMatch = tr.match(/<td[^>]*class=["']list_date[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const postedAtRaw = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, "").trim() : null;

    rows.push({
      sourcePostId,
      title,
      url: new URL(rawUrl, BASE_URL).toString(),
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
