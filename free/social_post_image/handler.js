// Social Post Image — 1:1 square image sized for Instagram/LinkedIn.
//
// Args:
//   concept   string  required — what the image should show
//   style     string  optional — "clean modern" | "editorial" | "playful" |
//                                "bold typographic" | …
//   provider  string  optional — override the configured default
//
// Returns: { ok, image_url, summary, provider_used }

const PROMPT_TEMPLATE = (concept, style) =>
  `${concept}, ${style}, social media post composition, ` +
  `1:1 aspect ratio, balanced negative space for caption overlay, ` +
  `high contrast, vibrant but not garish, mobile-thumbnail readable, ` +
  `professional brand-safe visual.`;

const SUPERVISOR_BASE = 'http://127.0.0.1:3417';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};
  const concept = typeof a.concept === 'string' ? a.concept.trim() : '';
  if (!concept) {
    throw new Error("concept is required (e.g. 'launch announcement for our new AI agent platform')");
  }
  const style = typeof a.style === 'string' && a.style.trim() ? a.style.trim() : 'clean modern';
  const provider =
    typeof a.provider === 'string' && a.provider.trim()
      ? a.provider.trim()
      : ctx.skillInputs?.preferred_provider || 'openai';

  const prompt = PROMPT_TEMPLATE(concept, style);
  const skillId = providerToSkillId(provider);
  if (!skillId) {
    throw new Error(`unknown provider: ${provider} (supported: openai, kie, higgsfield)`);
  }

  const res = await fetch(`${SUPERVISOR_BASE}/skills/${encodeURIComponent(skillId)}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      args: {
        prompt,
        aspect: '1:1',
        ratio: '1:1',
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return {
      ok: false,
      provider_used: provider,
      error: `provider ${skillId} returned ${res.status}: ${detail.slice(0, 300)}`,
    };
  }
  const body = await res.json();
  const output = body.output ?? body;
  return {
    ok: true,
    provider_used: provider,
    image_url: output.image_url ?? output.image_b64 ?? null,
    summary: `Social post (${style}) via ${provider}: ${concept.slice(0, 60)}`,
  };
}

function providerToSkillId(provider) {
  const map = {
    openai: 'create-images-openai',
    kie: 'kie_image',
    higgsfield: 'higgsfield_image',
  };
  return map[provider] ?? null;
}
