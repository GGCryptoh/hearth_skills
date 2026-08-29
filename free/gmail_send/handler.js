// Gmail — Send.
//
// Sends a single email through your Gmail account via Google's REST API.
// Uses an OAuth refresh token (gmail.send scope only) — minimum
// privilege isolation: this skill can compose and send but cannot
// read inbox or list messages. The reading complement is in gmail_read.
//
// Args (from /skills/:id/run body or scheduler):
//   to          string | string[]   required — single address or array
//   subject     string              required
//   html        string              optional — HTML body
//   text        string              optional — plain-text body (one of html/text required)
//   cc          string | string[]   optional
//   bcc         string | string[]   optional
//   reply_to    string              optional
//   from        string              optional — overrides the authenticated user's address
//
// Vault config:
//   GOOGLE_OAUTH_CLIENT_ID            text
//   GOOGLE_OAUTH_CLIENT_SECRET        secret
//   GMAIL_SEND_OAUTH_REFRESH_TOKEN    secret — gmail.send scope only
//   gmail_from_name                   text  — optional display name
//
// Returns: { ok: true, id, thread_id, to, subject }

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const PROFILE_URL =
  'https://gmail.googleapis.com/gmail/v1/users/me/profile';

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

function asArray(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.length > 0);
  if (typeof v === 'string' && v.length > 0) return [v];
  return [];
}

function buildRfc822(opts) {
  // RFC 5322 compliant message construction. We hand-build because the
  // payload is simple enough that pulling in a MIME library would be
  // overkill, and Gmail accepts base64url-encoded raw bytes directly.
  const headers = [];
  headers.push(`From: ${opts.from}`);
  headers.push(`To: ${opts.to.join(', ')}`);
  if (opts.cc.length > 0) headers.push(`Cc: ${opts.cc.join(', ')}`);
  if (opts.bcc.length > 0) headers.push(`Bcc: ${opts.bcc.join(', ')}`);
  if (opts.replyTo) headers.push(`Reply-To: ${opts.replyTo}`);
  headers.push(`Subject: ${opts.subject}`);
  headers.push('MIME-Version: 1.0');

  if (opts.html && opts.text) {
    // Multipart alternative — clients pick the best representation.
    const boundary = `hearth_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const body = [
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      opts.text,
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      opts.html,
      `--${boundary}--`,
    ].join('\r\n');
    return headers.join('\r\n') + body;
  }

  if (opts.html) {
    headers.push('Content-Type: text/html; charset="UTF-8"');
    return headers.join('\r\n') + '\r\n\r\n' + opts.html;
  }

  headers.push('Content-Type: text/plain; charset="UTF-8"');
  return headers.join('\r\n') + '\r\n\r\n' + (opts.text ?? '');
}

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  // One-click OAuth (2026-08-29): prefer the supervisor-injected access
  // token from the gear panel's "Connect Google" button; the pasted
  // refresh-token exchange stays as the manual fallback.
  const injectedAccessToken = readVaultString(ctx, 'GOOGLE_OAUTH_ACCESS_TOKEN');
  const clientId = readVaultString(ctx, 'GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = readVaultString(ctx, 'GOOGLE_OAUTH_CLIENT_SECRET');
  const refreshToken = readVaultString(ctx, 'GMAIL_SEND_OAUTH_REFRESH_TOKEN');
  if (!injectedAccessToken && (!clientId || !clientSecret || !refreshToken)) {
    throw new Error(
      'Gmail Send not configured — click "Connect Google" in the gear panel (one click), or set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GMAIL_SEND_OAUTH_REFRESH_TOKEN manually.',
    );
  }

  const to = asArray(a.to);
  if (to.length === 0) {
    throw new Error('to is required (string or array of email addresses)');
  }
  const subject = typeof a.subject === 'string' ? a.subject.trim() : '';
  if (!subject) throw new Error('subject is required');
  const html = typeof a.html === 'string' ? a.html : null;
  const text = typeof a.text === 'string' ? a.text : null;
  if (!html && !text) throw new Error('one of html or text is required');

  const accessToken =
    injectedAccessToken ||
    (await exchangeRefreshToken(clientId, clientSecret, refreshToken));

  // Resolve the From address: explicit args.from > authenticated mailbox.
  let from = typeof a.from === 'string' && a.from.length > 0 ? a.from : null;
  if (!from) {
    const profileRes = await fetch(PROFILE_URL, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      if (profile?.emailAddress) {
        const displayName = readVaultString(ctx, 'gmail_from_name');
        from = displayName
          ? `"${displayName}" <${profile.emailAddress}>`
          : profile.emailAddress;
      }
    }
  }
  if (!from) {
    throw new Error('Could not resolve a From address from your Gmail profile');
  }

  const rfc822 = buildRfc822({
    from,
    to,
    cc: asArray(a.cc),
    bcc: asArray(a.bcc),
    replyTo: typeof a.reply_to === 'string' ? a.reply_to : null,
    subject,
    html,
    text,
  });

  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ raw: base64UrlEncode(rfc822) }),
  });
  const respText = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail send ${res.status}: ${respText.slice(0, 500)}`);
  }
  const data = JSON.parse(respText);
  return {
    ok: true,
    id: data?.id ?? null,
    thread_id: data?.threadId ?? null,
    to,
    subject,
    summary: `Email sent to ${to.join(', ')} — subject "${subject}"`,
  };
}
