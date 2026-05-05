// Daily Brief.
//
// Single Anthropic Sonnet 4.6 hop. Asks the model to produce a short
// markdown brief: 3 world-headline bullets, a weather sentence, and a
// one-line "today, expect..." line based on the founder's stated
// interests + city. The model uses its training-data-aware reasoning;
// future revisions can chain web_search built-in for real-time
// headlines (today's hop is intentionally simple — costs ~$0.02 and
// runs in ~8s).
//
// Args:
//   format    'markdown' | 'plain'    optional, default 'markdown'
//
// Vault config:
//   ANTHROPIC_API_KEY                 secret, under providers
//   city                              vault input
//   interests                         vault input
//
// Returns: { ok, summary, brief, tokens } where `brief` is the rendered
// markdown for chat consumption.

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const format = a.format === 'plain' ? 'plain' : 'markdown';

  const apiKey = ctx.providerEnv?.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY missing — add your Anthropic key under Vault → API Keys',
    );
  }

  const city =
    typeof ctx.skillInputs?.city === 'string' && ctx.skillInputs.city.length > 0
      ? ctx.skillInputs.city
      : null;
  const interests =
    typeof ctx.skillInputs?.interests === 'string' &&
    ctx.skillInputs.interests.length > 0
      ? ctx.skillInputs.interests
      : null;

  const today = new Date().toISOString().slice(0, 10);
  const cityLine = city ? `Local context: ${city}.` : '';
  const interestsLine = interests
    ? `Founder interests: ${interests}. Bias headline picks accordingly.`
    : '';
  const formatLine =
    format === 'markdown'
      ? 'Render in compact markdown — bold the lead of each headline.'
      : 'Render as plain text — no markdown.';

  const userPrompt = [
    `Today is ${today}. Produce a tight morning brief in this exact shape:`,
    '',
    '1. Three world-headline bullets — one sentence each, with a bold lead phrase.',
    '2. A one-line weather summary for the founder\'s city (skip if no city).',
    '3. A one-line "today, expect..." outlook tailored to the founder\'s interests.',
    '',
    cityLine,
    interestsLine,
    formatLine,
    '',
    'No preamble, no sign-off. Open with the first bullet directly.',
  ]
    .filter(Boolean)
    .join('\n');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = Array.isArray(data?.content)
    ? data.content
        .filter((b) => b?.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
    : '';
  if (!text) {
    throw new Error('Anthropic returned no text content');
  }

  const usage = data?.usage ?? {};
  return {
    ok: true,
    brief: text,
    summary: `Daily brief ready (${today})`,
    tokens: {
      input: usage.input_tokens ?? null,
      output: usage.output_tokens ?? null,
    },
  };
}
