import { env } from "cloudflare:workers";

export interface FilterPrefs {
  window: string | null;
  sort: string | null;
  site: string | null;
}

export async function getUserFilterPrefs(
  userId: number
): Promise<FilterPrefs | null> {
  const row = await env.DB.prepare(
    "SELECT last_window as window, last_sort as sort, last_site as site FROM users WHERE id = ?"
  )
    .bind(userId)
    .first<FilterPrefs>();
  if (!row || (!row.window && !row.sort && row.site === null)) return null;
  return row;
}

export async function saveUserFilterPrefs(
  userId: number,
  prefs: { window: string; sort: string; site: string }
): Promise<void> {
  await env.DB.prepare(
    "UPDATE users SET last_window = ?, last_sort = ?, last_site = ? WHERE id = ?"
  )
    .bind(prefs.window, prefs.sort, prefs.site, userId)
    .run();
}
