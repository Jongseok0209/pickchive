-- 0007_cron_batches.sql
-- Cloudflare Cron이 12개 사이트를 한 번의 scheduled() 실행 안에서 순서대로 다
-- 돌리다가 CPU 시간 제한에 걸려, 첫 사이트(clien) 직후 매번 강제 종료되고
-- 있었다(2026-08-16, wrangler tail로 "Exceeded CPU Limit" 직접 확인). 이걸
-- crawl_runs 데이터만 보고 알아내려면 사이트별 마지막 시도 시각을 역추적해야
-- 했는데, 그 자체가 진단을 어렵게 만든 원인이었다. 그래서
-- 1) 한 번의 실행에서는 몇 개 사이트만 처리하고(커서로 다음 실행에 이어감),
-- 2) 매 실행마다 시작/끝/처리 결과를 이 테이블에 남겨서
-- "크론이 아예 안 도는지" vs "돌긴 하는데 중간에 죽는지"를 /status에서
-- 바로 구분할 수 있게 한다.
CREATE TABLE IF NOT EXISTS cron_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  sites TEXT NOT NULL,       -- 이번 실행에서 처리한 slug 목록 (콤마 구분)
  sites_ok INTEGER NOT NULL DEFAULT 0,
  error TEXT                 -- 배치 자체가 중간에 죽었을 때(예: CPU 제한) 기록
);
CREATE INDEX IF NOT EXISTS idx_cron_batches_started_at ON cron_batches(started_at);

CREATE TABLE IF NOT EXISTS cron_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_index INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO cron_cursor (id, next_index) VALUES (1, 0);
