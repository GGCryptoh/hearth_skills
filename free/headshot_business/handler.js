// Business Headshot — preset prompt + route through configured provider.
//
// Args:
//   subject     string  required — person description ("woman, 30s, brown hair,
//                                   confident smile")
//   wardrobe    string  optional — clothing override (default "navy blazer
//                                   over white shirt")
//   background  string  optional — background override (default "soft grey
//                                   studio backdrop")
//   provider    string  optional — override the configured default
//
// Returns: { ok, image_url, summary, provider_used }

const PROMPT_TEMPLATE = (parts) =>
  `Professional corporate headshot, ${parts.subject}, wearing ${parts.wardrobe}, ` +
  `${parts.background}, soft natural lighting, 35mm portrait lens look, ` +
  `crisp focus on face, neutral expression, looking at camera, ` +
  `editorial magazine quality, no distracting elements.`;

const SUPERVISOR_BASE = 'http://127.0.0.1:3417';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const subject = typeof a.subject === 'string' ? a.subject.trim() : '';
  if (!subject) {
    throw new Error("subject is required (e.g. 'woman, 30s, brown hair, confident smile')");
  }

  const wardrobe =
    typeof a.wardrobe === 'string' && a.wardrobe.trim()
      ? a.wardrobe.trim()
      : 'navy blazer over white shirt';
  const background =
    typeof a.background === 'string' && a.background.trim()
      ? a.background.trim()
      : 'soft grey studio backdrop';

  const prompt = PROMPT_TEMPLATE({ subject, wardrobe, background });

  // M82 — route through the supervisor's family-resolve so we pick a
  // provider that is BOTH configured (key in vault) AND capable
  // (declares text_to_image). Founder's preferred_provider setting
  // wins when it qualifies; else first usable; else surface the
  // missing keys so the caller knows what to configure.
  const preferred =
    typeof a.provider === 'string' && a.provider.trim()
      ? providerToSkillId(a.provider.trim())
      : providerToSkillId(ctx.skillInputs?.preferred_provider ?? 'openai');

  const resolveRes = await fetch(
    `${SUPERVISOR_BASE}/skills/family-resolve?family=ai_image&capability=text_to_image` +
      (preferred ? `&preferred=${encodeURIComponent(preferred)}` : ''),
  );
  if (!resolveRes.ok) {
    return {
      ok: false,
      error: `family_resolve_failed ${resolveRes.status}`,
    };
  }
  const resolved = await resolveRes.json();
  if (!resolved.provider_id) {
    const need = resolved.missing_keys?.join(', ') || '(none configured)';
    return {
      ok: false,
      error: `no AI image provider is configured for text_to_image. Configure one of: ${need} in Settings → Vault Keys.`,
      missing_keys: resolved.missing_keys,
      available_providers: resolved.available_providers,
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
    summary: `Business headshot via ${skillId}: ${subject.slice(0, 60)}`,
  };
}

/** Maps a friendly setting value to the actual skill id. */
function providerToSkillId(provider) {
  const map = {
    openai: 'create-images-openai',
    kie: 'kie_image',
    higgsfield: 'higgsfield_image',
  };
  return map[provider] ?? provider;
}
