// Replicate Image — multi-model image generation via Replicate.
//
// Args:
//   prompt    string  required
//   model     string  optional — slug like 'black-forest-labs/flux-schnell'
//                                (default). Also accepts a full version hash.
//   image_url string  optional — for image-to-image / inpaint / style_transfer
//   mask_url  string  optional — for inpaint
//   aspect    string  optional — '1:1' (default) | '16:9' | '9:16' | '4:3' | '3:4'
//   negative  string  optional
//
// Replicate is async-by-design — we POST a prediction, then poll until
// status is 'succeeded' (cap 90s; longer runs should use the skill-jobs
// harness, queued as M51-style work).

const API_BASE = 'https://api.replicate.com/v1';
const DEFAULT_MODEL = 'black-forest-labs/flux-schnell';
const POLL_INTERVAL_MS = 1500;
const MAX_WAIT_MS = 90_000;

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const token = ctx.providerEnv?.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error(
      'REPLICATE_API_TOKEN missing — open the Replicate Image skill gear panel and paste your token from replicate.com → Account → API tokens.',
    );
  }
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  if (!prompt) throw new Error('prompt is required');

  const model = typeof a.model === 'string' && a.model ? a.model : DEFAULT_MODEL;
  const input = {
    prompt,
    ...(typeof a.aspect === 'string' ? { aspect_ratio: a.aspect } : { aspect_ratio: '1:1' }),
    ...(typeof a.negative === 'string' && a.negative ? { negative_prompt: a.negative } : {}),
    ...(typeof a.image_url === 'string' && a.image_url ? { image: a.image_url } : {}),
    ...(typeof a.mask_url === 'string' && a.mask_url ? { mask: a.mask_url } : {}),
  };

  // POST /v1/models/{owner}/{model}/predictions for slug-style; or
  // /v1/predictions with `version` for version-hash style. We detect by
  // slash count.
  const isSlug = /^[\w.-]+\/[\w.-]+$/.test(model);
  const url = isSlug
    ? `${API_BASE}/models/${model}/predictions`
    : `${API_BASE}/predictions`;
  const body = isSlug ? { input } : { version: model, input };

  const create = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Token ${token}`,
      'content-type': 'application/json',
      prefer: 'wait=60',
    },
    body: JSON.stringify(body),
  });
  if (!create.ok) {
    const detail = await create.text().catch(() => '');
    throw new Error(`Replicate ${create.status}: ${detail.slice(0, 300)}`);
  }
  let prediction = await create.json();

  // The 'wait=60' Prefer header makes Replicate hold the connection for
  // up to 60s waiting for the prediction to finish. If it returns early
  // we poll the get-prediction endpoint until terminal.
  const startedAt = Date.now();
  while (
    prediction?.status &&
    prediction.status !== 'succeeded' &&
    prediction.status !== 'failed' &&
    prediction.status !== 'canceled'
  ) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      return {
        ok: false,
        error: `replicate_timeout after ${Math.round((Date.now() - startedAt) / 1000)}s — prediction ${prediction.id} still ${prediction.status}; queue via skill-jobs harness for long-running models`,
      };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetch(`${API_BASE}/predictions/${prediction.id}`, {
      headers: { authorization: `Token ${token}` },
    });
    if (!poll.ok) {
      const detail = await poll.text().catch(() => '');
      return {
        ok: false,
        error: `replicate_poll_${poll.status}: ${detail.slice(0, 200)}`,
      };
    }
    prediction = await poll.json();
  }

  if (prediction.status === 'failed' || prediction.status === 'canceled') {
    return {
      ok: false,
      error: prediction.error ?? `replicate_${prediction.status}`,
    };
  }

  // Output shape varies — slug returns either string URL or array.
  const out = prediction.output;
  const imageUrl = Array.isArray(out) ? out[0] : typeof out === 'string' ? out : null;
  if (!imageUrl) {
    return { ok: false, error: 'replicate_returned_no_image', raw: out };
  }
  return {
    ok: true,
    image_url: imageUrl,
    summary: `Replicate ${model}: ${prompt.slice(0, 80)}`,
  };
}
