// Stripe Revenue Report.
//
// Read-only reporting over the founder's own Stripe account. Uses a
// RESTRICTED key (read scopes only) — this handler issues nothing but GET
// requests, so it physically cannot create a charge, refund, or any write.
// Zero dependencies — global fetch + the Stripe REST API.
//
// Args (from /skills/:id/run body, the agent, or a routine step):
//   report  string  optional — 'summary' (default) | 'recent_charges'
//                    | 'failed_payments' | 'subscriptions'
//   limit   number  optional — for recent_charges (default 10, max 100)
//
// Vault config:
//   STRIPE_RESTRICTED_KEY   secret — rk_live_… / rk_test_… (read-only)
//
// Returns: report-specific structured response + a markdown `text` field.
// Throws on missing key or any non-2xx from Stripe (status + truncated body).

const API_BASE = 'https://api.stripe.com/v1';
const MAX_CHARGE_PAGES = 10; // 10 × 100 = up to 1000 charges scanned for volume

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const key = ctx.providerEnv?.STRIPE_RESTRICTED_KEY;
  if (!key) {
    throw new Error(
      'STRIPE_RESTRICTED_KEY missing — add a Stripe RESTRICTED (read-only) key under Vault → API Keys',
    );
  }

  const report = typeof a.report === 'string' ? a.report : 'summary';

  if (report === 'summary') return summaryReport(key);
  if (report === 'recent_charges') return recentChargesReport(key, a.limit);
  if (report === 'failed_payments') return failedPaymentsReport(key);
  if (report === 'subscriptions') return subscriptionsReport(key);

  throw new Error(
    `Unknown report "${report}". Expected one of: summary, recent_charges, failed_payments, subscriptions.`,
  );
}

async function stripeGet(path, key) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${key}` },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Stripe ${res.status}: ${body.slice(0, 400)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Stripe returned non-JSON (${res.status}): ${body.slice(0, 200)}`);
  }
}

function fmtAmount(cents, currency) {
  const v = (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v} ${String(currency || '').toUpperCase()}`;
}

async function summaryReport(key) {
  const now = Math.floor(Date.now() / 1000);
  const gte30 = now - 30 * 86400;
  const gte7 = now - 7 * 86400;

  // Balance.
  const balance = await stripeGet('/balance', key);
  const available = Array.isArray(balance.available) ? balance.available : [];
  const pending = Array.isArray(balance.pending) ? balance.pending : [];

  // Last-30-day charges: paginate, count succeeded + sum by currency.
  const volume = {}; // currency → cents
  let succeeded = 0;
  let scanned = 0;
  let capped = false;
  let startingAfter = null;
  for (let page = 0; page < MAX_CHARGE_PAGES; page++) {
    const params = new URLSearchParams({ limit: '100' });
    params.append('created[gte]', String(gte30));
    if (startingAfter) params.set('starting_after', startingAfter);
    const data = await stripeGet(`/charges?${params.toString()}`, key);
    const rows = Array.isArray(data.data) ? data.data : [];
    for (const c of rows) {
      scanned++;
      if (c.paid && c.status === 'succeeded') {
        succeeded++;
        const cur = c.currency || 'usd';
        volume[cur] = (volume[cur] || 0) + (c.amount || 0);
      }
    }
    if (!data.has_more || rows.length === 0) {
      startingAfter = null;
      break;
    }
    startingAfter = rows[rows.length - 1].id;
    if (page === MAX_CHARGE_PAGES - 1 && data.has_more) capped = true;
  }

  // Active subscriptions (count only).
  const subs = await stripeGet('/subscriptions?status=active&limit=100', key);
  const activeSubs = Array.isArray(subs.data) ? subs.data.length : 0;
  const subsMore = subs.has_more === true;

  // Failed payments last 7d.
  const failParams = new URLSearchParams({ limit: '100' });
  failParams.append('created[gte]', String(gte7));
  const failCharges = await stripeGet(`/charges?${failParams.toString()}`, key);
  const failedCount = (Array.isArray(failCharges.data) ? failCharges.data : []).filter(
    (c) => c.status === 'failed' || (c.paid === false && c.status !== 'succeeded'),
  ).length;

  const volLines = Object.entries(volume).map(([cur, cents]) => fmtAmount(cents, cur));
  const availLines = available.map((b) => fmtAmount(b.amount, b.currency));
  const pendLines = pending.map((b) => fmtAmount(b.amount, b.currency));

  const text = [
    '## Stripe Summary',
    '',
    `**Available balance:** ${availLines.length ? availLines.join(', ') : '0.00'}`,
    `**Pending balance:** ${pendLines.length ? pendLines.join(', ') : '0.00'}`,
    '',
    `**Last 30 days — gross volume (succeeded charges):** ${volLines.length ? volLines.join(', ') : '0.00'}`,
    `**Last 30 days — successful charge count:** ${succeeded}${capped ? ` (scanned ${scanned}; more exist — volume is a floor)` : ''}`,
    '',
    `**Active subscriptions:** ${activeSubs}${subsMore ? '+ (100+ — capped)' : ''}`,
    `**Failed payments (last 7 days):** ${failedCount}`,
  ].join('\n');

  return {
    ok: true,
    report: 'summary',
    available_balance: available.map((b) => ({ amount_cents: b.amount, currency: b.currency })),
    pending_balance: pending.map((b) => ({ amount_cents: b.amount, currency: b.currency })),
    last_30d_volume: volume,
    last_30d_succeeded_charges: succeeded,
    active_subscriptions: activeSubs,
    failed_payments_7d: failedCount,
    volume_capped: capped,
    text,
    summary: `30d: ${succeeded} charges (${volLines.join(', ') || '0.00'}); ${activeSubs} active subs; ${failedCount} failed payments in 7d.`,
  };
}

async function recentChargesReport(key, limitArg) {
  const limit =
    typeof limitArg === 'number' && limitArg > 0 && limitArg <= 100
      ? Math.floor(limitArg)
      : 10;
  const data = await stripeGet(`/charges?limit=${limit}`, key);
  const rows = Array.isArray(data.data) ? data.data : [];
  const charges = rows.map((c) => ({
    id: c.id,
    amount: fmtAmount(c.amount || 0, c.currency),
    status: c.status,
    paid: c.paid,
    description: c.description || null,
    customer_email: c.billing_details?.email || c.receipt_email || null,
    created: new Date((c.created || 0) * 1000).toISOString(),
  }));
  const text = [
    `## Recent Charges (${charges.length})`,
    '',
    ...charges.map(
      (c) =>
        `- **${c.amount}** · ${c.status}${c.paid ? '' : ' (unpaid)'} · ${c.customer_email || 'no email'} · ${c.created.slice(0, 10)}${c.description ? ` — ${c.description}` : ''}`,
    ),
  ].join('\n');
  return {
    ok: true,
    report: 'recent_charges',
    count: charges.length,
    charges,
    text,
    summary: `${charges.length} recent charge(s).`,
  };
}

async function failedPaymentsReport(key) {
  const now = Math.floor(Date.now() / 1000);
  const gte7 = now - 7 * 86400;
  const params = new URLSearchParams({ limit: '100' });
  params.append('created[gte]', String(gte7));
  const data = await stripeGet(`/charges?${params.toString()}`, key);
  const rows = Array.isArray(data.data) ? data.data : [];
  const failed = rows
    .filter((c) => c.status === 'failed' || (c.paid === false && c.status !== 'succeeded'))
    .map((c) => ({
      id: c.id,
      amount: fmtAmount(c.amount || 0, c.currency),
      failure_message: c.failure_message || c.outcome?.seller_message || null,
      customer_email: c.billing_details?.email || c.receipt_email || null,
      created: new Date((c.created || 0) * 1000).toISOString(),
    }));
  const text = failed.length
    ? [
        `## Failed Payments — last 7 days (${failed.length})`,
        '',
        ...failed.map(
          (c) =>
            `- **${c.amount}** · ${c.customer_email || 'no email'} · ${c.created.slice(0, 10)}${c.failure_message ? ` — ${c.failure_message}` : ''}`,
        ),
      ].join('\n')
    : 'No failed payments in the last 7 days.';
  return {
    ok: true,
    report: 'failed_payments',
    count: failed.length,
    failed_payments: failed,
    text,
    summary: `${failed.length} failed payment(s) in the last 7 days.`,
  };
}

async function subscriptionsReport(key) {
  const data = await stripeGet('/subscriptions?status=active&limit=100', key);
  const rows = Array.isArray(data.data) ? data.data : [];
  const subs = rows.map((s) => {
    const item = s.items?.data?.[0];
    const price = item?.price;
    const cents = price?.unit_amount || 0;
    const interval = price?.recurring?.interval || '?';
    return {
      id: s.id,
      customer: s.customer,
      status: s.status,
      amount: cents ? `${fmtAmount(cents, price.currency)}/${interval}` : null,
      current_period_end: s.current_period_end
        ? new Date(s.current_period_end * 1000).toISOString().slice(0, 10)
        : null,
    };
  });
  const text = [
    `## Active Subscriptions (${subs.length}${data.has_more ? '+, capped at 100' : ''})`,
    '',
    ...subs.map(
      (s) => `- ${s.customer} · ${s.amount || 'n/a'} · renews ${s.current_period_end || '?'}`,
    ),
  ].join('\n');
  return {
    ok: true,
    report: 'subscriptions',
    count: subs.length,
    has_more: data.has_more === true,
    subscriptions: subs,
    text,
    summary: `${subs.length}${data.has_more ? '+' : ''} active subscription(s).`,
  };
}
