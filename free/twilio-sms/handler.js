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
//
// Returns:
//   { ok: true, sid, status, to, from, preview }
//
// Errors:
//   - Missing config: throws with the specific missing key name.
//   - Twilio 4xx/5xx: response body included in the error message.
//   - Invalid phone number / non-SMS-capable number: surfaced from Twilio.
//
// API surface used:
//   POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json
//   Basic auth = base64(sid:token)
//   Body = form-urlencoded { From, To, Body }

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

  const auth = `Basic ${Buffer.from(`${sid}:${tok}`).toString('base64')}`;
  const form = new URLSearchParams({ From: from, To: to, Body: body });
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
  };
}
