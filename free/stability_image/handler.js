// Stability Image — Stable Diffusion 3 / Image Core / Ultra via Stability AI.
//
// Args:
//   prompt     string  required
//   model      string  optional — 'core' (default) | 'sd3' | 'ultra'
//   image_url  string  optional — for image-to-image (passed as URL; the
//                                 v2beta API takes multipart file uploads
//                                 — we URL-fetch then re-upload as bytes)
//   aspect     string  optional — '1:1' (default) | '16:9' | '9:16' | '4:3'
//                                 | '3:4' | '5:4' | '4:5' | '21:9' | '9:21'
//   negative   string  optional
//   style      string  optional — for Core only: 'anime' | '3d-model' |
//                                 'analog-film' | 'cinematic' | 'comic-book'
//                                 | 'digital-art' | 'enhance' | 'fantasy-art'
//                                 | 'isometric' | 'line-art' | 'low-poly'
//                                 | 'modeling-compound' | 'neon-punk'
//                                 | 'origami' | 'photographic' | 'pixel-art'
//                                 | 'tile-texture'

const API_BASE = 'https://api.stability.ai/v2beta/stable-image/generate';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const key = ctx.providerEnv?.STABILITY_API_KEY;
  if (!key) {
    throw new Error(
      'STABILITY_API_KEY missing — open the Stability Image skill gear panel and paste your key from platform.stability.ai.',
    );
  }
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  if (!prompt) throw new Error('prompt is required');

  const modelRaw = typeof a.model === 'string' && a.model ? a.model : 'core';
  const model = ['core', 'sd3', 'ultra'].includes(modelRaw) ? modelRaw : 'core';
  const aspect = typeof a.aspect === 'string' && a.aspect ? a.aspect : '1:1';

  const form = new FormData();
  form.append('prompt', prompt);
  form.append('aspect_ratio', aspect);
  form.append('output_format', 'png');
  if (typeof a.negative === 'string' && a.negative) {
    form.append('negative_prompt', a.negative);
  }
  if (model === 'core' && typeof a.style === 'string' && a.style) {
    form.append('style_preset', a.style);
  }
  if (typeof a.image_url === 'string' && a.image_url) {
    const imgRes = await fetch(a.image_url);
    if (!imgRes.ok) {
      return { ok: false, error: `image_fetch_${imgRes.status}` };
    }
    const blob = await imgRes.blob();
    form.append('image', blob, 'input.png');
    form.append('mode', 'image-to-image');
    form.append('strength', '0.6');
  }

  const res = await fetch(`${API_BASE}/${model}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      accept: 'application/json',
    },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Stability ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    return { ok: false, error: json.errors.join('; ') };
  }
  if (!json.image) {
    return { ok: false, error: 'stability_returned_no_image', raw: json };
  }
  // v2beta returns base64-encoded image when accept=application/json.
  const imageB64 = json.image;
  return {
    ok: true,
    image_b64: imageB64,
    image_url: `data:image/png;base64,${imageB64}`,
    summary: `Stability ${model}: ${prompt.slice(0, 80)}`,
  };
}
