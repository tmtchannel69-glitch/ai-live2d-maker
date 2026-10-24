// Server-only, OFFLINE request construction for the existing two-call pilot.
// This module does not read API keys, authorize billing, send network requests,
// or imply that the resulting envelope is approved for execution.
import {createHash} from 'node:crypto';

const need=(condition, reason)=>{if(!condition)throw new Error(reason);};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash64=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const allowedModels=new Set(['gpt-image-1.5','gpt-image-2.5-flare-2026-09-08','gpt-image-2.5-sunburst-2026-09-08']);
const baseFields=['model','n','size','quality','background','output_format','prompt'];
const pngSignature=Buffer.from('89504e470d0a1a0a','hex');
const imageLimit=8*1024*1024;

function checkPng(input,label){
  need(input instanceof Uint8Array&&input.byteLength>=33&&input.byteLength<=imageLimit,label+': invalid image size');
  const bytes=Buffer.from(input.buffer,input.byteOffset,input.byteLength);
  need(bytes.subarray(0,8).equals(pngSignature)&&bytes.toString('ascii',12,16)==='IHDR'&&
    bytes.readUInt32BE(8)===13&&bytes.readUInt32BE(16)===1024&&bytes.readUInt32BE(20)===1024&&
    bytes[24]===8&&bytes[25]===6,label+': expected a 1024x1024 8-bit RGBA PNG');
  return bytes;
}
function requirePlan(plan){
  need(plan?.format==='ai-live2d-openai-image-pilot'&&plan.version===2&&hash64(plan.plan_id)&&
    allowedModels.has(plan.model)&&plan.trial_counts?.maximum_requests===2&&plan.trial_counts?.base_requests===2&&
    plan.budget_policy?.owner_approved===false&&plan.budget_policy?.permitted_calls===0&&
    plan.cost?.permitted_api_calls===0, 'Use the unchanged, unapproved two-call plan');
  need(Array.isArray(plan.requests)&&plan.requests.length===2&&plan.requests[0]?.id==='reference'&&
    plan.requests[1]?.id==='iris_l'&&plan.requests[0].operation==='generate'&&plan.requests[1].operation==='edit',
    'Unexpected pilot request sequence');
  for(const [i,r] of plan.requests.entries()){
    const expected=i===0?'https://api.openai.com/v1/images/generations':'https://api.openai.com/v1/images/edits';
    need(r.endpoint===expected&&r.method==='POST'&&r.fields?.model===plan.model&&r.fields.n===1&&
      r.fields.size==='1024x1024'&&r.fields.quality==='medium'&&r.fields.background==='transparent'&&
      r.fields.output_format==='png'&&typeof r.fields.prompt==='string'&&r.fields.prompt.length<=32000&&
      r.fields.prompt.length>0, 'Unexpected API endpoint or image-generation settings');
    const expectedKeys=i===1&&plan.model==='gpt-image-1.5'?[...baseFields,'input_fidelity']:baseFields;
    need(Object.keys(r.fields).sort().join(',')===expectedKeys.sort().join(','), 'Unknown API fields in pilot request');
    if(i===1&&plan.model==='gpt-image-1.5')need(r.fields.input_fidelity==='high','Expected documented high fidelity setting');
  }
  need(plan.requests[0].images?.length===0&&plan.requests[1].images?.length===2&&
    plan.requests[1].images[0].asset==='raw/reference.png'&&
    plan.requests[1].images[1].asset==='guides/iris_l.png'&&
    plan.requests[1].role==='iris_l', 'Pilot attachments have changed');
  return plan;
}
function commonResult(plan,request,body,contentType,images=[]){
  return {plan_id:plan.plan_id,job:request.id,endpoint:request.endpoint,method:'POST',
    content_type:contentType,body,attachments:images,request_prepared_offline:true,
    authenticated:false,api_key_attached:false,authorized_to_send:false,network_request_sent:false};
}

export function prepareReferenceRequest(plan){
  requirePlan(plan);
  const r=plan.requests[0];
  return commonResult(plan,r,JSON.stringify(r.fields),'application/json');
}

export function prepareIrisRequest(plan,{referencePng,guidePng,frozenReferenceSha256}={}){
  requirePlan(plan);
  need(hash64(frozenReferenceSha256),'Explicit frozen SHA-256 of the approved reference is required');
  const reference=checkPng(referencePng,'reference'),guide=checkPng(guidePng,'guide');
  const actualRef=sha256(reference),actualGuide=sha256(guide),r=plan.requests[1];
  need(actualRef===frozenReferenceSha256,'Canonical reference changed since visual review');
  need(r.images[1].sha256===actualGuide&&hash64(r.images[1].sha256),
    'Guide differs from the fingerprint recorded in the prepared plan');
  need(r.images[0].sha256===null&&plan.reference_binding?.sha256===null,
    'Do not alter the frozen blueprint; keep actual reference identity in the execution record');
  const form=new FormData();
  for(const [key,value] of Object.entries(r.fields))form.append(key,String(value));
  form.append('image[]',new Blob([reference],{type:'image/png'}),'reference.png');
  form.append('image[]',new Blob([guide],{type:'image/png'}),'iris_l-guide.png');
  // Caller must allow the HTTP client to set the multipart boundary itself.
  return commonResult(plan,r,form,null,[
    {role:'canonical-reference',sha256:actualRef,bytes:reference.length},
    {role:'geometry-guide',sha256:actualGuide,bytes:guide.length}
  ]);
}

export function parseImageResponseOffline(raw,{job}={}){
  need(job==='reference'||job==='iris_l','Unknown response job');
  need(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Array.isArray(raw.data)&&raw.data.length===1,
    'Expected exactly one image in the response');
  const encoded=raw.data[0]?.b64_json;
  need(typeof encoded==='string'&&encoded.length>0&&encoded.length<=12*1024*1024&&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded),
    'Expected bounded, standard base64 image bytes');
  const png=checkPng(Buffer.from(encoded,'base64'), 'response');
  need(png.toString('base64')===encoded, 'Non-canonical base64 payload');
  // Recorded usage is informational; it is not an authenticated invoice or a budget cap.
  const usage=raw.usage&&typeof raw.usage==='object'?Object.fromEntries(
    ['input_tokens','output_tokens','total_tokens'].filter(k=>Number.isSafeInteger(raw.usage[k])&&raw.usage[k]>=0).map(k=>[k,raw.usage[k]])
  ):null;
  return {job,png:new Uint8Array(png),sha256:sha256(png),bytes:png.length,usage,
    decoded_offline:true,ai_provenance_verified:false,cost_verified:false,
    note:'A valid response-shaped object is not proof of an actual API call or of visual quality.'};
}
