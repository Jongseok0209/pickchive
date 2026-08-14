// @astrojs/cloudflare가 빌드할 때 만드는 dist/server/wrangler.json은 루트
// wrangler.jsonc의 필드를 전부 그대로 옮기지 않는다 — workers_dev는 빠진다.
// 그래서 루트 설정에 "workers_dev": true를 적어도 실제로 deploy에 반영이
// 안 되고, 커스텀 도메인(routes)만 있으면 매번 workers.dev 주소가 조용히
// 꺼진다(2026-08-15 확인 — pickchive.com 연결 직후 pickchive.won0209.workers.dev가
// 통째로 에러 1042를 내며 죽었었음). 빌드 후 이 스크립트로 생성된 설정 파일에
// workers_dev를 직접 주입해서 deploy 전에 바로잡는다.
import { readFileSync, writeFileSync } from "node:fs";

const path = "dist/server/wrangler.json";
const config = JSON.parse(readFileSync(path, "utf8"));
config.workers_dev = true;
writeFileSync(path, JSON.stringify(config));
console.log(`[patch-workers-dev] workers_dev: true 적용됨 (${path})`);
