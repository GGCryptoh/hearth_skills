// Cat Selfie Maker — OpenAI gpt-image-1.
//
// Generates a 9:16 vertical "ordinary iPhone snapshot" of a cat taking a
// selfie. The prompt is intentionally anti-cinematic — see DEFAULT_PROMPT
// below. The founder can override the prompt from the Configure Skill
// drawer; an empty/whitespace override falls back to DEFAULT_PROMPT.
//
// Args (from /skills/:id/run body or scheduler):
//   prompt          string  optional — overrides DEFAULT_PROMPT for this run
//   prompt_template string  optional — same as `prompt`; UI naming for the
//                                      vault_inputs override (one form, one key)
//   size            string  '1024x1536' (default — 9:16 portrait) | '1024x1024' | '1536x1024'
//
// Vault: OPENAI_API_KEY required.

const API_URL = 'https://api.openai.com/v1/images/generations';
const VALID_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024']);

const DEFAULT_PROMPT =
  'A vertical 9:16 ordinary iPhone snapshot of a cat taking a selfie in a ' +
  'casual setting, with some accessory/prop, an awkward or mundane candid ' +
  'expression, and an imperfection like blur, bad framing, clutter, or ' +
  'harsh lighting. Avoid cinematic, polished, professional, or glamour-' +
  'style composition.';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const overrideRaw =
    typeof a.prompt === 'string'
      ? a.prompt
      : typeof a.prompt_template === 'string'
        ? a.prompt_template
        : '';
  const override = overrideRaw.trim();
  const prompt = override.length > 0 ? override : DEFAULT_PROMPT;
  const size = VALID_SIZES.has(a.size) ? a.size : '1024x1536';

  const apiKey = ctx.providerEnv?.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY missing — add your OpenAI key under Vault → API Keys',
    );
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = await res.json();
  const item = data?.data?.[0] ?? {};
  const b64 = typeof item.b64_json === 'string' ? item.b64_json : '';

  if (!b64) {
    throw new Error('OpenAI returned no image data');
  }

  const dataUrl = `data:image/png;base64,${b64}`;
  const createdAt = new Date().toISOString();
  const titleStub = override.length > 0 ? override.slice(0, 60) : 'Cat selfie';

  let collateralId = null;
  if (ctx.vault && typeof ctx.vault.upsertCollateral === 'function') {
    const id = `coll-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    try {
      const row = await ctx.vault.upsertCollateral({
        id,
        title: `Cat selfie — ${titleStub}`,
        kind: 'image',
        content: dataUrl,
        source: 'skill',
        sourceId: 'cat-selfie-maker',
        metadata: JSON.stringify({
          mime: 'image/png',
          model: 'gpt-image-1',
          size,
          prompt,
          prompt_was_override: override.length > 0,
          skill_id: 'cat-selfie-maker',
        }),
        tags: JSON.stringify(['image', 'gpt-image-1', 'cat', 'selfie']),
        createdAt,
        seenAt: null,
      });
      collateralId = row?.id ?? id;
    } catch (err) {
      ctx.log?.warn?.('upsertCollateral failed — returning inline data URL', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (ctx.audit && typeof ctx.audit.append === 'function') {
    try {
      await ctx.audit.append({
        actor: 'skill:cat-selfie-maker',
        action: 'image.generated',
        target: collateralId ? `collateral:${collateralId}` : null,
        severity: 'info',
        details: {
          model: 'gpt-image-1',
          size,
          prompt_was_override: override.length > 0,
        },
      });
    } catch {
      /* audit failures never break the skill */
    }
  }

  const lines = [
    `## Cat selfie (gpt-image-1)`,
    '',
    `![${titleStub}](${dataUrl})`,
    '',
  ];
  if (collateralId) {
    lines.push(`Saved to collateral as \`${collateralId}\`.`);
  }

  return {
    ok: true,
    collateral_id: collateralId,
    image_url: dataUrl,
    prompt,
    prompt_was_override: override.length > 0,
    model: 'gpt-image-1',
    size,
    summary: lines.join('\n'),
  };
}
