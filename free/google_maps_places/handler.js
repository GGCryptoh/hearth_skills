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
const SUPERVISOR_BASE = 'http://127.0.0.1:3417';
const SKILL_ID = 'google_maps_places';

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
    summary: `Google Maps "${search}"${where}: ${arr.length} place${arr.length === 1 ? '' : 's'}`,
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
