import { fetchHtml, parseIntSafe, type RawPost } from "../types";

const LIST_URL = "https://www.bobaedream.co.kr/list?code=best";
const BASE_URL = "https://www.bobaedream.co.kr";

function extractNo(href: string): string | null {
  try {
    const url = new URL(href, BASE_URL);
    return url.searchParams.get("No");
  } catch {
    return null;
  }
}

export async function fetchBobaedream(): Promise<RawPost[]> {
  const res = await fetchHtml(LIST_URL);
  const rows: Partial<RawPost>[] = [];

  let capturingComment = false;
  let commentText = "";
  let capturingDate = false;
  let dateText = "";
  let capturingRec = false;
  let recText = "";
  let recAssigned = false;
  let capturingCount = false;
  let countText = "";

  const rewriter = new HTMLRewriter()
    .on("tr[itemtype]", {
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
        recAssigned = false;
      },
    })
    .on("tr[itemtype] td.category a", {
      element(el) {
        const row = rows[rows.length - 1];
        if (!row) return;
        row.category = el.getAttribute("title");
      },
    })
    .on("tr[itemtype] a.bsubject", {
      element(el) {
        const row = rows[rows.length - 1];
        if (!row) return;
        const href = el.getAttribute("href");
        if (!href) return;
        row.url = new URL(href, BASE_URL).toString();
        row.sourcePostId = extractNo(href) ?? undefined;
        row.title = (el.getAttribute("title") ?? "").trim() || row.title;
      },
    })
    .on("tr[itemtype] strong.totreply", {
      element() {
        capturingComment = true;
        commentText = "";
      },
      text(chunk) {
        if (!capturingComment) return;
        commentText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.commentCount = parseIntSafe(commentText);
          capturingComment = false;
        }
      },
    })
    .on("tr[itemtype] span.author", {
      element(el) {
        const row = rows[rows.length - 1];
        if (!row) return;
        row.author = el.getAttribute("title");
      },
    })
    .on("tr[itemtype] td.date", {
      element() {
        capturingDate = true;
        dateText = "";
      },
      text(chunk) {
        if (!capturingDate) return;
        dateText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.postedAtRaw = dateText.trim();
          capturingDate = false;
        }
      },
    })
    .on("tr[itemtype] td.recomm font", {
      element() {
        capturingRec = true;
        recText = "";
      },
      text(chunk) {
        if (!capturingRec) return;
        recText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row && !recAssigned && recText.trim()) {
            row.recommendCount = parseIntSafe(recText);
            recAssigned = true;
          }
          capturingRec = false;
        }
      },
    })
    .on("tr[itemtype] td.count", {
      element() {
        capturingCount = true;
        countText = "";
      },
      text(chunk) {
        if (!capturingCount) return;
        countText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.viewCount = parseIntSafe(countText);
          capturingCount = false;
        }
      },
    });

  await rewriter.transform(res).arrayBuffer();

  return rows.filter(
    (r): r is RawPost => !!r.sourcePostId && !!r.title && !!r.url
  );
}
