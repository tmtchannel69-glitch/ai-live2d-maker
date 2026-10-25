import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareReferenceRequest,prepareIrisRequest,parseImageResponseOffline} from '../../server/ai-image-pilot/request-contract.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Header-only fixtures check the envelope contract, NOT full PNG decoding.
// Production-quality inspection requires the separate fast-png checker.
const image=()=>{const b=Buffer.alloc(64);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(1024,16);b.writeUInt32BE(1024,20);b[24]=8;b[25]=6;return b;};
const reference=image(),guide=image();guide[40]=7;
const base={model:'gpt-image-2.5-flare-2026-09-08',n:1,size:'1024x1024',quality:'medium',background:'transparent',output_format:'png',prompt:'Draw this anime maid character.'};
const plan={format:'ai-live2d-openai-image-pilot',version:2,plan_id:'a'.repeat(64),model:base.model,
  budget_policy:{owner_approved:false,permitted_calls:0},cost:{permitted_api_calls:0},
  trial_counts:{base_requests:2,maximum_requests:2},reference_binding:{sha256:null},
  requests:[{id:'reference',operation:'generate',endpoint:'https://api.openai.com/v1/images/generations',method:'POST',fields:base,images:[]},
  {id:'iris_l',role:'iris_l',operation:'edit',endpoint:'https://api.openai.com/v1/images/edits',method:'POST',fields:{...base,prompt:'Only iris'},images:[
    {asset:'raw/reference.png',sha256:null},{asset:'guides/iris_l.png',sha256:hash(guide)}]}]};
test('reference envelope is JSON without secret or send behavior',()=>{
  const r=prepareReferenceRequest(plan);assert.equal(r.network_request_sent,false);assert.equal(r.authorized_to_send,false);
  assert.equal(r.api_key_attached,false);assert.equal(r.content_type,'application/json');
  assert.deepEqual(JSON.parse(r.body),base);assert.equal(r.job,'reference');
});
test('iris envelope has two ordered attachments, matched to reference fingerprint and guide',async()=>{
  const r=prepareIrisRequest(plan,{referencePng:reference,guidePng:guide,frozenReferenceSha256:hash(reference)});
  assert.equal(r.network_request_sent,false);assert.equal(r.content_type,null);
  assert.equal(r.body.getAll('image[]').length,2);
  assert.equal(r.body.get('model'),base.model);
  assert.equal(r.attachments[0].sha256,hash(reference));
  assert.deepEqual(Buffer.from(await r.body.getAll('image[]')[0].arrayBuffer()),reference);
  assert.deepEqual(Buffer.from(await r.body.getAll('image[]')[1].arrayBuffer()),guide);
});
test('rejects modified identity, guide, expanded calls, approval and unsafe fields',()=>{
  const a={referencePng:reference,guidePng:guide,frozenReferenceSha256:'b'.repeat(64)};
  assert.throws(()=>prepareIrisRequest(plan,a),/Canonical reference/);
  assert.throws(()=>prepareIrisRequest(plan,{...a,frozenReferenceSha256:hash(reference),guidePng:reference}),/Guide differs/);
  assert.throws(()=>prepareReferenceRequest({...plan,budget_policy:{owner_approved:true,permitted_calls:1}}));
  assert.throws(()=>prepareReferenceRequest({...plan,trial_counts:{base_requests:2,maximum_requests:3}}));
  assert.throws(()=>prepareReferenceRequest({...plan,requests:[{...plan.requests[0],fields:{...base,extra:1}},plan.requests[1]]}));
});
test('offline response parsing rejects multiple images and flags provenance/billing as unverified',()=>{
  const result=parseImageResponseOffline({data:[{b64_json:reference.toString('base64')}],usage:{input_tokens:17,output_tokens:30}},{job:'reference'});
  assert.equal(result.sha256,hash(reference));assert.equal(result.ai_provenance_verified,false);assert.equal(result.cost_verified,false);
  assert.equal(result.usage.input_tokens,17);
  assert.throws(()=>parseImageResponseOffline({data:[{},{}]},{job:'reference'}));
  assert.throws(()=>parseImageResponseOffline({data:[{b64_json:'not-base64'}]},{job:'iris_l'}));
});