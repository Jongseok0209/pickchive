-- 0008_crawl_runs_source.sql
-- 수집 경로가 셋(Cloudflare Cron / GitHub Actions / 맥미니 launchd)인데 전부 같은
-- crawl_runs에 기록을 남겨서, /status 타임라인만 보면 어느 경로의 결과인지 알 수
-- 없었다. 실제로 이것 때문에 펨코가 "됐다 안 됐다" 하는 것처럼 보였다 — GitHub
-- Actions(데이터센터 IP)는 100% 실패하고 맥미니(홈 IP)는 성공하는데 둘이 뒤섞여
-- 있었던 것(2026-08-16). 출처를 남겨서 경로별로 구분해 볼 수 있게 한다.
ALTER TABLE crawl_runs ADD COLUMN source TEXT;
CREATE INDEX IF NOT EXISTS idx_crawl_runs_source ON crawl_runs(source, ran_at);
