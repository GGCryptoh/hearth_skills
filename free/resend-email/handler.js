// Email — Resend.
//
// Sends a single transactional email via the Resend API. Bring your own
// RESEND_API_KEY (vault) and a verified sender domain (resend.com/domains).
//
// Args (from /skills/:id/run body or scheduler):
//   to          string | string[]   required — single address or array
//   subject     string              required
//   html        string              optional — HTML body
//   text        string              optional — plain-text body (one of html/text required)
//   cc          string | string[]   optional
//   bcc         string | string[]   optional
//   reply_to    string              optional
//   attachments [{filename, content}]  optional — content is base64-encoded bytes
//
// Vault config:
//   RESEND_API_KEY                 secret, under providers
//   from_email                     vault input — must be on a verified domain
//   default_subject_prefix         vault input — optional, prepended to subject
//
// Returns: { ok: true, id, to, subject } where `id` is Resend's email id.
// Throws on missing api key, missing from_email, missing to/subject, or 4xx/5xx
// from the Resend API (founder sees the response body in the error toast).

const API_URL = 'https://api.resend.com/emails';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const apiKey = ctx.providerEnv?.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      'RESEND_API_KEY missing — add your Resend key under Vault → API Keys',
    );
  }

  const fromEmail = ctx.skillInputs?.from_email;
  if (!fromEmail || typeof fromEmail !== 'string') {
    throw new Error(
      'from_email not configured — open the Resend skill gear panel and set a verified sender address',
    );
  }

  const toRaw = a.to;
  const to = Array.isArray(toRaw)
    ? toRaw.filter((x) => typeof x === 'string' && x.length > 0)
    : typeof toRaw === 'string' && toRaw.length > 0
      ? [toRaw]
      : [];
  if (to.length === 0) {
    throw new Error('to is required (string or array of email addresses)');
  }

  const subjectRaw = typeof a.subject === 'string' ? a.subject.trim() : '';
  if (!subjectRaw) {
    throw new Error('subject is required');
  }
  const prefix = ctx.skillInputs?.default_subject_prefix;
  const subject =
    typeof prefix === 'string' && prefix.length > 0
      ? `${prefix}${subjectRaw}`
      : subjectRaw;

  const html = typeof a.html === 'string' ? a.html : null;
  const text = typeof a.text === 'string' ? a.text : null;
  if (!html && !text) {
    throw new Error('one of html or text is required');
  }

  const body = { from: fromEmail, to, subject };
  if (html) body.html = html;
  if (text) body.text = text;
  if (a.cc) body.cc = Array.isArray(a.cc) ? a.cc : [a.cc];
  if (a.bcc) body.bcc = Array.isArray(a.bcc) ? a.bcc : [a.bcc];
  if (typeof a.reply_to === 'string') body.reply_to = a.reply_to;
  if (Array.isArray(a.attachments) && a.attachments.length > 0) {
    body.attachments = a.attachments
      .filter(
        (x) =>
          x &&
          typeof x.filename === 'string' &&
          typeof x.content === 'string',
      )
      .map((x) => ({ filename: x.filename, content: x.content }));
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = await res.json();
  return {
    ok: true,
    id: data?.id ?? null,
    to,
    subject,
    summary: `Email sent to ${to.join(', ')} — subject "${subject}"`,
  };
}
