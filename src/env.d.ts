// SESSION KV(어댑터가 자동 프로비저닝)와 Turnstile 키는 wrangler.jsonc에
// 직접 선언돼 있지 않아 `wrangler types` 생성 결과에 빠지므로 여기서 보강한다.
// `import { env } from "cloudflare:workers"`는 전역 Env가 아니라
// `Cloudflare.Env` 네임스페이스를 사용하므로 그쪽을 확장해야 한다.
declare namespace Cloudflare {
  interface Env {
    SESSION: KVNamespace;
    TURNSTILE_SECRET_KEY: string;
    PUBLIC_TURNSTILE_SITE_KEY: string;
  }
}

declare namespace App {
  interface SessionData {
    userId: number;
    username: string;
  }
}
