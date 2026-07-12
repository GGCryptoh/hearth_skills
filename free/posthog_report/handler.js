// PostHog Analytics Report.
//
// Read-only product-analytics pulse over the founder's own PostHog project.
// Runs HogQL count queries through the stable /query endpoint — this handler
// only issues read queries, so it cannot mutate anything. Zero dependencies —
// global fetch + a read-only personal API key.
//
// Args (from /skills/:id/run body, the agent, or a routine step):
//   report  string  optional — 'summary' (default) | 'top_pages'
//
// Vault config:
//   POSTHOG_API_KEY     secret — personal API key (phx_…), read-only
//   POSTHOG_PROJECT_ID  text   — numeric project id
//   posthog_host        text   — defaults to https://us.posthog.com
//
// Returns: report-specific structured response + markdown `text`.
// Throws on missing config or any non-2xx from PostHog (status + body).

function readVaultString(ctx, key) {
  const fromProvider = ctx.providerEnv?.[key];
  if (typeof fromProvider === 'string' && fromProvider.length > 0) return fromProvider;
  const fromInputs = ctx.skillInputs?.[key];
  if (typeof fromInputs === 'string' && fromInputs.length > 0) return fromInputs;
  return null;
}

async function hogql(host, projectId, apiKey, query) {
  const url = `${host}/api/projects/${encodeURIComponent(projectId)}/query/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PostHog ${res.status}: ${text.slice(0, 400)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`PostHog returned non-JSON: ${text.slice(0, 200)}`);
  }
  return Array.isArray(parsed.results) ? parsed.results : [];
}

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const apiKey = readVaultString(ctx, 'POSTHOG_API_KEY');
  if (!apiKey) {
    throw new Error(
      'POSTHOG_API_KEY missing — add a read-only PostHog personal API key (phx_…) in the gear panel',
    );
  }
  const projectId = readVaultString(ctx, 'POSTHOG_PROJECT_ID');
  if (!projectId) {
    throw new Error('POSTHOG_PROJECT_ID not configured — set your numeric project id in the gear panel');
  }
  let host = readVaultString(ctx, 'posthog_host') || 'https://us.posthog.com';
  host = host.replace(/\/+$/, ''); // strip trailing slash

  const report = typeof a.report === 'string' ? a.report : 'summary';

  if (report === 'summary') {
    const totalRows = await hogql(
      host,
      projectId,
      apiKey,
      'SELECT count() FROM events WHERE timestamp >= now() - INTERVAL 7 DAY',
    );
    const total = totalRows.length && Array.isArray(totalRows[0]) ? Number(totalRows[0][0]) || 0 : 0;

    const topRows = await hogql(
      host,
      projectId,
      apiKey,
      'SELECT event, count() AS c FROM events WHERE timestamp >= now() - INTERVAL 7 DAY ' +
        'GROUP BY event ORDER BY c DESC LIMIT 10',
    );
    const top = topRows.map((r) => ({ event: r[0], count: Number(r[1]) || 0 }));

    const text = [
      '## PostHog — last 7 days',
      '',
      `**Total events:** ${total.toLocaleString('en-US')}`,
      '',
      '**Top events:**',
      ...top.map((t, i) => `${i + 1}. ${t.event} — ${t.count.toLocaleString('en-US')}`),
    ].join('\n');

    return {
      ok: true,
      report: 'summary',
      window_days: 7,
      total_events: total,
      top_events: top,
      text,
      summary: `${total.toLocaleString('en-US')} events in the last 7 days; top event: ${top[0]?.event ?? 'n/a'}.`,
    };
  }

  if (report === 'top_pages') {
    const rows = await hogql(
      host,
      projectId,
      apiKey,
      "SELECT properties.$current_url AS url, count() AS c FROM events " +
        "WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 7 DAY " +
        'GROUP BY url ORDER BY c DESC LIMIT 10',
    );
    const pages = rows.map((r) => ({ url: r[0] || '(unknown)', count: Number(r[1]) || 0 }));
    const text = pages.length
      ? [
          '## PostHog — top pages (last 7 days)',
          '',
          ...pages.map((p, i) => `${i + 1}. ${p.url} — ${p.count.toLocaleString('en-US')}`),
        ].join('\n')
      : 'No $pageview events in the last 7 days.';
    return {
      ok: true,
      report: 'top_pages',
      window_days: 7,
      count: pages.length,
      pages,
      text,
      summary: `Top ${pages.length} page(s) over the last 7 days.`,
    };
  }

  throw new Error(`Unknown report "${report}". Expected one of: summary, top_pages.`);
}
