// Logo Variant — preset prompt for a logo concept.
//
// Args:
//   brand     string  required — brand name
//   concept   string  optional — what the logo should convey
//                                (defaults to "clean modern mark")
//   palette   string  optional — e.g. "deep navy and gold"
//   provider  string  optional — override the configured default

const PROMPT_TEMPLATE = (p) =>
  `Logo design for "${p.brand}", ${p.concept}, ` +
  `${p.palette}, vector style, flat, scalable, simple geometric forms, ` +
  `centered on a white background, no extra text, no realistic detail, ` +
  `brand-identity quality.`;

const SUPERVISOR_BASE = 'http://127.0.0.1:3417';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const brand = typeof a.brand === 'string' ? a.brand.trim() : '';
  if (!brand) throw new Error('brand is required');
  const concept =
    typeof a.concept === 'string' && a.concept.trim()
      ? a.concept.trim()
      : 'clean modern mark';
  const palette =
    typeof a.palette === 'string' && a.palette.trim()
      ? `using a colour palette of ${a.palette.trim()}`
      : 'using a restrained two-colour palette';

  const prompt = PROMPT_TEMPLATE({ brand, concept, palette });
  const preferred =
    typeof a.provider === 'string' && a.provider.trim()
      ? providerToSkillId(a.provider.trim())
      : providerToSkillId(ctx.skillInputs?.preferred_provider ?? 'recraft');

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
  const innerArgs = { prompt };
  // Recraft-specific style hint when it's the picked provider — opt into
  // the vector_illustration preset so the output really is an SVG-able mark.
  if (skillId === 'recraft_image') innerArgs.style = 'vector_illustration';

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
    is_vector: output.is_vector === true,
    summary: `Logo for ${brand} via ${skillId}`,
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
