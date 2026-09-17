// Packaged identically with each OpenAI image skill.
export async function requestImage(ctx, perform, { transparent = false } = {}) {
  const requestedModel = ctx.skillInputs?.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-2';
  const fallback = ctx.skillInputs?.OPENAI_IMAGE_FALLBACK_MODEL?.trim();
  const candidates = [...new Set([requestedModel, fallback].filter(Boolean))];
  let fallbackReason = null;
  for (const [index, model] of candidates.entries()) {
    if (!/^gpt-image-(?:2|2\.5-(?:flare|sunburst))(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) {
      throw new Error(`Unsupported image model: ${model}. Refresh models in Configure Skill.`);
    }
    if (transparent && /^gpt-image-2(?:$|-)/.test(model)) {
      fallbackReason = `${model} does not support transparent backgrounds`;
      if (index + 1 < candidates.length) continue;
      throw new Error(`${fallbackReason}. Select a compatible model in Configure Skill.`);
    }
    const response = await perform(model); // Never retry network errors or ambiguous timeouts.
    if (response.ok) return { data: await response.json(), model, requestedModel, fallbackReason };
    const error = await response.json().catch(() => ({}));
    const code = error?.error?.code;
    // Only definite model availability errors qualify; never auth, quota, moderation or server errors.
    const unavailable = [400, 404].includes(response.status) && code === 'model_not_found';
    if (unavailable && index + 1 < candidates.length) {
      fallbackReason = `${model}: model_not_found`;
      continue;
    }
    throw new Error(`OpenAI image request failed (${response.status}${typeof code === 'string' ? `: ${code}` : ''}).${unavailable ? ' Refresh models in Configure Skill.' : ''}`);
  }
}
