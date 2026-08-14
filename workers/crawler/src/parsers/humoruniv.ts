import { parseIntSafe, type RawPost } from "../types";

// st=day: 오늘의 베스트. 파라미터 없이 table=pds만 쓰면 그냥 최신 등록순이라
// 조회수/추천수 낮은 글이 섞여 들어온다.
const LIST_URL = "http://web.humoruniv.com/board/humor/list.html?table=pds&st=day";
// 목록 페이지의 href는 "read.html?..." 같은 상대경로라 BASE_URL이 도메인 루트만
// 가리키면 실제 글 경로("/board/humor/")가 빠진 채로("web.humoruniv.com/read.html")
// 잘못 조립되어 항상 404가 난다(2026-08-14 확인). 목록 페이지 자체를 base로 써서
// 상대경로를 올바르게 해석한다.
const BASE_URL = LIST_URL;

export async function fetchHumoruniv(): Promise<RawPost[]> {
  const res = await fetch(LIST_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });

  const buffer = await res.arrayBuffer();
  const decoder = new TextDecoder("euc-kr");
  const html = decoder.decode(buffer);

  const rows: RawPost[] = [];

  // 행(tr) 내부에 아이콘용 서브 테이블이 중첩되어 있어 non-greedy `</tr>` 매칭이
  // 조회수/추천수/작성시간 셀(li_und, w_time)에 도달하기 전에 중첩된 `</tr>`에서
  // 멈춰버린다. 따라서 다음 행 시작 위치까지를 하나의 행으로 슬라이싱한다.
  const rowStarts: { id: string; index: number }[] = [];
  const idRegex = /<tr id=["']li_chk_pds-(\d+)["']/gi;
  let idMatch: RegExpExecArray | null;
  while ((idMatch = idRegex.exec(html)) !== null) {
    rowStarts.push({ id: idMatch[1], index: idMatch.index });
  }

  for (let i = 0; i < rowStarts.length; i++) {
    const start = rowStarts[i].index;
    const end = i + 1 < rowStarts.length ? rowStarts[i + 1].index : html.length;
    const tr = html.slice(start, end);

    const linkMatch = tr.match(/href=["'](read\.html\?[^"']*number=(\d+)[^"']*)["']/i);
    if (!linkMatch) continue;

    const rawUrl = linkMatch[1];
    const sourcePostId = linkMatch[2];

    const titleMatch = tr.match(/<span id=["']title_chk_pds-\d+["'][^>]*>([\s\S]*?)<\/span>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    if (!title || title.length < 2) continue;

    if (rows.some(r => r.sourcePostId === sourcePostId)) continue;

    const commentMatch = tr.match(/<span class=["']list_comment_num["'][^>]*>\s*\[(\d+)\]/i);
    const commentCount = commentMatch ? parseIntSafe(commentMatch[1]) : 0;

    const authorMatch = tr.match(/onclick=["']pong2\('([^']+)'/i);
    const author = authorMatch ? authorMatch[1] : null;

    // g 플래그와 함께 .match()를 쓰면 캡처 그룹이 아닌 태그 전체 문자열이 반환되어
    // <td width="45" ...>의 "45" 같은 속성 숫자가 실제 값 앞에 섞여 들어간다.
    // matchAll로 캡처 그룹만 취한다.
    const undMatches = [
      ...tr.matchAll(/<td[^>]*class=["']li_und["'][^>]*>([\s\S]*?)<\/td>/gi),
    ].map(m => m[1]);
    let viewCount = 0;
    let recommendCount = 0;
    if (undMatches.length >= 2) {
      viewCount = parseIntSafe(undMatches[0]);
      recommendCount = parseIntSafe(undMatches[1]);
    }

    const dateMatch = tr.match(/<span class=["']w_time["'][^>]*>([\s\S]*?)<\/span>/i);
    const postedAtRaw = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, "").trim() : null;

    rows.push({
      sourcePostId,
      title,
      url: new URL(rawUrl, BASE_URL).toString(),
      author,
      viewCount,
      recommendCount,
      commentCount,
      category: null,
      thumbnailUrl: null,
      postedAtRaw,
    });
  }

  return rows;
}
