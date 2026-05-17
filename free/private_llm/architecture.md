This skill enables a private/incognito chat connection to any local
LAN or Tailscale/VPN like private connectivity in order to surface and
expose a per-call `private_query` tool. "Private" here means *off-cloud* —
the model runs on hardware the founder controls; nothing leaves the
machine except the founder's explicit save-to-collateral writes. Often
people may want to operate private or abliterated models this way.

## URL configuration: primary + fallback

Two slots so a founder running LM Studio on a home machine can:

- Have `http://192.168.1.22:1234` as primary (LAN, fast)
- Have `http://hearth-mac.tailnet.ts.net:1234` as fallback (Tailscale, works
  away from home)

The engine probes the primary first. On connection refused or
timeout, it transparently retries against the fallback. If both fail,
the chat surface raises a clean error the founder can act on (no
silent fall-through to a cloud provider — the privacy contract is
non-negotiable).

**Port-default rule:** if a URL has no `:port`, Hearth assumes 1234
(LM Studio's default). Override by including the port literal —
e.g. `http://localhost:11434` for Ollama.

## Allowed-tool policy while incognito is active

The chat surface enforces a hard allowlist when `incognito=true`:

| Tool | Allowed? | Why |
|---|---|---|
| `hearth_save_collateral` | ✅ | Pure on-device write; the only legitimate output channel |
| `web_search` / `web_fetch` | ❌ | Outbound network — defeats the privacy promise |
| `send_email` / `telegram_send` | ❌ | Sends content to a third party |
| `hearth_create_mission` | ❌ | Schedules cloud-engine work |
| `hearth_peer_*` (A2A) | ❌ | Already blocked by Phase 4.4 (defense in depth) |
| `private_query` (this skill) | ✅ | Self-reference is fine |

A refused tool returns a chat card explaining the refusal. The
agent's loop keeps going — it just can't reach for that capability
mid-incognito. The founder can disable incognito mid-thread to
unlock the full toolbelt.

## What this skill does NOT do

- Persist model weights (those live on the founder's box, managed
  by their LLM server)
- Auto-discover a running local server (manual config — there are
  too many shapes to probe reliably)
- Multi-tenant / multi-user isolation (a Hearth instance is a
  founder's own box; the skill operates in that scope)

## v0.2 follow-ups

- Auto-detect format by probing `/api/tags` first, fall back to
  `/v1/models`
- Inline "test connection" button in the gear panel
- Per-thread default-incognito flag (some founders want certain
  topics always private)
- Health-check loop (poll every 30s; show the founder when the
  primary URL goes down + falls through)
- Encrypted full-audit retention as a Pro-tier add-on (today is
  Option B scrub)
