// Inpaint — edit a masked region of an existing image.
//
// Args:
//   prompt    string  required — what to fill the masked area with
//   image_url string  required — URL of the source image
//   mask_url  string  required — URL of the mask (white = edit, black = keep)
//   provider  string  optional

const SUPERVISOR_BASE = 'http://127.0.0.1:3417';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  if (!prompt) throw new Error('prompt is required');
  const image_url = typeof a.image_url === 'string' ? a.image_url.trim() : '';
  if (!image_url) throw new Error('image_url is required');
  const mask_url = typeof a.mask_url === 'string' ? a.mask_url.trim() : '';
  if (!mask_url) throw new Error('mask_url is required');

  const preferred =
    typeof a.provider === 'string' && a.provider.trim()
      ? providerToSkillId(a.provider.trim())
      : providerToSkillId(ctx.skillInputs?.preferred_provider ?? 'fal');

  const resolveRes = await fetch(
    `${SUPERVISOR_BASE}/skills/family-resolve?family=ai_image&capability=inpaint` +
      (preferred ? `&preferred=${encodeURIComponent(preferred)}` : ''),
  );
  if (!resolveRes.ok) return { ok: false, error: `family_resolve_failed ${resolveRes.status}` };
  const resolved = await resolveRes.json();
  if (!resolved.provider_id) {
    return {
      ok: false,
      error: `no AI image provider configured for inpaint. Configure one of: ${resolved.missing_keys?.join(', ') || '(none)'}`,
      missing_keys: resolved.missing_keys,
    };
  }
  const skillId = resolved.provider_id;
  // Some providers expect different model slugs for inpaint mode.
  const innerArgs = { prompt, image_url, mask_url };
  if (skillId === 'fal_image') innerArgs.model = 'fal-ai/flux-lora-inpaint';

  const res = await fetch(`${SUPERVISOR_BASE}/skills/${encodeURIComponent(skillId)}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: innerArgs }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return {
      ok: false,
      provider_used: skillId,
      error: `provider ${skillId} returned ${res.status}: ${detail.slice(0, 300)}`,
    };
  }
  const body = await res.json();
  const output = body.output ?? body;
  return {
    ok: true,
    provider_used: skillId,
    image_url: output.image_url ?? output.image_b64 ?? null,
    summary: `Inpaint via ${skillId}: ${prompt.slice(0, 60)}`,
  };
}

function providerToSkillId(provider) {
  const map = {
    openai: 'create-images-openai',
    kie: 'kie_image',
    higgsfield: 'higgsfield_image',
    replicate: 'replicate_image',
    fal: 'fal_image',
    stability: 'stability_image',
    recraft: 'recraft_image',
    ideogram: 'ideogram_image',
  };
  return map[provider] ?? provider;
}
