// Apify Actor — generic synchronous wrapper.
//
// Runs ANY Apify actor via the run-sync-get-dataset-items endpoint and
// returns the dataset payload to the caller. Sidesteps the need to poll
// `/v2/acts/.../runs/.../status` — Apify holds the connection until the
// actor finishes (or the timeout fires).
//
// Args:
//   actor_id   string   required — Apify actor id, format "user/actor"
//                                    (e.g. "apify/instagram-scraper")
//   input      object   required — actor-specific input JSON (see the
//                                    actor's page on apify.com for the
//                                    expected schema)
//   max_items  number   optional — cap the returned items array client-
//                                    side (default: 100, max: 1000)
//   timeout_s  number   optional — server-side actor timeout in seconds
//                                    (default: 240; max: 600)
//
// Returns: { ok, actor_id, items: [...], item_count, run_id }
// Throws: missing token, missing actor_id, 4xx/5xx from Apify, or
//         Apify-reported actor failure (with run_id in the message so
//         the founder can pull the log in their Apify console).

const API_BASE = 'https://api.apify.com/v2';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const token = ctx.providerEnv?.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      'APIFY_API_TOKEN missing — open the Apify Actor skill gear panel and paste your Personal API token from console.apify.com → Settings → Integrations.',
    );
  }

  const actorId = typeof a.actor_id === 'string' ? a.actor_id.trim() : '';
  if (!actorId) {
    throw new Error(
      "actor_id is required (e.g. 'apify/instagram-scraper'). Find actor ids on apify.com/store.",
    );
  }
  // Apify slug normalisation — they accept both `user/actor` and `user~actor`
  // in URLs. Use the `~` form to avoid URL-encoding the slash.
  const slug = actorId.replace('/', '~');

  const input = a.input && typeof a.input === 'object' ? a.input : {};

  const maxItems = clampInt(a.max_items, 1, 1000, 100);
  const timeoutS = clampInt(a.timeout_s, 10, 600, 240);

  const url =
    `${API_BASE}/acts/${encodeURIComponent(slug)}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}` +
    `&timeout=${timeoutS}` +
    `&clean=1` +
    `&limit=${maxItems}`;

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

  // run-sync-get-dataset-items returns the items array directly (not
  // wrapped in {data: ...}). Run id is in the X-Run-Id response header.
  const items = await res.json();
  const runId = res.headers.get('x-apify-run-id') || null;

  return {
    ok: true,
    actor_id: actorId,
    items: Array.isArray(items) ? items : [],
    item_count: Array.isArray(items) ? items.length : 0,
    run_id: runId,
    summary:
      `Apify ${actorId}: ${Array.isArray(items) ? items.length : 0} items` +
      (runId ? ` (run ${runId})` : ''),
  };
}

function clampInt(v, lo, hi, def) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(lo, Math.min(hi, n));
}
