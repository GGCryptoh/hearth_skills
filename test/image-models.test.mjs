import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requestImage } from '../free/create-images-openai/image-models.js';
const ctx = { skillInputs: { OPENAI_IMAGE_MODEL: 'gpt-image-2.5-flare', OPENAI_IMAGE_FALLBACK_MODEL: 'gpt-image-2' } };
const ok = () => Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] });
test('fallback only for definite model unavailability', async () => {
  const calls = [];
  const result = await requestImage(ctx, async model => {
    calls.push(model);
    return calls.length === 1 ? Response.json({ error: { code: 'model_not_found' } }, { status: 404 }) : ok();
  });
  assert.deepEqual(calls, ['gpt-image-2.5-flare','gpt-image-2']);
  assert.equal(result.model, 'gpt-image-2');
  assert.match(result.fallbackReason, /model_not_found/);
});
for (const [status,code] of [[401,'model_not_found'],[429,'insufficient_quota'],[400,'moderation_blocked'],[500,'model_not_found'],[403,'permission_denied']]) {
  test(`no fallback for ${status}/${code}`, async () => {
    let calls = 0;
    await assert.rejects(requestImage(ctx, async () => { calls++; return Response.json({error:{code}}, {status}); }));
    assert.equal(calls, 1);
  });
}
test('no network retry and no implicit fallback', async () => {
  let calls = 0;
  await assert.rejects(requestImage(ctx, async () => { calls++; throw Error('timeout'); }));
  assert.equal(calls, 1);
  await assert.rejects(requestImage({}, async model => { assert.equal(model,'gpt-image-2'); return Response.json({error:{code:'model_not_found'}},{status:404}); }));
});
test('transparent images never silently lose transparency', async () => {
  let calls = 0;
  await assert.rejects(requestImage({}, async () => { calls++; return ok(); }, {transparent:true}), /transparent/);
  assert.equal(calls,0);
  const result = await requestImage({skillInputs:{OPENAI_IMAGE_FALLBACK_MODEL:'gpt-image-2.5-flare'}}, async model => {assert.equal(model,'gpt-image-2.5-flare'); return ok();}, {transparent:true});
  assert.match(result.fallbackReason,/transparent/);
});
for (const skill of ['create-images-openai','cat-selfie-maker','dog-selfie-maker']) {
  test(`${skill} sends saved preference and records actual model`, async () => {
    const {run} = await import(`../free/${skill}/handler.js`);
    const original = globalThis.fetch;
    let metadata;
    globalThis.fetch = async (_url, init) => { assert.equal(JSON.parse(init.body).model,'gpt-image-2.5-flare'); return ok(); };
    try {
      const result = await run({...ctx,providerEnv:{OPENAI_API_KEY:'test'},vault:{upsertCollateral:async row => {metadata=JSON.parse(row.metadata);return row;}}}, {prompt:'A tree'});
      assert.equal(result.model,'gpt-image-2.5-flare');
      assert.equal(metadata.model,result.model);
      assert.match(result.summary,/gpt-image-2.5-flare/);
    } finally { globalThis.fetch = original; }
  });
}
test('editing sends selected model and mask in multipart form', async () => {
  const {run} = await import('../free/create-images-openai/handler.js');
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {assert.match(url,/edits$/);assert.equal(init.body.get('model'),'gpt-image-2.5-flare');assert.ok(init.body.get('mask'));return ok();};
  try { const result=await run({...ctx,providerEnv:{OPENAI_API_KEY:'test'}},{prompt:'Edit',image_data_url:'data:image/png;base64,aW1hZ2U=',mask_url:'data:image/png;base64,aW1hZ2U='});assert.equal(result.mode,'inpaint'); } finally {globalThis.fetch=original;}
});
test('packaged helpers stay identical', async () => {
  const files=await Promise.all(['create-images-openai','cat-selfie-maker','dog-selfie-maker'].map(s=>readFile(new URL(`../free/${s}/image-models.js`,import.meta.url),'utf8')));
  assert.equal(files[0],files[1]);assert.equal(files[0],files[2]);
});
