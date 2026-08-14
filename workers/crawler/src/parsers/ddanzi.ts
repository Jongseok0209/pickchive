function decodeEntities(text: string): string {
  let decoded = text;
  let prev = "";
  while (decoded !== prev) {
    prev = decoded;
    decoded = decoded
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#039;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
  }
  return decoded;
}

import { parseIntSafe, type RawPost } from "../types";

const LIST_URL = "https://www.ddanzi.com/free";
const BASE_URL = "https://www.ddanzi.com";

export async function fetchDdanzi(): Promise<RawPost[]> {
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

  // TR 단위 수집을 통해 title, view_count, recommend_count, author 일치
  const trMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const tr of trMatches) {
    const linkMatch = tr.match(/href=["']([^"']*\/free\/(\d+))["']/i);
    if (!linkMatch) continue;

    const fullUrl = new URL(linkMatch[1], BASE_URL).toString();
    const sourcePostId = linkMatch[2];

    if (rows.some(r => r.sourcePostId === sourcePostId)) continue;

    // 제목 추출 (댓글 수 span 제거)
    const cleanTr = tr.replace(/<a[^>]*#comment[^>]*>[\s\S]*?<\/a>/gi, "");
    const titleMatch = cleanTr.match(/<td[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    let title = "";
    if (titleMatch) {
      title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
    }
    if (!title || title.length < 2 || title.includes("의인 전체 보기")) continue;

    // 추천수(동의) 추출: td.voteNum 내부. 추천수가 있는 글은 아이콘 <img style="width:16px;...">가
    // 숫자 앞에 붙는데, 태그를 제거하지 않고 parseIntSafe에 넘기면 style 속성의 "16" 등이
    // 실제 값 앞에 섞여 들어가(예: 항상 16으로 고정) 값이 깨진다. 태그를 먼저 제거한다.
    const voteMatch = tr.match(/<td[^>]*class=["'][^"']*voteNum[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const recommendCount = voteMatch ? parseIntSafe(voteMatch[1].replace(/<[^>]+>/g, "")) : 0;

    // 조회수 추출: td.readNum 또는 td.hit 내부
    const hitMatch = tr.match(/<td[^>]*class=["'][^"']*(?:readNum|hit)[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const viewCount = hitMatch ? parseIntSafe(hitMatch[1].replace(/<[^>]+>/g, "")) : 0;

    // 작성자 추출
    const authorMatch = tr.match(/<td[^>]*class=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const author = authorMatch ? authorMatch[1].replace(/<[^>]+>/g, "").trim() : null;

    // 댓글수 추출: <a href="...#comment"><span class="talk">[N]</span></a>
    const commentMatch = tr.match(/class=["']talk["'][^>]*>\s*\[(\d+)\]/i);
    const commentCount = commentMatch ? parseIntSafe(commentMatch[1]) : 0;

    rows.push({
      sourcePostId,
      title: decodeEntities(title),
      url: fullUrl,
      author,
      viewCount,
      recommendCount,
      commentCount,
      category: null,
      thumbnailUrl: null,
      postedAtRaw: null,
    });
  }

  return rows;
}
