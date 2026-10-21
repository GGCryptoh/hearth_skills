import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../free/resend-email/handler.js';

const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const base64 = bytes.toString('base64');
const args = { to: 'owner@example.com', subject: 'Dog selfie', text: 'Photo attached.' };
const ctx = {
  providerEnv: { RESEND_API_KEY: 'test' },
  skillInputs: { from_email: 'sender@example.com', default_subject_prefix: '[Hearth] ' },
};
const RESEND = 'https://api.resend.com/emails';
const RAW = (id) => `http://127.0.0.1:3417/collateral/${id}/raw`;

// Stub fetch: Resend POSTs are recorded in `calls`; supervisor /raw GETs are
// answered by `raw(id)` (default: 404) and recorded in `rawCalls`.
async function withFetch(fn, raw = async () => new Response('{"error":"not_found"}', { status: 404 })) {
  const original = globalThis.fetch;
  const calls = [];
  const rawCalls = [];
  globalThis.fetch = async (url, init) => {
    const m = String(url).match(/^http:\/\/127\.0\.0\.1:3417\/collateral\/([^/]+)\/raw$/);
    if (m) { rawCalls.push(decodeURIComponent(m[1])); return raw(decodeURIComponent(m[1])); }
    assert.equal(url, RESEND);
    calls.push(JSON.parse(init.body));
    return Response.json({ id: 'email-123' });
  };
  try { await fn(calls, rawCalls); } finally { globalThis.fetch = original; }
}

test('dog selfie collateral is embedded as exact bytes before the Resend POST', async () => {
  await withFetch(async (calls) => {
    const result = await run({ ...ctx, vault: { getCollateral: async (id) => {
      assert.equal(id, 'coll-dog');
      assert.equal(calls.length, 0);
      return { kind: 'image', content: `data:image/png;base64,${base64}` };
    } } }, { ...args, attachments: [{ filename: 'dog-selfie.png', collateral_id: 'coll-dog' }] });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].attachments, [{ filename: 'dog-selfie.png', content: base64 }]);
    assert.deepEqual(Buffer.from(calls[0].attachments[0].content, 'base64'), bytes);
    assert.equal(calls[0].subject, '[Hearth] Dog selfie');
    assert.equal(result.id, 'email-123');
    assert.equal(result.attachment_count, 1);
    assert.deepEqual(result.attachment_filenames, ['dog-selfie.png']);
    assert.deepEqual(result.attachments, [{ filename: 'dog-selfie.png', bytes: 8, source: 'collateral:coll-dog' }]);
    assert.equal(result.attachment_bytes_total, 8);
    assert.match(result.summary, /with 1 attachment: dog-selfie\.png \(8 B\)/);
  });
});

for (const key of ['collateral_id', 'attachment_collateral_id']) {
  test(`${key} attaches a saved data URL without a filename`, async () => {
    await withFetch(async (calls) => {
      await run({ ...ctx, vault: { getCollateral: async () => ({ content: `data:image/png;base64,${base64}` }) } }, { ...args, [key]: 'coll-dog' });
      assert.deepEqual(calls[0].attachments, [{ filename: 'attachment.png', content: base64 }]);
    });
  });
}

test('top-level collateral_id honours attachment_filename', async () => {
  await withFetch(async (calls) => {
    const result = await run({ ...ctx, vault: { getCollateral: async () => ({ content: `data:image/png;base64,${base64}` }) } },
      { ...args, collateral_id: 'coll-dog', attachment_filename: 'dog-selfie.png' });
    assert.deepEqual(calls[0].attachments, [{ filename: 'dog-selfie.png', content: base64 }]);
    assert.match(result.summary, /dog-selfie\.png \(8 B\)/);
  });
});

test('peer file metadata base64 attaches correctly', async () => {
  await withFetch(async (calls) => {
    await run({ ...ctx, vault: { getCollateral: async () => ({ kind: 'image', content: base64, metadata: JSON.stringify({ encoding: 'base64', mime_type: 'image/png' }) }) } }, { ...args, collateral_id: 'peer-file' });
    assert.deepEqual(calls[0].attachments, [{ filename: 'attachment.png', content: base64 }]);
  });
});

test('without ctx.vault the collateral is fetched from GET /collateral/:id/raw', async () => {
  await withFetch(async (calls, rawCalls) => {
    const result = await run(ctx, { ...args, collateral_id: 'coll dog', attachment_filename: 'dog-selfie.png' });
    assert.deepEqual(rawCalls, ['coll dog']);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].attachments, [{ filename: 'dog-selfie.png', content: base64 }]);
    assert.deepEqual(result.attachments, [{ filename: 'dog-selfie.png', bytes: 8, source: 'collateral:coll dog' }]);
    assert.match(result.summary, /with 1 attachment: dog-selfie\.png \(8 B\)/);
  }, async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }));
});

test('raw fallback derives the filename extension from content-type', async () => {
  await withFetch(async (calls) => {
    await run(ctx, { ...args, collateral_id: 'coll-dog' });
    assert.deepEqual(calls[0].attachments, [{ filename: 'attachment.png', content: base64 }]);
  }, async () => new Response(bytes, { headers: { 'content-type': 'image/png; charset=binary' } }));
});

test('existing base64, hosted URL and routine data URL attachments are preserved together', async () => {
  await withFetch(async (calls) => {
    const result = await run(ctx, { ...args,
      attachments: [{ filename: 'photo.png', content: base64 }, { filename: 'report.pdf', path: 'https://example.com/report.pdf' }],
      attachment_data_url: `data:image/png;base64,${base64}`, attachment_filename: 'routine.png',
    });
    assert.deepEqual(calls[0].attachments, [
      { filename: 'photo.png', content: base64 }, { filename: 'report.pdf', path: 'https://example.com/report.pdf' },
      { filename: 'routine.png', content: base64 },
    ]);
    assert.deepEqual(result.attachments, [
      { filename: 'photo.png', bytes: 8, source: 'content' },
      { filename: 'report.pdf', bytes: null, source: 'path' },
      { filename: 'routine.png', bytes: 8, source: 'data_url' },
    ]);
    assert.match(result.summary, /with 3 attachments: photo\.png \(8 B\), report\.pdf \(hosted URL\), routine\.png \(8 B\)/);
  });
});

test('text collateral and plain data URLs encode UTF-8 bytes', async () => {
  await withFetch(async (calls) => {
    await run({ ...ctx, vault: { getCollateral: async () => ({ kind: 'note', content: 'hello 🐕', metadata: 'legacy' }) } }, {
      ...args, collateral_id: 'note', attachment_data_url: 'data:text/plain,hello%20%F0%9F%90%95',
    });
    for (const attachment of calls[0].attachments) {
      assert.equal(Buffer.from(attachment.content, 'base64').toString('utf8'), 'hello 🐕');
    }
  });
});

const UNRESOLVED = /attachment unresolved: collateral .* — email not sent/;
for (const [name, vault, extra, error, raw] of [
  ['missing row', { getCollateral: async () => null }, { collateral_id: 'coll-dog' }, /not found or empty/],
  ['empty row', { getCollateral: async () => ({ content: '' }) }, { collateral_id: 'coll-dog' }, /not found or empty/],
  ['unreadable vault', { getCollateral: async () => { throw Error('locked'); } }, { collateral_id: 'coll-dog' }, /locked/],
  ['invalid image data', { getCollateral: async () => ({ content: 'data:image/png;base64,!!!' }) }, { collateral_id: 'coll-dog' }, /invalid data URL/],
  ['remote image collateral', { getCollateral: async () => ({ content: 'http://hearth.local/image.png', kind: 'image' }) }, { collateral_id: 'coll-dog' }, /no local file bytes/],
  ['raw 404', undefined, { collateral_id: 'coll-dog' }, /HTTP 404/],
  ['raw 404 in attachments array', undefined, { attachments: [{ filename: 'dog.png', collateral_id: 'missing' }] }, /HTTP 404/],
  ['raw empty body', undefined, { collateral_id: 'coll-dog' }, /zero bytes/, async () => new Response('', { status: 200 })],
  ['raw unreachable', undefined, { collateral_id: 'coll-dog' }, /could not be fetched/, async () => { throw new Error('ECONNREFUSED'); }],
  ['raw too large', undefined, { collateral_id: 'coll-dog' }, /over Resend's 40 MB cap/, async () => new Response(Buffer.alloc(40 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } })],
  ['malformed array', undefined, { attachments: {} }, /must be an array/],
  ['null array entry', undefined, { attachments: [null] }, /filename/],
  ['unsupported shape', undefined, { attachments: [{ filename: 'dog.png', media_url: 'http://hearth.local/dog' }] }, /exactly one/],
  ['ambiguous source', undefined, { attachments: [{ filename: 'dog.png', content: base64, collateral_id: 'coll-dog' }] }, /exactly one/],
  ['invalid base64', undefined, { attachments: [{ filename: 'dog.png', content: 'broken!' }] }, /base64/],
  ['empty data URL', undefined, { attachment_data_url: 'data:image/png;base64,' }, /valid non-empty data URL/],
  ['invalid data URL', undefined, { attachment_data_url: 'garbage' }, /valid non-empty data URL/],
  ['empty id', undefined, { collateral_id: '' }, /non-empty string/],
  ['null id', undefined, { attachment_collateral_id: null }, /non-empty string/],
  ['ambiguous top-level id', undefined, { collateral_id: 'a', attachment_collateral_id: 'b' }, /either/],
  ['oversized inline attachments', undefined, { attachments: [{ filename: 'big.bin', content: Buffer.alloc(40 * 1024 * 1024 + 1).toString('base64') }] }, /attachment too large: big\.bin \(40\.0 MB\).*email not sent/],
]) {
  test(`${name} prevents sending a partial email`, async () => {
    await withFetch(async (calls) => {
      await assert.rejects(run({ ...ctx, vault }, { ...args, ...extra }), error);
      if (UNRESOLVED.test(name) || /raw|missing row|empty row|invalid image|remote image/.test(name)) {
        await assert.rejects(run({ ...ctx, vault }, { ...args, ...extra }), UNRESOLVED);
      }
      assert.equal(calls.length, 0);
    }, raw);
  });
}

test('a missing second attachment prevents sending the valid first one', async () => {
  await withFetch(async (calls) => {
    await assert.rejects(run({ ...ctx, vault: { getCollateral: async () => null } }, {
      ...args, attachments: [{ filename: 'first.png', content: base64 }, { filename: 'missing.png', collateral_id: 'missing' }],
    }), /not found or empty/);
    assert.equal(calls.length, 0);
  });
});

test('text-only email retains its behavior and reports no attachment', async () => {
  await withFetch(async (calls) => {
    const result = await run(ctx, args);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].attachments, undefined);
    assert.equal(result.attachment_count, 0);
    assert.deepEqual(result.attachments, []);
    assert.match(result.summary, /— no attachment$/);
  });
});

test('Resend rejection does not report success', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('attachment rejected', { status: 422 });
  try {
    await assert.rejects(run(ctx, { ...args, attachments: [{ filename: 'dog.png', content: base64 }] }), /Resend 422/);
  } finally { globalThis.fetch = original; }
});
