// Facebook Posts — pull recent posts + photos from a Facebook PAGE or
// public PROFILE, given its URL.
//
// Uses Apify's apify/facebook-posts-scraper actor, which scrapes public
// posts/media/reactions from BOTH pages (brands/businesses) and personal
// profiles — only ever PUBLIC content. It does NOT search for a person by
// name/city (Facebook walls that behind login); the caller must supply the
// profile/page URL (web_search can find it first, e.g. "Jane Doe Phila
// facebook").
//
// Args:
//   url | profile_url | page_url   string  required — any facebook.com URL
//                                  (page OR public profile)
//   limit                          number  optional — max posts (default 10, max 100)
//
// Returns: { ok, items, item_count, run_id, summary }  (items carry text + media/photo URLs)

const API_BASE = 'https://api.apify.com/v2';
const ACTOR_SLUG = 'apify~facebook-posts-scraper';
const SUPERVISOR_BASE = 'http://127.0.0.1:3417';
const SKILL_ID = 'facebook_posts';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const token = ctx.providerEnv?.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      'APIFY_API_TOKEN missing — open the gear panel and paste your Apify token from console.apify.com → Settings → Integrations.',
    );
  }

  // Accept url / profile_url / page_url — all map to the actor's startUrls.
  // (The actor scrapes pages AND public profiles; the field name is just a
  // hint, so the agent can pass whichever it has.)
  const candidate = [a.url, a.profile_url, a.page_url].find(
    (u) => typeof u === 'string' && u.trim().length > 0,
  );
  if (typeof candidate !== 'string') {
    throw new Error(
      "A Facebook URL is required — pass url/profile_url/page_url, e.g. 'https://www.facebook.com/anthropic' (page) or 'https://www.facebook.com/sarah.hopkins' (profile). To find someone's URL first, use web_search.",
    );
  }
  const rawUrl = candidate.trim();
  const limit = clampInt(a.limit, 1, 100, 10);

  const input = {
    startUrls: [{ url: rawUrl }],
    resultsLimit: limit,
  };
  const mode = args.mode === 'sync' ? 'sync' : 'async';

  if (mode === 'async') {
    return runAsync(ctx, args, input);
  }

  // Legacy sync mode — 90s ceiling. Use only for known-fast actors.
  const timeoutS = clampInt(args.timeout_s, 10, 600, 240);
  const apifyEndpoint =
    `${API_BASE}/acts/${ACTOR_SLUG}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}` +
    `&timeout=${timeoutS}` +
    `&clean=1`;
  const res = await fetch(apifyEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Apify ${res.status}: ${detail.slice(0, 500) || '(no body)'}`);
  }
  const items = await res.json();
  const runId = res.headers.get('x-apify-run-id') || null;
  const arr = Array.isArray(items) ? items : [];
  return {
    ok: true,
    items: arr,
    item_count: arr.length,
    run_id: runId,
    summary: `Facebook posts for ${rawUrl}: ${arr.length} post${arr.length === 1 ? '' : 's'}`,
  };
}

async function runAsync(ctx, args, input) {
  const startUrl =
    `${API_BASE}/acts/${ACTOR_SLUG}/runs?token=${encodeURIComponent(ctx.providerEnv?.APIFY_API_TOKEN ?? '')}`;
  const startRes = await fetch(startUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!startRes.ok) {
    const detail = await startRes.text().catch(() => '');
    throw new Error(`Apify start ${startRes.status}: ${detail.slice(0, 500)}`);
  }
  const startJson = await startRes.json();
  const runId = startJson?.data?.id;
  const datasetId = startJson?.data?.defaultDatasetId;
  if (!runId) throw new Error('Apify start response missing data.id');

  const origin = ctx.origin ?? { kind: 'manual' };
  const reg = await fetch(`${SUPERVISOR_BASE}/skill-jobs/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      skill_id: SKILL_ID,
      provider: 'apify',
      external_run_id: runId,
      external_dataset_id: datasetId ?? undefined,
      max_wait_ms: clampInt(args.max_wait_minutes, 1, 120, 60) * 60_000,
      max_spend_usd:
        typeof args.max_spend_usd === 'number' && Number.isFinite(args.max_spend_usd)
          ? Math.max(0, Math.min(1000, args.max_spend_usd))
          : 5.0,
      origin: {
        kind: origin.kind ?? 'manual',
        thread_id: origin.threadId,
        telegram_chat: origin.telegramChat,
        mission_id: origin.missionId,
        user_message: origin.userMessage,
      },
    }),
  });
  if (!reg.ok) {
    const detail = await reg.text().catch(() => '');
    throw new Error(`skill-jobs register ${reg.status}: ${detail.slice(0, 300)}`);
  }
  const regJson = await reg.json();
  return {
    ok: true,
    status: 'pending',
    job_id: regJson.job_id,
    run_id: runId,
    summary: `Started ${SKILL_ID} — running in background (Apify run ${runId}). I'll come back when it's done.`,
  };
}


function clampInt(v, lo, hi, def) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(lo, Math.min(hi, n));
}
