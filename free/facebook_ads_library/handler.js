// Facebook Ads Library — scrape competitor ads from the Ads Library.
//
// Uses Apify's curious_coder/facebook-ads-library-scraper actor.
//
// Args:
//   query    string  required — search query (brand or keyword)
//   country  string  optional — 2-letter country code, default 'US'
//   limit    number  optional — max ads (default 10, max 100)
//
// Returns: { ok, items, item_count, run_id, summary }

const API_BASE = 'https://api.apify.com/v2';
const ACTOR_SLUG = 'curious_coder~facebook-ads-library-scraper';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const token = ctx.providerEnv?.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      'APIFY_API_TOKEN missing — open the gear panel and paste your Apify token from console.apify.com → Settings → Integrations.',
    );
  }

  const query =
    typeof a.query === 'string' && a.query.trim().length > 0
      ? a.query.trim()
      : '';
  if (!query) {
    throw new Error("query is required (e.g. 'Nike' or 'cold brew coffee')");
  }
  const country =
    typeof a.country === 'string' && a.country.trim().length > 0
      ? a.country.trim().toUpperCase()
      : 'US';
  const limit = clampInt(a.limit, 1, 100, 10);

  const libraryUrl =
    'https://www.facebook.com/ads/library/?q=' +
    encodeURIComponent(query) +
    '&country=' +
    encodeURIComponent(country);

  const input = {
    urls: [{ url: libraryUrl }],
    maxItems: limit,
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
    summary: `Facebook Ads Library "${query}" (${country}): ${arr.length} ad${arr.length === 1 ? '' : 's'}`,
  };
}

function clampInt(v, lo, hi, def) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(lo, Math.min(hi, n));
}
