// YouTube Transcript — fetch a video's transcript as plain text.
//
// Uses Apify's pintostudio/youtube-transcript-scraper actor (17k+ users,
// ~4M runs/month). Keyless scraping of YouTube's caption endpoints died
// in 2026 when YouTube enforced proof-of-origin tokens everywhere, so
// this joins the Apify family — same APIFY_API_TOKEN as the other 18.
//
// Args:
//   url       string  required — full YouTube URL or bare 11-char video ID
//   max_chars number  optional — cap transcript length (default 60000)
//
// Returns: { ok, video_id, segment_count, transcript, text, truncated, summary }
//   `text` duplicates `transcript` so routine delivery + collateral
//   preview (M68 key set) extract it without special-casing.

const API_BASE = 'https://api.apify.com/v2';
const ACTOR_SLUG = 'pintostudio~youtube-transcript-scraper';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const token = ctx.providerEnv?.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      'APIFY_API_TOKEN missing — open the gear panel and paste your Apify token from console.apify.com → Settings → Integrations. Same token as the other Apify skills.',
    );
  }

  const videoId = extractVideoId(
    typeof a.url === 'string'
      ? a.url
      : typeof a.video_id === 'string'
        ? a.video_id
        : '',
  );
  if (!videoId) {
    throw new Error(
      "url is required — a YouTube link (youtube.com/watch?v=…, youtu.be/…) or a bare 11-character video ID",
    );
  }
  const maxChars = clampInt(a.max_chars, 1000, 500000, 60000);

  const res = await fetch(
    `${API_BASE}/acts/${ACTOR_SLUG}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=120`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'Apify rejected the token — regenerate it at console.apify.com → Settings → Integrations and re-save in the gear panel.',
      );
    }
    throw new Error(
      `Apify actor failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }

  const items = await res.json();
  // Actor returns [{data: [{start, dur, text}, ...]}].
  const segs = Array.isArray(items)
    ? items.flatMap((it) => (Array.isArray(it?.data) ? it.data : []))
    : [];
  const parts = segs
    .map((s) => (typeof s?.text === 'string' ? s.text.trim() : ''))
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error(
      `No transcript available for video ${videoId} — captions may be disabled by the uploader.`,
    );
  }

  let transcript = decodeEntities(parts.join(' ').replace(/\s+/g, ' ').trim());
  let truncated = false;
  if (transcript.length > maxChars) {
    transcript = `${transcript.slice(0, maxChars)}…`;
    truncated = true;
  }

  const summary = `Transcript of ${videoId} — ${parts.length} segments, ${transcript.length} chars${truncated ? ' (truncated)' : ''}.`;

  return {
    ok: true,
    video_id: videoId,
    segment_count: parts.length,
    truncated,
    transcript,
    // M68 text-shape key so routines/collateral surface the content.
    text: transcript,
    summary,
  };
}

function extractVideoId(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.endsWith('youtu.be')) {
      const id = u.pathname.slice(1).split('/')[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    const v = u.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    // /shorts/<id>, /embed/<id>, /live/<id>
    const m = u.pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function decodeEntities(s) {
  return s
    .replace(/&amp;#39;/g, "'")
    .replace(/&amp;quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<');
}

function clampInt(v, min, max, dflt) {
  const n =
    typeof v === 'number' ? Math.floor(v) : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
