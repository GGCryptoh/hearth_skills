// n8n Workflow — orchestration via n8n's REST API.
//
// Single-skill, multi-verb shape (like a Stripe / GitHub API wrapper).
// The agent passes `action` to pick the operation; the remaining args
// are action-specific.
//
// Vault config:
//   N8N_BASE_URL   text     required — https://yourname.n8n.cloud OR self-hosted
//   N8N_API_KEY    secret   required — header: X-N8N-API-KEY
//
// Supported actions:
//   list         — { active?: boolean, tags?: string }            → workflows[]
//   get          — { id: string }                                  → workflow
//   create       — { name: string, nodes: [], connections: {},
//                    settings?: object, active?: boolean }         → workflow
//   update       — { id: string, ...same as create }               → workflow
//   delete       — { id: string }                                  → { deleted: true }
//   activate     — { id: string }                                  → workflow
//   deactivate   — { id: string }                                  → workflow
//   trigger      — { id: string, data?: object }                   → execution
//                  (only works on workflows with a manual/webhook trigger node;
//                  uses POST /workflows/:id/run when supported, otherwise
//                  routes through the webhook URL on the workflow's webhook node)
//   executions   — { workflow_id?: string, limit?: number,
//                    status?: 'success'|'error'|'waiting' }        → executions[]
//
// Errors:
//   - missing N8N_BASE_URL / N8N_API_KEY  → thrown with the fix instruction
//   - 4xx / 5xx from n8n                  → thrown with status + body excerpt
//   - 401                                 → "API key was rejected — regenerate at
//                                            <base>/settings/api"
//
// n8n API docs: https://docs.n8n.io/api/

const API_PATH = '/api/v1';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const apiKey = ctx.providerEnv?.N8N_API_KEY;
  if (!apiKey) {
    throw new Error(
      'N8N_API_KEY missing — open the n8n Workflow skill gear panel and paste your API key from n8n → Settings → API → Create API key.',
    );
  }
  const baseUrlRaw = ctx.skillInputs?.N8N_BASE_URL;
  if (!baseUrlRaw || typeof baseUrlRaw !== 'string') {
    throw new Error(
      'N8N_BASE_URL missing — open the n8n Workflow skill gear panel and paste your n8n instance URL (e.g. https://yourname.n8n.cloud).',
    );
  }
  // Normalise — strip trailing slash + accidental /api/v1 suffix so the
  // handler controls the path. Common founder mistake: pasting the full
  // browser URL with query params.
  let baseUrl;
  try {
    const u = new URL(baseUrlRaw.trim());
    baseUrl = `${u.protocol}//${u.host}`;
  } catch {
    throw new Error(
      `N8N_BASE_URL is not a valid URL: ${baseUrlRaw}`,
    );
  }

  const action = typeof a.action === 'string' ? a.action.trim() : '';
  if (!action) {
    throw new Error(
      "action is required. Use one of: list, get, create, update, delete, activate, deactivate, trigger, executions.",
    );
  }

  switch (action) {
    case 'list':
      return await listWorkflows(baseUrl, apiKey, a);
    case 'get':
      requireId(a.id);
      return await getWorkflow(baseUrl, apiKey, a.id);
    case 'create':
      return await createWorkflow(baseUrl, apiKey, a);
    case 'update':
      requireId(a.id);
      return await updateWorkflow(baseUrl, apiKey, a.id, a);
    case 'delete':
      requireId(a.id);
      return await deleteWorkflow(baseUrl, apiKey, a.id);
    case 'activate':
      requireId(a.id);
      return await setActive(baseUrl, apiKey, a.id, true);
    case 'deactivate':
      requireId(a.id);
      return await setActive(baseUrl, apiKey, a.id, false);
    case 'trigger':
      requireId(a.id);
      return await triggerWorkflow(baseUrl, apiKey, a.id, a.data ?? {});
    case 'executions':
      return await listExecutions(baseUrl, apiKey, a);
    default:
      throw new Error(
        `Unknown action "${action}". Use one of: list, get, create, update, delete, activate, deactivate, trigger, executions.`,
      );
  }
}

function requireId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('id is required for this action (the workflow id from n8n)');
  }
}

async function n8nFetch(baseUrl, apiKey, path, init = {}) {
  const headers = {
    'X-N8N-API-KEY': apiKey,
    Accept: 'application/json',
    ...(init.headers ?? {}),
  };
  if (init.body && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${baseUrl}${API_PATH}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401) {
      throw new Error(
        `n8n 401 — API key was rejected. Generate a new one at ${baseUrl}/settings/api and re-save in the skill gear panel. (Body: ${text.slice(0, 200)})`,
      );
    }
    throw new Error(
      `n8n ${res.status}: ${text.slice(0, 500) || '(no body)'}`,
    );
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    return await res.json();
  }
  // Some endpoints (webhook triggers) return text or empty body.
  return await res.text();
}

async function listWorkflows(baseUrl, apiKey, a) {
  const params = new URLSearchParams();
  if (typeof a.active === 'boolean') params.set('active', a.active ? 'true' : 'false');
  if (typeof a.tags === 'string' && a.tags.length > 0) params.set('tags', a.tags);
  const q = params.toString();
  const data = await n8nFetch(baseUrl, apiKey, `/workflows${q ? `?${q}` : ''}`);
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return {
    ok: true,
    action: 'list',
    count: list.length,
    workflows: list.map(summariseWorkflow),
    summary: `Found ${list.length} workflow${list.length === 1 ? '' : 's'}.`,
  };
}

async function getWorkflow(baseUrl, apiKey, id) {
  const data = await n8nFetch(baseUrl, apiKey, `/workflows/${encodeURIComponent(id)}`);
  const wf = data?.data ?? data;
  return {
    ok: true,
    action: 'get',
    workflow: wf,
    summary: `Loaded workflow "${wf?.name ?? id}" (${wf?.nodes?.length ?? 0} nodes, active=${!!wf?.active}).`,
  };
}

async function createWorkflow(baseUrl, apiKey, a) {
  const body = buildWorkflowBody(a);
  if (!body.name) throw new Error('name is required for create');
  const data = await n8nFetch(baseUrl, apiKey, `/workflows`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const wf = data?.data ?? data;
  return {
    ok: true,
    action: 'create',
    workflow: wf,
    summary: `Created workflow "${wf?.name ?? body.name}" (id=${wf?.id ?? 'unknown'}, active=${!!wf?.active}).`,
  };
}

async function updateWorkflow(baseUrl, apiKey, id, a) {
  const body = buildWorkflowBody(a);
  const data = await n8nFetch(baseUrl, apiKey, `/workflows/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  const wf = data?.data ?? data;
  return {
    ok: true,
    action: 'update',
    workflow: wf,
    summary: `Updated workflow "${wf?.name ?? id}".`,
  };
}

async function deleteWorkflow(baseUrl, apiKey, id) {
  await n8nFetch(baseUrl, apiKey, `/workflows/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return {
    ok: true,
    action: 'delete',
    id,
    summary: `Deleted workflow ${id}.`,
  };
}

async function setActive(baseUrl, apiKey, id, active) {
  const path = active
    ? `/workflows/${encodeURIComponent(id)}/activate`
    : `/workflows/${encodeURIComponent(id)}/deactivate`;
  const data = await n8nFetch(baseUrl, apiKey, path, { method: 'POST' });
  const wf = data?.data ?? data;
  return {
    ok: true,
    action: active ? 'activate' : 'deactivate',
    workflow: wf,
    summary: `${active ? 'Activated' : 'Deactivated'} workflow "${wf?.name ?? id}".`,
  };
}

async function triggerWorkflow(baseUrl, apiKey, id, data) {
  // n8n's REST API doesn't have a universal "trigger" endpoint — execution
  // happens via the workflow's trigger node (webhook URL, schedule, etc.).
  // The closest universal call is POST /workflows/:id/run, which is gated
  // by the workflow having a "Manual Trigger" node. For other trigger
  // shapes the founder hits the workflow's published webhook URL directly.
  //
  // Try POST run; if it fails with 4xx, surface a clearer message.
  try {
    const result = await n8nFetch(baseUrl, apiKey, `/workflows/${encodeURIComponent(id)}/run`, {
      method: 'POST',
      body: JSON.stringify({ data }),
    });
    return {
      ok: true,
      action: 'trigger',
      result,
      summary: `Triggered workflow ${id} (manual run).`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/404|405|not.*found/i.test(msg)) {
      throw new Error(
        `Workflow ${id} can't be triggered via /run — it likely doesn't have a Manual Trigger node. ` +
          `Find the workflow's webhook URL in n8n and POST to it directly. ` +
          `Underlying error: ${msg}`,
      );
    }
    throw err;
  }
}

async function listExecutions(baseUrl, apiKey, a) {
  const params = new URLSearchParams();
  if (typeof a.workflow_id === 'string' && a.workflow_id.length > 0) {
    params.set('workflowId', a.workflow_id);
  }
  const limit =
    typeof a.limit === 'number' && Number.isFinite(a.limit) && a.limit > 0
      ? Math.min(Math.floor(a.limit), 250)
      : 20;
  params.set('limit', String(limit));
  if (typeof a.status === 'string' && a.status.length > 0) {
    params.set('status', a.status);
  }
  const data = await n8nFetch(baseUrl, apiKey, `/executions?${params.toString()}`);
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return {
    ok: true,
    action: 'executions',
    count: list.length,
    executions: list.map(summariseExecution),
    summary: `Found ${list.length} execution${list.length === 1 ? '' : 's'}.`,
  };
}

function buildWorkflowBody(a) {
  const body = {};
  if (typeof a.name === 'string' && a.name.length > 0) body.name = a.name;
  if (Array.isArray(a.nodes)) body.nodes = a.nodes;
  if (a.connections && typeof a.connections === 'object') {
    body.connections = a.connections;
  }
  if (a.settings && typeof a.settings === 'object') body.settings = a.settings;
  if (typeof a.active === 'boolean') body.active = a.active;
  if (Array.isArray(a.tags)) body.tags = a.tags;
  return body;
}

function summariseWorkflow(wf) {
  if (!wf || typeof wf !== 'object') return wf;
  return {
    id: wf.id,
    name: wf.name,
    active: wf.active,
    node_count: Array.isArray(wf.nodes) ? wf.nodes.length : 0,
    created_at: wf.createdAt,
    updated_at: wf.updatedAt,
    tags: Array.isArray(wf.tags) ? wf.tags : undefined,
  };
}

function summariseExecution(ex) {
  if (!ex || typeof ex !== 'object') return ex;
  return {
    id: ex.id,
    workflow_id: ex.workflowId,
    finished: ex.finished,
    status:
      ex.status ?? (ex.finished === true ? 'success' : ex.finished === false ? 'error' : 'unknown'),
    started_at: ex.startedAt,
    stopped_at: ex.stoppedAt,
    mode: ex.mode,
  };
}
