export interface RawPost {
  sourcePostId: string;
  title: string;
  url: string;
  author: string | null;
  viewCount: number;
  recommendCount: number;
  commentCount: number | null;
  category: string | null;
  thumbnailUrl: string | null;
  postedAtRaw: string | null;
}

export interface Env {
  DB: D1Database;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 수집이 실패하면(0건) "왜"가 반드시 남아야 하는데, 대부분의 실패는 예외가 아니라
// "200을 받았는데 목록이 비어있음"이라 그냥 두면 crawl_runs.error가 null로 남아
// /status에 아무 이유도 안 뜬다. 실제로 오늘의유머 원인(해외 IP 403 차단)을 찾는
// 데 오래 걸린 이유가 이것이었다 — 상태코드와 실행 콜로만 찍혀 있었으면 즉시
// 알았을 문제였다(2026-08-16).
//
// 그래서 모든 fetch가 이 지점을 지나가게 하고, 마지막 응답의 상태코드/콜로/본문
// 길이를 여기에 기록해둔다. crawlSite가 0건으로 끝날 때 이 정보를 실패 사유로
// 함께 남긴다. 사이트별 파서를 일일이 고치지 않아도 전 사이트에 자동 적용된다.
export interface LastFetchInfo {
  url: string;
  status: number;
  colo: string | null;
  bodyLength: number | null;
}

let lastFetchInfo: LastFetchInfo | null = null;

export function getLastFetchInfo(): LastFetchInfo | null {
  return lastFetchInfo;
}

export function resetLastFetchInfo(): void {
  lastFetchInfo = null;
}

/**
 * 표준 fetch와 시그니처가 같은 추적용 래퍼. 파서에서 `fetch(...)` 대신
 * `fetchTracked(...)`로 바꿔 부르기만 하면 실패 사유에 상태코드/콜로가 붙는다.
 */
export async function fetchTracked(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(url, init);
  return trackResponse(url, res);
}

/** 응답을 기록용으로 관찰한다. 파서가 쓰는 Response는 그대로 반환. */
export function trackResponse(url: string, res: Response): Response {
  const ray = res.headers.get("cf-ray");
  lastFetchInfo = {
    url,
    status: res.status,
    colo: ray ? (ray.split("-").pop() ?? null) : null,
    bodyLength: null,
  };
  return res;
}

/** 실패 사유 문자열로 쓰기 좋은 한 줄 요약. */
export function describeLastFetch(): string {
  const info = lastFetchInfo;
  if (!info) return "요청 기록 없음";
  const parts = [`status=${info.status}`];
  if (info.colo) parts.push(`colo=${info.colo}`);
  if (info.bodyLength !== null) parts.push(`len=${info.bodyLength}`);
  return parts.join(" ");
}

export async function fetchHtml(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });
  return trackResponse(url, res);
}

export function parseIntSafe(text: string | null | undefined): number {
  if (!text) return 0;
  const str = text.trim();
  if (/[0-9.]+\s*M/i.test(str)) {
    const match = str.match(/([0-9.]+)\s*M/i);
    if (match) return Math.round(parseFloat(match[1]) * 1000000);
  }
  if (/[0-9.]+\s*K/i.test(str)) {
    const match = str.match(/([0-9.]+)\s*K/i);
    if (match) return Math.round(parseFloat(match[1]) * 1000);
  }
  const cleaned = str.replace(/[^0-9-]/g, "");
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}
