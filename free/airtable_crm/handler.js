// Airtable CRM — read + write records.
//
// Thin wrapper over the Airtable REST API (api.airtable.com/v0). Pairs with
// leads_finder: prospect → drop the lead straight into your Airtable CRM.
// Zero dependencies — global fetch + a personal access token.
//
// Commands (dispatched on args.action):
//   action: 'add'     args: { fields }                → create a record
//   action: 'list'    args: { max?=20, view? }        → records
//   action: 'update'  args: { record_id, fields }     → patch a record
//
// Vault config:
//   AIRTABLE_API_KEY   secret — personal access token (data.records r/w)
//   base_id            text   — appXXXXXXXXXXXXXX
//   table_name         text   — defaults to 'Leads'
//
// Returns: action-specific structured response + markdown `text`.
// Throws on missing config, bad args, or any non-2xx from Airtable
// (status + truncated body — Airtable errors name the field on 422).

const API_BASE = 'https://api.airtable.com/v0';

function readVaultString(ctx, key) {
  const fromProvider = ctx.providerEnv?.[key];
  if (typeof fromProvider === 'string' && fromProvider.length > 0) return fromProvider;
  const fromInputs = ctx.skillInputs?.[key];
  if (typeof fromInputs === 'string' && fromInputs.length > 0) return fromInputs;
  return null;
}

async function airtable(path, apiKey, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Airtable ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const apiKey = readVaultString(ctx, 'AIRTABLE_API_KEY');
  if (!apiKey) {
    throw new Error(
      'AIRTABLE_API_KEY missing — add your Airtable personal access token under the skill gear panel',
    );
  }
  const baseId = readVaultString(ctx, 'base_id');
  if (!baseId) {
    throw new Error('base_id not configured — set your Airtable base id (appXXXX…) in the gear panel');
  }
  const tableName = readVaultString(ctx, 'table_name') || 'Leads';
  const tablePath = `/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}`;

  const action = typeof a.action === 'string' ? a.action : 'list';

  if (action === 'add') {
    const fields = a.fields && typeof a.fields === 'object' && !Array.isArray(a.fields) ? a.fields : null;
    if (!fields || Object.keys(fields).length === 0) {
      throw new Error('action="add" requires args.fields — an object of column → value');
    }
    const data = await airtable(tablePath, apiKey, {
      method: 'POST',
      body: JSON.stringify({ fields, typecast: true }),
    });
    return {
      ok: true,
      action: 'add',
      record_id: data.id || null,
      fields: data.fields || fields,
      text: `Added record ${data.id || '(id unknown)'} to ${tableName}.`,
      summary: `Added a record to Airtable table "${tableName}".`,
    };
  }

  if (action === 'list') {
    const max =
      typeof a.max === 'number' && a.max > 0 && a.max <= 100 ? Math.floor(a.max) : 20;
    const params = new URLSearchParams({ pageSize: String(max), maxRecords: String(max) });
    if (typeof a.view === 'string' && a.view.trim()) params.set('view', a.view.trim());
    const data = await airtable(`${tablePath}?${params.toString()}`, apiKey);
    const rows = Array.isArray(data.records) ? data.records : [];
    const records = rows.map((r) => ({ id: r.id, fields: r.fields || {} }));
    const text = records.length
      ? [
          `## ${tableName} — ${records.length} record(s)`,
          '',
          ...records.map((r) => `- \`${r.id}\` · ${summarizeFields(r.fields)}`),
        ].join('\n')
      : `No records in "${tableName}".`;
    return {
      ok: true,
      action: 'list',
      table: tableName,
      count: records.length,
      records,
      text,
      summary: `Listed ${records.length} record(s) from "${tableName}".`,
    };
  }

  if (action === 'update') {
    const recordId = typeof a.record_id === 'string' ? a.record_id.trim() : '';
    if (!recordId) throw new Error('action="update" requires args.record_id (rec…)');
    const fields = a.fields && typeof a.fields === 'object' && !Array.isArray(a.fields) ? a.fields : null;
    if (!fields || Object.keys(fields).length === 0) {
      throw new Error('action="update" requires args.fields — an object of column → value');
    }
    const data = await airtable(`${tablePath}/${encodeURIComponent(recordId)}`, apiKey, {
      method: 'PATCH',
      body: JSON.stringify({ fields, typecast: true }),
    });
    return {
      ok: true,
      action: 'update',
      record_id: data.id || recordId,
      fields: data.fields || fields,
      text: `Updated record ${recordId} in ${tableName}.`,
      summary: `Updated a record in Airtable table "${tableName}".`,
    };
  }

  throw new Error(`Unknown action "${action}". Expected one of: add, list, update.`);
}

function summarizeFields(fields) {
  const keys = Object.keys(fields).slice(0, 4);
  return keys
    .map((k) => {
      let v = fields[k];
      if (Array.isArray(v)) v = v.join(', ');
      else if (v && typeof v === 'object') v = JSON.stringify(v);
      const s = String(v ?? '');
      return `${k}: ${s.length > 60 ? s.slice(0, 59) + '…' : s}`;
    })
    .join(' · ');
}
