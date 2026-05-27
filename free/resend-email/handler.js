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
//   attachment_data_url  string         optional — single attachment as a data URL
//                                       (data:image/jpeg;base64,…). M38 routine
//                                       step delivery rail forwards this when a
//                                       prior step produced binary output. Auto-
//                                       extracted to attachments[].
//   attachment_filename  string         optional — name to use when sending
//                                       attachment_data_url (defaults to
//                                       attachment.<ext> derived from MIME type).
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
  // Collect attachments from both manual + M38-routine paths.
  const collected = [];
  if (Array.isArray(a.attachments)) {
    for (const x of a.attachments) {
      if (
        x &&
        typeof x.filename === 'string' &&
        typeof x.content === 'string'
      ) {
        collected.push({ filename: x.filename, content: x.content });
      }
    }
  }
  if (typeof a.attachment_data_url === 'string' && a.attachment_data_url.length > 0) {
    const parsed = parseDataUrl(a.attachment_data_url);
    if (parsed) {
      const filename =
        typeof a.attachment_filename === 'string' && a.attachment_filename.length > 0
          ? a.attachment_filename
          : `attachment.${parsed.ext}`;
      collected.push({ filename, content: parsed.base64 });
    }
  }
  if (collected.length > 0) {
    body.attachments = collected;
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

// Decode a `data:<mime>;base64,<payload>` URL into { base64, ext }. Returns
// null on malformed input. Falls back to .bin if the MIME type is unknown.
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
};

function parseDataUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('data:')) return null;
  const commaIdx = url.indexOf(',');
  if (commaIdx === -1) return null;
  const meta = url.slice(5, commaIdx); // strip "data:"
  const payload = url.slice(commaIdx + 1);
  const isBase64 = meta.toLowerCase().includes(';base64');
  const mime = (isBase64 ? meta.split(';')[0] : meta) || 'application/octet-stream';
  // If the data URL is plain (not base64), encode it before forwarding.
  const base64 = isBase64
    ? payload
    : Buffer.from(decodeURIComponent(payload), 'utf-8').toString('base64');
  const ext = MIME_EXT[mime.toLowerCase()] || 'bin';
  return { base64, ext, mime };
}
