// Ideogram Image — typography-strong image generation via Ideogram.ai.
//
// Args:
//   prompt     string  required
//   model      string  optional — 'V_2' (default) | 'V_2_TURBO' | 'V_1'
//   aspect     string  optional — '1:1' (default) | '16:9' | '9:16' | '4:3' |
//                                 '3:4' | '3:2' | '2:3' | '4:5' | '5:4'
//                                 | '16:10' | '10:16'
//   negative   string  optional
//   style      string  optional — 'GENERAL' (default) | 'REALISTIC' |
//                                 'DESIGN' | 'RENDER_3D' | 'ANIME'

const API_BASE = 'https://api.ideogram.ai';
const DEFAULT_MODEL = 'V_2';

const ASPECT_TO_RESOLUTION = {
  '1:1': 'ASPECT_1_1',
  '16:9': 'ASPECT_16_9',
  '9:16': 'ASPECT_9_16',
  '4:3': 'ASPECT_4_3',
  '3:4': 'ASPECT_3_4',
  '3:2': 'ASPECT_3_2',
  '2:3': 'ASPECT_2_3',
  '4:5': 'ASPECT_4_5',
  '5:4': 'ASPECT_5_4',
  '16:10': 'ASPECT_16_10',
  '10:16': 'ASPECT_10_16',
};

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const key = ctx.providerEnv?.IDEOGRAM_API_KEY;
  if (!key) {
    throw new Error(
      'IDEOGRAM_API_KEY missing — open the Ideogram Image skill gear panel and paste your key from ideogram.ai → Manage API.',
    );
  }
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  if (!prompt) throw new Error('prompt is required');

  const model = typeof a.model === 'string' && a.model ? a.model : DEFAULT_MODEL;
  const aspect = typeof a.aspect === 'string' && a.aspect ? a.aspect : '1:1';
  const aspect_ratio = ASPECT_TO_RESOLUTION[aspect] ?? 'ASPECT_1_1';

  const body = {
    image_request: {
      prompt,
      model,
      aspect_ratio,
      ...(typeof a.style === 'string' && a.style
        ? { style_type: a.style.toUpperCase() }
        : {}),
      ...(typeof a.negative === 'string' && a.negative
        ? { negative_prompt: a.negative }
        : {}),
    },
  };

  const res = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: {
      'Api-Key': key,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Ideogram ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = await res.json();
  const imageUrl = json?.data?.[0]?.url ?? null;
  if (!imageUrl) {
    return { ok: false, error: 'ideogram_returned_no_image', raw: json };
  }
  return {
    ok: true,
    image_url: imageUrl,
    summary: `Ideogram ${model}: ${prompt.slice(0, 80)}`,
  };
}
