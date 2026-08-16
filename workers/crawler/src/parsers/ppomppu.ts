import { parseIntSafe, fetchTracked, type RawPost } from "../types";

const LIST_URL = "https://www.ppomppu.co.kr/zboard/zboard.php?id=freeboard";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 뽐뿌는 EUC-KR로 응답하므로 HTMLRewriter(UTF-8 가정)에 넘기기 전에 직접 디코딩한다.
async function fetchAsUtf8(url: string): Promise<Response> {
  const res = await fetchTracked(url, {
    headers: { "User-Agent": BROWSER_UA, "Accept-Language": "ko-KR,ko;q=0.9" },
  });
  const buf = await res.arrayBuffer();
  const decoded = new TextDecoder("euc-kr").decode(buf);
  return new Response(decoded, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function extractNo(href: string): string | null {
  try {
    const url = new URL(href, LIST_URL);
    return url.searchParams.get("no");
  } catch {
    return null;
  }
}

export async function fetchPpomppu(): Promise<RawPost[]> {
  const res = await fetchAsUtf8(LIST_URL);
  const rows: Partial<RawPost>[] = [];

  let capturingTitle = false;
  let titleText = "";
  let capturingAuthor = false;
  let authorText = "";
  let capturingRec = false;
  let recText = "";
  let capturingViews = false;
  let viewsText = "";

  const rewriter = new HTMLRewriter()
    .on("tr.baseList", {
      element() {
        rows.push({
          title: "",
          url: "",
          author: null,
          viewCount: 0,
          recommendCount: 0,
          commentCount: null,
          category: null,
          thumbnailUrl: null,
          postedAtRaw: null,
        });
      },
    })
    .on("tr.baseList a.baseList-title", {
      element(el) {
        const row = rows[rows.length - 1];
        if (!row) return;
        const href = el.getAttribute("href");
        if (!href) return;
        row.url = new URL(href, LIST_URL).toString();
        row.sourcePostId = extractNo(href) ?? undefined;
      },
    })
    .on("tr.baseList a.baseList-title span", {
      element() {
        capturingTitle = true;
        titleText = "";
      },
      text(chunk) {
        if (!capturingTitle) return;
        titleText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.title = titleText.trim();
          capturingTitle = false;
        }
      },
    })
    .on("tr.baseList span.baseList-name", {
      element() {
        capturingAuthor = true;
        authorText = "";
      },
      text(chunk) {
        if (!capturingAuthor) return;
        authorText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row && authorText.trim()) row.author = authorText.trim();
          capturingAuthor = false;
        }
      },
    })
    .on("tr.baseList td[title]", {
      element(el) {
        const row = rows[rows.length - 1];
        if (!row) return;
        row.postedAtRaw = el.getAttribute("title");
      },
    })
    .on("tr.baseList td.baseList-rec", {
      element() {
        capturingRec = true;
        recText = "";
      },
      text(chunk) {
        if (!capturingRec) return;
        recText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.recommendCount = parseIntSafe(recText);
          capturingRec = false;
        }
      },
    })
    .on("tr.baseList td.baseList-views", {
      element() {
        capturingViews = true;
        viewsText = "";
      },
      text(chunk) {
        if (!capturingViews) return;
        viewsText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.viewCount = parseIntSafe(viewsText);
          capturingViews = false;
        }
      },
    });

  await rewriter.transform(res).arrayBuffer();

  return rows.filter(
    (r): r is RawPost => !!r.sourcePostId && !!r.title && !!r.url
  );
}
