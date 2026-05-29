// Background Replace — swap the backdrop while keeping the subject.
//
// Args:
//   image_url   string  required
//   background  string  required — describe the new background
//   mask_url    string  optional — foreground mask (subject in white)
//   provider    string  optional

const SUPERVISOR_BASE = 'http://127.0.0.1:3417';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const image_url = typeof a.image_url === 'string' ? a.image_url.trim() : '';
  if (!image_url) throw new Error('image_url is required');
  const background = typeof a.background === 'string' ? a.background.trim() : '';
  if (!background) throw new Error('background is required');

  const prompt =
    `Keep the same subject, same pose, same outfit, same lighting on the subject. ` +
    `Replace the background with: ${background}. ` +
    `Realistic edge blending, consistent ambient light spill from the new background, ` +
    `photorealistic, no other changes to the subject.`;

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
    summary: `Background replace via ${skillId}: ${background.slice(0, 60)}`,
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
