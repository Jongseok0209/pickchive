import { chromium } from "playwright";

const INGEST_URL = "https://pickchive-crawler.won0209.workers.dev/ingest";

// 숫자 파싱은 page.evaluate() 콜백 "밖"(일반 Node 스코프)에서 수행한다.
// CI에서 이 스크립트를 `npx tsx`로 실행하는데, tsx(esbuild)가 트랜스파일한 코드를
// page.evaluate 콜백 안에 중첩 함수 선언(화살표 함수를 const에 대입하는 것 포함)이
// 있으면 브라우저 컨텍스트에 없는 `__name` 헬퍼를 참조해 "ReferenceError: __name is
// not defined"로 항상 실패한다(2026-08-14 확인, node로는 재현 안 됨 — tsx 전용 버그).
// 그래서 evaluate 콜백 안에서는 텍스트만 뽑아 반환하고, 숫자 변환은 바깥에서 한다.
function parseNum(text: string | null | undefined): number {
  if (!text) return 0;
  const t = text.trim();
  const manMatch = t.match(/([0-9.]+)\s*만/);
  if (manMatch) return Math.round(parseFloat(manMatch[1]) * 10000);
  const cleaned = t.replace(/[^0-9-]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
}

async function crawlFmkorea(browser: any) {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  // 기본 /best는 "이미지 형식(webzine)" 카드 위젯이라 조회수 칼럼 자체가 없고,
  // 추천수/댓글수 클래스도 기존 셀렉터(.voted_count, .comment 등)와 실제 클래스
  // (pc_voted_count, comment_count)가 달라 전부 0으로 빠졌다.
  // listStyle=list(텍스트 형식)는 조회수/추천수/댓글수가 모두 별도 컬럼으로 나온다.
  // GitHub Actions 러너에서는 로컬보다 느리게 로드될 때가 있어서(2026-08-14 확인:
  // 로컬 테스트로는 정상인데 CI 실행에서 "Playwright found 0 posts") 첫 시도가
  // 비어있으면 더 기다렸다가 재시도한다.
  let raw: any[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt === 0) {
      await page.goto("https://www.fmkorea.com/best?listStyle=list", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    }
    await page.waitForTimeout(2000 + attempt * 2000);

    raw = await page.evaluate(() => {
      const list: any[] = [];
      const trs = document.querySelectorAll("table.bd_lst tbody tr");
      trs.forEach(tr => {
        const titleLink = tr.querySelector("a.hx");
        if (!titleLink) return;
        const href = titleLink.getAttribute("href") || "";
        const match = href.match(/document_srl=(\d+)/);
        if (!match) return;
        const sourcePostId = match[1];
        if (list.some(p => p.sourcePostId === sourcePostId)) return;

        const title = titleLink.textContent?.trim() || "";
        if (!title || title.length < 2) return;

        const author = tr.querySelector("td.author")?.textContent?.trim() || null;
        const commentText = tr.querySelector("a.replyNum")?.textContent?.trim() || "0";
        const recoCell = tr.querySelector("td.m_no.m_no_voted");
        const viewCell = Array.from(tr.querySelectorAll("td.m_no")).find(
          td => !td.classList.contains("m_no_voted")
        );
        const timeText = tr.querySelector("td.time")?.textContent?.trim() || null;

        list.push({
          sourcePostId,
          title,
          href,
          author,
          viewText: viewCell?.textContent || null,
          recoText: recoCell?.textContent || null,
          commentText,
          timeText,
        });
      });
      return list;
    });

    if (raw.length > 0) break;
  }

  let error: string | undefined;
  if (raw.length === 0) {
    // 재시도로도 안 되는 이유가 로딩 지연인지, 봇 차단/리다이렉트인지 다음 실행
    // 로그 + /status에서 바로 판단할 수 있도록 진단 정보를 남긴다.
    error = `0 posts after retries. url=${page.url()} title=${await page.title()}`;
    console.log(`[fmkorea] ${error}`);
  }

  const posts = raw.map((p: any) => ({
    sourcePostId: p.sourcePostId,
    title: p.title,
    url: "https://www.fmkorea.com" + p.href,
    author: p.author,
    viewCount: parseNum(p.viewText),
    recommendCount: parseNum(p.recoText),
    commentCount: parseNum(p.commentText),
    category: null,
    thumbnailUrl: null,
    postedAtRaw: p.timeText,
  }));

  await page.close();
  console.log(`[fmkorea] Playwright found ${posts.length} posts`);
  return { slug: "fmkorea", posts, error };
}

async function crawlRuliweb(browser: any) {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  await page.goto("https://bbs.ruliweb.com/best/humor/now", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  const posts = await page.evaluate(() => {
    const list: any[] = [];
    const trs = document.querySelectorAll("tr");
    trs.forEach(tr => {
      const link = tr.querySelector("a.subject_link");
      if (!link) return;
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/read\/(\d+)/);
      if (!match) return;
      const sourcePostId = match[1];

      const titleNode = tr.querySelector("strong.text_over") || link;
      const title = titleNode.textContent?.trim() || "";
      if (!title || title.length < 2 || list.some(p => p.sourcePostId === sourcePostId)) return;

      const author = tr.querySelector("td.writer")?.textContent?.trim() || null;
      const viewText = tr.querySelector("td.hit")?.textContent?.trim() || "0";
      const recText = tr.querySelector("td.recomd")?.textContent?.trim() || "0";
      const commentText = tr.querySelector("span.num_reply")?.textContent?.trim() || "0";

      const v = parseInt(viewText.replace(/[^0-9]/g, ""), 10) || 0;
      const r = parseInt(recText.replace(/[^0-9]/g, ""), 10) || 0;
      const c = parseInt(commentText.replace(/[^0-9]/g, ""), 10) || 0;

      list.push({
        sourcePostId,
        title,
        url: href.startsWith("http") ? href : "https://bbs.ruliweb.com" + href,
        author,
        viewCount: v,
        recommendCount: r,
        commentCount: c,
        category: null,
        thumbnailUrl: null,
        postedAtRaw: null,
      });
    });
    return list;
  });

  let error: string | undefined;
  if (posts.length === 0) {
    error = `0 posts. url=${page.url()} title=${await page.title()}`;
    console.log(`[ruliweb] ${error}`);
  }

  await page.close();
  console.log(`[ruliweb] Playwright found ${posts.length} posts`);
  return { slug: "ruliweb", posts, error };
}

async function crawlDamoang(browser: any) {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  // /free HTML은 Cloudflare Turnstile 챌린지로 막혀 있어 일반 fetch로는 우회 불가하지만
  // 헤드리스 브라우저로는 정상 통과됨을 확인(2026-08-14). RSS(fetchDamoang, 일반 크롤
  // 경로)는 title/link/author/date만 제공하고 조회수/추천수/댓글수가 구조적으로 없어서,
  // 이 목록 HTML을 통해 그 값들을 채운다.
  await page.goto("https://damoang.net/free", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const raw = await page.evaluate(() => {
    const list: any[] = [];
    document.querySelectorAll("a.post-row").forEach(row => {
      const href = row.getAttribute("href") || "";
      const match = href.match(/\/free\/(\d+)/);
      if (!match) return;
      const sourcePostId = match[1];
      if (list.some(p => p.sourcePostId === sourcePostId)) return;

      const titleEl = row.querySelector(".post-title");
      const title = titleEl?.textContent?.trim() || "";
      if (!title || title.length < 2) return;

      const recoEl = row.querySelector('div[class*="min-h-5"][class*="min-w-10"]');
      const commentEl = row.querySelector("button.comment-count");
      const authorEl = row.querySelector('span[class*="md:w-\\[120px\\]"]');
      const dateEl = row.querySelector('span[class*="md:w-\\[70px\\]"]');
      const viewEl = row.querySelector('span[class*="md:w-\\[50px\\]"]');

      list.push({
        sourcePostId,
        title,
        href,
        author: authorEl?.textContent?.trim() || null,
        viewText: viewEl?.textContent || null,
        recoText: recoEl?.textContent || null,
        commentText: commentEl?.textContent || null,
        dateText: dateEl?.textContent?.trim() || null,
      });
    });
    return list;
  });

  const posts = raw.map((p: any) => ({
    sourcePostId: p.sourcePostId,
    title: p.title,
    url: "https://damoang.net" + p.href,
    author: p.author,
    viewCount: parseNum(p.viewText),
    recommendCount: parseNum(p.recoText),
    commentCount: parseNum(p.commentText),
    category: "자유게시판",
    thumbnailUrl: null,
    postedAtRaw: p.dateText,
  }));

  let error: string | undefined;
  if (posts.length === 0) {
    error = `0 posts. url=${page.url()} title=${await page.title()}`;
    console.log(`[damoang] ${error}`);
  }

  await page.close();
  console.log(`[damoang] Playwright found ${posts.length} posts`);
  return { slug: "damoang", posts, error };
}

// 0건 수집이어도 항상 ingest를 호출해야 한다 — 예전엔 posts.length > 0일 때만
// 호출해서, 실패(0건)한 시도는 crawl_runs에 기록조차 안 남았다. 그래서 실제로는
// "매번 시도했다가 실패"인데 /status에는 "시도 안 함"으로 잘못 떴다(2026-08-14 확인,
// 펨코가 IP 차단으로 매번 0건인데도 계속 "시도 안 함"으로 보이던 문제).
async function ingest(data: { slug: string; posts: unknown[]; error?: string }) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  console.log(`[${data.slug}] Ingest response:`, await res.text());
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    // 펨코는 여기서 수집하지 않는다. GitHub Actions 러너는 데이터센터 IP라
    // 펨코가 "에펨코리아 보안 시스템" 페이지로 100% 차단하기 때문에(2026-08-16
    // 실측: 24시간 동안 이 경로 50회 시도 전부 실패, 성공 0회) 절대 성공할 수
    // 없는 호출이었다. 게다가 이 실패가 맥미니(홈 IP) 수집 성공 기록과 뒤섞여
    // crawl_runs에 남으면서, 펨코가 "됐다 안 됐다" 하는 것처럼 보이게 만들어
    // 원인 파악을 방해했다. 펨코는 맥미니 launchd 경로(scripts/crawl_fmkorea_home.mjs)
    // 하나로만 수집한다.
    await ingest(await crawlRuliweb(browser));
    await ingest(await crawlDamoang(browser));
  } catch (err: any) {
    console.error("Playwright crawl error:", err);
  } finally {
    await browser.close();
  }
}

run();
