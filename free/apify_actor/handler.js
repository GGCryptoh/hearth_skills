// Apify Actor — generic wrapper with async-job harness support.
//
// MODES
//   async (default) — POST /v2/acts/.../runs (non-blocking) → get run_id
//                     immediately → register with Hearth's skill-jobs
//                     harness which polls Apify on a backoff ladder
//                     [2,5,7,9,12,15,20,30,45]m and posts the result
//                     back to the original chat thread / Telegram / etc.
//                     when the actor finishes. Use for ANY actor that
//                     might take more than ~30s.
//   sync           — Original behaviour. POST /v2/acts/.../run-sync-
//                     get-dataset-items — blocks until the actor finishes
//                     or the 90s skill timeout fires. Use only for
//                     known-fast actors (google-search, simple lookups).
//
// Args:
//   actor_id   string   required — Apify actor id, "user/actor" form.
//   input      object   required — actor-specific input JSON.
//   mode       string   optional — 'async' (default) | 'sync'.
//   max_items  number   optional — sync mode item cap (default 100, max 1000).
//   timeout_s  number   optional — sync mode server timeout (default 240, max 600).
//   max_wait_minutes number optional — async mode hard cap (default 60).
//   max_spend_usd    number optional — async mode spend cap (default $5).
//
// async mode return:
//   { ok: true, status: 'pending', job_id, run_id, summary }
// sync mode return:
//   { ok: true, status: 'done', items, item_count, run_id, summary }

const API_BASE = 'https://api.apify.com/v2';
const SUPERVISOR_BASE = 'http://127.0.0.1:3417';

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
  const slug = actorId.replace('/', '~');
  const input = a.input && typeof a.input === 'object' ? a.input : {};
  const mode = a.mode === 'sync' ? 'sync' : 'async';

  if (mode === 'sync') {
    return runSync({ token, slug, actorId, input, args: a });
  }
  return runAsync({ ctx, token, slug, actorId, input, args: a });
}

async function runAsync({ ctx, token, slug, actorId, input, args }) {
  // 1. Start the run non-blocking. Apify responds in ~1-2s with run_id +
  //    defaultDatasetId.
  const startUrl =
    `${API_BASE}/acts/${encodeURIComponent(slug)}/runs` +
    `?token=${encodeURIComponent(token)}`;
  const startRes = await fetch(startUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!startRes.ok) {
    const detail = await startRes.text().catch(() => '');
    throw new Error(
      `Apify start ${startRes.status}: ${detail.slice(0, 500) || '(no body)'}`,
    );
  }
  const startJson = await startRes.json();
  const runId = startJson?.data?.id;
  const datasetId = startJson?.data?.defaultDatasetId;
  if (!runId) {
    throw new Error('Apify start response missing data.id');
  }

  // 2. Register with the supervisor's skill-jobs harness.
  const origin = ctx.origin ?? { kind: 'manual' };
  const registerBody = {
    skill_id: 'apify_actor',
    provider: 'apify',
    external_run_id: runId,
    external_dataset_id: datasetId ?? undefined,
    max_wait_ms: clampInt(args.max_wait_minutes, 1, 120, 60) * 60_000,
    max_spend_usd: clampFloat(args.max_spend_usd, 0, 1000, 5.0),
    origin: {
      kind: origin.kind ?? 'manual',
      thread_id: origin.threadId,
      telegram_chat: origin.telegramChat,
      mission_id: origin.missionId,
      user_message: origin.userMessage,
    },
  };
  const regRes = await fetch(`${SUPERVISOR_BASE}/skill-jobs/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registerBody),
  });
  if (!regRes.ok) {
    const detail = await regRes.text().catch(() => '');
    throw new Error(
      `skill-jobs register ${regRes.status}: ${detail.slice(0, 300)}`,
    );
  }
  const reg = await regRes.json();

  return {
    ok: true,
    status: 'pending',
    job_id: reg.job_id,
    run_id: runId,
    summary:
      `Started ${actorId} (Apify run ${runId}). ` +
      `I'll come back with the results when it's done ` +
      `(checking every 2→60 min, cost cap $${registerBody.max_spend_usd.toFixed(2)}).`,
  };
}

async function runSync({ token, slug, actorId, input, args }) {
  const maxItems = clampInt(args.max_items, 1, 1000, 100);
  const timeoutS = clampInt(args.timeout_s, 10, 600, 240);

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
  const items = await res.json();
  const runId = res.headers.get('x-apify-run-id') || null;
  const arr = Array.isArray(items) ? items : [];
  return {
    ok: true,
    status: 'done',
    actor_id: actorId,
    items: arr,
    item_count: arr.length,
    run_id: runId,
    summary:
      `Apify ${actorId}: ${arr.length} items` +
      (runId ? ` (run ${runId})` : ''),
  };
}

function clampInt(v, lo, hi, def) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(lo, Math.min(hi, n));
}

function clampFloat(v, lo, hi, def) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
  return Math.max(lo, Math.min(hi, n));
}
