// RSS / Atom Digest.
//
// Fetches 1-N RSS or Atom feeds and returns the latest items as clean
// markdown. Zero dependencies — the XML item extraction is hand-rolled
// (regex + CDATA handling + tag stripping) so it runs standalone in the
// supervisor with global fetch only.
//
// Args (from /skills/:id/run body, the agent, or a routine step):
//   feeds  string | string[]  required — a feed URL, an array of URLs, or a
//                             comma/space/newline separated string (max 20)
//   limit  number             optional — max items per feed (default 5)
//   hours  number             optional — only items published within N hours
//
// Returns: { ok: true, feeds, item_count, items, text, summary }
//   text is delivery-ready markdown (used by routine delivery + the stage).
// Throws only when no usable feed URL is supplied; per-feed fetch/parse
// errors are captured inline so one bad feed doesn't sink the digest.

const MAX_FEEDS = 20;
const SNIPPET_CAP = 280;
const TITLE_CAP = 200;

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const feeds = normalizeFeeds(a.feeds);
  if (feeds.length === 0) {
    throw new Error(
      'feeds is required — pass a feed URL, an array of URLs, or a comma/space separated string',
    );
  }

  const limit =
    typeof a.limit === 'number' && a.limit > 0 && a.limit <= 50
      ? Math.floor(a.limit)
      : 5;
  const hours =
    typeof a.hours === 'number' && a.hours > 0 ? a.hours : null;
  const cutoffMs = hours ? Date.now() - hours * 3600_000 : null;

  const results = await Promise.all(
    feeds.map((url) => fetchFeed(url, limit, cutoffMs)),
  );

  const sections = [];
  let itemCount = 0;
  const flatItems = [];

  for (const r of results) {
    if (r.error) {
      sections.push(`### ${r.url}\n_Could not load: ${r.error}_`);
      continue;
    }
    itemCount += r.items.length;
    const heading = r.title ? `${r.title}` : r.url;
    if (r.items.length === 0) {
      sections.push(
        `### ${heading}\n_No items${hours ? ` in the last ${hours}h` : ''}._`,
      );
      continue;
    }
    const lines = r.items.map((it) => {
      flatItems.push({ ...it, feed: heading });
      const dateStr = it.dateMs ? new Date(it.dateMs).toISOString().slice(0, 16).replace('T', ' ') : '';
      const head = it.link ? `[${it.title}](${it.link})` : it.title;
      const meta = dateStr ? ` — ${dateStr} UTC` : '';
      return `- **${head}**${meta}${it.snippet ? `\n  ${it.snippet}` : ''}`;
    });
    sections.push(`### ${heading}\n${lines.join('\n')}`);
  }

  const text = sections.join('\n\n');

  return {
    ok: true,
    feeds,
    item_count: itemCount,
    items: flatItems,
    text,
    summary: `${itemCount} item(s) across ${feeds.length} feed(s)${hours ? ` (last ${hours}h)` : ''}.`,
  };
}

function normalizeFeeds(raw) {
  let list = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string') {
    list = raw.split(/[\s,]+/);
  }
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const url = typeof item === 'string' ? item.trim() : '';
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_FEEDS) break;
  }
  return out;
}

async function fetchFeed(url, limit, cutoffMs) {
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'user-agent': 'HearthRSSDigest/0.1 (+https://hearth.cutlineadvisory.com)',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { url, error: `HTTP ${res.status} ${body.slice(0, 120)}`.trim() };
    }
    const xml = await res.text();
    const feedTitle = firstTag(xml.slice(0, 4000), 'title');
    const items = parseItems(xml, limit, cutoffMs);
    return { url, title: feedTitle, items };
  } catch (e) {
    return { url, error: e instanceof Error ? e.message : String(e) };
  }
}

// Extract <item> (RSS) and <entry> (Atom) blocks, in document order.
function parseItems(xml, limit, cutoffMs) {
  const blocks = [];
  const re = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    blocks.push(m[0]);
    if (blocks.length >= 200) break;
  }

  const items = [];
  for (const block of blocks) {
    const title = clean(firstTag(block, 'title')) || '(untitled)';
    const link = extractLink(block);
    const dateRaw =
      firstTag(block, 'pubDate') ||
      firstTag(block, 'published') ||
      firstTag(block, 'updated') ||
      firstTag(block, 'dc:date') ||
      '';
    const dateMs = parseDate(dateRaw);
    if (cutoffMs && dateMs && dateMs < cutoffMs) continue;
    const descRaw =
      firstTag(block, 'description') ||
      firstTag(block, 'summary') ||
      firstTag(block, 'content') ||
      firstTag(block, 'content:encoded') ||
      '';
    const snippet = capStr(stripTags(clean(descRaw)), SNIPPET_CAP);
    items.push({
      title: capStr(title, TITLE_CAP),
      link,
      date: dateRaw || null,
      dateMs,
      snippet,
    });
    if (items.length >= limit) break;
  }
  return items;
}

// Return the inner text of the first <tag>…</tag>, handling CDATA.
function firstTag(xml, tag) {
  const re = new RegExp(`<${escapeRe(tag)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRe(tag)}>`, 'i');
  const m = re.exec(xml);
  return m ? m[1] : '';
}

// Atom <link href="…"/> or RSS <link>…</link>.
function extractLink(block) {
  // Atom: prefer rel="alternate" (or no rel) href.
  const linkTags = block.match(/<link\b[^>]*>/gi) || [];
  let alt = null;
  for (const t of linkTags) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(t);
    if (!href) continue;
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(t);
    if (!rel || rel[1].toLowerCase() === 'alternate') return href[1];
    if (!alt) alt = href[1];
  }
  if (alt) return alt;
  // RSS: <link>url</link>
  const rss = clean(firstTag(block, 'link'));
  return rss || null;
}

function clean(s) {
  if (typeof s !== 'string') return '';
  let out = s.trim();
  // Unwrap CDATA.
  out = out.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return out.trim();
}

function stripTags(html) {
  return decodeEntities(
    String(html)
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(Number(d));
      } catch {
        return '';
      }
    });
}

function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : null;
}

function capStr(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
