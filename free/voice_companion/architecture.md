# Voice Companion (Jarvis mode) — Skill Architecture

## What this skill gates

The **Voice Companion** skill enables the `/dashboard/companion` surface: realtime voice conversation with your agent. You can:

- **Talk to your CEO or Persona agent** via browser microphone
- **See an animated avatar** react to the conversation (speaking, thinking, listening)
- **Dispatch tool calls through your existing skills** — when the agent wants to send a Telegram message, save to collateral, etc., the call routes through your skill library + approvals rail
- **Review full transcripts** in your chat thread history
- **Track costs** in the same Financials view as other LLM spend

## Ephemeral-token architecture — your vault key never leaves the server

The vault's `OPENAI_API_KEY` is **never** sent to the browser. Instead:

1. Browser requests a session via `POST /companion/session`
2. Supervisor verifies:
   - Skill is enabled
   - Vault is unlocked
   - User hasn't exceeded their daily `companion_daily_minutes_cap`
3. Supervisor mints a short-lived OpenAI Realtime client secret server-side
4. Browser receives the ephemeral token and connects **directly to OpenAI** via WebRTC
5. Audio goes straight to OpenAI; Hearth is out of the audio path entirely

This design kills the entire SSE-buffering-bug class: no audio relay = no pipes to get wrong.

## Containment & approvals

When a voice call fires:

| Concern | Default | Override |
|---------|---------|----------|
| **Daily budget** | 30 minutes/day | `companion_daily_minutes_cap` config |
| **Microphone** | Push-to-talk (manual button) | Opt-in VAD (voice-activity detection — less manual, more cost) |
| **Dangerous/moderate tool calls** | Queued for approval | Same approvals rail as chat — agent says "that's queued for your approval" |
| **Cost tracking** | Per-session row in Financials | Same ledger as all other LLM spend; your Financials page sees it |

No new permissions. Tool calls inherit the full M32 risk classifier + approvals flow.

## Config (vault_inputs)

- **Companion_voice**: Which voice the agent uses (10 OpenAI Realtime options: alloy, ash, ballad, coral, echo, juniper, marin, sage, shimmer, verse). Preview at https://platform.openai.com/docs/guides/realtime.
- **Companion_mic_mode**: `ptt` (push-to-talk, default) or `vad` (voice activity detection, opt-in).
- **Companion_daily_minutes_cap**: Max session duration per calendar day (default 30 min). Fail-closed enforcement at session mint.
- **Companion_avatar**: Which 3D avatar renders (`orb` — stylized face with morph targets; `floppy` — retro prop with transform animation). More avatars ship in v0.2.

All config writes flow through the supervisor's vault layer — encrypted at rest, never exposed in plaintext.

## Data model reuse

No new tables. The voice lane reuses existing infrastructure:

| Data | Where it lives | Audit trail |
|---|---|---|
| Session transcript | `chat_threads` — one thread per session (title "Companion — <date>") | Searchable, same retention as chat |
| Cost tracking | `llm_usage` row per session (engine='openai-realtime', audio-token counts) | Financials page picks it up zero-config |
| Daily cap enforcement | `SUM(duration) today` over `llm_usage` rows on session mint | Fail-closed: no readable usage → no session |
| Config state | Standard skill config (vault-backed) | Gear panel UX same as any skill |
| Approval queue | Existing approvals rail (`approvals` table) | Voice tool calls join the same queue as chat |

## Related documentation

- **Full spec:** [docs/VOICE-COMPANION-Design.md](../../docs/VOICE-COMPANION-Design.md) in the aios repo (architecture diagrams, phase plan, cost/containment strategy, avatar shape-key contract, mood machine, open decisions)
- **Type contract:** [apps/dashboard/lib/companion/types.ts](../../apps/dashboard/lib/companion/types.ts) — the interface between supervisor routes, WebRTC hook, and avatar renderer (frozen across workstreams)

## v0.1 scope (Phase 1)

- ✅ Skill manifest + config gates
- ✅ Session mint (token + daily cap + audit)
- ✅ WebRTC direct to OpenAI Realtime (no relay)
- ✅ Transcript → chat thread
- ✅ Usage → llm_usage + Financials
- 📋 Planned: CSS face (eyes + mouth) proves mood/lip-sync wiring before 3D
- 📋 Planned: r3f + GLB pipeline, shape-key contract, orb/floppy bundled (Phase 2)
- 📋 Planned: Tool calls + approval queue + artifact panel (Phase 3)
- 📋 Planned: Widget mode + always-on-top (Phase 4, gated on Tauri v0.3)

## Cost and budgeting

Realtime speech-to-speech is the most expensive way to talk to a model: ~$0.30–0.60/min blended at current OpenAI gpt-realtime audio-token pricing (verify at build time). The default 30-minute-per-day cap keeps spend predictable and manageable. Founder can:

- Raise or lower `companion_daily_minutes_cap` anytime via the config panel
- Monitor actual spend in `/dashboard/financials` (every session is one ledger row)
- Switch off voice entirely by disabling the skill (same as any other skill)

Voice grants no new authority: it's a new *input device* for the same agent. Tool calls inherit the full approvals/risk rail — nothing is faster or more permissive when spoken.
