// Gmail — Read.
//
// Read-only Gmail access via Google's official REST API. Uses an OAuth
// refresh token (gmail.readonly scope) the founder generates once via
// the OAuth Playground and stores in vault. We exchange the refresh
// token for a short-lived access token on every call — cheaper than
// caching, no token-rotation logic to maintain, and the refresh
// endpoint is fast (~150ms).
//
// Commands (dispatched on args.action):
//   action: 'search'         args: { query, max_results? }   → list messages
//   action: 'get'            args: { id, format? }           → single message
//   action: 'labels'         args: {}                        → list labels
//
// Vault config:
//   GOOGLE_OAUTH_CLIENT_ID            text  — shared Google OAuth client id
//   GOOGLE_OAUTH_CLIENT_SECRET        secret — paired secret
//   GMAIL_READ_OAUTH_REFRESH_TOKEN    secret — gmail.readonly scope only
//
// Returns: action-specific structured response (see each handler).

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function exchangeRefreshToken(clientId, clientSecret, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OAuth refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(text);
  if (!parsed.access_token) {
    throw new Error('OAuth response missing access_token');
  }
  return parsed.access_token;
}

async function gmailGet(path, accessToken) {
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail ${res.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

function readVaultString(ctx, key) {
  const fromProvider = ctx.providerEnv?.[key];
  if (typeof fromProvider === 'string' && fromProvider.length > 0) {
    return fromProvider;
  }
  const fromInputs = ctx.skillInputs?.[key];
  if (typeof fromInputs === 'string' && fromInputs.length > 0) {
    return fromInputs;
  }
  return null;
}

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const clientId = readVaultString(ctx, 'GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = readVaultString(ctx, 'GOOGLE_OAUTH_CLIENT_SECRET');
  const refreshToken = readVaultString(ctx, 'GMAIL_READ_OAUTH_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Gmail Read not configured — open the gear panel and set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GMAIL_READ_OAUTH_REFRESH_TOKEN.',
    );
  }

  const accessToken = await exchangeRefreshToken(
    clientId,
    clientSecret,
    refreshToken,
  );

  const action = typeof a.action === 'string' ? a.action : 'search';

  if (action === 'search') {
    const query = typeof a.query === 'string' ? a.query : '';
    const maxResults =
      typeof a.max_results === 'number' &&
      a.max_results > 0 &&
      a.max_results <= 100
        ? Math.floor(a.max_results)
        : 25;
    const params = new URLSearchParams({ maxResults: String(maxResults) });
    if (query) params.set('q', query);
    const data = await gmailGet(
      `/messages?${params.toString()}`,
      accessToken,
    );
    const messages = Array.isArray(data.messages) ? data.messages : [];
    return {
      ok: true,
      action: 'search',
      query,
      count: messages.length,
      messages,
      result_size_estimate: data.resultSizeEstimate ?? null,
      summary: `Found ${messages.length} message(s)${query ? ` matching "${query}"` : ''}.`,
    };
  }

  if (action === 'get') {
    const id = typeof a.id === 'string' ? a.id : '';
    if (!id) throw new Error('action="get" requires args.id (message id)');
    const format =
      a.format === 'full' || a.format === 'metadata' || a.format === 'raw'
        ? a.format
        : 'full';
    const data = await gmailGet(
      `/messages/${encodeURIComponent(id)}?format=${format}`,
      accessToken,
    );
    return {
      ok: true,
      action: 'get',
      id,
      format,
      message: data,
      summary: `Read message ${id}.`,
    };
  }

  if (action === 'labels') {
    const data = await gmailGet('/labels', accessToken);
    const labels = Array.isArray(data.labels) ? data.labels : [];
    return {
      ok: true,
      action: 'labels',
      count: labels.length,
      labels,
      summary: `Listed ${labels.length} label(s).`,
    };
  }

  throw new Error(
    `Unknown action "${action}". Expected one of: search, get, labels.`,
  );
}
