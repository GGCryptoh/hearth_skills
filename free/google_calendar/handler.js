// Google Calendar — read + create events.
//
// Uses an OAuth refresh token (calendar.events + calendar.readonly scopes)
// the founder generates once via the OAuth Playground and stores in vault.
// We exchange the refresh token for a short-lived access token on every
// call — no token-cache to maintain, the refresh endpoint is fast (~150ms).
// Zero dependencies — global fetch + Google's REST API.
//
// Commands (dispatched on args.action):
//   action: 'list'    args: { days_ahead?=7, calendar_id?='primary' }
//                     → upcoming events (start, end, summary, location, link)
//   action: 'create'  args: { summary, start_iso, end_iso, description?,
//                              attendees? } → the created event
//
// Vault config:
//   GCAL_OAUTH_CLIENT_ID       text   — Google OAuth client id
//   GCAL_OAUTH_CLIENT_SECRET   secret — paired secret
//   GCAL_OAUTH_REFRESH_TOKEN   secret — calendar.events + calendar.readonly
//
// Returns: action-specific structured response + markdown `text`.
// Throws on missing config, OAuth failure, or any non-2xx from the
// Calendar API (status + truncated body).

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL_API_BASE = 'https://www.googleapis.com/calendar/v3';

function readVaultString(ctx, key) {
  const fromProvider = ctx.providerEnv?.[key];
  if (typeof fromProvider === 'string' && fromProvider.length > 0) return fromProvider;
  const fromInputs = ctx.skillInputs?.[key];
  if (typeof fromInputs === 'string' && fromInputs.length > 0) return fromInputs;
  return null;
}

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
  if (!parsed.access_token) throw new Error('OAuth response missing access_token');
  return parsed.access_token;
}

async function calFetch(path, accessToken, init = {}) {
  const res = await fetch(`${CAL_API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google Calendar ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  // One-click OAuth (2026-08-29): the supervisor injects a fresh access
  // token from the gear panel's "Connect Google" button as
  // GOOGLE_OAUTH_ACCESS_TOKEN — prefer it; the pasted refresh-token
  // exchange below stays as the manual fallback.
  let accessToken = readVaultString(ctx, 'GOOGLE_OAUTH_ACCESS_TOKEN');
  if (!accessToken) {
    const clientId = readVaultString(ctx, 'GCAL_OAUTH_CLIENT_ID');
    const clientSecret = readVaultString(ctx, 'GCAL_OAUTH_CLIENT_SECRET');
    const refreshToken = readVaultString(ctx, 'GCAL_OAUTH_REFRESH_TOKEN');
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        'Google Calendar not configured — click "Connect Google" in the gear panel (one click), or set GCAL_OAUTH_CLIENT_ID, GCAL_OAUTH_CLIENT_SECRET, GCAL_OAUTH_REFRESH_TOKEN manually.',
      );
    }
    accessToken = await exchangeRefreshToken(clientId, clientSecret, refreshToken);
  }
  const action = typeof a.action === 'string' ? a.action : 'list';

  if (action === 'list') return listEvents(a, accessToken);
  if (action === 'create') return createEvent(a, accessToken);

  throw new Error(`Unknown action "${action}". Expected one of: list, create.`);
}

async function listEvents(a, accessToken) {
  const calendarId =
    typeof a.calendar_id === 'string' && a.calendar_id.trim() ? a.calendar_id.trim() : 'primary';
  const daysAhead =
    typeof a.days_ahead === 'number' && a.days_ahead > 0 && a.days_ahead <= 365
      ? Math.floor(a.days_ahead)
      : 7;
  const now = new Date();
  const timeMax = new Date(now.getTime() + daysAhead * 86400_000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });
  const data = await calFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    accessToken,
  );
  const items = Array.isArray(data.items) ? data.items : [];
  const events = items.map((e) => ({
    id: e.id,
    summary: e.summary || '(no title)',
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    location: e.location || null,
    html_link: e.htmlLink || null,
    attendees: Array.isArray(e.attendees) ? e.attendees.map((x) => x.email).filter(Boolean) : [],
  }));
  const text = events.length
    ? [
        `## Upcoming events — next ${daysAhead} day(s)`,
        '',
        ...events.map((e) => {
          const when = e.start ? fmtWhen(e.start) : '?';
          return `- **${e.summary}** — ${when}${e.location ? ` @ ${e.location}` : ''}`;
        }),
      ].join('\n')
    : `No events in the next ${daysAhead} day(s).`;
  return {
    ok: true,
    action: 'list',
    calendar_id: calendarId,
    days_ahead: daysAhead,
    count: events.length,
    events,
    text,
    summary: `${events.length} event(s) in the next ${daysAhead} day(s).`,
  };
}

async function createEvent(a, accessToken) {
  const summary = typeof a.summary === 'string' ? a.summary.trim() : '';
  if (!summary) throw new Error('action="create" requires args.summary');
  const startIso = typeof a.start_iso === 'string' ? a.start_iso.trim() : '';
  const endIso = typeof a.end_iso === 'string' ? a.end_iso.trim() : '';
  if (!startIso || !endIso) {
    throw new Error(
      'action="create" requires args.start_iso and args.end_iso (RFC3339, e.g. 2026-07-15T15:00:00-04:00)',
    );
  }
  const calendarId =
    typeof a.calendar_id === 'string' && a.calendar_id.trim() ? a.calendar_id.trim() : 'primary';

  const attendeesRaw = a.attendees;
  const attendeeList = Array.isArray(attendeesRaw)
    ? attendeesRaw
    : typeof attendeesRaw === 'string' && attendeesRaw.trim()
      ? attendeesRaw.split(/[\s,]+/)
      : [];
  const attendees = attendeeList
    .filter((x) => typeof x === 'string' && x.includes('@'))
    .map((email) => ({ email: email.trim() }));

  const body = {
    summary,
    start: { dateTime: startIso },
    end: { dateTime: endIso },
  };
  if (typeof a.description === 'string' && a.description.length > 0) body.description = a.description;
  if (attendees.length > 0) body.attendees = attendees;

  const params = new URLSearchParams();
  if (attendees.length > 0) params.set('sendUpdates', 'all');

  const data = await calFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    accessToken,
    { method: 'POST', body: JSON.stringify(body) },
  );

  const text =
    `## Event created\n\n**${summary}**\n` +
    `${fmtWhen(startIso)} → ${fmtWhen(endIso)}\n` +
    `${attendees.length ? `Invited: ${attendees.map((x) => x.email).join(', ')}\n` : ''}` +
    `${data.htmlLink ? `[Open in Google Calendar](${data.htmlLink})` : ''}`;

  return {
    ok: true,
    action: 'create',
    id: data.id || null,
    html_link: data.htmlLink || null,
    summary_field: summary,
    start: startIso,
    end: endIso,
    attendees: attendees.map((x) => x.email),
    text,
    summary: `Created "${summary}" for ${fmtWhen(startIso)}.`,
  };
}

function fmtWhen(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso);
  const d = new Date(t);
  // Date-only values (all-day events) have no time component.
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return iso;
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}
