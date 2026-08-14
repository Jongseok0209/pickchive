// 펨코(에펨코리아)는 데이터센터 IP(Cloudflare Workers, GitHub Actions)를 전부
// 차단한다(HTTP 430, "에펨코리아 보안 시스템" 페이지 — JS 챌린지가 아니라 순수
// IP 평판 차단이라 Playwright로도 못 뚫음, 2026-08-14 확인). 반대로 가정용 IP는
// 안 막혀 있어서, 늘 켜져 있는 이 맥미니에서 launchd로 5분마다 직접 수집해
// 크롤러 워커의 /ingest로 보낸다. 헤드리스 브라우저 없이 그냥 fetch로 충분함
// (JS 실행이 필요한 페이지가 아니라 서버에서 완성된 HTML을 그대로 줌).
const LIST_URL = "https://www.fmkorea.com/best?listStyle=list";
const INGEST_URL = "https://pickchive-crawler.won0209.workers.dev/ingest";

// 조회수는 "5만"처럼 만 단위로 축약해서 나온다. 그냥 숫자만 남기면
// "5만" -> 5로 잘못 읽혀서(실제 50000) 조회수가 추천수보다 훨씬 작게
// 나오는 버그가 있었다(2026-08-14 확인).
function parseNum(text) {
  if (!text) return 0;
  const t = text.trim();
  const manMatch = t.match(/([0-9.]+)\s*만/);
  if (manMatch) return Math.round(parseFloat(manMatch[1]) * 10000);
  const cleaned = t.replace(/[^0-9-]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, "").trim();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'");
}

async function crawlFmkorea() {
  const res = await fetch(LIST_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });

  const html = await res.text();

  if (!res.ok) {
    return { slug: "fmkorea", posts: [], error: `HTTP ${res.status}` };
  }

  const posts = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];

  for (const row of rows) {
    const titleMatch = row.match(
      /<a href="([^"]*document_srl=(\d+))" class="hx"[^>]*>([\s\S]*?)<\/a>/
    );
    if (!titleMatch) continue;

    const href = decodeEntities(titleMatch[1]);
    const sourcePostId = titleMatch[2];
    const title = decodeEntities(stripTags(titleMatch[3]));
    if (!title) continue;

    const commentMatch = row.match(/class="replyNum"[^>]*>(\d+)</);
    const authorMatch = row.match(
      /<td class="author">[\s\S]*?<a[^>]*class='member[^']*'[^>]*>([\s\S]*?)<\/a>/
    );
    const timeMatch = row.match(/<td class="time">\s*([^<]*)\s*<\/td>/);
    const recoMatch = row.match(
      /<td class="m_no m_no_voted">\s*([^<]*)\s*<\/td>/
    );
    const viewMatch = row.match(/<td class="m_no">\s*([^<]*)\s*<\/td>/);

    posts.push({
      sourcePostId,
      title,
      url: "https://www.fmkorea.com" + href,
      author: authorMatch ? decodeEntities(stripTags(authorMatch[1])) : null,
      viewCount: parseNum(viewMatch?.[1]),
      recommendCount: parseNum(recoMatch?.[1]),
      commentCount: parseNum(commentMatch?.[1]),
      category: null,
      thumbnailUrl: null,
      postedAtRaw: timeMatch ? timeMatch[1].trim() : null,
    });
  }

  if (posts.length === 0) {
    return {
      slug: "fmkorea",
      posts: [],
      error: `0 posts after parse. status=${res.status} len=${html.length}`,
    };
  }
  return { slug: "fmkorea", posts };
}

async function run() {
  const ts = new Date().toISOString();
  try {
    const data = await crawlFmkorea();
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const text = await res.text();
    console.log(`[fmkorea-home] ${ts} posts=${data.posts.length} ingest="${text}"`);
  } catch (err) {
    console.error(`[fmkorea-home] ${ts} error:`, err?.message ?? err);
  }
}

run();
