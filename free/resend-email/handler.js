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
//   attachments [{filename, content|collateral_id|path}] optional — content is
//                                       base64 bytes; path is a hosted HTTPS URL.
//   collateral_id / attachment_collateral_id  optional — saved local collateral
//                                       to attach. Resolved to bytes server-side:
//                                       ctx.vault.getCollateral when the runner
//                                       hands us the vault, else the supervisor's
//                                       GET /collateral/:id/raw (HEARTH_SUPERVISOR_URL,
//                                       default http://127.0.0.1:3417). An id that
//                                       cannot be resolved (404 / empty / too
//                                       large) FAILS the call — the email is never
//                                       sent without the attachment the agent
//                                       asked for.
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
// Returns: { ok: true, id, to, subject, attachment_count, attachment_filenames,
//            attachments: [{filename, bytes, source}], attachment_bytes_total,
//            summary }
// `summary` always states whether an attachment was included and, if so, its
// filename + byte size — the agent may only claim "sent with attachment" when
// the summary says so. Throws on missing api key, missing from_email, missing
// to/subject, any unresolved attachment, or 4xx/5xx from the Resend API.

const API_URL = 'https://api.resend.com/emails';
const SUPERVISOR_URL_DEFAULT = 'http://127.0.0.1:3417';
// Resend rejects emails over 40 MB (body + attachments). Fail before the POST
// instead of letting Resend 413 with the attachment silently blamed on us.
const MAX_ATTACHMENT_BYTES_TOTAL = 40 * 1024 * 1024;

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
  // Resolve every requested attachment before sending. Never silently drop one.
  const collected = [];
  if (a.attachments !== undefined) {
    if (!Array.isArray(a.attachments)) throw new Error('attachments must be an array');
    for (const x of a.attachments) {
      if (!x || typeof x !== 'object' || typeof x.filename !== 'string' || !x.filename.trim()) {
        throw new Error('Each attachment requires a filename');
      }
      const sources = ['content', 'collateral_id', 'path'].filter((key) => x[key] !== undefined);
      if (sources.length !== 1) throw new Error('Each attachment requires exactly one of content, collateral_id or path');
      if (sources[0] === 'collateral_id') {
        collected.push(await collateralAttachment(ctx, x.collateral_id, x.filename));
      } else if (sources[0] === 'path') {
        let url;
        try { url = new URL(x.path); } catch { throw new Error('Attachment path must be a hosted HTTPS URL'); }
        if (url.protocol !== 'https:') throw new Error('Attachment path must be a hosted HTTPS URL');
        collected.push({ filename: x.filename, path: url.href, bytes: null, source: 'path' });
      } else {
        const content = validateBase64(x.content);
        collected.push({ filename: x.filename, content, bytes: base64Bytes(content), source: 'content' });
      }
    }
  }
  if (a.collateral_id !== undefined && a.attachment_collateral_id !== undefined) {
    throw new Error('Use either collateral_id or attachment_collateral_id');
  }
  const collateralId = a.attachment_collateral_id !== undefined ? a.attachment_collateral_id : a.collateral_id;
  if (collateralId !== undefined) {
    collected.push(await collateralAttachment(ctx, collateralId, a.attachment_filename));
  }
  if (a.attachment_data_url !== undefined) {
    const parsed = parseDataUrl(a.attachment_data_url);
    if (!parsed) throw new Error('attachment_data_url must be a valid non-empty data URL');
    const filename =
      typeof a.attachment_filename === 'string' && a.attachment_filename.trim()
        ? a.attachment_filename
        : `attachment.${parsed.ext}`;
    collected.push({ filename, content: parsed.base64, bytes: base64Bytes(parsed.base64), source: 'data_url' });
  }
  // Size gate — Resend caps the whole email at 40 MB. Fail loud before the
  // POST so the agent never reports "sent" for a message Resend would 413.
  const attachmentBytesTotal = collected.reduce((sum, x) => sum + (x.bytes ?? 0), 0);
  if (attachmentBytesTotal > MAX_ATTACHMENT_BYTES_TOTAL) {
    throw new Error(
      `attachment too large: ${collected.map((x) => `${x.filename} (${formatBytes(x.bytes)})`).join(', ')} totals ${formatBytes(attachmentBytesTotal)}, over Resend's 40 MB cap — email not sent`,
    );
  }
  if (collected.length > 0) {
    body.attachments = collected.map((x) =>
      x.path !== undefined ? { filename: x.filename, path: x.path } : { filename: x.filename, content: x.content },
    );
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
  const attachmentReport = collected.map((x) => ({
    filename: x.filename,
    bytes: x.bytes,
    source: x.source,
  }));
  const attachmentLine = collected.length
    ? `with ${collected.length} attachment${collected.length === 1 ? '' : 's'}: ${collected
        .map((x) => `${x.filename} (${x.bytes === null ? 'hosted URL' : formatBytes(x.bytes)})`)
        .join(', ')}`
    : 'no attachment';
  return {
    ok: true,
    id: data?.id ?? null,
    to,
    subject,
    attachment_count: collected.length,
    attachment_filenames: collected.map((x) => x.filename),
    attachments: attachmentReport,
    attachment_bytes_total: attachmentBytesTotal,
    summary: `Email sent to ${to.join(', ')} — subject "${subject}" — ${attachmentLine}`,
  };
}

// Decoded byte length of a base64 payload without materialising the buffer.
function base64Bytes(b64) {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'unknown size';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
  let base64;
  try {
    base64 = validateBase64(isBase64
      ? payload
      : Buffer.from(decodeURIComponent(payload), 'utf-8').toString('base64'));
  } catch { return null; }
  const ext = MIME_EXT[mime.toLowerCase()] || 'bin';
  return { base64, ext, mime };
}

function validateBase64(content) {
  if (typeof content !== 'string' || !content.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) {
    throw new Error('Attachment content must be non-empty base64 bytes');
  }
  const normalized = Buffer.from(content, 'base64').toString('base64');
  if (normalized.replace(/=+$/, '') !== content.replace(/=+$/, '') ||
      (content.includes('=') && normalized !== content)) {
    throw new Error('Attachment content contains invalid base64');
  }
  return normalized;
}

// Resolve a saved collateral row to attachment bytes. Contract: every failure
// throws an "attachment unresolved: … — email not sent" error so the agent can
// never report a sent-with-attachment email that went out bare.
async function collateralAttachment(ctx, id, filename) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('collateral_id must be a non-empty string');
  const cid = id.trim();
  const unresolved = (why) => new Error(`attachment unresolved: collateral ${cid} ${why} — email not sent`);
  const parsed = typeof ctx.vault?.getCollateral === 'function'
    ? await collateralFromVault(ctx, cid, unresolved)
    : await collateralFromSupervisor(ctx, cid, unresolved);
  if (!parsed.base64) throw unresolved('resolved to zero bytes');
  return {
    filename: typeof filename === 'string' && filename.trim() ? filename : `attachment.${parsed.ext}`,
    content: parsed.base64,
    bytes: base64Bytes(parsed.base64),
    source: `collateral:${cid}`,
  };
}

// In-process path — the runner hands marketplace handlers the unlocked vault.
async function collateralFromVault(ctx, cid, unresolved) {
  const row = await ctx.vault.getCollateral(cid);
  if (!row || typeof row.content !== 'string' || !row.content.length) {
    throw unresolved('not found or empty');
  }
  let metadata = {};
  try { metadata = JSON.parse(row.metadata ?? '{}') ?? {}; } catch { /* legacy row */ }
  if (row.content.startsWith('data:')) {
    const parsed = parseDataUrl(row.content);
    if (!parsed) throw unresolved('has an invalid data URL');
    return parsed;
  }
  if (metadata.encoding === 'base64') {
    return { base64: validateBase64(row.content), ext: MIME_EXT[metadata.mime_type] || 'bin' };
  }
  if (/^https?:\/\//i.test(row.content.trim()) || row.kind === 'image') {
    throw unresolved('has no local file bytes (remote URL); supply base64 content or a hosted attachment path');
  }
  return { base64: Buffer.from(row.content, 'utf8').toString('base64'), ext: 'txt' };
}

// Out-of-process path — GET /collateral/:id/raw on the supervisor returns the
// decoded bytes with a content-type header (404 not_found / no_content when
// the id is unknown or empty). No auth header: supervisor GETs are local-only.
async function collateralFromSupervisor(ctx, cid, unresolved) {
  const base = String(
    ctx.providerEnv?.HEARTH_SUPERVISOR_URL || process.env.HEARTH_SUPERVISOR_URL || SUPERVISOR_URL_DEFAULT,
  ).replace(/\/+$/, '');
  const url = `${base}/collateral/${encodeURIComponent(cid)}/raw`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw unresolved(`could not be fetched from ${url} (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw unresolved(`fetch from ${url} returned HTTP ${res.status}${detail ? ` ${detail.slice(0, 120)}` : ''}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw unresolved('resolved to zero bytes');
  if (bytes.length > MAX_ATTACHMENT_BYTES_TOTAL) {
    throw unresolved(`is ${formatBytes(bytes.length)}, over Resend's 40 MB cap`);
  }
  const mime = String(res.headers.get('content-type') || 'application/octet-stream')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return { base64: bytes.toString('base64'), ext: MIME_EXT[mime] || 'bin', mime };
}
