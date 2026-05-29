// fal Image — serverless image generation via fal.ai.
//
// Args:
//   prompt     string  required
//   model      string  optional — endpoint slug ('fal-ai/flux/schnell' default,
//                                 'fal-ai/flux-pro', 'fal-ai/flux/dev',
//                                 'fal-ai/sdxl', 'fal-ai/stable-diffusion-3-medium',
//                                 'fal-ai/flux-pro/v1/canny', 'fal-ai/flux-pro/v1/depth',
//                                 'fal-ai/flux-lora-inpaint', etc.)
//   image_url  string  optional — for image-to-image / inpaint / style_transfer
//   mask_url   string  optional — for inpaint
//   aspect     string  optional — 'square_hd' (default) | 'portrait_4_3' |
//                                 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9'
//   negative   string  optional
//
// fal sync endpoints return immediately with `images: [{url, ...}]`.

const API_BASE = 'https://fal.run';
const DEFAULT_MODEL = 'fal-ai/flux/schnell';

const ASPECT_ALIASES = {
  '1:1': 'square_hd',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
  '4:3': 'landscape_4_3',
  '3:4': 'portrait_4_3',
};

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const key = ctx.providerEnv?.FAL_KEY;
  if (!key) {
    throw new Error(
      'FAL_KEY missing — open the fal Image skill gear panel and paste your key from fal.ai → Dashboard → Keys.',
    );
  }
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  if (!prompt) throw new Error('prompt is required');

  const model = typeof a.model === 'string' && a.model ? a.model : DEFAULT_MODEL;
  const aspectRaw = typeof a.aspect === 'string' && a.aspect ? a.aspect : '1:1';
  const image_size = ASPECT_ALIASES[aspectRaw] ?? aspectRaw;

  const body = {
    prompt,
    image_size,
    ...(typeof a.negative === 'string' && a.negative ? { negative_prompt: a.negative } : {}),
    ...(typeof a.image_url === 'string' && a.image_url ? { image_url: a.image_url } : {}),
    ...(typeof a.mask_url === 'string' && a.mask_url ? { mask_url: a.mask_url } : {}),
  };

  const res = await fetch(`${API_BASE}/${model}`, {
    method: 'POST',
    headers: {
      authorization: `Key ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`fal ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = await res.json();
  const imageUrl = json?.images?.[0]?.url ?? json?.image?.url ?? null;
  if (!imageUrl) {
    return { ok: false, error: 'fal_returned_no_image', raw: json };
  }
  return {
    ok: true,
    image_url: imageUrl,
    summary: `fal ${model}: ${prompt.slice(0, 80)}`,
  };
}
