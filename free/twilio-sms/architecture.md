# Twilio SMS — setup + how to use

Send a single SMS from a Twilio number you own. The skill calls Twilio's REST API with HTTP Basic auth, so there's no Twilio SDK shipping in this handler — just a `fetch()` to the Messages endpoint.

## What you need

1. A Twilio account (https://www.twilio.com/try-twilio — free trial includes a $15 credit + one verified destination)
2. An SMS-capable phone number purchased on Twilio (≈$1.15/mo per US local number; toll-free is more)
3. Your Twilio **Account SID** (starts with `AC…`) and **Auth Token**

## One-time Twilio setup (~5 minutes)

1. Sign in at https://console.twilio.com
2. **Buy a number**: Phone Numbers → Manage → Buy a number → filter for SMS capability → pick one → Buy
3. **Copy your credentials** from the Console home page:
   - Account SID
   - Auth Token (click the lock icon to reveal)

## Paste into Hearth

In the gear panel:
- **Account SID** — paste your `AC…` value
- **Auth Token** — paste the secret. Stored encrypted in your vault; the field clears after save
- Click **Save configuration**
- The **From number** dropdown is empty at this point — click the **↻** button next to it. Hearth calls `GET /Accounts/{sid}/IncomingPhoneNumbers` and populates the dropdown with every SMS-capable number on your account. Pick one. Save again.

## How the skill is called

Three entry points, all wired:

### 1. Manual run from the Skills page
- Open the skill row → click the **Run** button (only visible on enabled skills)
- Provide `to` (E.164, e.g. `+15551234567`) and `body` (the message)
- Returns `{ ok, sid, status, to, from, preview }` — the Twilio Message SID lets you trace the send in their console

### 2. Inside a routine (Routines wizard)
- `/dashboard/routines/new` → Add step → pick **Twilio SMS**
- Step inputs: `to` + `body`
- Tip: Step 2's "Include prior output" toggle lets a routine like *fetch news → SMS me the headlines* work without you typing the body — the prior step's output becomes the SMS body

### 3. As a delivery channel on any routine
- In the routine wizard delivery picker, click **+ SMS**
- Set the destination number (E.164) and optionally a **Format as** prompt (e.g. `sms_short` → LLM rewrites the routine output as an SMS-friendly line)
- The Telegram + email + collateral targets work the same way — SMS is just another channel

### 4. Agent-initiated (LLM picks the skill)
- When your CEO or persona has Twilio SMS **enabled**, the agent can call it via `hearth_run_skill` MCP tool
- The agent sees the skill in its context block at every chat turn
- Risk tier is `moderate` — your Risk tolerance setting decides whether the call auto-runs or queues an approval first

## Costs

Twilio charges per outbound segment (~$0.0079/segment for US numbers in 2026). The skill manifest declares this so Hearth can show MTD spend per skill. Long messages auto-split — the `body` parameter accepts up to ~1600 characters and Twilio handles segmentation.

## Failure modes you might hit

| Error | Cause | Fix |
|---|---|---|
| `Twilio 401: Authentication Error` | Wrong SID or Token | Recopy from console.twilio.com |
| `Twilio 21211: Invalid 'To'` | Number isn't E.164 | Use `+1...` format, no spaces/dashes |
| `Twilio 21408: Permission to send to recipient` | Trial account + unverified destination | Either verify the destination at console.twilio.com or upgrade out of trial |
| `Twilio 21610: STOP'd` | Recipient sent STOP to your number | They have to text START to your number to opt back in (US carrier rule) |

## Security posture

- Account SID stays in `vault_entries` plaintext column (it's not a secret — Twilio treats it like a public username)
- Auth Token is `kind: 'secret'` → encrypted at rest with the rest of your vault
- The `risk: moderate` manifest setting means the M32 risk gate may surface an approval prompt for an agent-initiated send depending on your Risk tolerance — Conservative asks every time, Moderate asks above ~$5, Aggressive only asks for elevation
- The handler does NOT log message bodies. Audit rows capture the destination (hashed) + Twilio's returned Message SID only

## What this skill does NOT do (yet)

- **No MMS** — body-only. Routine step attachments (M38, in progress) will add image/file pass-through via Twilio's `MediaUrl` parameter
- **No inbound** — receiving SMS to your Twilio number would require a webhook + a public URL. Out of scope for v0.1
- **No template/short-link rewriting** — what you pass in `body` is what gets sent verbatim
