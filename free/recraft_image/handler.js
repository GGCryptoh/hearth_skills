// Recraft Image — design-focused image + vector generation.
//
// Args:
//   prompt     string  required
//   style      string  optional — 'realistic_image' (default) |
//                                 'digital_illustration' | 'vector_illustration' |
//                                 'icon' (any Recraft style preset id works)
//   aspect     string  optional — '1:1' (default) | '16:9' | '9:16' | '4:3' | '3:4'
//   substyle   string  optional — style modifier (Recraft-specific)
//
// Recraft returns:
//   { data: [{ url, b64_json? }] }

const API_BASE = 'https://external.api.recraft.ai/v1';

const ASPECT_TO_SIZE = {
  '1:1': '1024x1024',
  '16:9': '1820x1024',
  '9:16': '1024x1820',
  '4:3': '1365x1024',
  '3:4': '1024x1365',
};

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const token = ctx.providerEnv?.RECRAFT_API_TOKEN;
  if (!token) {
    throw new Error(
      'RECRAFT_API_TOKEN missing — open the Recraft Image skill gear panel and paste your token from recraft.ai → API.',
    );
  }
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  if (!prompt) throw new Error('prompt is required');

  const style = typeof a.style === 'string' && a.style ? a.style : 'realistic_image';
  const aspect = typeof a.aspect === 'string' && a.aspect ? a.aspect : '1:1';
  const size = ASPECT_TO_SIZE[aspect] ?? '1024x1024';

  const body = {
    prompt,
    style,
    size,
    ...(typeof a.substyle === 'string' && a.substyle ? { substyle: a.substyle } : {}),
  };

  const res = await fetch(`${API_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Recraft ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = await res.json();
  const imageUrl = json?.data?.[0]?.url ?? null;
  if (!imageUrl) {
    return { ok: false, error: 'recraft_returned_no_image', raw: json };
  }
  return {
    ok: true,
    image_url: imageUrl,
    is_vector: style.startsWith('vector_'),
    summary: `Recraft ${style}: ${prompt.slice(0, 80)}`,
  };
}
