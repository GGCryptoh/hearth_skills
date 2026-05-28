# Privacy.com Virtual Card — Setup & Architecture

Agent-controlled virtual cards. Mint a single-use or merchant-locked card with a hard spend cap; the agent uses it to pay; Privacy.com bills your linked funding source. Frozen-by-default safety posture.

## When to use

- Agent buying a domain ($15 cap, MERCHANT_LOCKED to Namecheap)
- Agent subscribing to an API ($30/mo cap, MERCHANT_LOCKED to OpenAI)
- One-off purchase from an untrusted merchant (SINGLE_USE, $X cap)
- Ad spend on a single platform (MERCHANT_LOCKED, monthly cap)

If you don't want the agent spending money autonomously, just don't enable this skill. Or enable it but leave the **Allow agent spending** master kill off.

## Setup

| Step | What | Where |
|---|---|---|
| 1 | Sign up at [privacy.com](https://privacy.com). US-only — requires SSN + DOB for KYC. Free tier covers personal use. | external |
| 2 | Link a funding source (bank account or debit card). This is what cards draw from. | external |
| 3 | **Account → Developers → Enable API access** → Generate API Key. Format: `ek_…` | external |
| 4 | Paste into `PRIVACY_API_KEY` in this skill's gear panel. | gear panel |
| 5 | Set `PRIVACY_DEFAULT_SPEND_CAP_USD` (default $50). The hard ceiling — agent CANNOT mint a card above this regardless of what it asks for. | gear panel |
| 6 | Set `PRIVACY_APPROVAL_THRESHOLD_USD` (default $25). Mint requests above this queue an approval card before the API fires. | gear panel |
| 7 | Toggle **Settings → Allow agent spending** (the master kill for this skill family). Off by default. | Settings |

## Verbs

| Verb | Args | Returns |
|---|---|---|
| `mint` | `spend_limit_usd` (required), `memo` (required), `type` (default `MERCHANT_LOCKED`) | Card PAN + CVV + exp + token |
| `list` | `page` (default 1) | Active + paused cards |
| `freeze` | `card_token` | Card state = PAUSED |
| `unfreeze` | `card_token` | Card state = OPEN |
| `set_limit` | `card_token`, `spend_limit_usd` | Updated cap |
| `transactions` | `card_token` (optional), `begin_iso` (optional) | Recent transaction list |

## Safety rails (in this order)

1. **Master kill** (`requires_master_kill: agent_spending`) — when off, the runner refuses every call. Settings → Allow agent spending.
2. **Hard cap** (`PRIVACY_DEFAULT_SPEND_CAP_USD`) — clamps any mint to this ceiling. Even if the agent asks for $1000 with a hard reason, the API call goes out with $50 (or whatever you set). The result reports `spend_limit_clamped: true` so the founder sees it.
3. **Approval gate** (`PRIVACY_APPROVAL_THRESHOLD_USD`) — mint requests above this return `{ ok: false, needs_approval: true, pending: {...} }`. Hearth's approval rail queues a card; founder approves → skill re-fires with `approved: true`.
4. **MERCHANT_LOCKED preferred** — once the card is used at merchant X, it can't be charged by merchant Y. Stops a leaked PAN from being reused.
5. **Audit row** on every mint, freeze, set_limit, and transaction pull. Tied to the standard audit chain.

## Agent flow example

```
Founder: "Subscribe me to the OpenAI Plus plan, $20/mo"

Agent thinks:
  - Need to charge a card at openai.com → mint a MERCHANT_LOCKED card
  - $20 < $25 approval threshold → no approval needed
  - Call privacy_card.mint(spend_limit_usd=20, memo="OpenAI Plus subscription",
                            type='MERCHANT_LOCKED')
  - Returns { pan: 4111…, cvv: 123, exp_month: 5, exp_year: 2030 }
  - Open openai.com checkout, paste card details
  - First charge $20 locks the card to OpenAI's merchant_id
  - Done. Card stays open, auto-renews monthly at the same $20 cap.

Founder later: "Cancel OpenAI"

Agent:
  - Cancel via OpenAI dashboard
  - privacy_card.freeze(card_token=…) — defensive in case the merchant
    tries one more charge
```

## Financials integration

The dashboard's `/dashboard/financials` page surfaces:

- **Active cards** — token, last_four, memo, spend cap, spend YTD
- **Recent transactions** — date, amount, merchant, card
- **Spend by card** — chart
- **Spend by merchant** — chart

Data is pulled fresh on page load via the supervisor's `/financials/privacy/*` proxy routes (which read the same vault token, never expose it to the dashboard).

## Limits & gotchas

| | |
|---|---|
| US-only | Privacy.com requires US SSN. International equivalents (Wise, Revolut) not supported. |
| Funding source | Free tier draws from a linked bank account. Pro tier ($10/mo) allows funding from debit cards. |
| Card type defaults | `MERCHANT_LOCKED` for new mints unless the agent explicitly passes `type='SINGLE_USE'`. |
| Card details | Returned ONLY once on mint. The agent should use them immediately (paste into a checkout). Hearth doesn't persist PAN/CVV — they live in the response, in memory, briefly. |
| Spend duration | All cards mint with `spend_limit_duration='TRANSACTION'` — the cap is per-transaction. For monthly caps, the agent should `set_limit` after each cycle, OR you can patch the duration manually in the Privacy.com dashboard. |
| Rate limits | Privacy.com allows 100 requests/min. The skill backs off on 429 (TODO — currently throws). |

## Threat model

| Threat | Mitigation |
|---|---|
| Agent goes rogue, mints $10k card | Hard cap (`PRIVACY_DEFAULT_SPEND_CAP_USD`) clamps EVERY mint. Even with a forged approval, the API call carries the clamped amount. |
| Compromised PRIVACY_API_KEY leaks | Vault stores encrypted. Copy button reveals briefly + auto-masks. Rotate in Privacy.com → Developers → Revoke. |
| Merchant double-charges or fraud | MERCHANT_LOCKED stops cross-merchant abuse. SINGLE_USE for high-risk merchants. Freeze instantly via the skill (or Privacy.com web app). |
| Founder gets buyer's remorse | Privacy.com dispute flow + Hearth's audit row let the founder reconstruct what the agent did, when, and why. |
