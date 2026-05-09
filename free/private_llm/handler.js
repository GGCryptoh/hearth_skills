// Private LLM — single-turn proxy through Hearth's LocalLlmEngine.
//
// This handler is the founder-facing way to call the local model from
// the agent's tool loop. The engine itself (registered as id 'local'
// in the supervisor's EngineRegistry) handles the wire protocol;
// `private_query` here is a thin wrapper so the agent has a clean
// MCP tool surface without needing to know about engines.
//
// The chat's incognito toggle uses the same engine but at the chat
// level (whole conversation routes locally). This skill is for
// per-call delegation — the agent decides "this single bit needs the
// local model" and calls private_query without flipping the whole
// thread.
//
// Args:
//   prompt   string  required — the user-facing prompt
//   system   string  optional — system prompt prepended
//
// Vault inputs (all read at supervisor startup; gear panel writes them):
//   HEARTH_LOCAL_API_BASE          — primary URL (port :1234 if omitted)
//   HEARTH_LOCAL_API_BASE_FALLBACK — secondary URL (Tailscale etc)
//   HEARTH_LOCAL_API_FORMAT        — 'openai' | 'ollama'
//   HEARTH_LOCAL_MODEL             — model id
//   HEARTH_LOCAL_API_KEY           — optional bearer token

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  const system = typeof a.system === 'string' ? a.system.trim() : '';

  if (!prompt) {
    return {
      ok: false,
      message: 'private_query requires a non-empty `prompt`.',
    };
  }

  // The supervisor's chat send path is the cleanest re-use surface —
  // it already wires LocalLlmEngine correctly + carries the
  // primary/fallback URL logic. Calling it with incognito=true forces
  // the local route regardless of agent_profiles.engine.
  const supervisorBase =
    process.env.HEARTH_SUPERVISOR_BASE ?? 'http://127.0.0.1:3417';

  const url = `${supervisorBase}/chat/send`;
  const body = {
    agentId: ctx?.agentId ?? 'persona',
    message: prompt,
    incognito: true,
    // Clean a fresh thread per invocation so the agent doesn't
    // accidentally pollute the founder's chat history with
    // tool-call mechanics.
    threadId: null,
  };
  if (system) body.system = system;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      message: `Local LLM unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* swallow */
    }
    return {
      ok: false,
      message: `Local LLM call failed (${res.status}): ${detail.slice(0, 200)}`,
    };
  }

  const json = await res.json();
  const reply =
    typeof json.reply === 'string' ? json.reply : String(json.reply ?? '');

  return {
    ok: true,
    text: reply,
    meta: {
      session_id: json.sessionId ?? json.session_id ?? null,
      api_format: json.api_format ?? null,
    },
  };
}
