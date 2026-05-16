// Image Generation — OpenAI gpt-image-2.
//
// Generates a single image from a text prompt and writes it to the
// founder's collateral table as a base64 PNG. Returns the saved
// collateral id + a short markdown summary.
//
// Args (from /skills/:id/run body or scheduler):
//   prompt   string  required
//   size     string  '1024x1024' | '1024x1792' | '1792x1024'   (default 1024x1024)
//   quality  string  'standard' | 'hd'                         (default 'standard')
//   style    string  'vivid' | 'natural'                       (default 'vivid')
//
// The OPENAI_API_KEY must live in the vault under provider 'openai'.

const API_URL = 'https://api.openai.com/v1/images/generations';
const VALID_SIZES = new Set(['1024x1024', '1024x1792', '1792x1024']);
const VALID_QUALITY = new Set(['standard', 'hd']);
const VALID_STYLE = new Set(['vivid', 'natural']);

export async function run(ctx, args) {
  const a = (args && typeof args === 'object' ? args : {});
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  const size = VALID_SIZES.has(a.size) ? a.size : '1024x1024';
  const quality = VALID_QUALITY.has(a.quality) ? a.quality : 'standard';
  const style = VALID_STYLE.has(a.style) ? a.style : 'vivid';

  if (!prompt) {
    throw new Error('prompt is required');
  }

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
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size,
      quality,
      style,
      response_format: 'b64_json',
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = await res.json();
  const item = data?.data?.[0] ?? {};
  const b64 = typeof item.b64_json === 'string' ? item.b64_json : '';
  const revisedPrompt =
    typeof item.revised_prompt === 'string' ? item.revised_prompt : '';

  if (!b64) {
    throw new Error('OpenAI returned no image data');
  }

  const dataUrl = `data:image/png;base64,${b64}`;
  const createdAt = new Date().toISOString();
  const titleStub = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;

  let collateralId = null;
  if (ctx.vault && typeof ctx.vault.upsertCollateral === 'function') {
    const id = `coll-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    try {
      const row = await ctx.vault.upsertCollateral({
        id,
        title: `Image: ${titleStub}`,
        kind: 'image',
        content: dataUrl,
        source: 'skill',
        sourceId: 'create-images-openai',
        metadata: JSON.stringify({
          mime: 'image/png',
          model: 'gpt-image-2',
          size,
          quality,
          style,
          prompt,
          revised_prompt: revisedPrompt || null,
          skill_id: 'create-images-openai',
        }),
        tags: JSON.stringify(['image', 'gpt-image-2', 'openai']),
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
        actor: 'skill:create-images-openai',
        action: 'image.generated',
        target: collateralId ? `collateral:${collateralId}` : null,
        severity: 'info',
        details: { size, quality, style, has_revised_prompt: !!revisedPrompt },
      });
    } catch {
      /* audit failures never break the skill */
    }
  }

  const lines = [
    `## Generated image (gpt-image-2)`,
    '',
    `![${titleStub}](${dataUrl})`,
    '',
    `**Prompt:** ${prompt}`,
  ];
  if (revisedPrompt) {
    lines.push('', `_Revised prompt:_ ${revisedPrompt}`);
  }
  if (collateralId) {
    lines.push('', `Saved to collateral as \`${collateralId}\`.`);
  }

  return {
    ok: true,
    collateral_id: collateralId,
    image_url: dataUrl,
    prompt,
    revised_prompt: revisedPrompt || null,
    size,
    quality,
    style,
    summary: lines.join('\n'),
  };
}
