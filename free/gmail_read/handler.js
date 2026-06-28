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
//   action: 'search'         args: { query, max_results? }   → message ids
//   action: 'digest'         args: { query?, max_results? }  → recent mail WITH
//                            content (from/subject/date/snippet) in one call
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

// --- Message body extraction (the `get` action) --------------------------
// Gmail returns the body base64url-encoded inside a nested MIME tree. The
// previous handler returned the raw `message` object + a "Read message
// <id>." stub, so collateral saved the stub and the agent never saw the
// text. These helpers decode it into readable content.

function decodeB64Url(s) {
  if (typeof s !== 'string' || s.length === 0) return '';
  try {
    return Buffer.from(s, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function headerValue(payload, name) {
  const headers = payload && Array.isArray(payload.headers) ? payload.headers : [];
  const h = headers.find(
    (x) =>
      x &&
      typeof x.name === 'string' &&
      x.name.toLowerCase() === name.toLowerCase(),
  );
  return h && typeof h.value === 'string' ? h.value : '';
}

function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Walk the MIME tree for the most readable body: prefer text/plain, then
// text/html (tags stripped). Recurses into multipart/* containers.
function extractBody(payload) {
  if (!payload) return '';
  if (payload.body && payload.body.data && typeof payload.mimeType === 'string') {
    if (payload.mimeType === 'text/plain') return decodeB64Url(payload.body.data);
    if (payload.mimeType === 'text/html') return stripHtml(decodeB64Url(payload.body.data));
  }
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const p of parts) {
    if (p.mimeType === 'text/plain' && p.body?.data) {
      return decodeB64Url(p.body.data);
    }
  }
  for (const p of parts) {
    if (typeof p.mimeType === 'string' && p.mimeType.startsWith('multipart/')) {
      const nested = extractBody(p);
      if (nested) return nested;
    }
  }
  for (const p of parts) {
    if (p.mimeType === 'text/html' && p.body?.data) {
      return stripHtml(decodeB64Url(p.body.data));
    }
  }
  return '';
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

  // action: 'digest' — one call → recent messages WITH content (sender,
  // subject, date, snippet, unread). `search` returns only opaque ids,
  // which is useless for a morning-brief summarizer; digest fetches each
  // match's metadata (headers only — cheap) + Gmail's snippet so the LLM
  // has something real to summarize. Default query targets the last day.
  if (action === 'digest') {
    const query =
      typeof a.query === 'string' && a.query.trim().length > 0
        ? a.query.trim()
        : 'newer_than:1d';
    const maxResults =
      typeof a.max_results === 'number' &&
      a.max_results > 0 &&
      a.max_results <= 30
        ? Math.floor(a.max_results)
        : 12;
    const params = new URLSearchParams({
      maxResults: String(maxResults),
      q: query,
    });
    const list = await gmailGet(`/messages?${params.toString()}`, accessToken);
    const ids = (Array.isArray(list.messages) ? list.messages : []).map(
      (m) => m.id,
    );
    // Header-only fetch per message (format=metadata + a header allowlist)
    // — far cheaper than format=full, and the snippet rides along free.
    const items = await Promise.all(
      ids.map(async (id) => {
        try {
          const data = await gmailGet(
            `/messages/${encodeURIComponent(id)}?format=metadata` +
              `&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            accessToken,
          );
          return {
            id,
            from: headerValue(data.payload, 'From'),
            subject: headerValue(data.payload, 'Subject'),
            date: headerValue(data.payload, 'Date'),
            snippet: typeof data.snippet === 'string' ? data.snippet : '',
            unread: Array.isArray(data.labelIds)
              ? data.labelIds.includes('UNREAD')
              : false,
          };
        } catch (e) {
          return { id, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    const good = items.filter((m) => !m.error);
    const text = good.length
      ? good
          .map(
            (m) =>
              `• ${m.subject || '(no subject)'} — ${m.from || '(unknown sender)'}` +
              `${m.unread ? ' [unread]' : ''}\n  ${m.snippet}`,
          )
          .join('\n')
      : `No messages matched "${query}".`;
    return {
      ok: true,
      action: 'digest',
      query,
      count: good.length,
      messages: good,
      text,
      summary: `${good.length} message(s) matching "${query}".`,
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
    const from = headerValue(data.payload, 'From');
    const to = headerValue(data.payload, 'To');
    const subject = headerValue(data.payload, 'Subject');
    const date = headerValue(data.payload, 'Date');
    let body = extractBody(data.payload);
    if (!body && typeof data.snippet === 'string') body = data.snippet;
    const MAX_BODY = 8000;
    const bodyText =
      body.length > MAX_BODY
        ? `${body.slice(0, MAX_BODY)}\n\n[truncated — ${body.length} chars total]`
        : body;
    const metaLine = [
      from && `From: ${from}`,
      to && `To: ${to}`,
      date && `Date: ${date}`,
    ]
      .filter(Boolean)
      .join('  ·  ');
    const summary =
      `${subject ? `**${subject}**` : '(no subject)'}\n` +
      `${metaLine}\n\n` +
      `${bodyText || '(no readable body found)'}`;
    return {
      ok: true,
      action: 'get',
      id,
      format,
      from,
      to,
      subject,
      date,
      snippet: typeof data.snippet === 'string' ? data.snippet : null,
      body: bodyText,
      message: data,
      summary,
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
    `Unknown action "${action}". Expected one of: search, digest, get, labels.`,
  );
}
