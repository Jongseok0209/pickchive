// 오늘의유머는 해외 IP를 HTTP 403으로 차단한다(2026-08-16 확정).
// Cloudflare Workers의 크론은 어느 콜로에서 실행될지 제어할 수 없어서,
// 파리(CDG) 같은 해외 콜로에 걸리면 매번 403 → 0건으로 실패했다. 반대로
// 한국 엣지에서 실행될 때는 항상 성공(수동 호출 24회 연속 성공으로 확인).
//
//   실패 기록 예: "0 posts (empty list) [colo=CDG status=403]"
//
// 그래서 펨코와 동일하게, 늘 켜져 있는 이 맥미니(한국 가정용 IP)에서 직접
// 수집해 크롤러 워커의 /ingest로 보낸다. 워커 쪽 파서는 HTMLRewriter(Workers
// 전용)를 쓰므로 여기서는 Node에서 도는 정규식 파서로 다시 구현했다.
const LIST_URLS = [
  "https://www.todayhumor.co.kr/board/list.php?table=bestofbest",
  "https://www.todayhumor.co.kr/board/list.php?table=humorbest",
];
const BASE_URL = "https://www.todayhumor.co.kr";
const INGEST_URL = "https://pickchive-crawler.won0209.workers.dev/ingest";

function parseIntSafe(text) {
  if (!text) return 0;
  const cleaned = String(text).replace(/[^0-9-]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, "").trim();
}

function decodeEntities(s) {
  let decoded = s;
  let prev = "";
  while (decoded !== prev) {
    prev = decoded;
    decoded = decoded
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#0*39;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
        String.fromCharCode(parseInt(code, 16))
      );
  }
  return decoded;
}

// 목록 행은 <tr class="view ..."> 형태이고, 그 안에 td.subject/td.name/
// td.hits/td.oknok/td.date가 들어있다(워커 쪽 HTMLRewriter 셀렉터와 동일한 구조).
function parseList(html) {
  const posts = [];
  const rows = html.match(/<tr[^>]*class="[^"]*\bview\b[^"]*"[^>]*>[\s\S]*?<\/tr>/g) || [];

  for (const row of rows) {
    const linkMatch = row.match(
      /<td[^>]*class="[^"]*\bsubject\b[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/
    );
    if (!linkMatch) continue;

    const href = decodeEntities(linkMatch[1]);
    const idMatch = href.match(/no=(\d+)/);
    if (!idMatch) continue;
    const title = decodeEntities(stripTags(linkMatch[2]));
    if (!title) continue;

    const cell = name =>
      row.match(
        new RegExp(`<td[^>]*class="[^"]*\\b${name}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/td>`)
      )?.[1];

    posts.push({
      sourcePostId: idMatch[1],
      title,
      url: new URL(href, BASE_URL).toString(),
      author: cell("name") ? decodeEntities(stripTags(cell("name"))) : null,
      viewCount: parseIntSafe(stripTags(cell("hits") ?? "")),
      recommendCount: parseIntSafe(stripTags(cell("oknok") ?? "")),
      // 오늘의유머 목록에는 댓글수 컬럼 자체가 없다(0이 정상, 파싱 버그 아님).
      commentCount: 0,
      category: null,
      thumbnailUrl: null,
      postedAtRaw: cell("date") ? stripTags(cell("date")) : null,
    });
  }
  return posts;
}

async function fetchList(listUrl) {
  const res = await fetch(listUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: "https://www.todayhumor.co.kr/",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Upgrade-Insecure-Requests": "1",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseList(await res.text());
}

async function crawlTodayhumor() {
  // 게시판 하나가 실패해도 다른 쪽 결과는 살린다(워커 파서와 동일한 방침).
  const settled = await Promise.allSettled(LIST_URLS.map(fetchList));
  const bySourcePostId = new Map();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const post of r.value) {
      if (!bySourcePostId.has(post.sourcePostId)) {
        bySourcePostId.set(post.sourcePostId, post);
      }
    }
  }
  const posts = [...bySourcePostId.values()];

  if (posts.length === 0) {
    const firstError = settled.find(r => r.status === "rejected")?.reason;
    return {
      slug: "todayhumor",
      posts: [],
      error: `0 posts (home). ${firstError?.message ?? "empty list"}`,
    };
  }
  return { slug: "todayhumor", posts };
}

async function run() {
  const ts = new Date().toISOString();
  try {
    const data = await crawlTodayhumor();
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const text = await res.text();
    console.log(
      `[todayhumor-home] ${ts} posts=${data.posts.length} ingest="${text}"`
    );
  } catch (err) {
    console.error(`[todayhumor-home] ${ts} error:`, err?.message ?? err);
  }
}

run();
