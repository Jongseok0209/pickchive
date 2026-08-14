import { parseIntSafe, type RawPost } from "../types";

// bestofbest(베스트 오브 베스트)만 보다가, humorbest(유머 베스트)도 같이
// 시도해달라는 요청으로 두 게시판을 합쳐서 가져온다. 둘 다 같은 HTML
// 구조를 쓴다.
const LIST_URLS = [
  "https://www.todayhumor.co.kr/board/list.php?table=bestofbest",
  "https://www.todayhumor.co.kr/board/list.php?table=humorbest",
];
const BASE_URL = "https://www.todayhumor.co.kr";

async function fetchTodayhumorList(listUrl: string): Promise<RawPost[]> {
  const res = await fetch(listUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });

  const rows: Partial<RawPost>[] = [];
  let currentTargetKey: "author" | "views" | "recom" | "date" | null = null;
  let textBuffer = "";

  const rewriter = new HTMLRewriter()
    .on("tr.view", {
      element() {
        rows.push({
          sourcePostId: "",
          title: "",
          url: "",
          author: null,
          viewCount: 0,
          recommendCount: 0,
          commentCount: 0,
          category: null,
          thumbnailUrl: null,
          postedAtRaw: null,
        });
      },
    })
    .on("tr.view td.subject a", {
      element(el) {
        const row = rows[rows.length - 1];
        if (!row) return;
        const href = el.getAttribute("href");
        if (href) {
          row.url = new URL(href, BASE_URL).toString();
          const match = href.match(/no=(\d+)/);
          if (match) row.sourcePostId = match[1];
        }
      },
      text(chunk) {
        const row = rows[rows.length - 1];
        if (!row) return;
        textBuffer += chunk.text;
        if (chunk.lastInTextNode) {
          const title = textBuffer.trim();
          if (title && !row.title) {
            row.title = title;
          }
          textBuffer = "";
        }
      },
    })
    .on("tr.view td.name", {
      element() {
        currentTargetKey = "author";
        textBuffer = "";
      },
      text(chunk) {
        if (currentTargetKey !== "author") return;
        textBuffer += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.author = textBuffer.trim();
          currentTargetKey = null;
          textBuffer = "";
        }
      },
    })
    .on("tr.view td.hits", {
      element() {
        currentTargetKey = "views";
        textBuffer = "";
      },
      text(chunk) {
        if (currentTargetKey !== "views") return;
        textBuffer += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.viewCount = parseIntSafe(textBuffer);
          currentTargetKey = null;
          textBuffer = "";
        }
      },
    })
    .on("tr.view td.oknok", {
      element() {
        currentTargetKey = "recom";
        textBuffer = "";
      },
      text(chunk) {
        if (currentTargetKey !== "recom") return;
        textBuffer += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.recommendCount = parseIntSafe(textBuffer);
          currentTargetKey = null;
          textBuffer = "";
        }
      },
    })
    .on("tr.view td.date", {
      element() {
        currentTargetKey = "date";
        textBuffer = "";
      },
      text(chunk) {
        if (currentTargetKey !== "date") return;
        textBuffer += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.postedAtRaw = textBuffer.trim();
          currentTargetKey = null;
          textBuffer = "";
        }
      },
    });

  await rewriter.transform(res).arrayBuffer();

  return rows.filter(
    (r): r is RawPost => !!r.sourcePostId && !!r.title && !!r.url
  );
}

export async function fetchTodayhumor(): Promise<RawPost[]> {
  const lists = await Promise.all(LIST_URLS.map(fetchTodayhumorList));

  // bestofbest와 humorbest에 같은 글이 겹쳐서 뜨는 경우가 있어 sourcePostId로 합친다.
  const bySourcePostId = new Map<string, RawPost>();
  for (const list of lists) {
    for (const post of list) {
      if (!bySourcePostId.has(post.sourcePostId)) {
        bySourcePostId.set(post.sourcePostId, post);
      }
    }
  }
  return [...bySourcePostId.values()];
}
