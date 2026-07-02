// RetellAI Phone Call — place an outbound PSTN call via RetellAI.
//
// Founder configures once via the skill gear panel:
//   RETELLAI_API_KEY       — vault, secret
//   RETELLAI_FROM_NUMBER   — vault, enumerated_select (Hearth lists the
//                            founder's RetellAI-purchased numbers)
//   RETELLAI_VOICE_ID      — vault, enumerated_select (voices available
//                            on the founder's account)
//   RETELLAI_PHONETIC_CODE — vault, text (REQUIRED phrase the agent
//                            must say in the first sentence — anti-misuse
//                            recipient signal)
//   RETELLAI_DAILY_CALL_CAP — vault, number (default 5)
//
// Args (from /skills/:id/run, scheduler, or M35 delivery rail):
//   to              string             required — E.164 number
//   script          string             required — opening message the
//                                      agent says. Must spell out
//                                      enough context for the
//                                      recipient to know what's
//                                      happening.
//   max_duration_seconds  number       optional — hard cap (default
//                                      180s). Cap at 600s in the
//                                      handler so a typo can't burn
//                                      $30 on a 5-hour call.
//
// Safety guardrails (founder direction PROJECT.md decision log):
//   1. Phonetic code: handler auto-prepends "[phrase]:" to the script
//      so the recipient hears it. Refuses to run when phrase missing.
//   2. Daily call cap: vault counter `retellai.calls_today` increments
//      on each successful call. Refuses when count ≥ cap. Resets
//      automatically when the day changes (UTC).
//   3. Duration cap: max_duration_seconds clamped to [10, 600].
//   4. M32 risk gate: this skill is risk:dangerous so the gate ALWAYS
//      surfaces an approval card unless founder allowlists it. (Gate
//      lives in the supervisor — not handler concern.)
//
// Returns:
//   { ok: true, call_id, to, from, status, voice, max_duration_seconds,
//     daily_calls_used }
//
// Errors throw with a specific message so the founder can debug.

// 2026-07-02: RetellAI's outbound-call endpoint is versioned under /v2.
// The unversioned path returns 404 "Cannot POST /create-phone-call".
const CREATE_CALL_URL = 'https://api.retellai.com/v2/create-phone-call';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const key = ctx.skillInputs?.RETELLAI_API_KEY?.trim();
  const from = ctx.skillInputs?.RETELLAI_FROM_NUMBER?.trim();
  const voice = ctx.skillInputs?.RETELLAI_VOICE_ID?.trim();
  const phonetic = ctx.skillInputs?.RETELLAI_PHONETIC_CODE?.trim();
  const dailyCapRaw = ctx.skillInputs?.RETELLAI_DAILY_CALL_CAP;
  const dailyCap = parseDailyCap(dailyCapRaw);

  if (!key) {
    throw new Error(
      'RETELLAI_API_KEY missing — open the RetellAI Phone Call gear panel and paste your API key',
    );
  }
  if (!from) {
    throw new Error(
      'RETELLAI_FROM_NUMBER not configured — after the API key saves, refresh the gear panel to pick a from-number',
    );
  }
  if (!voice) {
    throw new Error(
      'RETELLAI_VOICE_ID not configured — after the API key saves, refresh the gear panel to pick a voice',
    );
  }
  if (!phonetic) {
    throw new Error(
      'RETELLAI_PHONETIC_CODE not set — required. Pick a memorable 2-3 word phrase the agent will say at the start of every call so recipients can spot misuse',
    );
  }

  const to = typeof a.to === 'string' ? a.to.trim() : '';
  const scriptRaw = typeof a.script === 'string' ? a.script.trim() : '';
  if (!to) throw new Error('to is required (E.164 phone number)');
  if (!scriptRaw) throw new Error('script is required (opening message)');

  // Clamp duration. Founder direction: no calls longer than 10 minutes
  // without explicit per-call approval (M32 risk gate handles the
  // approval — but the handler still refuses the over-cap value as a
  // belt-and-suspenders defense against a fabricated tool call).
  const requestedDuration =
    typeof a.max_duration_seconds === 'number'
      ? Math.floor(a.max_duration_seconds)
      : 180;
  if (requestedDuration > 600) {
    throw new Error(
      'max_duration_seconds capped at 600 (10 min). Lower the value or split the call.',
    );
  }
  const max_duration_seconds = Math.max(10, Math.min(600, requestedDuration));

  // Daily call cap. Vault key `retellai.calls_today` is a JSON blob
  // { date: 'YYYY-MM-DD', count: N } so the count auto-resets at the
  // UTC midnight boundary.
  const today = new Date().toISOString().slice(0, 10);
  const counter = await readDailyCounter(ctx, today);
  if (counter.count >= dailyCap) {
    throw new Error(
      `Daily call cap reached: ${counter.count}/${dailyCap} calls placed today (UTC). Raise the cap in the gear panel or wait until tomorrow.`,
    );
  }

  // Phonetic-code prefix. Inject the required phrase at the start of
  // the script so it lands in the first sentence the recipient hears.
  // Founders should pick something niche enough to NOT appear in a
  // legitimate human-led call so misuse is unambiguous.
  const script = `${phonetic}. ${scriptRaw}`;

  let res;
  try {
    res = await fetch(CREATE_CALL_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        from_number: from,
        to_number: to,
        voice_id: voice,
        agent_config: {
          first_message: script,
          max_duration_seconds,
        },
      }),
    });
  } catch (err) {
    throw new Error(
      `RetellAI fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const responseText = await res.text().catch(() => '');
  if (!res.ok) {
    let detail = responseText.slice(0, 400);
    try {
      const parsed = JSON.parse(responseText);
      if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
        detail = parsed.error;
      } else if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string') {
        detail = parsed.message;
      }
    } catch {
      /* leave raw text */
    }
    throw new Error(`RetellAI ${res.status}: ${detail}`);
  }

  let json = {};
  try {
    json = JSON.parse(responseText);
  } catch {
    /* tolerate */
  }

  // Bump the daily counter only AFTER the call POST succeeds so a
  // 4xx response doesn't count against the founder's cap.
  await writeDailyCounter(ctx, today, counter.count + 1);

  return {
    ok: true,
    call_id: typeof json.call_id === 'string' ? json.call_id : null,
    to: json.to_number ?? to,
    from: json.from_number ?? from,
    status: typeof json.call_status === 'string' ? json.call_status : 'initiated',
    voice,
    max_duration_seconds,
    daily_calls_used: counter.count + 1,
    daily_call_cap: dailyCap,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDailyCap(raw) {
  if (raw === undefined || raw === null) return 5;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.min(50, Math.floor(n));
}

const COUNTER_VAULT_KEY = 'retellai.calls_today';

async function readDailyCounter(ctx, today) {
  if (!ctx.vault || typeof ctx.vault.get !== 'function') {
    return { date: today, count: 0 };
  }
  try {
    const bytes = await ctx.vault.get(COUNTER_VAULT_KEY);
    if (!bytes) return { date: today, count: 0 };
    const text = new TextDecoder().decode(bytes).trim();
    if (!text) return { date: today, count: 0 };
    const parsed = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.date === 'string' &&
      typeof parsed.count === 'number'
    ) {
      if (parsed.date !== today) {
        // Day rolled over — reset count.
        return { date: today, count: 0 };
      }
      return { date: parsed.date, count: parsed.count };
    }
    return { date: today, count: 0 };
  } catch {
    return { date: today, count: 0 };
  }
}

async function writeDailyCounter(ctx, today, count) {
  if (!ctx.vault || typeof ctx.vault.set !== 'function') return;
  try {
    await ctx.vault.set(
      COUNTER_VAULT_KEY,
      JSON.stringify({ date: today, count }),
    );
  } catch {
    /* counter is best-effort; cap-bypass on a vault hiccup is a
       tolerated edge case — the M32 risk gate still fires per-call */
  }
}
