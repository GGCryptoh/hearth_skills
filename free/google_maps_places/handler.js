// Google Maps Places — find businesses by search query and location.
//
// Uses Apify's compass/crawler-google-places actor.
//
// Args:
//   search    string  required — e.g. "coffee shops"
//   location  string  optional — e.g. "San Francisco, CA"
//   limit     number  optional — max places (default 10, max 100)
//
// Returns: { ok, items, item_count, run_id, summary }

const API_BASE = 'https://api.apify.com/v2';
const ACTOR_SLUG = 'compass~crawler-google-places';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const token = ctx.providerEnv?.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      'APIFY_API_TOKEN missing — open the gear panel and paste your Apify token from console.apify.com → Settings → Integrations.',
    );
  }

  const search =
    typeof a.search === 'string' && a.search.trim().length > 0
      ? a.search.trim()
      : '';
  if (!search) {
    throw new Error("search is required (e.g. 'coffee shops')");
  }
  const location =
    typeof a.location === 'string' && a.location.trim().length > 0
      ? a.location.trim()
      : '';
  const limit = clampInt(a.limit, 1, 100, 10);

  const input = {
    searchStringsArray: [search],
    maxCrawledPlacesPerSearch: limit,
  };
  if (location) {
    input.locationQuery = location;
  }
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

  const where = location ? ` in ${location}` : '';
  return {
    ok: true,
    items: arr,
    item_count: arr.length,
    run_id: runId,
    summary: `Google Maps "${search}"${where}: ${arr.length} place${arr.length === 1 ? '' : 's'}`,
  };
}

function clampInt(v, lo, hi, def) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(lo, Math.min(hi, n));
}
