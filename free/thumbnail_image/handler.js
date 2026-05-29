// Thumbnail Image — 16:9 high-contrast bold composition.
//
// Args:
//   concept   string  required — what the thumbnail should show
//   headline  string  optional — text to overlay big (Ideogram does this best)
//   palette   string  optional — colour palette hint
//   provider  string  optional — override the configured default

const SUPERVISOR_BASE = 'http://127.0.0.1:3417';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const concept = typeof a.concept === 'string' ? a.concept.trim() : '';
  if (!concept) throw new Error('concept is required');
  const headline = typeof a.headline === 'string' ? a.headline.trim() : '';
  const palette =
    typeof a.palette === 'string' && a.palette.trim()
      ? `bold ${a.palette.trim()} palette`
      : 'bold high-contrast palette';

  const prompt =
    `Eye-catching 16:9 thumbnail image of ${concept}, ${palette}, ` +
    `dramatic lighting, strong focal point dead-centre, shallow depth-of-field, ` +
    `editorial composition, dynamic and clickable, ` +
    (headline
      ? `with large readable text "${headline}" overlaid in a chunky sans-serif at the top, `
      : 'leave space at the top for a headline overlay, ') +
    `no watermarks, no clutter.`;

  const preferred =
    typeof a.provider === 'string' && a.provider.trim()
      ? providerToSkillId(a.provider.trim())
      : providerToSkillId(ctx.skillInputs?.preferred_provider ?? 'ideogram');

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
    body: JSON.stringify({ args: { prompt, aspect: '16:9' } }),
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
    summary: `Thumbnail "${concept.slice(0, 50)}" via ${skillId}`,
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
