// Privacy.com Virtual Card — agent-controlled spend surface.
//
// Seven verbs: mint / list / freeze / unfreeze / close / set_limit /
// transactions.
//
// Safety rails enforced in this handler:
//   1. Hard spend cap — PRIVACY_DEFAULT_SPEND_CAP_USD clamps mint requests
//      even if the agent asks for more.
//   2. Approval gate — mint requests above PRIVACY_APPROVAL_THRESHOLD_USD
//      return { needs_approval: true } so the supervisor's approval rail
//      can queue a card before the actual API call fires.
//   3. Master kill — manifest declares requires_master_kill: 'agent_spending';
//      the runner short-circuits when the master kill is off.
//   4. MERCHANT_LOCKED preferred over SINGLE_USE for repeat-merchant
//      subscriptions (won't accidentally double-charge on retry).
//   5. PAN/CVV NEVER returned (PLAN-AUTONOMY 1.2, 2026-07-02) — skill
//      output goes verbatim into the agent's context and from there into
//      chat, logs, and Telegram. Mint returns the card token + last four
//      only; the purchase rail (hearth_purchase) or the founder's
//      Privacy.com dashboard handles full card details out-of-band.
//
// Endpoints verified against https://developers.privacy.com/docs 2026-07-02
// (plural /v1/cards + /v1/transactions — the singular forms are legacy).

const API_BASE = 'https://api.privacy.com/v1';

const DURATIONS = ['TRANSACTION', 'MONTHLY', 'ANNUALLY', 'FOREVER'];

export async function run(ctx, args) {
  const verb = typeof args?.verb === 'string' ? args.verb : 'list';
  const apiKey = ctx.providerEnv?.PRIVACY_API_KEY;
  if (!apiKey) {
    throw new Error(
      'PRIVACY_API_KEY missing — open the Privacy.com skill gear panel and paste your API key from privacy.com → Account → Developers.',
    );
  }

  switch (verb) {
    case 'mint':
      return mint(args, ctx, apiKey);
    case 'list':
      return list(args, apiKey);
    case 'freeze':
      return setState(args, apiKey, 'PAUSED');
    case 'unfreeze':
      return setState(args, apiKey, 'OPEN');
    case 'close':
      // Closing is PERMANENT — demand an explicit confirm so a sloppy
      // tool call can't burn a live card.
      if (args?.confirm !== true) {
        throw new Error(
          'Closing a card is PERMANENT and cannot be undone. Re-call with confirm: true, or use verb "freeze" for a reversible pause.',
        );
      }
      return setState(args, apiKey, 'CLOSED');
    case 'set_limit':
      return setLimit(args, apiKey);
    case 'transactions':
      return transactions(args, apiKey);
    default:
      throw new Error(
        `unknown verb: ${verb}. Supported: mint, list, freeze, unfreeze, close, set_limit, transactions.`,
      );
  }
}

async function mint(args, ctx, apiKey) {
  const requested = numArg(args.spend_limit_usd);
  if (!requested || requested <= 0) {
    throw new Error('spend_limit_usd is required and must be > 0');
  }
  const memo = typeof args.memo === 'string' ? args.memo.trim() : '';
  if (!memo) {
    throw new Error('memo is required (what is this card for?)');
  }
  const type = args.type === 'SINGLE_USE' ? 'SINGLE_USE' : 'MERCHANT_LOCKED';

  // Hard cap
  const defaultCap = numArg(ctx.skillInputs?.PRIVACY_DEFAULT_SPEND_CAP_USD) ?? 50;
  const effective = Math.min(requested, defaultCap);
  const clamped = requested > defaultCap;

  // Approval gate (returns shape the supervisor recognises and queues
  // an approval card before re-running the verb with `approved: true`).
  const approvalThreshold =
    numArg(ctx.skillInputs?.PRIVACY_APPROVAL_THRESHOLD_USD) ?? 25;
  if (effective > approvalThreshold && args.approved !== true) {
    return {
      ok: false,
      needs_approval: true,
      summary: `Approval required to mint $${effective.toFixed(2)} card for "${memo}" (threshold $${approvalThreshold}).`,
      pending: {
        verb: 'mint',
        spend_limit_usd: effective,
        memo,
        type,
        approved: true,
      },
    };
  }

  // Privacy.com expects spend_limit in CENTS.
  const body = {
    type,
    memo: memo.slice(0, 60),
    spend_limit: Math.round(effective * 100),
    spend_limit_duration: DURATIONS.includes(args.spend_limit_duration)
      ? args.spend_limit_duration
      : 'TRANSACTION',
    state: 'OPEN',
  };
  const res = await fetch(`${API_BASE}/cards`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) return errorBody(res);
  const card = await res.json();

  // PAN / CVV / exp are in `card` but NEVER returned — see header note 5.
  return {
    ok: true,
    card_token: card.token,
    last_four: card.last_four,
    spend_limit_usd: effective,
    spend_limit_clamped: clamped,
    type,
    memo,
    summary:
      `Minted ${type} Privacy.com card · ${effective.toFixed(2)} cap` +
      (clamped ? ` (clamped from $${requested})` : '') +
      ` · last four ${card.last_four} · memo: ${memo}`,
    note: 'Full card number is withheld from chat by design — the founder retrieves it in the Privacy.com dashboard, or the purchase rail passes it to checkout directly.',
  };
}

async function list(args, apiKey) {
  const page = Math.max(1, Math.min(numArg(args.page) ?? 1, 100));
  const res = await fetch(`${API_BASE}/cards?page=${page}&page_size=50`, {
    headers: authHeaders(apiKey),
  });
  if (!res.ok) return errorBody(res);
  const json = await res.json();
  const rows = (json.data ?? []).map((c) => ({
    token: c.token,
    last_four: c.last_four,
    memo: c.memo,
    state: c.state,
    type: c.type,
    spend_limit_usd: (c.spend_limit ?? 0) / 100,
  }));
  return {
    ok: true,
    count: rows.length,
    cards: rows,
    summary: `${rows.length} card${rows.length === 1 ? '' : 's'} returned.`,
  };
}

async function setState(args, apiKey, state) {
  const token = strArg(args.card_token);
  if (!token) throw new Error('card_token is required');
  const res = await fetch(`${API_BASE}/cards/${encodeURIComponent(token)}`, {
    method: 'PATCH',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ state }),
  });
  if (!res.ok) return errorBody(res);
  const card = await res.json();
  return {
    ok: true,
    card_token: card.token,
    state: card.state,
    summary: `Card ${card.last_four} → ${card.state}`,
  };
}

async function setLimit(args, apiKey) {
  const token = strArg(args.card_token);
  if (!token) throw new Error('card_token is required');
  const usd = numArg(args.spend_limit_usd);
  if (!usd || usd <= 0) throw new Error('spend_limit_usd is required and must be > 0');
  const res = await fetch(`${API_BASE}/cards/${encodeURIComponent(token)}`, {
    method: 'PATCH',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ spend_limit: Math.round(usd * 100) }),
  });
  if (!res.ok) return errorBody(res);
  const card = await res.json();
  return {
    ok: true,
    card_token: card.token,
    spend_limit_usd: (card.spend_limit ?? 0) / 100,
    summary: `Card ${card.last_four} cap → $${((card.spend_limit ?? 0) / 100).toFixed(2)}`,
  };
}

async function transactions(args, apiKey) {
  const params = new URLSearchParams();
  if (args.card_token) params.set('card_token', String(args.card_token));
  // `begin` is the documented param name; `begin_iso` kept for
  // backwards-compat with the original verb shape.
  const begin = args.begin ?? args.begin_iso;
  if (begin) params.set('begin', String(begin));
  if (args.end) params.set('end', String(args.end));
  if (args.result === 'APPROVED' || args.result === 'DECLINED') {
    params.set('result', args.result);
  }
  const page = numArg(args.page);
  if (page && page >= 1) params.set('page', String(Math.floor(page)));
  params.set('page_size', '50');
  const res = await fetch(`${API_BASE}/transactions?${params}`, {
    headers: authHeaders(apiKey),
  });
  if (!res.ok) return errorBody(res);
  const json = await res.json();
  const rows = (json.data ?? []).map((t) => ({
    token: t.token,
    amount_usd: (t.amount ?? 0) / 100,
    status: t.status,
    result: t.result ?? null,
    merchant_name: t.merchant?.descriptor ?? null,
    merchant_city: t.merchant?.city ?? null,
    merchant_state: t.merchant?.state ?? null,
    card_token: t.card_token ?? null,
    created: t.created,
  }));
  const total = rows.reduce((s, r) => s + (r.amount_usd ?? 0), 0);
  return {
    ok: true,
    count: rows.length,
    transactions: rows,
    total_usd: total,
    summary: `${rows.length} transaction${rows.length === 1 ? '' : 's'} · $${total.toFixed(2)} total`,
  };
}

function authHeaders(apiKey) {
  return {
    'authorization': `api-key ${apiKey}`,
    'content-type': 'application/json',
  };
}

async function errorBody(res) {
  const text = await res.text().catch(() => '');
  return {
    ok: false,
    error: `privacy.com ${res.status}: ${text.slice(0, 300) || '(no body)'}`,
  };
}

function numArg(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strArg(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
