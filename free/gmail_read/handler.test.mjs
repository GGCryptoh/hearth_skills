import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './handler.js';

test('search exposes and accepts pagination until the final page', async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    const next = new URL(url).searchParams.get('pageToken');
    return { ok: true, text: async () => JSON.stringify(next ? { messages: [{ id: 'second' }] } : { messages: [{ id: 'first' }], nextPageToken: 'cursor+2', resultSizeEstimate: 2 }) };
  };
  try {
    const ctx = { providerEnv: { GOOGLE_OAUTH_ACCESS_TOKEN: 'synthetic-test-token' } };
    const first = await run(ctx, { action: 'search', query: 'receipt', max_results: 1 });
    assert.equal(first.complete, false);
    assert.equal(first.next_page_token, 'cursor+2');
    const second = await run(ctx, { action: 'search', query: 'receipt', page_token: first.next_page_token });
    assert.equal(new URL(urls[1]).searchParams.get('pageToken'), 'cursor+2');
    assert.equal(second.complete, true);
    assert.equal(second.next_page_token, null);
    assert.deepEqual([...first.messages, ...second.messages].map(x => x.id), ['first', 'second']);
  } finally { globalThis.fetch = original; }
});
