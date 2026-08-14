-- 0005_crawl_runs.sql
-- 크롤 실행 기록. 크롤이 "조용히 실패"(HTTP 200인데 0건 수집)하는 일이 반복돼서,
-- 사이트별 마지막 성공/실패를 남겨 /health로 한눈에 볼 수 있게 한다.
CREATE TABLE IF NOT EXISTS crawl_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  ran_at TEXT NOT NULL DEFAULT (datetime('now')),
  post_count INTEGER NOT NULL,
  ok INTEGER NOT NULL,          -- 1 = 1건 이상 수집, 0 = 0건(조용한 실패)
  error TEXT                    -- 예외 발생 시 메시지
);
CREATE INDEX IF NOT EXISTS idx_crawl_runs_slug_ran_at ON crawl_runs(slug, ran_at);
