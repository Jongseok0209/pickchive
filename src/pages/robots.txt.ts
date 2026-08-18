import type { APIRoute } from "astro";

// 2026-08-17 사고 대응: Cloudflare Workers 무료 플랜 일일 요청 한도(10만)를
// 하루 만에 넘겨 사이트 전체가 에러 1027로 내려갔다. 원인은 사람 트래픽이 아니라
// AI 학습 크롤러였다 — 12시간 동안 홈(`/`)에 meta-externalagent 약 7.7만 회,
// GPTBot 약 3.6만 회. 홈은 기간(7) x 정렬(4) x 사이트(14개 토글 조합) 필터
// 링크가 전부 서버 렌더링 <a>라서 크롤러 입장에선 사실상 무한한 URL 공간이고,
// 전부 SSR이라 한 번 한 번이 Worker 요청으로 계산된다.
//
// robots.txt는 "규칙을 지키는" 봇에만 효과가 있다(GPTBot/meta-externalagent는
// 지킨다). 무시하는 봇까지 막으려면 Cloudflare WAF 레벨 차단이 필요하다 —
// WAF는 Worker보다 먼저 실행돼서 차단된 요청은 아예 Worker 요청으로 안 잡힌다.
// 상세는 AGENTS.md 함정 20 참고.

// AI 학습/수집 크롤러 — 전면 차단. 우리 콘텐츠는 원문 링크만 모은 것이라
// 학습 크롤링으로 얻을 게 없는데 비용(Worker 요청)만 전부 우리가 낸다.
const AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "meta-externalagent",
  "meta-externalfetcher",
  "FacebookBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "PerplexityBot",
  "Perplexity-User",
  "Amazonbot",
  "Diffbot",
  "ImagesiftBot",
  "Omgilibot",
  "omgili",
  "cohere-ai",
  "Timpibot",
  "Webzio-Extended",
  "YouBot",
  "AI2Bot",
  "Applebot-Extended",
];

// SEO/백링크 분석 봇 — 우리에게 아무 이득이 없고 요청만 먹는다.
const SEO_CRAWLERS = [
  "serpstatbot",
  "AhrefsBot",
  "SemrushBot",
  "MJ12bot",
  "DotBot",
  "BLEXBot",
  "DataForSeoBot",
  "Barkrowler",
  "ZoominfoBot",
  "PetalBot",
  "MegaIndex",
];

const getRobotsTxt = (sitemapURL: URL) => {
  const blocked = [...new Set([...AI_CRAWLERS, ...SEO_CRAWLERS])]
    .map(ua => `User-agent: ${ua}`)
    .join("\n");

  return `# 검색엔진(구글/빙/네이버/다음)은 환영. AI 학습 크롤러와 SEO 분석 봇은 차단.
# 이유: 2026-08-17 AI 크롤러 폭주로 Workers 무료 한도(10만/일) 초과 → 사이트 다운.

${blocked}
Disallow: /

User-agent: *
# 필터 조합(?window=&sort=&site=) URL은 사실상 무한대다. 정본은 파라미터 없는
# 경로 하나뿐이고 canonical도 그쪽을 가리키니 쿼리 붙은 주소는 크롤하지 말 것.
Disallow: /*?
Disallow: /api/
Disallow: /login
Disallow: /signup
Disallow: /status
Allow: /
Crawl-delay: 10

Sitemap: ${sitemapURL.href}
`;
};

export const GET: APIRoute = ({ site }) => {
  const sitemapURL = new URL("sitemap-index.xml", site);
  return new Response(getRobotsTxt(sitemapURL), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // 봇이 robots.txt를 매번 다시 받아가도 Worker까지 오지 않도록 캐시.
      "Cache-Control": "public, max-age=86400",
    },
  });
};
