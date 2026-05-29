// Lifestyle Headshot — outdoor / golden-hour preset.
//
// Args:
//   subject     string  required
//   wardrobe    string  optional — defaults to 'casual button-down and a textured knit'
//   setting     string  optional — defaults to 'sun-dappled park late afternoon'
//   provider    string  optional

const SUPERVISOR_BASE = 'http://127.0.0.1:3417';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const subject = typeof a.subject === 'string' ? a.subject.trim() : '';
  if (!subject) throw new Error('subject is required');
  const wardrobe =
    typeof a.wardrobe === 'string' && a.wardrobe.trim()
      ? a.wardrobe.trim()
      : 'casual button-down and a textured knit';
  const setting =
    typeof a.setting === 'string' && a.setting.trim()
      ? a.setting.trim()
      : 'sun-dappled park late afternoon';

  const prompt =
    `Lifestyle portrait, ${subject}, wearing ${wardrobe}, ` +
    `${setting}, warm golden-hour lighting, gentle authentic smile, ` +
    `shallow depth-of-field, bokeh, 85mm lens look, ` +
    `magazine-cover quality, looking just off-camera, ` +
    `natural and unposed.`;

  const preferred =
    typeof a.provider === 'string' && a.provider.trim()
      ? providerToSkillId(a.provider.trim())
      : providerToSkillId(ctx.skillInputs?.preferred_provider ?? 'openai');

  const resolveRes = await fetch(
    `${SUPERVISOR_BASE}/skills/family-resolve?family=ai_image&capability=text_to_image` +
      (preferred ? `&preferred=${encodeURIComponent(preferred)}` : ''),
  );
  if (!resolveRes.ok) return { ok: false, error: `family_resolve_failed ${resolveRes.status}` };
  const resolved = await resolveRes.json();
  if (!resolved.provider_id) {
    return {
      ok: false,
      error: `no AI image provider configured. Configure one of: ${resolved.missing_keys?.join(', ') || '(none)'}`,
      missing_keys: resolved.missing_keys,
    };
  }
  const skillId = resolved.provider_id;
  const res = await fetch(`${SUPERVISOR_BASE}/skills/${encodeURIComponent(skillId)}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: { prompt } }),
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
    summary: `Lifestyle headshot via ${skillId}: ${subject.slice(0, 50)}`,
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
