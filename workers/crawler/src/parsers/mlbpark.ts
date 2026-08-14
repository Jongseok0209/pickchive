import { parseIntSafe, type RawPost } from "../types";

const LIST_URL = "https://mlbpark.donga.com/mp/b.php?b=bullpen";
const BASE_URL = "https://mlbpark.donga.com";

// 2026-08-14 확인: 이 사이트는 요청 경로에 따라 두 가지 다른 응답을 준다.
// - 로컬 curl / Node fetch로는 매번 클라이언트 JS 렌더링 SPA 셸(글 목록 <tr> 없음,
//   .table_wrap/.body_item을 JS가 채움)만 내려온다.
// - Cloudflare Workers 런타임(wrangler dev, 실제 배포 환경과 동일한 fetch 경로)으로
//   호출하면 아래 셀렉터(a.txt/div.tit/span.viewV/span.replyCnt)가 매칭되는
//   서버 렌더링 HTML을 받는다(로컬 D1로 실제 크롤 테스트해 확인, 조회수/댓글수 정상 수집).
// 따라서 view_count/comment_count는 정상 동작하지만, recommend_count(추천수)는
// 목록 HTML에서 해당 셀렉터를 아직 찾지 못해 항상 0으로 고정되어 있다.
// 실제 배포 환경에서 받는 HTML을 기준으로 추천수 클래스명을 확인해 채워야 한다.
export async function fetchMlbpark(): Promise<RawPost[]> {
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
    const linkMatch = tr.match(/href=["']([^"']*id=(\d+)[^"']*)["']/i);
    if (!linkMatch || tr.includes("b=notice")) continue;

    const rawUrl = linkMatch[1];
    const sourcePostId = linkMatch[2];

    const titleMatch = tr.match(/<a[^>]*class=["']txt["'][^>]*>([\s\S]*?)<\/a>/i) ||
                       tr.match(/<div[^>]*class=["']tit["'][^>]*>([\s\S]*?)<\/div>/i);
    if (!titleMatch) continue;

    let title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
    if (!title || title.length < 2 || rows.some(r => r.sourcePostId === sourcePostId)) continue;

    const authorMatch = tr.match(/<span[^>]*class=["']nick["'][^>]*>([\s\S]*?)<\/span>/i);
    const author = authorMatch ? authorMatch[1].replace(/<[^>]+>/g, "").trim() : null;

    const categoryMatch = tr.match(/<a[^>]*class=["']list_word["'][^>]*>([\s\S]*?)<\/a>/i);
    const category = categoryMatch ? categoryMatch[1].replace(/<[^>]+>/g, "").trim() : null;

    const viewMatch = tr.match(/<span[^>]*class=["']viewV["'][^>]*>([\s\S]*?)<\/span>/i);
    const viewCount = viewMatch ? parseIntSafe(viewMatch[1]) : 0;

    const replyMatch = tr.match(/<span[^>]*class=["']replyCnt["'][^>]*>([\s\S]*?)<\/span>/i);
    const commentCount = replyMatch ? parseIntSafe(replyMatch[1]) : 0;

    const dateMatch = tr.match(/<span[^>]*class=["']date["'][^>]*>([\s\S]*?)<\/span>/i);
    const postedAtRaw = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, "").trim() : null;

    rows.push({
      sourcePostId,
      title,
      url: new URL(rawUrl, BASE_URL).toString(),
      author,
      viewCount,
      recommendCount: 0,
      commentCount,
      category,
      thumbnailUrl: null,
      postedAtRaw,
    });
  }

  return rows;
}
