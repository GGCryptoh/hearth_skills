// Style Transfer — restyle an image while preserving content.
//
// Args:
//   image_url string  required
//   style     string  required — target aesthetic description
//   strength  number  optional — 0..1 (default 0.7)
//   provider  string  optional

const SUPERVISOR_BASE = 'http://127.0.0.1:3417';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const image_url = typeof a.image_url === 'string' ? a.image_url.trim() : '';
  if (!image_url) throw new Error('image_url is required');
  const style = typeof a.style === 'string' ? a.style.trim() : '';
  if (!style) throw new Error('style is required');

  const prompt =
    `Restyle this image as: ${style}. ` +
    `Preserve the composition, subject, and overall geometry. ` +
    `Shift the surface treatment, palette, and texture to match the new style. ` +
    `High-fidelity art-direction quality.`;

  const preferred =
    typeof a.provider === 'string' && a.provider.trim()
      ? providerToSkillId(a.provider.trim())
      : providerToSkillId(ctx.skillInputs?.preferred_provider ?? 'higgsfield');

  const resolveRes = await fetch(
    `${SUPERVISOR_BASE}/skills/family-resolve?family=ai_image&capability=style_transfer` +
      (preferred ? `&preferred=${encodeURIComponent(preferred)}` : ''),
  );
  if (!resolveRes.ok) return { ok: false, error: `family_resolve_failed ${resolveRes.status}` };
  const resolved = await resolveRes.json();
  if (!resolved.provider_id) {
    return {
      ok: false,
      error: `no AI image provider configured for style_transfer. Configure one of: ${resolved.missing_keys?.join(', ') || '(none)'}`,
      missing_keys: resolved.missing_keys,
    };
  }
  const skillId = resolved.provider_id;
  const innerArgs = { prompt, image_url };
  if (typeof a.strength === 'number') innerArgs.strength = a.strength;

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
    summary: `Style transfer via ${skillId}: ${style.slice(0, 60)}`,
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
