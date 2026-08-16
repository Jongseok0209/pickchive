import { env } from "cloudflare:workers";

export interface CronBatch {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  sites: string;
  sitesOk: number;
  error: string | null;
}

// 크롤러 워커의 scheduled()가 CPU 시간 제한에 걸려 조용히 죽는 사고가 있었다
// (2026-08-16). crawl_runs만 봐서는 "크론 자체가 안 도는지" vs "돌긴 하는데
// 중간에 죽는지"를 알아내기 위해 사이트별 마지막 시도 시각을 역추적해야 했던
// 게 진단을 어렵게 만든 원인이라, cron_batches에 실행마다 시작/끝을 남기고
// 여기서 최근 이력을 그대로 보여준다.
export async function getRecentCronBatches(limit = 10): Promise<CronBatch[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, started_at as startedAt, finished_at as finishedAt,
            sites, sites_ok as sitesOk, error
     FROM cron_batches ORDER BY started_at DESC LIMIT ?`
  )
    .bind(limit)
    .all<CronBatch>();
  return results;
}
