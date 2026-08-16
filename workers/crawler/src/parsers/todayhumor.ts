import { parseIntSafe, fetchTracked, type RawPost } from "../types";

// bestofbest(베스트 오브 베스트)만 보다가, humorbest(유머 베스트)도 같이
// 시도해달라는 요청으로 두 게시판을 합쳐서 가져온다. 둘 다 같은 HTML
// 구조를 쓴다.
const LIST_URLS = [
  "https://www.todayhumor.co.kr/board/list.php?table=bestofbest",
  "https://www.todayhumor.co.kr/board/list.php?table=humorbest",
];
const BASE_URL = "https://www.todayhumor.co.kr";

async function fetchTodayhumorList(listUrl: string): Promise<RawPost[]> {
  const res = await fetchTracked(listUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
      Referer: "https://www.todayhumor.co.kr/",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 오늘의유머 실패는 "요청마다 랜덤"이 아니라 몇 분 단위로 되는 창/안 되는 창이
// 번갈아 오는 형태다(2026-08-16 실측: 21:11에 수동 15회 연속 전부 성공,
// 21:12~21:15 자동 3회 전부 실패, 21:30에 수동 6회 전부 첫 시도에 성공).
// 그래서 수십 초 안에 재시도를 몰아 넣는 건 같은 "안 되는 창"을 계속 두드리는
// 셈이라 효과가 거의 없다. 게다가 백오프 합이 커지면 scheduled()의 사이트당
// 15초 타임아웃에 잘려서 오히려 실패로 기록된다. 재시도는 짧게만 두고(순간적인
// 흔들림만 흡수), 창이 바뀌길 기다리는 건 크론 로테이션 주기에 맡긴다.
const RETRY_ATTEMPTS = 3;

// 게시판 하나씩 완전히 독립적으로 재시도한다. 예전엔 crawlSite의 공용 재시도
// 루프가 fetchTodayhumor() 전체(두 게시판 다)를 한 단위로 재시도해서, humorbest만
// 일시적으로 비어도 이미 받아온 bestofbest 결과까지 같이 버리고 두 게시판을
// 처음부터 다시 찔렀다. 게시판별로 자기 재시도를 따로 돌려서, 한쪽이 계속
// 실패해도 다른 쪽 재시도 횟수·결과에 전혀 영향을 주지 않게 한다.
async function fetchTodayhumorListWithRetry(listUrl: string): Promise<RawPost[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const rows = await fetchTodayhumorList(listUrl);
      if (rows.length > 0) return rows;
      lastError = undefined;
    } catch (err) {
      lastError = err;
    }
    if (attempt < RETRY_ATTEMPTS - 1) {
      await sleep(700 * (attempt + 1));
    }
  }
  if (lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  return [];
}

export async function fetchTodayhumor(): Promise<RawPost[]> {
  const settled = await Promise.allSettled(
    LIST_URLS.map(fetchTodayhumorListWithRetry)
  );

  // 한쪽 게시판이 재시도를 전부 소진하고 끝내 실패(reject)하거나 빈 배열로
  // 끝나도, 다른 쪽이 얻어온 결과는 그대로 살려서 합친다 — 하나의 실패
  // 때문에 이미 성공한 나머지 결과까지 통째로 지우지 않는다.
  const lists = settled
    .filter(
      (r): r is PromiseFulfilledResult<RawPost[]> => r.status === "fulfilled"
    )
    .map(r => r.value);

  // bestofbest와 humorbest에 같은 글이 겹쳐서 뜨는 경우가 있어 sourcePostId로 합친다.
  const bySourcePostId = new Map<string, RawPost>();
  for (const list of lists) {
    for (const post of list) {
      if (!bySourcePostId.has(post.sourcePostId)) {
        bySourcePostId.set(post.sourcePostId, post);
      }
    }
  }
  const merged = [...bySourcePostId.values()];

  // 둘 다 완전히 실패했을 때만 상위(crawlSite)에 에러로 알린다. 상태코드/콜로는
  // crawlSite가 공통으로 붙여주므로(types.ts의 describeLastFetch) 여기선 안 붙인다.
  if (merged.length === 0) {
    const firstError = settled.find(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    )?.reason;
    if (firstError) {
      throw firstError instanceof Error ? firstError : new Error(String(firstError));
    }
  }

  return merged;
}
