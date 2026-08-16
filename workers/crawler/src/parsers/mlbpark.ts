import { parseIntSafe, fetchTracked, type RawPost } from "../types";

const LIST_URL = "https://mlbpark.donga.com/mp/b.php?b=bullpen";
const BASE_URL = "https://mlbpark.donga.com";

function parseRows(html: string): RawPost[] {
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

    // 목록 HTML에서 추천수 클래스를 아직 특정하지 못했다(2026-08-14). 항상 0으로 고정.
    // 실제로 정상 응답을 받았을 때의 HTML을 확보해 확인이 필요함(아래 재시도 관련 주석 참고).
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

// 2026-08-14 확인: 이 사이트는 같은 요청을 반복해도 응답이 들쭉날쭉하다.
// - 어떤 요청은 글 목록이 그대로 담긴 서버 렌더링 HTML(.txt/.tit/.viewV/.replyCnt 매칭됨)을 준다.
// - 어떤 요청은 클라이언트 JS가 채워야 하는 빈 SPA 셸(글 목록 <tr> 없음)만 준다.
// 로컬 curl/Node fetch로는 매번 셸만 왔지만, 같은 코드를 Cloudflare Workers 런타임
// (wrangler dev)으로 실행하면 셸/정상 응답이 섞여서 왔다 — 명확한 원인(요청 빈도 제한,
// 캐시 로테이션, A/B 등)은 특정하지 못했다. 재시도하면 대부분 성공하는 것을 확인했으므로,
// 빈 결과가 오면 정상 응답을 받을 때까지 잠깐 대기 후 재시도한다.
// Playwright(fmkorea/ruliweb 방식)로 옮기는 건 이 문제의 근본 해결책이 아니다 —
// 브라우저로 접근해도 동일한 origin의 비결정적 응답을 그대로 받을 뿐이라 효과가
// 불확실한 반면 GitHub Actions 실행 시간/복잡도만 늘어난다.
export async function fetchMlbpark(): Promise<RawPost[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchTracked(LIST_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
    });

    const html = await res.text();
    const rows = parseRows(html);
    if (rows.length > 0) return rows;

    if (attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 500 + attempt * 500));
    }
  }

  return [];
}
