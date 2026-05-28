// TikTok Scraper — pull TikTok videos by hashtag or profile.
//
// Uses Apify's clockworks/tiktok-scraper actor.
//
// Args:
//   hashtag_or_profile  string  required — hashtag (with or without #) or profile name
//   limit               number  optional — max videos (default 10, max 100)
//
// Returns: { ok, items, item_count, run_id, summary }

const API_BASE = 'https://api.apify.com/v2';
const ACTOR_SLUG = 'clockworks~tiktok-scraper';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const token = ctx.providerEnv?.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      'APIFY_API_TOKEN missing — open the gear panel and paste your Apify token from console.apify.com → Settings → Integrations.',
    );
  }

  const target =
    typeof a.hashtag_or_profile === 'string' &&
    a.hashtag_or_profile.trim().length > 0
      ? a.hashtag_or_profile.trim().replace(/^#/, '')
      : '';
  if (!target) {
    throw new Error(
      "hashtag_or_profile is required (e.g. 'cooking' or '@mrbeast')",
    );
  }
  const limit = clampInt(a.limit, 1, 100, 10);

  const input = {
    hashtags: [target],
    resultsPerPage: limit,
  };
  const timeoutS = 240;

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
    summary: `TikTok scrape for "${target}": ${arr.length} video${arr.length === 1 ? '' : 's'}`,
  };
}

function clampInt(v, lo, hi, def) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(lo, Math.min(hi, n));
}
