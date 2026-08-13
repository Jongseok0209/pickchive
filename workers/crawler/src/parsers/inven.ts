import { fetchHtml, parseIntSafe, type RawPost } from "../types";

const LIST_URL = "https://www.inven.co.kr/board/webzine/2097";

function extractPostId(href: string): string | null {
  const match = href.match(/\/board\/webzine\/2097\/(\d+)/);
  return match ? match[1] : null;
}

export async function fetchInven(): Promise<RawPost[]> {
  const res = await fetchHtml(LIST_URL);
  const rows: Partial<RawPost>[] = [];
  let skipCurrent = false;

  let inCategory = false;
  let categoryText = "";
  let titleText = "";
  let capturingUser = false;
  let userText = "";
  let capturingDate = false;
  let dateText = "";
  let capturingView = false;
  let viewText = "";
  let capturingReco = false;
  let recoText = "";

  const rewriter = new HTMLRewriter()
    .on("table.thumbnail tbody tr", {
      element(el) {
        const cls = el.getAttribute("class") ?? "";
        skipCurrent = cls.includes("notice");
        if (skipCurrent) return;
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
    .on("table.thumbnail tbody tr td.thumb img", {
      element(el) {
        if (skipCurrent) return;
        const row = rows[rows.length - 1];
        if (row && !row.thumbnailUrl) row.thumbnailUrl = el.getAttribute("src");
      },
    })
    .on("table.thumbnail tbody tr a.subject-link", {
      element(el) {
        if (skipCurrent) return;
        const row = rows[rows.length - 1];
        if (!row) return;
        const href = el.getAttribute("href");
        if (!href) return;
        row.url = href;
        row.sourcePostId = extractPostId(href) ?? undefined;
        titleText = "";
        categoryText = "";
        el.onEndTag(() => {
          if (row) row.title = titleText.trim();
        });
      },
      text(chunk) {
        if (skipCurrent) return;
        if (inCategory) {
          categoryText += chunk.text;
        } else {
          titleText += chunk.text;
        }
      },
    })
    .on("table.thumbnail tbody tr a.subject-link span.category", {
      element(el) {
        if (skipCurrent) return;
        inCategory = true;
        el.onEndTag(() => {
          const row = rows[rows.length - 1];
          if (row) row.category = categoryText.trim().replace(/^\[|\]$/g, "");
          inCategory = false;
        });
      },
    })
    .on("table.thumbnail tbody tr td.user span.layerNickName", {
      element() {
        if (skipCurrent) return;
        capturingUser = true;
        userText = "";
      },
      text(chunk) {
        if (!capturingUser || skipCurrent) return;
        userText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row && userText.trim()) row.author = userText.trim();
          capturingUser = false;
        }
      },
    })
    .on("table.thumbnail tbody tr td.date", {
      element() {
        if (skipCurrent) return;
        capturingDate = true;
        dateText = "";
      },
      text(chunk) {
        if (!capturingDate || skipCurrent) return;
        dateText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.postedAtRaw = dateText.trim();
          capturingDate = false;
        }
      },
    })
    .on("table.thumbnail tbody tr td.view", {
      element() {
        if (skipCurrent) return;
        capturingView = true;
        viewText = "";
      },
      text(chunk) {
        if (!capturingView || skipCurrent) return;
        viewText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.viewCount = parseIntSafe(viewText);
          capturingView = false;
        }
      },
    })
    .on("table.thumbnail tbody tr td.reco", {
      element() {
        if (skipCurrent) return;
        capturingReco = true;
        recoText = "";
      },
      text(chunk) {
        if (!capturingReco || skipCurrent) return;
        recoText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.recommendCount = parseIntSafe(recoText);
          capturingReco = false;
        }
      },
    });

  await rewriter.transform(res).arrayBuffer();

  return rows.filter(
    (r): r is RawPost => !!r.sourcePostId && !!r.title && !!r.url
  );
}
