import { fetchHtml, parseIntSafe, type RawPost } from "../types";

// od=T33: 공감순 정렬. 기본(정렬 파라미터 없음)은 등록일순이라 그냥 최신글이
// 섞여 들어옴 — 인기글(공감 많은 글) 위주로 모으려고 정렬을 명시한다.
const LIST_URL = "https://www.clien.net/service/board/park?od=T33";
const BASE_URL = "https://www.clien.net";

export async function fetchClien(): Promise<RawPost[]> {
  const res = await fetchHtml(LIST_URL);
  const rows: Partial<RawPost>[] = [];

  let currentHitText = "";
  let currentRecommendText = "";
  let currentTimestampText = "";
  let capturingHit = false;
  let capturingRecommend = false;
  let capturingTimestamp = false;

  const rewriter = new HTMLRewriter()
    .on('div[data-role="list-row"]', {
      element(el) {
        const sourcePostId = el.getAttribute("data-board-sn") ?? "";
        if (!sourcePostId) return;
        rows.push({
          sourcePostId,
          commentCount: parseIntSafe(el.getAttribute("data-comment-count")),
          title: "",
          url: "",
          author: null,
          viewCount: 0,
          recommendCount: 0,
          category: null,
          thumbnailUrl: null,
          postedAtRaw: null,
        });
      },
    })
    .on('div[data-role="list-row"] a.list_subject', {
      element(el) {
        const row = rows[rows.length - 1];
        if (!row) return;
        const href = el.getAttribute("href");
        if (href) row.url = new URL(href, BASE_URL).toString();
      },
    })
    .on('div[data-role="list-row"] span[data-role="list-title-text"]', {
      element(el) {
        const row = rows[rows.length - 1];
        if (!row) return;
        const title = el.getAttribute("title");
        if (title) row.title = title.trim();
      },
    })
    .on('div[data-role="list-row"] span.nickname span[title]', {
      element(el) {
        const row = rows[rows.length - 1];
        if (!row) return;
        row.author = el.getAttribute("title");
      },
    })
    .on('div[data-role="list-row"] div.list_hit span.hit', {
      element() {
        capturingHit = true;
        currentHitText = "";
      },
      text(chunk) {
        if (!capturingHit) return;
        currentHitText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.viewCount = parseIntSafe(currentHitText);
          capturingHit = false;
        }
      },
    })
    .on('div[data-role="list-like-count"] span, div.list_symph span', {
      element() {
        capturingRecommend = true;
        currentRecommendText = "";
      },
      text(chunk) {
        if (!capturingRecommend) return;
        currentRecommendText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.recommendCount = parseIntSafe(currentRecommendText);
          capturingRecommend = false;
        }
      },
    })
    .on('div[data-role="list-row"] span.timestamp', {
      element() {
        capturingTimestamp = true;
        currentTimestampText = "";
      },
      text(chunk) {
        if (!capturingTimestamp) return;
        currentTimestampText += chunk.text;
        if (chunk.lastInTextNode) {
          const row = rows[rows.length - 1];
          if (row) row.postedAtRaw = currentTimestampText.trim();
          capturingTimestamp = false;
        }
      },
    });

  await rewriter.transform(res).arrayBuffer();

  return rows.filter(
    (r): r is RawPost => !!r.sourcePostId && !!r.title && !!r.url
  );
}
