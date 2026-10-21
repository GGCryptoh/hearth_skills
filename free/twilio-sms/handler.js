// Twilio SMS — send a single SMS via Twilio.
//
// Founder configures once via the skill gear panel:
//   TWILIO_ACCOUNT_SID    — vault, text
//   TWILIO_AUTH_TOKEN     — vault, secret
//   TWILIO_FROM_NUMBER    — vault, enumerated_select (Hearth lists the
//                           founder's account-owned numbers via the
//                           twilio.list_from_numbers enumerator)
//
// Args (from /skills/:id/run body, scheduler, or M35 delivery rail):
//   to     string             required — E.164 phone number ('+15551234567')
//   body   string             required — message body (≤1600 chars after
//                                        segmentation; Twilio splits long
//                                        messages automatically)
//   media_url  string | string[]  optional — MMS attachment(s), max 10.
//                                        Twilio fetches these from ITS cloud,
//                                        so each MUST be a public https URL.
//                                        Validated before the call: http://,
//                                        localhost, *.local, *.ts.net tailnet
//                                        hosts, bare IPs and RFC1918 / loopback
//                                        / link-local ranges are refused with
//                                        an error that points the agent to
//                                        Telegram or email for local images.
//
// Returns:
//   { ok: true, sid, status, to, from, preview, media_urls }
//
// Errors:
//   - Missing config: throws with the specific missing key name.
//   - media_url not publicly reachable: throws BEFORE calling Twilio.
//   - Twilio 4xx/5xx: response body included in the error message.
//   - Invalid phone number / non-SMS-capable number: surfaced from Twilio.
//
// API surface used:
//   POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json
//   Basic auth = base64(sid:token)
//   Body = form-urlencoded { From, To, Body, MediaUrl* }

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const sid = ctx.skillInputs?.TWILIO_ACCOUNT_SID?.trim();
  const tok = ctx.skillInputs?.TWILIO_AUTH_TOKEN?.trim();
  const from = ctx.skillInputs?.TWILIO_FROM_NUMBER?.trim();

  if (!sid) {
    throw new Error(
      'TWILIO_ACCOUNT_SID missing — open the Twilio SMS gear panel and paste your Account SID (starts with AC…)',
    );
  }
  if (!tok) {
    throw new Error(
      'TWILIO_AUTH_TOKEN missing — open the Twilio SMS gear panel and paste your Auth Token',
    );
  }
  if (!from) {
    throw new Error(
      'TWILIO_FROM_NUMBER not configured — after the SID + Token are saved, refresh the gear panel to pick a from-number from your Twilio account',
    );
  }

  const to = typeof a.to === 'string' ? a.to.trim() : '';
  const body = typeof a.body === 'string' ? a.body.trim() : '';
  if (!to) {
    throw new Error(
      'to is required (E.164 phone number, e.g. +15551234567)',
    );
  }
  if (!body) {
    throw new Error('body is required');
  }

  // MMS media — validate BEFORE the Twilio call. An unreachable MediaUrl
  // (e.g. an invented https://hearth.local/… link) would otherwise be
  // accepted by Twilio's API and fail asynchronously, leaving the agent to
  // claim "sent with image" for a message that never carried one.
  const mediaUrls = normaliseMediaUrls(a.media_url);
  for (const u of mediaUrls) assertPublicMediaUrl(u);

  const auth = `Basic ${Buffer.from(`${sid}:${tok}`).toString('base64')}`;
  const form = new URLSearchParams({ From: from, To: to, Body: body });
  for (const u of mediaUrls) form.append('MediaUrl', u);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: auth,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: form,
    });
  } catch (err) {
    throw new Error(
      `Twilio fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const responseText = await res.text().catch(() => '');
  if (!res.ok) {
    // Twilio returns JSON errors like {"code": 21211, "message": "Invalid 'To' Phone Number"}
    let detail = responseText.slice(0, 400);
    try {
      const parsed = JSON.parse(responseText);
      if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string') {
        detail = parsed.message + (parsed.code ? ` (code ${parsed.code})` : '');
      }
    } catch {
      /* leave raw text */
    }
    throw new Error(`Twilio ${res.status}: ${detail}`);
  }

  let json = {};
  try {
    json = JSON.parse(responseText);
  } catch {
    /* shouldn't happen on 2xx; tolerate */
  }

  return {
    ok: true,
    sid: typeof json.sid === 'string' ? json.sid : null,
    status: typeof json.status === 'string' ? json.status : 'queued',
    to: json.to ?? to,
    from: json.from ?? from,
    preview: body.length > 80 ? body.slice(0, 77) + '…' : body,
    media_urls: mediaUrls,
    summary: `SMS ${typeof json.status === 'string' ? json.status : 'queued'} to ${json.to ?? to}${mediaUrls.length ? ` with ${mediaUrls.length} MMS media URL${mediaUrls.length === 1 ? '' : 's'}` : ' (no media)'}`,
  };
}

// ---------------------------------------------------------------------------
// MMS media URL validation
// ---------------------------------------------------------------------------

const MEDIA_URL_MAX = 10; // Twilio's per-message MediaUrl cap

const MEDIA_URL_GUIDANCE =
  'Twilio fetches MediaUrl from its own cloud, so it needs a publicly reachable https URL. ' +
  'Hearth collateral and local files are not publicly hosted — send the image on Telegram or by email (resend-email with collateral_id) instead, or send the SMS without media_url.';

function normaliseMediaUrls(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length > MEDIA_URL_MAX) {
    throw new Error(`media_url: Twilio allows at most ${MEDIA_URL_MAX} media URLs per message (got ${list.length}) — SMS not sent`);
  }
  return list.map((u) => {
    if (typeof u !== 'string' || !u.trim()) {
      throw new Error(`media_url must be a non-empty https URL string — SMS not sent. ${MEDIA_URL_GUIDANCE}`);
    }
    return u.trim();
  });
}

// Throws unless `raw` is an https URL whose host Twilio could plausibly reach
// from the public internet. Rejects: non-https schemes, localhost, *.local,
// *.localhost, *.internal, *.ts.net (Tailscale), bare IPv4/IPv6 literals, and
// any IPv4 literal in loopback / RFC1918 / link-local / CGNAT ranges.
export function assertPublicMediaUrl(raw) {
  const fail = (why) => new Error(`media_url rejected: ${raw} — ${why}; SMS not sent. ${MEDIA_URL_GUIDANCE}`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw fail('not a valid URL');
  }
  if (url.protocol !== 'https:') throw fail(`scheme must be https (got ${url.protocol.replace(':', '')})`);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw fail('missing host');
  if (url.username || url.password) throw fail('credentials in the URL are not allowed');

  // IPv6 literal (URL.hostname keeps the brackets) or anything else that is
  // purely an IP — Twilio needs a DNS name on a public host.
  if (host.startsWith('[')) throw fail('bare IPv6 addresses are not publicly resolvable media hosts');
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const priv =
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127);
    throw fail(priv ? 'private / loopback / link-local IP address' : 'bare IP addresses are not accepted as media hosts');
  }

  if (host === 'localhost' || host.endsWith('.localhost')) throw fail('localhost is not reachable from Twilio');
  if (!host.includes('.')) throw fail('single-label hostnames are not publicly resolvable');
  const tld = host.slice(host.lastIndexOf('.') + 1);
  if (['local', 'internal', 'lan', 'home', 'intranet', 'localdomain', 'test', 'example', 'invalid'].includes(tld)) {
    throw fail(`.${tld} hosts are not publicly resolvable`);
  }
  if (host.endsWith('.ts.net')) throw fail('Tailscale tailnet hosts (*.ts.net) are private to your tailnet');
  return url.href;
}
