// Notion — read + write a Notion workspace via the official REST API.
//
// Single-skill, multi-verb shape (like the n8n / Stripe / GitHub wrappers).
// The agent passes `action` to pick the operation; the rest of the args are
// action-specific. The API key is an INTERNAL INTEGRATION SECRET, and the
// integration only sees pages/databases the founder has explicitly shared
// with it (••• → Connections) — so an empty search usually means "not shared
// yet", not "doesn't exist".
//
// Vault config:
//   NOTION_API_KEY   secret   required — Authorization: Bearer <key>
//
// Supported actions:
//   search             { query?, filter?, page_size? }                 → results[]
//   get_page           { id }                                          → page
//   get_database       { id }                                          → database
//   query_database     { id, filter?, sorts?, page_size? }             → results[]
//   create_page        { parent, properties, children? }              → page
//                      parent = { database_id } OR { page_id }
//   update_page        { id, properties?, archived? }                  → page
//   get_block_children { id, page_size? }                              → results[] (page content)
//   append_blocks      { id, children }                                → results[]
//
// Optional on any action: notion_version (defaults to a broadly-compatible
// stable version; override only if you need a newer API behaviour).
//
// Notion API docs: https://developers.notion.com/reference

const API_BASE = 'https://api.notion.com/v1';
// 2022-06-28 is the most broadly-compatible stable version and supports every
// endpoint here. Newer versions (e.g. 2025-09-03) renamed databases →
// "data sources" for query, which would break query_database — so we pin a
// safe default and let the caller override via args.notion_version.
const DEFAULT_NOTION_VERSION = '2022-06-28';

function readVaultString(ctx, key) {
  const fromProvider = ctx.providerEnv?.[key];
  if (typeof fromProvider === 'string' && fromProvider.length > 0) return fromProvider;
  const fromInputs = ctx.skillInputs?.[key];
  if (typeof fromInputs === 'string' && fromInputs.length > 0) return fromInputs;
  return null;
}

function reqId(a) {
  const id = typeof a.id === 'string' ? a.id.trim() : '';
  if (!id) {
    throw new Error(
      'This action requires args.id (a Notion page / database / block id — the 32-char hex in the URL).',
    );
  }
  return encodeURIComponent(id);
}

// Best-effort human title for a page or database object.
function titleOf(obj) {
  if (!obj || typeof obj !== 'object') return '(unknown)';
  if (obj.object === 'database' && Array.isArray(obj.title)) {
    return obj.title.map((t) => t.plain_text).join('') || '(untitled database)';
  }
  const props = obj.properties || {};
  for (const v of Object.values(props)) {
    if (v && v.type === 'title' && Array.isArray(v.title)) {
      return v.title.map((t) => t.plain_text).join('') || '(untitled)';
    }
  }
  return obj.id || '(unknown)';
}

function summarizeSearch(results) {
  if (!results.length) {
    return 'No Notion pages or databases matched. If you expected results, make sure the page/database is shared with your integration (••• → Connections).';
  }
  return results
    .map((r) => `• [${r.object}] ${titleOf(r)} — ${r.url || r.id}`)
    .join('\n');
}

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const apiKey = readVaultString(ctx, 'NOTION_API_KEY');
  if (!apiKey) {
    throw new Error(
      'Notion not configured — open the gear panel and set NOTION_API_KEY (your internal integration secret from notion.so/my-integrations).',
    );
  }
  const version =
    typeof a.notion_version === 'string' && a.notion_version.trim().length > 0
      ? a.notion_version.trim()
      : DEFAULT_NOTION_VERSION;

  async function call(method, path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'Notion-Version': version,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error(
          'Notion rejected the API key (401) — regenerate the integration secret at notion.so/my-integrations and paste the new value.',
        );
      }
      if (res.status === 404) {
        throw new Error(
          `Notion 404 — the id wasn't found OR the page/database isn't shared with your integration (••• → Connections). ${(json.message || '').slice(0, 200)}`,
        );
      }
      throw new Error(`Notion ${res.status}: ${(json.message || text).slice(0, 300)}`);
    }
    return json;
  }

  const action = typeof a.action === 'string' ? a.action : 'search';

  switch (action) {
    case 'search': {
      const body = {};
      if (typeof a.query === 'string') body.query = a.query;
      if (a.filter && typeof a.filter === 'object') body.filter = a.filter;
      if (typeof a.page_size === 'number') body.page_size = a.page_size;
      const data = await call('POST', '/search', body);
      const results = Array.isArray(data.results) ? data.results : [];
      return {
        ok: true,
        action,
        count: results.length,
        results,
        has_more: data.has_more ?? false,
        next_cursor: data.next_cursor ?? null,
        text: summarizeSearch(results),
      };
    }

    case 'get_page':
      return { ok: true, action, page: await call('GET', `/pages/${reqId(a)}`) };

    case 'get_database':
      return {
        ok: true,
        action,
        database: await call('GET', `/databases/${reqId(a)}`),
      };

    case 'query_database': {
      const body = {};
      if (a.filter && typeof a.filter === 'object') body.filter = a.filter;
      if (Array.isArray(a.sorts)) body.sorts = a.sorts;
      if (typeof a.page_size === 'number') body.page_size = a.page_size;
      if (typeof a.start_cursor === 'string') body.start_cursor = a.start_cursor;
      const data = await call('POST', `/databases/${reqId(a)}/query`, body);
      const results = Array.isArray(data.results) ? data.results : [];
      return {
        ok: true,
        action,
        count: results.length,
        results,
        has_more: data.has_more ?? false,
        next_cursor: data.next_cursor ?? null,
      };
    }

    case 'create_page': {
      if (!a.parent || typeof a.parent !== 'object') {
        throw new Error(
          'create_page requires args.parent — e.g. { "database_id": "…" } to add a row, or { "page_id": "…" } to nest a page.',
        );
      }
      const body = { parent: a.parent, properties: a.properties || {} };
      if (Array.isArray(a.children)) body.children = a.children;
      const page = await call('POST', '/pages', body);
      return { ok: true, action, page, text: `Created page ${page.id} (${page.url || ''}).` };
    }

    case 'update_page': {
      const body = {};
      if (a.properties && typeof a.properties === 'object') body.properties = a.properties;
      if (typeof a.archived === 'boolean') body.archived = a.archived;
      const page = await call('PATCH', `/pages/${reqId(a)}`, body);
      return { ok: true, action, page, text: `Updated page ${page.id}.` };
    }

    case 'get_block_children': {
      const size = typeof a.page_size === 'number' ? Math.min(100, a.page_size) : 100;
      const data = await call(
        'GET',
        `/blocks/${reqId(a)}/children?page_size=${size}`,
      );
      const results = Array.isArray(data.results) ? data.results : [];
      return {
        ok: true,
        action,
        count: results.length,
        results,
        has_more: data.has_more ?? false,
        next_cursor: data.next_cursor ?? null,
      };
    }

    case 'append_blocks': {
      if (!Array.isArray(a.children)) {
        throw new Error(
          'append_blocks requires args.children — an array of Notion block objects to append to the page/block at args.id.',
        );
      }
      const data = await call('PATCH', `/blocks/${reqId(a)}/children`, {
        children: a.children,
      });
      return { ok: true, action, results: data.results ?? [], text: 'Appended blocks.' };
    }

    default:
      throw new Error(
        `Unknown action "${action}". Expected one of: search, get_page, get_database, query_database, create_page, update_page, get_block_children, append_blocks.`,
      );
  }
}
