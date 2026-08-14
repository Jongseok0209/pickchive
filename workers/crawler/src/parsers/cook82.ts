import { fetchHtml, parseIntSafe, type RawPost } from "../types";

const LIST_URL = "https://www.82cook.com/entiz/enti.php?bn=15";
const BASE_URL = "https://www.82cook.com/entiz/";

function extractNum(href: string): string | null {
  try {
    const url = new URL(href, BASE_URL);
    return url.searchParams.get("num");
  } catch {
    return null;
  }
}

// 82cook 게시판 목록에는 추천수 컬럼이 없음 (제목/작성자/날짜/조회만 제공) — recommendCount는 항상 0으로 둔다.
export async function fetchCook82(): Promise<RawPost[]> {
  const res = await fetchHtml(LIST_URL);
  const rows: Partial<RawPost>[] = [];
  let skipCurrent = false;
  let numbersSeenInRow = 0;

  let capturingTitle = false;
  let titleText = "";
  let capturingComment = false;
  let commentText = "";
  let capturingAuthor = false;
  let authorText = "";
  let capturingViews = false;
  let viewsText = "";

  const rewriter = new HTMLRewriter()
    .on("#bbs table tbody tr", {
      element(el) {
        const cls = el.getAttribute("class") ?? "";
        skipCurrent = cls.includes("noticeList");
        numbersSeenInRow = 0;
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
    .on("#bbs table tbody tr td.title a", {
      element(el) {
        if (skipCurrent) return;
        const row = rows[rows.length - 1];
        if (!row) return;
        const href = el.getAttribute("href");
        if (href) {
          row.url = new URL(href, BASE_URL).toString();
          row.sourcePostId = extractNum(href) ?? undefined;
        }
        capturingTitle = true;
        titleText = "";
        el.onEndTag(() => {
          if (row && !row.title) row.title = titleText.trim();
          capturingTitle = false;
        });
      },
      text(chunk) {
        if (!capturingTitle) return;
        titleText += chunk.text;
      },
    })
    .on("#bbs table tbody tr td.title em", {
      element() {
        if (skipCurrent) return;
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
    .on("#bbs table tbody tr td.user_function", {
      element() {
        if (skipCurrent) return;
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
    .on("#bbs table tbody tr td.regdate", {
      element(el) {
        if (skipCurrent) return;
        const row = rows[rows.length - 1];
        if (row) row.postedAtRaw = el.getAttribute("title");
      },
    })
    .on('#bbs table tbody tr td[class="numbers"]', {
      element() {
        if (skipCurrent) return;
        numbersSeenInRow += 1;
        if (numbersSeenInRow === 2) {
          capturingViews = true;
          viewsText = "";
        }
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
