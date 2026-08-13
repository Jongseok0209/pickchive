import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://pickchive.won0209.workers.dev/",
    title: "픽카이브",
    description: "여러 커뮤니티의 인기글을 한곳에 모아보는 사이트",
    author: "Pickchive",
    ogImage: "default-og.jpg",
    lang: "ko",
    timezone: "Asia/Seoul",
    dir: "ltr",
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: false,
    showBackButton: true,
    editPost: { enabled: false },
    search: false,
  },
  socials: [],
  shareLinks: [],
});