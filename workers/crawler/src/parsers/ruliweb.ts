import { parseIntSafe, type RawPost } from "../types";

const LIST_URL = "https://m.ruliweb.com/best/humor/now";
const BASE_URL = "https://m.ruliweb.com";

export async function fetchRuliweb(): Promise<RawPost[]> {
  const res = await fetch(LIST_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });

  const rows: Partial<RawPost>[] = [];

  const rewriter = new HTMLRewriter().on("a[href*='/read/']", {
    element(el) {
      const href = el.getAttribute("href");
      if (!href) return;
      const match = href.match(/\/read\/(\d+)/);
      if (!match) return;
      const sourcePostId = match[1];
      const fullUrl = new URL(href, BASE_URL).toString();

      if (rows.some(r => r.sourcePostId === sourcePostId)) return;

      rows.push({
        sourcePostId,
        title: "",
        url: fullUrl,
        author: null,
        viewCount: 0,
        recommendCount: 0,
        commentCount: 0,
        category: null,
        thumbnailUrl: null,
        postedAtRaw: null,
      });
    },
    text(chunk) {
      const row = rows[rows.length - 1];
      if (!row) return;
      const txt = chunk.text.trim();
      if (txt && !row.title && txt.length > 2) {
        row.title = txt;
      }
    },
  });

  await rewriter.transform(res).arrayBuffer();

  return rows.filter(
    (r): r is RawPost => !!r.sourcePostId && !!r.title && !!r.url
  );
}
