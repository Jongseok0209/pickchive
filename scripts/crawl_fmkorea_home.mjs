// 펨코(에펨코리아) 수집 — 맥미니 launchd 전용.
//
// 두 겹의 방어가 걸려 있다.
//  1. 데이터센터 IP(Cloudflare Workers, GitHub Actions) 차단 — 그래서 한국 가정용
//     IP인 이 맥미니에서만 수집한다.
//  2. JS + WebAssembly DDoS 챌린지 — HTTP 430 "에펨코리아 보안 시스템" 페이지를
//     주고, 인라인 JS가 lite_year 쿠키를 심은 뒤 /mc/mc.php 의 WASM 모듈이
//     fm5()를 실행해 진짜 통과 쿠키를 만든다(WASM 안에서 document.cookie를
//     직접 건드린다). **plain fetch로는 이 쿠키를 절대 만들 수 없다.**
//
// 2026-08-18 이전 버전은 2번을 "순수 IP 평판 차단이라 Playwright로도 못 뚫음"으로
// 잘못 진단해서, 챌린지를 풀지 못한 채 5분마다 그냥 재요청만 반복했다. 그 결과
// 24시간 275회 전부 실패했을 뿐 아니라 "챌린지를 한 번도 통과하지 않는 클라이언트"로
// 찍혀서 HTTP 429 "[보안 시스템에 의한 자동 차단]"까지 올라갔다. 응답 헤더의
// retry-after 가 정확히 300초인데 launchd 주기도 300초라, 매 요청이 차단 해제
// 시점을 칼같이 노리는 꼴이라 더 봇처럼 보였다.
//
// 지금 방식: **쿠키는 브라우저로 한 번만 따고, 그 다음엔 plain fetch로 싸게 쓴다.**
//  - 저장된 쿠키로 plain fetch 시도 (평소 경로, 브라우저 안 띄움)
//  - 챌린지에 걸리면 그때만 Playwright 헤드리스로 챌린지를 풀고 쿠키를 갱신한 뒤 재시도
//  - 실측(2026-08-18): 챌린지 통과 후 PHPSESSID + idntm5 만으로 plain fetch가 HTTP 200
//
// 파서는 워커 쪽(HTMLRewriter)과 별개 구현이다 — 파서 고칠 땐 양쪽 다 손볼 것.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

const LIST_URL = "https://www.fmkorea.com/best?listStyle=list";
const INGEST_URL = "https://pickchive-crawler.won0209.workers.dev/ingest";
const COOKIE_FILE = `${homedir()}/Library/Application Support/pickchive/fmkorea-cookies.txt`;
const STATE_FILE = `${homedir()}/Library/Application Support/pickchive/fmkorea-block-state.json`;
// 차단/챌린지 페이지 판정. 2026-08-20까지 이 정규식이 `/보안 시스템/`(띄어쓰기 있음)
// 이었는데 실제 제목은 "에펨코리아 보안시스템"(띄어쓰기 없음)이라 **한 번도 매치되지
// 않았다.** 그래서 차단 페이지를 보고 있으면서 solved=true로 판정했고, 쿠키를 0개
// 들고 재요청한 뒤 "re-blocked after solve"라는 엉뚱한 이유를 남겼다. 실제로는 solve
// 자체가 안 된 것이었다. 공백 유무를 모두 받도록 \s* 로 둔다.
const BLOCK_PAGE_RE = /보안\s*시스템/;
// 하드블록(429)을 만났을 때 쉬는 시간. 연속 횟수에 따라 늘린다.
const BACKOFF_MS = [30, 60, 120, 240, 360].map(m => m * 60_000);
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
// 챌린지 통과에 실제로 필요한 쿠키만 보관한다. 광고/분석 쿠키(_ga, __gads 등)까지
// 싣고 다니면 헤더만 커지고 얻는 게 없다.
const KEEP_COOKIES = [
  "PHPSESSID",
  "idntm5",
  "fm5",
  "fm6",
  "lite_year",
  "g_lite_year",
];

// 조회수는 "5만"처럼 만 단위로 축약해서 나온다. 그냥 숫자만 남기면
// "5만" -> 5로 잘못 읽혀서(실제 50000) 조회수가 추천수보다 훨씬 작게
// 나오는 버그가 있었다(2026-08-14 확인).
function parseNum(text) {
  if (!text) return 0;
  const t = text.trim();
  const manMatch = t.match(/([0-9.]+)\s*만/);
  if (manMatch) return Math.round(parseFloat(manMatch[1]) * 10000);
  const cleaned = t.replace(/[^0-9-]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, "").trim();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'");
}

function loadCookies() {
  try {
    return readFileSync(COOKIE_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

function saveCookies(header) {
  mkdirSync(dirname(COOKIE_FILE), { recursive: true });
  writeFileSync(COOKIE_FILE, header);
}

// 하드블록 백오프 상태. 429를 맞으면 "언제까지 쉴지"를 디스크에 남긴다 —
// launchd가 5분마다 새 프로세스를 띄우므로 메모리로는 이어지지 않는다.
function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { consecutive: 0, blockedUntil: 0 };
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

// 챌린지 페이지인지 판별. 430(챌린지)과 429(자동 차단)를 구분해서 남겨야
// "풀면 되는 상태"인지 "이미 찍혀서 굳은 상태"인지 로그만 보고 알 수 있다.
function challengeKind(status, html) {
  if (status === 430) return "challenge";
  if (status === 429) return "hard-block";
  if (BLOCK_PAGE_RE.test(html)) return "challenge";
  return null;
}

async function fetchList(cookieHeader) {
  const res = await fetch(LIST_URL, {
    headers: {
      "User-Agent": UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: "https://www.fmkorea.com/",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Upgrade-Insecure-Requests": "1",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });
  return { status: res.status, html: await res.text() };
}

// Playwright 헤드리스로 챌린지를 실제로 실행시켜 통과 쿠키를 얻는다.
// 평소엔 호출되지 않으므로 import도 이 안에서 동적으로 한다(브라우저 기동 비용 회피).
async function solveChallenge() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent: UA,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();
    await page.goto(LIST_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    // WASM이 쿠키를 심고 스스로 리다이렉트할 시간을 준다.
    await page.waitForTimeout(6000);
    if (BLOCK_PAGE_RE.test(await page.title())) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(4000);
    }
    const solved = !BLOCK_PAGE_RE.test(await page.title());
    const header = (await ctx.cookies())
      .filter(c => KEEP_COOKIES.includes(c.name))
      .map(c => `${c.name}=${c.value}`)
      .join("; ");
    if (solved && header) saveCookies(header);
    return { solved, header };
  } finally {
    await browser.close();
  }
}

function parsePosts(html) {
  const posts = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];

  for (const row of rows) {
    const titleMatch = row.match(
      /<a href="([^"]*document_srl=(\d+))" class="hx"[^>]*>([\s\S]*?)<\/a>/
    );
    if (!titleMatch) continue;

    const href = decodeEntities(titleMatch[1]);
    const sourcePostId = titleMatch[2];
    const title = decodeEntities(stripTags(titleMatch[3]));
    if (!title) continue;

    const commentMatch = row.match(/class="replyNum"[^>]*>(\d+)</);
    const authorMatch = row.match(
      /<td class="author">[\s\S]*?<a[^>]*class='member[^']*'[^>]*>([\s\S]*?)<\/a>/
    );
    const timeMatch = row.match(/<td class="time">\s*([^<]*)\s*<\/td>/);
    const recoMatch = row.match(
      /<td class="m_no m_no_voted">\s*([^<]*)\s*<\/td>/
    );
    const viewMatch = row.match(/<td class="m_no">\s*([^<]*)\s*<\/td>/);

    posts.push({
      sourcePostId,
      title,
      url: "https://www.fmkorea.com" + href,
      author: authorMatch ? decodeEntities(stripTags(authorMatch[1])) : null,
      viewCount: parseNum(viewMatch?.[1]),
      recommendCount: parseNum(recoMatch?.[1]),
      commentCount: parseNum(commentMatch?.[1]),
      category: null,
      thumbnailUrl: null,
      postedAtRaw: timeMatch ? timeMatch[1].trim() : null,
    });
  }
  return posts;
}

async function crawlFmkorea() {
  let solvedThisRun = false;
  let { status, html } = await fetchList(loadCookies());
  let kind = challengeKind(status, html);

  // 하드블록(429)은 "풀면 되는 상태"가 아니라 이미 찍혀서 굳은 상태다. 여기서
  // 브라우저를 띄워봐야 챌린지가 안 풀리고, 요청만 더 쌓여서 차단이 유지된다.
  // 2026-08-19 16시간 중단이 정확히 이 경로였다 — 5분마다 크로미움을 띄워
  // 두 번씩 두드리길 190여 회. 그냥 물러난다.
  if (kind === "hard-block") {
    return {
      slug: "fmkorea",
      posts: [],
      hardBlocked: true,
      error: `hard-block (status=${status}) — 요청 중단하고 백오프`,
    };
  }

  // 저장된 쿠키가 만료됐거나 아예 없으면 여기서 걸린다 — 그때만 브라우저를 띄운다.
  if (kind) {
    const { solved, header } = await solveChallenge();
    solvedThisRun = true;
    if (!solved) {
      return {
        slug: "fmkorea",
        posts: [],
        // 못 푸는 채로 계속 두드리면 430이 429로 승격된다(2026-08-18에 겪음).
        // 그래서 "못 풀었음"도 백오프 대상이다.
        hardBlocked: true,
        error: `challenge unsolved (${kind}, status=${status}) — 브라우저로도 통과 실패`,
      };
    }
    ({ status, html } = await fetchList(header));
    kind = challengeKind(status, html);
    if (kind) {
      return {
        slug: "fmkorea",
        posts: [],
        hardBlocked: kind === "hard-block",
        error: `challenge re-blocked after solve (${kind}, status=${status})`,
      };
    }
  }

  if (status !== 200) {
    return { slug: "fmkorea", posts: [], error: `HTTP ${status}` };
  }

  const posts = parsePosts(html);
  if (posts.length === 0) {
    return {
      slug: "fmkorea",
      posts: [],
      error: `0 posts after parse. status=${status} len=${html.length} solvedThisRun=${solvedThisRun}`,
    };
  }
  return { slug: "fmkorea", posts, solvedThisRun };
}

// 수집 결과를 크롤러 워커에 보낸다. source를 실어 보내야 /status 타임라인에서 이
// 맥미니 수집분을 크론·GitHub Actions 결과와 구분할 수 있다(예전엔 뒤섞여서 펨코가
// "됐다 안 됐다" 하는 것처럼 보였다).
async function report(payload, ts, note = "") {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, source: "macmini" }),
  });
  const text = await res.text();
  console.log(
    `[fmkorea-home] ${ts} posts=${payload.posts.length}${note} ingest="${text}"`
  );
}

async function run() {
  const ts = new Date().toISOString();
  const state = loadState();

  // 백오프 중이면 펨코를 아예 건드리지 않는다 — fetch도 브라우저도 없다.
  // 차단을 푸는 유일한 방법은 조용히 있는 것인데, 이유는 남겨야 /status에서
  // "왜 안 들어오는지"가 보인다(수집 실패엔 반드시 이유를 남긴다는 원칙).
  if (state.blockedUntil && Date.now() < state.blockedUntil) {
    const mins = Math.ceil((state.blockedUntil - Date.now()) / 60_000);
    await report(
      {
        slug: "fmkorea",
        posts: [],
        error: `hard-block 백오프 중 — ${mins}분 후 재시도 (연속 ${state.consecutive}회 차단)`,
      },
      ts
    );
    return;
  }

  // launchd 주기(300초)가 펨코 차단의 retry-after(300초)와 정확히 같아서, 매 요청이
  // 차단 해제 시점을 칼같이 노리는 패턴으로 보였다. 무작위 지연으로 주기를 흐트러뜨린다.
  if (!process.env.PICKCHIVE_NO_JITTER) {
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 90_000)));
  }

  try {
    const data = await crawlFmkorea();
    const { solvedThisRun, hardBlocked, ...payload } = data;

    if (payload.posts.length > 0) {
      // 성공하면 백오프 기록을 지운다.
      saveState({ consecutive: 0, blockedUntil: 0 });
    } else if (hardBlocked) {
      const n = state.consecutive + 1;
      const wait = BACKOFF_MS[Math.min(n - 1, BACKOFF_MS.length - 1)];
      saveState({ consecutive: n, blockedUntil: Date.now() + wait });
      payload.error += ` → ${wait / 60_000}분 쉼 (연속 ${n}회)`;
    }

    await report(payload, ts, solvedThisRun ? " (챌린지 재통과)" : "");
  } catch (err) {
    console.error(`[fmkorea-home] ${ts} error:`, err?.message ?? err);
  }
}

run();
