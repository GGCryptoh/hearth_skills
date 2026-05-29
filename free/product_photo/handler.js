// Product Photo — preset prompt + route through configured provider.
//
// Args:
//   product       string  required — what the photo is of
//   surface       string  optional — defaults to 'soft white seamless backdrop'
//   angle         string  optional — defaults to 'three-quarter angle'
//   provider      string  optional — override the configured default
//
// Returns: { ok, image_url, summary, provider_used }

const PROMPT_TEMPLATE = (p) =>
  `Professional studio product photograph of ${p.product}, ` +
  `${p.surface}, ${p.angle}, soft diffused three-point lighting, ` +
  `crisp tack-sharp focus, subtle shadow under the product, ` +
  `50mm macro look, commercial catalog quality, no text, no logos, ` +
  `centered composition.`;

const SUPERVISOR_BASE = 'http://127.0.0.1:3417';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const product = typeof a.product === 'string' ? a.product.trim() : '';
  if (!product) {
    throw new Error(
      "product is required (e.g. 'matte black ceramic coffee mug')",
    );
  }
  const surface =
    typeof a.surface === 'string' && a.surface.trim()
      ? a.surface.trim()
      : 'soft white seamless backdrop';
  const angle =
    typeof a.angle === 'string' && a.angle.trim()
      ? a.angle.trim()
      : 'three-quarter angle';

  const prompt = PROMPT_TEMPLATE({ product, surface, angle });
  return callFamilyProvider(ctx, a, prompt, 'text_to_image', `Product photo: ${product.slice(0, 60)}`);
}

async function callFamilyProvider(ctx, a, prompt, capability, summaryPrefix) {
  const preferred =
    typeof a.provider === 'string' && a.provider.trim()
      ? providerToSkillId(a.provider.trim())
      : providerToSkillId(ctx.skillInputs?.preferred_provider ?? 'openai');

  const resolveRes = await fetch(
    `${SUPERVISOR_BASE}/skills/family-resolve?family=ai_image&capability=${encodeURIComponent(capability)}` +
      (preferred ? `&preferred=${encodeURIComponent(preferred)}` : ''),
  );
  if (!resolveRes.ok) {
    return { ok: false, error: `family_resolve_failed ${resolveRes.status}` };
  }
  const resolved = await resolveRes.json();
  if (!resolved.provider_id) {
    const need = resolved.missing_keys?.join(', ') || '(none configured)';
    return {
      ok: false,
      error: `no AI image provider is configured for ${capability}. Configure one of: ${need} in Settings → Vault Keys.`,
      missing_keys: resolved.missing_keys,
      available_providers: resolved.available_providers,
    };
  }
  const skillId = resolved.provider_id;
  const res = await fetch(
    `${SUPERVISOR_BASE}/skills/${encodeURIComponent(skillId)}/run`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: { prompt } }),
    },
  );
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
    summary: `${summaryPrefix} via ${skillId}`,
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
