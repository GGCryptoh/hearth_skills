// LinkedIn Mentions — thin wrapper over Apify's harvestapi/linkedin-post-search.
//
// The generic apify_actor skill takes the full input JSON; this one bakes
// in the actor id + the input shape so the agent only has to supply a
// keyword + (optional) limit. Same APIFY_API_TOKEN — paste once.
//
// Args:
//   keyword   string   required — what to search for ("hearth aios", "founder dating", etc.)
//   limit     number   optional — number of posts to return (default 20, max 200)
//
// Returns: { ok, keyword, items: [...], item_count, run_id }
// Each item shape (from harvestapi/linkedin-post-search):
//   { author, authorUrl, content, postUrl, postedAt, reactionsCount,
//     commentsCount, repostsCount, ... }
// Throws: missing token, missing keyword, 4xx/5xx from Apify.

const API_BASE = 'https://api.apify.com/v2';
const ACTOR_SLUG = 'harvestapi~linkedin-post-search';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const token = ctx.providerEnv?.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      'APIFY_API_TOKEN missing — open the LinkedIn Mentions (or Apify Actor) skill gear panel and paste your token from console.apify.com → Settings → Integrations.',
    );
  }

  const keyword =
    typeof a.keyword === 'string' && a.keyword.trim().length > 0
      ? a.keyword.trim()
      : '';
  if (!keyword) {
    throw new Error("keyword is required (e.g. 'hearth aios')");
  }
  const limit = clampInt(a.limit, 1, 200, 20);

  const input = {
    search: keyword,
    maxItems: limit,
    sortBy: 'date_posted',
  };
  const timeoutS = 240;

  const url =
    `${API_BASE}/acts/${ACTOR_SLUG}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}` +
    `&timeout=${timeoutS}` +
    `&clean=1` +
    `&limit=${limit}`;

  const res = await fetch(url, {
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
    keyword,
    items: arr,
    item_count: arr.length,
    run_id: runId,
    summary: `LinkedIn search "${keyword}": ${arr.length} post${arr.length === 1 ? '' : 's'}`,
  };
}

function clampInt(v, lo, hi, def) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(lo, Math.min(hi, n));
}
