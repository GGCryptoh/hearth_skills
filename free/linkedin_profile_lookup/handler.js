// LinkedIn Profile Lookup — fetch a profile's full details.
//
// Uses Apify's dev_fusion/linkedin-profile-scraper actor.
//
// Args:
//   profile_url  string  required — LinkedIn profile URL
//
// Returns: { ok, items, item_count, run_id, summary }

const API_BASE = 'https://api.apify.com/v2';
const ACTOR_SLUG = 'dev_fusion~linkedin-profile-scraper';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const token = ctx.providerEnv?.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      'APIFY_API_TOKEN missing — open the gear panel and paste your Apify token from console.apify.com → Settings → Integrations.',
    );
  }

  const rawUrl =
    typeof a.profile_url === 'string' && a.profile_url.trim().length > 0
      ? a.profile_url.trim()
      : '';
  if (!rawUrl) {
    throw new Error(
      "profile_url is required (e.g. 'https://www.linkedin.com/in/geoffhopkins/')",
    );
  }
  let profileUrl;
  try {
    const u = new URL(rawUrl);
    profileUrl = `${u.origin}${u.pathname}`;
  } catch {
    throw new Error(`profile_url is not a valid URL: ${rawUrl}`);
  }

  const input = {
    profileUrls: [profileUrl],
  };
  const timeoutS = 240;
  const limit = 1;

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
    summary: `LinkedIn profile lookup ${profileUrl}: ${arr.length} record${arr.length === 1 ? '' : 's'}`,
  };
}
