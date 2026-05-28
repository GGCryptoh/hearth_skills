# ngrok Tunnel — Setup & Architecture

Public HTTPS ingress for inbound webhooks. Once configured, every other Hearth skill that needs a callback URL (Apify async jobs, Twilio Inbound SMS, Retell inbound voice, GitHub, Stripe, etc.) auto-discovers the tunnel via `INGRESS_PUBLIC_URL` written into the vault.

The supervisor owns the lifecycle. This skill is the configuration + status read surface.

## Setup — 7 steps

1. **Sign up** at [ngrok.com](https://ngrok.com). Free tier is fine — no credit card required.
2. **Verify your email** and log into the dashboard.
3. **Copy your Authtoken** from [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken).
4. **Paste it into the `NGROK_AUTHTOKEN` field** in this skill's config panel. Hearth stores it encrypted in the vault and never displays it in plaintext.
5. **(Strongly recommended) Claim a free static domain** at [dashboard.ngrok.com → Domains → New Domain](https://dashboard.ngrok.com/domains). Free accounts get one. Paste the domain (e.g. `your-name.ngrok.app`) into `NGROK_STATIC_DOMAIN`. Without this the tunnel URL changes every restart, breaking every webhook subscription you've registered.
6. **Generate a webhook HMAC secret** — click "Generate" next to `NGROK_WEBHOOK_HMAC_SECRET`, or paste 32+ random characters. Every inbound webhook must carry this in the `X-Hearth-Token` header; Hearth rejects anything else.
7. **Enable the skill.** The supervisor spawns the tunnel within ~3 seconds. Confirm by checking the `/dashboard/now` page or by asking the agent "is my tunnel up?".

## What other skills get

After enable, the vault gains a new key:

```
INGRESS_PUBLIC_URL = https://your-name.ngrok.app
```

Any skill handler that needs a callback URL reads `ctx.providerEnv.INGRESS_PUBLIC_URL` and constructs:

```
https://your-name.ngrok.app/skill-webhooks/{provider}/{job_id}?token={hmac}
```

The supervisor's `/skill-webhooks/:provider/:job_id` route validates the HMAC token, looks up the matching `skill_jobs` row, and dispatches the provider-specific handler (e.g. fetches the Apify dataset and resumes the original chat thread).

## Lifecycle

| Event | What happens |
|---|---|
| `pnpm hearth start` (vault unlocked) | Supervisor reads `NGROK_AUTHTOKEN`, spawns `ngrok http <port> --authtoken=… --domain=…`, captures the assigned URL, writes `INGRESS_PUBLIC_URL` to vault, marks ingress active |
| `pnpm hearth start` (vault locked) | Tunnel stays down until vault unlocks. The `onVaultUnlock` hook then starts it |
| Vault locks during runtime | Tunnel keeps running (no secrets leak; vault-lock affects new reads only) |
| Supervisor stops / crashes | Child ngrok process is killed cleanly via SIGTERM; on crash, launchd or `pnpm hearth start` brings everything back |
| Skill disabled | Supervisor stops the tunnel, clears `INGRESS_PUBLIC_URL` |
| Skill uninstalled | Same as disable, plus removes the static domain from local config |

## Status surface

- **`/meta`** — `ingress: { scheme: 'ngrok', running, public_url, started_at, error }`
- **`/ingress/status`** — same data, richer schema for the dashboard
- **`/dashboard/now`** — Ingress card with status dot, URL with copy button, uptime, restart button
- **Skill verb `status`** — chat-callable. "What's my ngrok URL?" → agent calls `ngrok_tunnel.status` → reads `/ingress/status` → answers

## Free-tier limits

ngrok free accounts get:

- 1 static domain
- 1 simultaneous tunnel
- ~120 connections/minute
- ~40 connections/second burst

This is enough for personal Hearth use. For heavier production traffic, upgrade to ngrok Personal ($10/mo) for higher limits, or switch to Tailscale Funnel (zero-cost if you're already on Tailscale; see `tailscale_funnel` skill).

## Security model

| Threat | Mitigation |
|---|---|
| Anonymous internet traffic hitting your supervisor | All `/skill-webhooks/*` requests must carry `X-Hearth-Token: <hmac>`; missing or mismatching → 401 |
| Replayed webhooks | Supervisor stamps a nonce per outbound webhook URL; replay attempts after consume → 409 |
| Authtoken leak | Stored encrypted in vault. Never logged. Copy button reveals briefly + auto-masks. Rotating: paste new value + click Restart |
| Other ngrok URLs in your account hitting Hearth | The HMAC secret is per-Hearth-instance; tunnels you spin up via the ngrok CLI directly don't carry it and get rejected |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `running: false`, `last_error: "ngrok binary not found"` | ngrok not in PATH | Install ngrok: `brew install ngrok` (macOS) or download from [ngrok.com/download](https://ngrok.com/download) |
| `running: false`, `last_error: "ERR_NGROK_108"` | Authtoken invalid or revoked | Rotate the token in ngrok dashboard, paste new value, click Restart |
| `running: false`, `last_error: "ERR_NGROK_3200"` | Free-tier 1-tunnel limit hit (you have another tunnel running elsewhere) | Stop the other tunnel OR upgrade to Personal |
| `public_url` changes every restart | No static domain configured | Claim one and paste into `NGROK_STATIC_DOMAIN` |
| Webhook hits arrive but get 401 | HMAC secret mismatch — the provider's stored URL has an old token | After rotating `NGROK_WEBHOOK_HMAC_SECRET`, re-register webhooks with the providers that use it |
