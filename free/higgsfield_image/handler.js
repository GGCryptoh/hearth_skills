// Higgsfield Image — Sora-style image + image-to-video generation.
//
// Args:
//   prompt    string  required — what to generate
//   style     string  optional — "cinematic" (default) | "natural" | "stylized"
//   ratio     string  optional — "16:9" (default) | "1:1" | "9:16" | "4:3"
//
// Returns: { ok, image_url, summary }

const API_BASE = 'https://api.higgsfield.ai';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const apiKey = ctx.providerEnv?.HIGGSFIELD_API_KEY;
  if (!apiKey) {
    throw new Error(
      'HIGGSFIELD_API_KEY missing — open the Higgsfield Image skill gear panel and paste your key from higgsfield.ai → Account → API.',
    );
  }
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  if (!prompt) throw new Error('prompt is required');

  const body = {
    prompt,
    style: typeof a.style === 'string' ? a.style : 'cinematic',
    aspect_ratio: typeof a.ratio === 'string' ? a.ratio : '16:9',
  };

  const res = await fetch(`${API_BASE}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Higgsfield ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = await res.json();
  const imageUrl = json?.url ?? json?.data?.[0]?.url ?? null;
  if (!imageUrl) {
    return { ok: false, error: 'higgsfield_returned_no_image', raw: json };
  }
  return {
    ok: true,
    image_url: imageUrl,
    summary: `Higgsfield ${body.style}: ${prompt.slice(0, 80)}`,
  };
}
