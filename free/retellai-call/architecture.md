# RetellAI Phone Call — setup + how to use

Place an **outbound** phone call to a real phone number, with a RetellAI-synthesized voice reading a script you (or your agent) wrote. Risk tier: `dangerous` — every agent-initiated call goes through an approval before dialing.

## What the Phonetic Code actually is (read this first)

> **It is NOT an inbound auth code.** It is an **outbound integrity tag** spoken by your agent in the first sentence of every call, so the *recipient* can spot an automated call instantly.

### Why this matters

When your agent calls your mom, your accountant, or a vendor, the synthesized voice is good enough to sound like a human. Without a tell, the recipient can't tell whether:
- It's actually you on the line
- It's your agent calling on your behalf (legitimate)
- It's a deepfake scammer impersonating you (not legitimate)

**The phonetic code is the tell.** You pick a niche 2-3 word phrase ("hearth-pineapple", "blue-thursday", "octopus-mailbox" — anything memorable and unlikely to appear in a normal conversation), and the handler **prepends it to every script** so it's the first thing the recipient hears:

> *"hearth-pineapple. Hi Mrs. Hopkins, this is Geoff's assistant calling about your appointment on Thursday…"*

### What to do with the code

1. Pick something niche and memorable. Avoid common words.
2. **Tell the people you'll be calling**: "If you ever get a call from me and the agent doesn't say *hearth-pineapple* in the first sentence, hang up — it isn't from me."
3. Rotate the code if you ever suspect it's leaked (someone outside the trusted circle heard it).

The handler refuses to dial if the code field is blank.

## What you need

1. A RetellAI account (https://app.retellai.com)
2. Credit in your RetellAI wallet (~$0.07/minute for most voices in 2026)
3. At least one outbound phone number on your RetellAI account
4. At least one voice (RetellAI ships defaults; you can also import ElevenLabs/Play.ht voices)

## One-time RetellAI setup (~10 minutes)

1. **Sign up** at https://app.retellai.com
2. **Add credit** — Billing → Add payment method → add ~$10 to start
3. **Buy or import a phone number**:
   - Phone Numbers → Buy a number (RetellAI provisions it) OR
   - Import an existing Twilio number (advanced — needs SIP trunk setup, see RetellAI docs)
4. **Pick or create a voice**:
   - Voices → browse the catalog
   - Note: voice quality and cost vary; "Adrian" / "Alice" / similar named voices are usually ElevenLabs-backed and sound the best (and cost the most)
5. **Get your API key**:
   - Settings → API Keys → Create new key
   - Copy the value (starts with `key_…`)

## Paste into Hearth

In the gear panel:
- **API Key** — paste the `key_…` value. Stored encrypted, field clears after save
- Click **Save configuration**
- Click the **↻** next to **From Number** — Hearth calls `/list-phone-numbers` and populates with your owned numbers. Pick one.
- Click the **↻** next to **Voice Model** — Hearth calls `/list-voices` and shows the voices on your account (formatted as `Name — Provider`). Pick one.
- **Phonetic Code** — pick your niche phrase (see top of this doc). Required. The handler refuses to dial without it.
- **Daily Call Cap** — defaults to 5. Hard limit on outbound calls per UTC day. Bump if you have a legitimate use case for more (e.g. a survey routine); leave low otherwise — this is your runaway-loop protection.
- Click **Save configuration** again.

## How the skill is called

### 1. Manual run from the Skills page
- Skills → RetellAI Phone Call → Run
- Args: `to` (E.164), `script` (what the agent will say after the phonetic code), `max_duration_seconds` (optional, default 180, hard-capped at 600)
- Returns `{ ok, call_id, to, from, status, voice, max_duration_seconds, daily_calls_used }`

### 2. Inside a routine
- Routines wizard → Add step → **RetellAI Phone Call**
- Step inputs: `to`, `script`, `max_duration_seconds`
- "Include prior output" works the same way as other steps — a `summarize_long` step can produce a script for the next step's call

### 3. As a delivery channel
- Routine delivery picker → **+ Phone Call**
- Set the target number; pick a **Format as** of `phone_script` to have the LLM rewrite the routine output for spoken cadence (conversational, brief, no markdown)

### 4. Agent-initiated
- When the agent calls this skill via `hearth_run_skill`, the M32 risk gate ALWAYS surfaces an approval card first (risk: dangerous + no allowlist by default)
- The card shows: target number, voice, full script (with the phonetic code prepended so you can verify), max duration
- You tap Allow → call dials. Tap Deny → nothing happens. The approval lands in Telegram too if your bot is configured

## Safety guardrails layered on top of the API

The handler applies four guardrails *before* hitting the RetellAI API:

1. **Phonetic-code prefix** — script becomes `${phonetic}. ${script}`. The handler refuses to dial if the code is blank
2. **Duration cap** — `max_duration_seconds` is clamped to `[10, 600]`. A typo in `max_duration_seconds: 3600` can't burn $30 on a 5-hour call
3. **Daily call counter** — vault key `retellai.calls_today` holds `{ date, count }`. Incremented on every successful POST. Refuses when count ≥ cap. Resets at UTC midnight
4. **Risk gate** — the M32 gate ALWAYS prompts for approval on this skill regardless of risk tolerance, because the manifest is `risk: dangerous`. Approval includes the full script (after phonetic prefix) so you see what the agent will say

## Costs

| Item | Approx 2026 |
|---|---|
| Per-minute outbound | $0.05–$0.10 (varies by voice + carrier) |
| Per phone number | ~$2.50/mo |
| Per imported voice | $0 if shipped; $5–$30/mo for premium ElevenLabs/Play.ht voices |

The manifest declares `per_call: 0.21` (an average; varies with call length). Hearth's MTD spend tracker uses this to flag when calls are racking up.

## Failure modes

| Error | Cause | Fix |
|---|---|---|
| `RETELLAI_PHONETIC_CODE not set` | Required field blank | Pick a 2-3 word phrase, save |
| `Daily call cap reached: 5/5` | Hit your daily limit | Raise the cap or wait until UTC midnight |
| `RetellAI 401` | Wrong API key | Regenerate at app.retellai.com → Settings → API Keys |
| `RetellAI 402` | Out of credit | Top up your RetellAI wallet |
| `max_duration_seconds capped at 600` | Argument tried to exceed 10 minutes | Lower the value or split the call into a routine of two short calls |

## Security posture

- API key, phonetic code, daily cap → all `kind: 'secret'`/'text' in the encrypted vault
- Audit rows hash the destination number (FNV-1a) so the audit log doesn't carry plaintext phone numbers
- The handler does NOT log the script body. Scripts can be sensitive (account numbers, dates, personal context) — the audit captures the RetellAI call_id only, which lets you cross-reference in their console without exposing the words

## What this skill does NOT do

- **No inbound calls** — RetellAI supports them via webhook, but the v0.1 skill is outbound-only
- **No multi-turn conversation** — the script reads aloud; RetellAI's agent capabilities (where the AI actually converses with the human) are a separate product surface. v0.2 may add a `retellai_agent_call` skill for that
- **No call recording / transcript ingest** — RetellAI captures these on their side; pulling them back into Hearth is a v0.2 ask
- **No SMS/MMS** — that's the Twilio SMS skill
