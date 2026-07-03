// Image Generation / Editing — OpenAI gpt-image-2.
//
// Two modes, auto-selected by whether an input image is supplied:
//
//   text_to_image   (no input image)  → POST /v1/images/generations
//       prompt   string  required
//       size     string  '1024x1024' | '1536x1024' | '1024x1536' | 'auto'
//                        (legacy DALL-E 3 sizes 1024x1792/1792x1024 are
//                        remapped to the nearest gpt-image size)
//       quality  string  'low' | 'medium' | 'high' | 'auto'
//                        (legacy 'standard'→'medium', 'hd'→'high')
//
//   NOTE (2026-07-03): gpt-image-2 rejects the DALL-E 3 params `style`
//   and `response_format` with 400 unknown_parameter — the founder hit
//   this live (companion + chat image asks failed). Neither is sent
//   anymore; the API returns b64_json by default.
//
//   image_to_image / inpaint / background_remove  (input image supplied)
//                                       → POST /v1/images/edits
//       prompt      string  required
//       image_url   string  required — data: URL or http(s) URL of the source
//       mask_url     string optional — PNG mask (transparent = edit region).
//                            When present the call is an inpaint.
//       transparent  bool   optional — request a transparent-background PNG
//                            (background:'transparent'). Used for cutouts /
//                            background removal.
//       size         string optional — gpt-image edit sizes: '1024x1024',
//                            '1536x1024', '1024x1536', 'auto' (default 1024x1024)
//
// Capability mapping (skill.json): text_to_image, image_to_image, inpaint,
// background_remove. Sub-skills (background_replace, wardrobe_swap, inpaint,
// headshot_*, …) resolve here via /skills/family-resolve and call run() with
// the arg shape above.
//
// The OPENAI_API_KEY must live in the vault (provider 'openai').

const GENERATIONS_URL = 'https://api.openai.com/v1/images/generations';
const EDITS_URL = 'https://api.openai.com/v1/images/edits';
const VALID_SIZES = new Set([
  '1024x1024',
  '1536x1024',
  '1024x1536',
  'auto',
]);
// Callers still passing DALL-E 3 shapes get the nearest gpt-image size.
const LEGACY_SIZE_REMAP = {
  '1024x1792': '1024x1536',
  '1792x1024': '1536x1024',
};
const VALID_EDIT_SIZES = new Set([
  '1024x1024',
  '1536x1024',
  '1024x1536',
  'auto',
]);
const VALID_QUALITY = new Set(['low', 'medium', 'high', 'auto']);
const LEGACY_QUALITY_REMAP = { standard: 'medium', hd: 'high' };

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  if (!prompt) {
    throw new Error('prompt is required');
  }

  const apiKey = ctx.providerEnv?.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY missing — add your OpenAI key under Vault → API Keys',
    );
  }

  // An input image switches us from text-to-image to the edits endpoint
  // (image-to-image / inpaint / background removal).
  const inputImage =
    typeof a.image_url === 'string' && a.image_url.trim()
      ? a.image_url.trim()
      : typeof a.image_data_url === 'string' && a.image_data_url.trim()
        ? a.image_data_url.trim()
        : typeof a.init_image === 'string' && a.init_image.trim()
          ? a.init_image.trim()
          : '';

  const transparent =
    a.transparent === true ||
    a.transparent === 'true' ||
    a.background === 'transparent';

  const result = inputImage
    ? await editImage({ apiKey, prompt, inputImage, a, transparent, ctx })
    : await generateImage({ apiKey, prompt, a, transparent });

  return persistAndSummarize({ ...result, ctx, prompt });
}

// ---- text-to-image (unchanged behavior) -------------------------------

async function generateImage({ apiKey, prompt, a, transparent }) {
  const requestedSize = LEGACY_SIZE_REMAP[a.size] ?? a.size;
  const size = VALID_SIZES.has(requestedSize) ? requestedSize : '1024x1024';
  const requestedQuality = LEGACY_QUALITY_REMAP[a.quality] ?? a.quality;
  const quality = VALID_QUALITY.has(requestedQuality)
    ? requestedQuality
    : 'auto';

  const body = {
    model: 'gpt-image-2',
    prompt,
    n: 1,
    size,
    quality,
  };
  if (transparent) body.background = 'transparent';

  const res = await fetch(GENERATIONS_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 500)}`);
  }
  const data = await res.json();
  const item = data?.data?.[0] ?? {};
  const b64 = typeof item.b64_json === 'string' ? item.b64_json : '';
  if (!b64) throw new Error('OpenAI returned no image data');
  return {
    b64,
    revisedPrompt:
      typeof item.revised_prompt === 'string' ? item.revised_prompt : '',
    size,
    quality,
    transparent: !!transparent,
    mode: 'text_to_image',
  };
}

// ---- image-to-image / inpaint / background-remove ---------------------

async function editImage({ apiKey, prompt, inputImage, a, transparent, ctx }) {
  const size = VALID_EDIT_SIZES.has(a.size) ? a.size : '1024x1024';
  const maskUrl =
    typeof a.mask_url === 'string' && a.mask_url.trim()
      ? a.mask_url.trim()
      : '';

  const img = await loadImageBytes(inputImage);
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('n', '1');
  form.append('size', size);
  if (transparent) form.append('background', 'transparent');
  form.append('image', new Blob([img.bytes], { type: img.mime }), 'image.png');
  if (maskUrl) {
    const mask = await loadImageBytes(maskUrl);
    form.append('mask', new Blob([mask.bytes], { type: mask.mime }), 'mask.png');
  }

  const res = await fetch(EDITS_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` }, // fetch sets multipart boundary
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI edits ${res.status}: ${detail.slice(0, 500)}`);
  }
  const data = await res.json();
  const item = data?.data?.[0] ?? {};
  const b64 = typeof item.b64_json === 'string' ? item.b64_json : '';
  if (!b64) throw new Error('OpenAI edits returned no image data');
  return {
    b64,
    revisedPrompt:
      typeof item.revised_prompt === 'string' ? item.revised_prompt : '',
    size,
    quality: null,
    transparent: !!transparent,
    mode: maskUrl ? 'inpaint' : 'image_to_image',
  };
}

// Decode a data: URL or fetch an http(s) URL into raw bytes + mime.
async function loadImageBytes(urlOrDataUrl) {
  if (urlOrDataUrl.startsWith('data:')) {
    const m = urlOrDataUrl.match(/^data:([^;]+);base64,(.*)$/s);
    if (!m) throw new Error('invalid data URL for input image');
    return {
      bytes: Uint8Array.from(Buffer.from(m[2], 'base64')),
      mime: m[1] || 'image/png',
    };
  }
  const r = await fetch(urlOrDataUrl);
  if (!r.ok) throw new Error(`could not fetch input image (${r.status})`);
  const buf = new Uint8Array(await r.arrayBuffer());
  return { bytes: buf, mime: r.headers.get('content-type') || 'image/png' };
}

// ---- shared: persist to collateral + build the summary ----------------

async function persistAndSummarize({
  b64,
  revisedPrompt,
  size,
  quality,
  transparent,
  mode,
  ctx,
  prompt,
}) {
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
          mode,
          size,
          quality,
          transparent,
          prompt,
          revised_prompt: revisedPrompt || null,
          skill_id: 'create-images-openai',
        }),
        tags: JSON.stringify(['image', 'gpt-image-2', 'openai', mode]),
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
        details: { mode, size, transparent, has_revised_prompt: !!revisedPrompt },
      });
    } catch {
      /* audit failures never break the skill */
    }
  }

  const lines = [
    `## ${mode === 'text_to_image' ? 'Generated' : 'Edited'} image (gpt-image-2 · ${mode})`,
    '',
    `![${titleStub}](${dataUrl})`,
    '',
    `**Prompt:** ${prompt}`,
  ];
  if (revisedPrompt) lines.push('', `_Revised prompt:_ ${revisedPrompt}`);
  if (collateralId) lines.push('', `Saved to collateral as \`${collateralId}\`.`);

  return {
    ok: true,
    collateral_id: collateralId,
    image_url: dataUrl,
    prompt,
    revised_prompt: revisedPrompt || null,
    mode,
    size,
    quality,
    transparent,
    summary: lines.join('\n'),
  };
}
