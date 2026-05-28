// Reddit Search — keyword search across Reddit, optionally scoped to a subreddit.
//
// Uses Apify's trudax/reddit-scraper-lite actor.
//
// Args:
//   query      string  required — search keyword
//   subreddit  string  optional — restrict to a single subreddit
//   limit      number  optional — max results (default 10, max 100)
//
// Returns: { ok, items, item_count, run_id, summary }

const API_BASE = 'https://api.apify.com/v2';
const ACTOR_SLUG = 'trudax~reddit-scraper-lite';

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
    throw new Error("query is required (e.g. 'best note-taking app')");
  }
  const subreddit =
    typeof a.subreddit === 'string' && a.subreddit.trim().length > 0
      ? a.subreddit.trim().replace(/^r\//, '')
      : '';
  const limit = clampInt(a.limit, 1, 100, 10);

  const input = {
    searches: [query],
    subreddits: subreddit ? [subreddit] : [],
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

  const where = subreddit ? ` in r/${subreddit}` : '';
  return {
    ok: true,
    items: arr,
    item_count: arr.length,
    run_id: runId,
    summary: `Reddit search "${query}"${where}: ${arr.length} result${arr.length === 1 ? '' : 's'}`,
  };
}

function clampInt(v, lo, hi, def) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(lo, Math.min(hi, n));
}
