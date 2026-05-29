// Wardrobe Swap — change clothing in an existing portrait.
//
// Args:
//   image_url string  required — URL of the source portrait
//   outfit    string  required — new clothing description
//   mask_url  string  optional — only the clothing region (improves quality
//                                when supplied)
//   provider  string  optional

const SUPERVISOR_BASE = 'http://127.0.0.1:3417';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const image_url = typeof a.image_url === 'string' ? a.image_url.trim() : '';
  if (!image_url) throw new Error('image_url is required');
  const outfit = typeof a.outfit === 'string' ? a.outfit.trim() : '';
  if (!outfit) throw new Error('outfit is required');

  const prompt =
    `Keep the same person, same face, same pose, same lighting. ` +
    `Change the clothing to: ${outfit}. ` +
    `Photorealistic, fabric drape matches the body, ` +
    `no other changes.`;

  const capability = a.mask_url ? 'inpaint' : 'image_to_image';
  const preferred =
    typeof a.provider === 'string' && a.provider.trim()
      ? providerToSkillId(a.provider.trim())
      : providerToSkillId(ctx.skillInputs?.preferred_provider ?? 'fal');

  const resolveRes = await fetch(
    `${SUPERVISOR_BASE}/skills/family-resolve?family=ai_image&capability=${capability}` +
      (preferred ? `&preferred=${encodeURIComponent(preferred)}` : ''),
  );
  if (!resolveRes.ok) return { ok: false, error: `family_resolve_failed ${resolveRes.status}` };
  const resolved = await resolveRes.json();
  if (!resolved.provider_id) {
    return {
      ok: false,
      error: `no AI image provider configured for ${capability}. Configure one of: ${resolved.missing_keys?.join(', ') || '(none)'}`,
      missing_keys: resolved.missing_keys,
    };
  }
  const skillId = resolved.provider_id;
  const innerArgs = { prompt, image_url };
  if (a.mask_url) innerArgs.mask_url = a.mask_url;

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
    summary: `Wardrobe swap via ${skillId}: ${outfit.slice(0, 60)}`,
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
