// LinkedIn Mentions — thin wrapper over Apify's harvestapi/linkedin-post-search.
//
// Default mode: async (recommended — LinkedIn scrapes routinely take 5-15 min).
// mode='sync' falls back to the legacy run-sync path for known-fast actors;
// not recommended for this wrapper.
//
// Args:
//   keyword           string  required — what to search for
//   limit             number  optional — number of posts (default 20, max 200)
//   mode              string  optional — 'async' (default) | 'sync'
//   max_wait_minutes  number  optional — async cap (default 60)
//   max_spend_usd     number  optional — async cap (default 5)
//
// async return: { ok, status: 'pending', job_id, run_id, summary }
// sync return:  { ok, status: 'done', keyword, items, item_count, run_id, summary }

const API_BASE = 'https://api.apify.com/v2';
const SUPERVISOR_BASE = 'http://127.0.0.1:3417';
const ACTOR_SLUG = 'harvestapi~linkedin-post-search';
const SKILL_ID = 'linkedin_mentions';

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

  const mode = a.mode === 'sync' ? 'sync' : 'async';

  if (mode === 'async') {
    return runAsync({ ctx, token, input, args: a, keyword });
  }
  return runSync({ token, input, limit, keyword });
}

async function runAsync({ ctx, token, input, args, keyword }) {
  const startUrl =
    `${API_BASE}/acts/${ACTOR_SLUG}/runs?token=${encodeURIComponent(token)}`;
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
    summary: `Searching LinkedIn for "${keyword}" — running in background (Apify run ${runId}). I'll come back when it's done.`,
  };
}

async function runSync({ token, input, limit, keyword }) {
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
    throw new Error(`Apify ${res.status}: ${detail.slice(0, 500) || '(no body)'}`);
  }
  const items = await res.json();
  const runId = res.headers.get('x-apify-run-id') || null;
  const arr = Array.isArray(items) ? items : [];

  return {
    ok: true,
    status: 'done',
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
