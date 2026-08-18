// SLR클럽은 데이터센터 IP를 차단한다 (2026-08-18 확정).
//
// Cloudflare Workers에서 나가면 HTTP 404("openresty" 기본 404 페이지)를 주고,
// 기록상으로는 521도 섞여 나왔다. 반면 한국 가정용 IP에서는 **User-Agent를 아예
// 안 보내거나 `curl/8.7.1`로 보내도 전부 HTTP 200**이다 — UA/헤더 문제가 아니라
// 순수 IP 기반 차단이라는 뜻이다.
//
//   워커 실패 기록 예: "0건 수집 — 응답은 받았으나 목록이 비어있음 (status=521 colo=CDG)"
//   /debug-fetch(HKG 콜로) 실측:  status=404, title="404 Not Found", server=openresty
//   맥미니(SK Broadband, 인천) 실측: HTTP 200, 글 링크 31건
//
// 2026-08-16까지는 워커에서 24시간 102회 중 96회 성공했는데 그 뒤 막혔다 —
// SLR클럽이 최근에 차단을 건 것으로 보인다. 그래서 펨코·오늘의유머와 동일하게
// 맥미니(한국 가정용 IP) launchd 경로로 옮겼다.
//
// 파서는 워커 쪽(`workers/crawler/src/parsers/slrclub.ts`)과 별개 구현이다 —
// 셀렉터를 고칠 땐 양쪽 다 손볼 것.
const LIST_URL = "https://www.slrclub.com/bbs/zboard.php?id=best_article";
const BASE_URL = "https://www.slrclub.com";
const INGEST_URL = "https://pickchive-crawler.won0209.workers.dev/ingest";

function parseIntSafe(text) {
  if (!text) return 0;
  const cleaned = String(text).replace(/[^0-9-]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, "").trim();
}

function parseList(html) {
  const posts = [];
  const trMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const tr of trMatches) {
    const linkMatch = tr.match(
      /href=["'](\/bbs\/vx2\.php\?[^"']*no=(\d+)[^"']*)["']/i
    );
    if (!linkMatch) continue;

    // HTML 속성값의 &amp;를 실제 &로 되돌리지 않으면 쿼리스트링이
    // "?id=free&amp;no=123"이 되어 no 파라미터가 인식되지 않고 글이 아닌
    // 사이트 첫 화면으로 연결된다(2026-08-14 확인, 98/99건 깨져 있었음).
    const rawUrl = linkMatch[1].replace(/&amp;/gi, "&");
    const sourcePostId = linkMatch[2];

    const titleMatch = tr.match(
      /<td[^>]*class=["']sbj["'][^>]*>([\s\S]*?)<\/td>/i
    );
    if (!titleMatch) continue;

    let title = stripTags(titleMatch[1]);
    // 제목 끝에 붙는 댓글수 [27] 분리
    const commentMatch = title.match(/\[(\d+)\]$/);
    const commentCount = commentMatch ? parseIntSafe(commentMatch[1]) : 0;
    title = title.replace(/\[\d+\]$/, "").trim();

    if (
      !title ||
      title.length < 2 ||
      posts.some(p => p.sourcePostId === sourcePostId)
    )
      continue;

    const authorMatch = tr.match(
      /<td[^>]*class=["']list_name["'][^>]*>([\s\S]*?)<\/td>/i
    );
    const categoryMatch = tr.match(
      /<td[^>]*class=["']list_ctgry["'][^>]*>([\s\S]*?)<\/td>/i
    );
    const voteMatch = tr.match(
      /<td[^>]*class=["']list_vote[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
    );
    const clickMatch = tr.match(
      /<td[^>]*class=["']list_click[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
    );
    const dateMatch = tr.match(
      /<td[^>]*class=["']list_date[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
    );

    posts.push({
      sourcePostId,
      title,
      url: new URL(rawUrl, BASE_URL).toString(),
      author: authorMatch ? stripTags(authorMatch[1]) : null,
      viewCount: clickMatch ? parseIntSafe(clickMatch[1]) : 0,
      recommendCount: voteMatch ? parseIntSafe(voteMatch[1]) : 0,
      commentCount,
      category: categoryMatch ? stripTags(categoryMatch[1]) : null,
      thumbnailUrl: null,
      postedAtRaw: dateMatch ? stripTags(dateMatch[1]) : null,
    });
  }

  return posts;
}

async function crawlSlrclub() {
  const res = await fetch(LIST_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });

  const html = await res.text();
  if (!res.ok) {
    return { slug: "slrclub", posts: [], error: `HTTP ${res.status}` };
  }

  const posts = parseList(html);
  if (posts.length === 0) {
    // 빈 결과도 반드시 이유를 남긴다(함정 19).
    return {
      slug: "slrclub",
      posts: [],
      error: `0 posts after parse (home). status=${res.status} len=${html.length}`,
    };
  }
  return { slug: "slrclub", posts };
}

async function run() {
  const ts = new Date().toISOString();
  try {
    const data = await crawlSlrclub();
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // source를 실어 보내야 /status 타임라인에서 이 맥미니 수집분을 크론·GitHub
      // Actions 결과와 구분할 수 있다.
      body: JSON.stringify({ ...data, source: "macmini" }),
    });
    const text = await res.text();
    console.log(
      `[slrclub-home] ${ts} posts=${data.posts.length} ingest="${text}"`
    );
  } catch (err) {
    console.error(`[slrclub-home] ${ts} error:`, err?.message ?? err);
  }
}

run();
