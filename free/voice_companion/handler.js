// Voice Companion — marketplace skill manifest and config gateway.
//
// This skill has no direct CLI invocation path. It's a container for the
// voice_companion config (vault_inputs for voice, mic_mode, daily_minutes_cap,
// avatar selection) and the feature gate for the /dashboard/companion surface.
//
// The actual realtime voice loop is built into the dashboard and supervisor:
//   - Browser: WebRTC directly to OpenAI Realtime (no audio relay)
//   - Supervisor: POST /companion/session (mint ephemeral token + daily cap check)
//                 POST /companion/tool-call (risk gate + skill dispatch)
//                 SSE /chat/stream (mood reactivity)
//
// If the skill is invoked directly (via chat, tests, or MCP), this handler
// returns an honest response: "this skill gates the voice surface, not callable
// as a standalone skill."

export async function run(ctx, args) {
  return {
    ok: true,
    message:
      'Voice Companion gates the /dashboard/companion realtime voice surface. ' +
      'Enable the skill and visit /dashboard/companion to start a voice session. ' +
      'Tool calls and approval decisions route through your existing skills + approvals rail.',
    meta: {
      feature: 'voice_companion',
      ephemeral_token_mint: 'POST /companion/session',
      tool_call_dispatch: 'POST /companion/tool-call',
      architecture_doc: 'docs/VOICE-COMPANION-Design.md',
    },
  };
}
