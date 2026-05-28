// LinkedIn Company Employees — pull all employees from a LinkedIn company page.
//
// Uses Apify's harvestapi/linkedin-company-employees actor.
//
// Args:
//   company_url  string  required — LinkedIn company URL
//   limit        number  optional — max employees (default 10, max 100)
//
// Returns: { ok, items, item_count, run_id, summary }

const API_BASE = 'https://api.apify.com/v2';
const ACTOR_SLUG = 'harvestapi~linkedin-company-employees';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const token = ctx.providerEnv?.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      'APIFY_API_TOKEN missing — open the gear panel and paste your Apify token from console.apify.com → Settings → Integrations.',
    );
  }

  const rawUrl =
    typeof a.company_url === 'string' && a.company_url.trim().length > 0
      ? a.company_url.trim()
      : '';
  if (!rawUrl) {
    throw new Error(
      "company_url is required (e.g. 'https://www.linkedin.com/company/anthropic/')",
    );
  }
  let companyUrl;
  try {
    const u = new URL(rawUrl);
    companyUrl = `${u.origin}${u.pathname}`;
  } catch {
    throw new Error(`company_url is not a valid URL: ${rawUrl}`);
  }
  const limit = clampInt(a.limit, 1, 100, 10);

  const input = {
    companies: [companyUrl],
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
    summary: `LinkedIn employees for ${companyUrl}: ${arr.length} employee${arr.length === 1 ? '' : 's'}`,
  };
}

function clampInt(v, lo, hi, def) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(lo, Math.min(hi, n));
}
