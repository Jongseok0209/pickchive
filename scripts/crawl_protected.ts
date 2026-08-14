import { chromium } from "playwright";

const INGEST_URL = "https://pickchive-crawler.won0209.workers.dev/ingest";

async function crawlFmkorea(browser: any) {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  // 기본 /best는 "이미지 형식(webzine)" 카드 위젯이라 조회수 칼럼 자체가 없고,
  // 추천수/댓글수 클래스도 기존 셀렉터(.voted_count, .comment 등)와 실제 클래스
  // (pc_voted_count, comment_count)가 달라 전부 0으로 빠졌다.
  // listStyle=list(텍스트 형식)는 조회수/추천수/댓글수가 모두 별도 컬럼으로 나온다.
  await page.goto("https://www.fmkorea.com/best?listStyle=list", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(2000);

  const posts = await page.evaluate(() => {
    const list: any[] = [];

    const parseNum = (text: string | null | undefined): number => {
      if (!text) return 0;
      const t = text.trim();
      const manMatch = t.match(/([0-9.]+)\s*만/);
      if (manMatch) return Math.round(parseFloat(manMatch[1]) * 10000);
      const cleaned = t.replace(/[^0-9]/g, "");
      return cleaned ? parseInt(cleaned, 10) : 0;
    };

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
        url: "https://www.fmkorea.com" + href,
        author,
        viewCount: parseNum(viewCell?.textContent),
        recommendCount: parseNum(recoCell?.textContent),
        commentCount: parseNum(commentText),
        category: null,
        thumbnailUrl: null,
        postedAtRaw: timeText,
      });
    });
    return list;
  });

  await page.close();
  console.log(`[fmkorea] Playwright found ${posts.length} posts`);
  return { slug: "fmkorea", posts };
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

  await page.close();
  console.log(`[ruliweb] Playwright found ${posts.length} posts`);
  return { slug: "ruliweb", posts };
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const fmData = await crawlFmkorea(browser);
    if (fmData.posts.length > 0) {
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fmData),
      });
      console.log(`[fmkorea] Ingest response:`, await res.text());
    }

    const ruliData = await crawlRuliweb(browser);
    if (ruliData.posts.length > 0) {
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruliData),
      });
      console.log(`[ruliweb] Ingest response:`, await res.text());
    }
  } catch (err: any) {
    console.error("Playwright crawl error:", err);
  } finally {
    await browser.close();
  }
}

run();
