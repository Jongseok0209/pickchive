function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

import { parseIntSafe, type RawPost } from "../types";

// 구 URL(bbs/rss.php?bo_table=free)은 /rss/free로 301 리다이렉트된다. fetch()가
// 리다이렉트를 자동으로 따라가므로 동작에는 문제없지만 신규 URL을 직접 사용한다.
const RSS_URL = "https://damoang.net/rss/free";

export async function fetchDamoang(): Promise<RawPost[]> {
  const res = await fetch(RSS_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
  });

  const xmlText = await res.text();
  const rows: RawPost[] = [];

  const items = xmlText.split("<item>");
  for (let i = 1; i < items.length; i++) {
    const item = items[i];
    const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const linkMatch = item.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
    const authorMatch = item.match(/<author>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/author>/);
    const dateMatch = item.match(/<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/);

    if (titleMatch && linkMatch) {
      const url = linkMatch[1].trim();
      const idMatch = url.match(/\/(\d+)$/);
      const sourcePostId = idMatch ? idMatch[1] : url;

      rows.push({
        sourcePostId,
        title: decodeEntities(titleMatch[1].trim()),
        url,
        author: authorMatch ? decodeEntities(authorMatch[1].trim()) : null,
        // RSS 피드는 title/link/author/pubDate만 제공하고 조회수·추천수·댓글수는
        // 아예 포함하지 않는다(HTML 스펙 자체의 한계, 파싱 실수 아님).
        // 실제 HTML 목록(/free)은 Cloudflare Turnstile 챌린지로 막혀 있어(2026-08-14 확인)
        // 일반 fetch로는 우회 불가 — fmkorea/ruliweb처럼 Playwright 헤드리스 브라우저
        // 경유가 필요하다. 값을 채우려면 scripts/crawl_protected.ts에 damoang을
        // 추가하는 방식을 검토할 것.
        viewCount: 0,
        recommendCount: 0,
        commentCount: 0,
        category: "자유게시판",
        thumbnailUrl: null,
        postedAtRaw: dateMatch ? dateMatch[1].trim() : null,
      });
    }
  }

  return rows;
}
