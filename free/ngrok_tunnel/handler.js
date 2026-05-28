/**
 * ngrok_tunnel skill — verbs are status + restart.
 *
 * The tunnel PROCESS itself is owned by the Hearth supervisor (see
 * apps/supervisor/src/ingress/ngrok-runner.ts). The supervisor spawns
 * ngrok at boot when this skill is installed + enabled + NGROK_AUTHTOKEN
 * is configured. This handler is the chat / agent-facing read surface
 * that lets the agent answer "is the tunnel up? what's the URL?" without
 * the supervisor having to expose internal lifecycle methods to it.
 *
 * For inbound webhook handling (the /skill-webhooks/:provider/:job_id
 * route), see the supervisor — this skill doesn't process inbound traffic
 * directly; it just keeps the tunnel open.
 */
export async function run(args, ctx) {
  const verb = (args && args.verb) || 'status';

  if (verb === 'status') {
    return readSupervisorStatus(ctx);
  }
  if (verb === 'restart') {
    return restartTunnel(ctx);
  }
  return {
    ok: false,
    error: `unknown_verb: ${verb}. Supported: status, restart.`,
  };
}

async function readSupervisorStatus(ctx) {
  const base = supervisorBase(ctx);
  const res = await fetch(`${base}/ingress/status`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok) {
    return { ok: false, error: `supervisor ${res.status}` };
  }
  const json = await res.json();
  return {
    ok: true,
    running: json.running === true,
    public_url: json.public_url ?? null,
    started_at: json.started_at ?? null,
    static_domain: json.static_domain ?? null,
    last_error: json.last_error ?? null,
  };
}

async function restartTunnel(ctx) {
  const base = supervisorBase(ctx);
  const res = await fetch(`${base}/ingress/restart`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `supervisor ${res.status}: ${body.slice(0, 200)}` };
  }
  const json = await res.json();
  return { ok: true, ...json };
}

function supervisorBase(ctx) {
  if (ctx && ctx.providerEnv && ctx.providerEnv.HEARTH_SUPERVISOR_URL) {
    return ctx.providerEnv.HEARTH_SUPERVISOR_URL.replace(/\/$/, '');
  }
  return 'http://127.0.0.1:3417';
}
