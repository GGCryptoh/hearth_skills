// Domain Availability Check.
//
// Checks domain registration status via RDAP (the modern, JSON successor
// to WHOIS) through the public bootstrap redirector at rdap.org. Zero
// keys, zero dependencies — global fetch only.
//
//   GET https://rdap.org/domain/<name>
//     404  → no RDAP record → the domain is (very likely) unregistered
//     200  → registered → response carries registrar + events (expiry)
//
// Args (from /skills/:id/run body, the agent, or a routine step):
//   domains  string | string[]  required — a domain, an array, or a
//                               comma/space separated string (max 20)
//
// Returns: { ok: true, checked, results: [{domain, status, registrar,
//            expires, error}], text, summary }
// Throws only when no valid domain is supplied; per-domain errors are
// captured inline.

const MAX_DOMAINS = 20;
const RDAP_BASE = 'https://rdap.org/domain/';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const domains = normalizeDomains(a.domains);
  if (domains.length === 0) {
    throw new Error(
      'domains is required — pass a domain, an array, or a comma/space separated string (e.g. "example.com foobar.io")',
    );
  }

  const results = await Promise.all(domains.map((d) => checkOne(d)));

  const lines = results.map((r) => {
    if (r.status === 'available') return `- ✅ **${r.domain}** — available`;
    if (r.status === 'taken') {
      const bits = [r.registrar && `registrar: ${r.registrar}`, r.expires && `expires: ${r.expires}`]
        .filter(Boolean)
        .join(', ');
      return `- ❌ **${r.domain}** — taken${bits ? ` (${bits})` : ''}`;
    }
    return `- ⚠️ **${r.domain}** — unknown${r.error ? ` (${r.error})` : ''}`;
  });

  const availCount = results.filter((r) => r.status === 'available').length;

  return {
    ok: true,
    checked: domains.length,
    results,
    text: lines.join('\n'),
    summary: `${availCount} of ${domains.length} domain(s) appear available.`,
  };
}

function normalizeDomains(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string') list = raw.split(/[\s,]+/);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    let d = typeof item === 'string' ? item.trim().toLowerCase() : '';
    // Strip scheme + path if a full URL was passed.
    d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    if (!d || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
    if (out.length >= MAX_DOMAINS) break;
  }
  return out;
}

async function checkOne(domain) {
  try {
    const res = await fetch(`${RDAP_BASE}${encodeURIComponent(domain)}`, {
      headers: {
        accept: 'application/rdap+json, application/json',
        'user-agent': 'HearthDomainCheck/0.1 (+https://hearth.cutlineadvisory.com)',
      },
      redirect: 'follow',
    });

    if (res.status === 404) {
      return { domain, status: 'available', registrar: null, expires: null };
    }
    if (res.status === 200) {
      const data = await res.json().catch(() => ({}));
      return {
        domain,
        status: 'taken',
        registrar: extractRegistrar(data),
        expires: extractExpiry(data),
      };
    }
    // 400/429/5xx etc → we can't determine status.
    const body = await res.text().catch(() => '');
    return {
      domain,
      status: 'unknown',
      registrar: null,
      expires: null,
      error: `RDAP HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`,
    };
  } catch (e) {
    return {
      domain,
      status: 'unknown',
      registrar: null,
      expires: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function extractRegistrar(data) {
  const entities = Array.isArray(data?.entities) ? data.entities : [];
  for (const ent of entities) {
    const roles = Array.isArray(ent?.roles) ? ent.roles : [];
    if (!roles.includes('registrar')) continue;
    // vCard array: ['vcard', [ ['fn', {}, 'text', 'Registrar Name'], ... ] ]
    const vcard = ent.vcardArray;
    if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
      for (const field of vcard[1]) {
        if (Array.isArray(field) && field[0] === 'fn' && typeof field[3] === 'string') {
          return field[3];
        }
      }
    }
    if (typeof ent.handle === 'string') return ent.handle;
  }
  return null;
}

function extractExpiry(data) {
  const events = Array.isArray(data?.events) ? data.events : [];
  for (const ev of events) {
    if (ev?.eventAction === 'expiration' && typeof ev.eventDate === 'string') {
      // Return the date portion (YYYY-MM-DD) for readability.
      return ev.eventDate.slice(0, 10);
    }
  }
  return null;
}
