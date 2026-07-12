// Slack — Send Message.
//
// Posts a single message to a Slack channel via the Web API method
// chat.postMessage. Bring your own SLACK_BOT_TOKEN (bot token with the
// chat:write scope). The bot must be a member of the target channel.
//
// Args (from /skills/:id/run body, the agent, or a routine step):
//   text     string   required — message body (Slack mrkdwn supported)
//   channel  string   optional — channel id (C0123ABCD) or #name; falls
//                      back to the configured default_channel
//
// Vault config:
//   SLACK_BOT_TOKEN   secret — Bot User OAuth Token (xoxb-…)
//   default_channel   text   — used when args.channel is absent
//
// Returns: { ok: true, channel, ts, summary, text }
// Throws on missing token, missing channel/text, transport error, or a
// Slack API error (Slack returns HTTP 200 with { ok:false, error } — we
// surface the error string, e.g. 'not_in_channel', 'channel_not_found').

const API_URL = 'https://slack.com/api/chat.postMessage';

export async function run(ctx, args) {
  const a = args && typeof args === 'object' ? args : {};

  const token = ctx.providerEnv?.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error(
      'SLACK_BOT_TOKEN missing — add your Slack bot token (xoxb-…) under Vault → API Keys',
    );
  }

  const text = typeof a.text === 'string' ? a.text.trim() : '';
  if (!text) {
    throw new Error('text is required (the message to post)');
  }

  const channel =
    (typeof a.channel === 'string' && a.channel.trim().length > 0
      ? a.channel.trim()
      : null) ??
    (typeof ctx.skillInputs?.default_channel === 'string' &&
    ctx.skillInputs.default_channel.trim().length > 0
      ? ctx.skillInputs.default_channel.trim()
      : null);
  if (!channel) {
    throw new Error(
      'No channel — pass a channel (id or #name) or set a default channel in the Slack skill gear panel',
    );
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel, text }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Slack HTTP ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const err = typeof data.error === 'string' ? data.error : 'unknown_error';
    const hint =
      err === 'not_in_channel'
        ? ' — invite the bot to that channel first'
        : err === 'channel_not_found'
          ? ' — check the channel id/name'
          : err === 'invalid_auth' || err === 'not_authed'
            ? ' — the bot token is invalid or missing the chat:write scope'
            : '';
    throw new Error(`Slack API error: ${err}${hint}`);
  }

  return {
    ok: true,
    channel: data.channel ?? channel,
    ts: data.ts ?? null,
    summary: `Posted to Slack channel ${data.channel ?? channel}.`,
    text: `Message posted to ${data.channel ?? channel}.`,
  };
}
