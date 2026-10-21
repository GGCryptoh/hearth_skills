import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, assertPublicMediaUrl } from '../free/twilio-sms/handler.js';

const ctx = {
  skillInputs: { TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+15550000000' },
};
const args = { to: '+15551234567', body: 'hello' };

async function withTwilio(fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json');
    calls.push(new URLSearchParams(init.body.toString()));
    return new Response(JSON.stringify({ sid: 'SM1', status: 'queued', to: '+15551234567', from: '+15550000000' }), { status: 201 });
  };
  try { await fn(calls); } finally { globalThis.fetch = original; }
}

test('plain SMS still sends and reports no media', async () => {
  await withTwilio(async (calls) => {
    const r = await run(ctx, args);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].get('Body'), 'hello');
    assert.equal(calls[0].has('MediaUrl'), false);
    assert.deepEqual(r.media_urls, []);
    assert.match(r.summary, /\(no media\)/);
  });
});

test('public https media_url is forwarded as MediaUrl', async () => {
  await withTwilio(async (calls) => {
    const r = await run(ctx, { ...args, media_url: ['https://cdn.example.com/a.png', 'https://files.example.org/b.jpg '] });
    assert.deepEqual(calls[0].getAll('MediaUrl'), ['https://cdn.example.com/a.png', 'https://files.example.org/b.jpg']);
    assert.equal(r.media_urls.length, 2);
    assert.match(r.summary, /with 2 MMS media URLs/);
  });
});

const REJECTED = [
  ['invented hearth.local', 'https://hearth.local/collateral/coll-1/raw', /\.local hosts/],
  ['http scheme', 'http://cdn.example.com/a.png', /scheme must be https/],
  ['localhost', 'https://localhost:3417/collateral/x/raw', /localhost/],
  ['sub.localhost', 'https://api.localhost/x.png', /localhost/],
  ['loopback ip', 'https://127.0.0.1:3417/collateral/x/raw', /private \/ loopback/],
  ['rfc1918 10/8', 'https://10.0.0.5/x.png', /private \/ loopback/],
  ['rfc1918 172.16/12', 'https://172.20.1.1/x.png', /private \/ loopback/],
  ['rfc1918 192.168/16', 'https://192.168.1.22/x.png', /private \/ loopback/],
  ['link-local', 'https://169.254.1.1/x.png', /private \/ loopback/],
  ['cgnat (tailscale 100.64/10)', 'https://100.100.1.1/x.png', /private \/ loopback/],
  ['public bare ip', 'https://8.8.8.8/x.png', /bare IP addresses/],
  ['ipv6 literal', 'https://[::1]/x.png', /IPv6/],
  ['tailnet', 'https://mac-mini.tail439706.ts.net/collateral/x/raw', /ts\.net/],
  ['single label', 'https://macmini/x.png', /single-label/],
  ['.internal', 'https://files.internal/x.png', /\.internal hosts/],
  ['data url', 'data:image/png;base64,AAAA', /scheme must be https/],
  ['garbage', 'not a url', /not a valid URL/],
  ['credentials', 'https://user:pw@cdn.example.com/x.png', /credentials/],
];

for (const [name, url, why] of REJECTED) {
  test(`media_url ${name} is rejected before Twilio is called`, async () => {
    await withTwilio(async (calls) => {
      await assert.rejects(run(ctx, { ...args, media_url: url }), why);
      await assert.rejects(run(ctx, { ...args, media_url: url }), /publicly reachable https URL.*Telegram or by email/);
      await assert.rejects(run(ctx, { ...args, media_url: url }), /SMS not sent/);
      assert.equal(calls.length, 0);
    });
  });
}

test('a bad second media_url blocks the whole send', async () => {
  await withTwilio(async (calls) => {
    await assert.rejects(run(ctx, { ...args, media_url: ['https://cdn.example.com/a.png', 'https://hearth.local/b.png'] }), /media_url rejected/);
    assert.equal(calls.length, 0);
  });
});

test('more than 10 media urls is refused', async () => {
  await withTwilio(async (calls) => {
    await assert.rejects(run(ctx, { ...args, media_url: Array(11).fill('https://cdn.example.com/a.png') }), /at most 10/);
    assert.equal(calls.length, 0);
  });
});

test('non-string media_url entries are refused', async () => {
  await withTwilio(async (calls) => {
    await assert.rejects(run(ctx, { ...args, media_url: [42] }), /non-empty https URL string/);
    assert.equal(calls.length, 0);
  });
});

test('assertPublicMediaUrl returns the normalised href for a good URL', () => {
  assert.equal(assertPublicMediaUrl('https://CDN.Example.com/a.png'), 'https://cdn.example.com/a.png');
});
