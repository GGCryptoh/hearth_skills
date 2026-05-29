// KIE Image — image generation via KIE.ai's multi-model proxy.
//
// Args:
//   prompt    string  required
//   model     string  optional — "flux-pro" (default) | "flux-schnell" |
//                                "sd3" | "midjourney" | …
//   aspect    string  optional — "1:1" (default) | "16:9" | "9:16" | "4:3" | "3:4"
//   negative  string  optional — what NOT to include
//
// Returns: { ok, image_url?, image_b64?, collateral_id?, summary }

const API_BASE = 'https://api.kie.ai';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const apiKey = ctx.providerEnv?.KIE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'KIE_API_KEY missing — open the KIE Image skill gear panel and paste your key from kie.ai → Settings → API Keys.',
    );
  }
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  if (!prompt) throw new Error('prompt is required');

  const body = {
    prompt,
    model: typeof a.model === 'string' ? a.model : 'flux-pro',
    aspect_ratio: typeof a.aspect === 'string' ? a.aspect : '1:1',
    ...(typeof a.negative === 'string' && a.negative ? { negative_prompt: a.negative } : {}),
  };

  const res = await fetch(`${API_BASE}/v1/generations`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`KIE ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = await res.json();
  const imageUrl = json?.data?.[0]?.url ?? json?.image_url ?? null;
  if (!imageUrl) {
    return { ok: false, error: 'kie_returned_no_image', raw: json };
  }
  return {
    ok: true,
    image_url: imageUrl,
    summary: `KIE.ai ${body.model}: ${prompt.slice(0, 80)}`,
  };
}
