// Instagram Profile Snapshot — fetch profile bio + counts.
//
// Uses Apify's apify/instagram-profile-scraper actor.
//
// Args:
//   handle  string  required — Instagram username (with or without @)
//
// Returns: { ok, items, item_count, run_id, summary }

const API_BASE = 'https://api.apify.com/v2';
const ACTOR_SLUG = 'apify~instagram-profile-scraper';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const token = ctx.providerEnv?.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      'APIFY_API_TOKEN missing — open the gear panel and paste your Apify token from console.apify.com → Settings → Integrations.',
    );
  }

  const handle =
    typeof a.handle === 'string' && a.handle.trim().length > 0
      ? a.handle.trim().replace(/^@/, '')
      : '';
  if (!handle) {
    throw new Error("handle is required (e.g. 'nasa' or '@nasa')");
  }

  const input = {
    usernames: [handle],
  };
  const timeoutS = 240;
  const limit = 1;

  const endpoint =
    `${API_BASE}/acts/${ACTOR_SLUG}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}` +
    `&timeout=${timeoutS}` +
    `&clean=1` +
    `&limit=${limit}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `Apify ${res.status}: ${detail.slice(0, 500) || '(no body)'}`,
    );
  }

  const items = await res.json();
  const runId = res.headers.get('x-apify-run-id') || null;
  const arr = Array.isArray(items) ? items : [];

  return {
    ok: true,
    items: arr,
    item_count: arr.length,
    run_id: runId,
    summary: `Instagram profile @${handle}: ${arr.length} record${arr.length === 1 ? '' : 's'}`,
  };
}
