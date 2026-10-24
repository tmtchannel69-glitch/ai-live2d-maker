import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {decode,encode} from 'fast-png';
import {createPilotPlan,validatePilotPlan,PILOT_ROLES,PILOT_MODEL} from '../../server/ai-image-pilot/plan.mjs';
import {createGuidePng} from '../../server/ai-image-pilot/guides.mjs';
import {inspectPilotPart} from '../../server/ai-image-pilot/quality.mjs';
import {ROOT} from './private-io.mjs';

const run=promisify(execFile),prepare=join(ROOT,'scripts/ai-image-pilot/prepare.mjs'),checker=join(ROOT,'scripts/ai-image-pilot/check-parts.mjs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const plan=await createPilotPlan({name:'Pilot test'}),part=plan.requests.find(r=>r.role==='iris_l');
const rgba=(width=1024,height=1024)=>({width,height,channels:4,depth:8,data:new Uint8Array(width*height*4)});
function fixture(request,{spill=false,opaque=false,opaqueTile=false,empty=false}={}){
  const image=rgba(),q=request.api_rect;
  // Pure structural fixture, never presented as character or AI artwork.
  if(opaque)image.data.fill(255);
  else if(opaqueTile){for(let y=q.y;y<q.y+q.height;y++)for(let x=q.x;x<q.x+q.width;x++)image.data.set([128,128,128,255],(y*1024+x)*4);}
  else if(!empty){image.data.set([79,64,111,73],((q.y+2)*1024+q.x+2)*4);image.data.set([19,29,39,0],((q.y+3)*1024+q.x+3)*4);}
  if(spill)image.data.set([10,20,30,255],0);
  return encode(image);
}

test('pilot reuses one identity and blueprint for generate then five distinct layer edits',async()=>{
  assert.equal(plan.model,PILOT_MODEL);assert.equal(plan.requests.length,6);assert.deepEqual(plan.requests.slice(1).map(r=>r.role),PILOT_ROLES);
  assert.equal(plan.requests[0].content_type,'application/json');assert.deepEqual(plan.requests[0].images,[]);
  for(const request of plan.requests.slice(1)){
    assert.equal(request.endpoint,'https://api.openai.com/v1/images/edits');assert.equal(request.content_type,'multipart/form-data');assert.equal(request.fields.input_fidelity,'high');
    assert.equal(request.images[0].asset,plan.reference_binding.asset);assert.equal(request.images[0].sha256,null);assert.equal(request.images[1].purpose,'geometry-guide-not-character-artwork');
    assert.ok(request.fields.prompt.includes(JSON.stringify(plan.design)));assert.equal(request.api_rect.x,request.part.rect.x+128);assert.equal(request.api_rect.y,request.part.rect.y);
    assert.equal(request.fields.n,1);assert.equal(request.fields.size,'1024x1024');assert.equal(request.fields.background,'transparent');assert.equal(request.fields.output_format,'png');
    assert.equal(request.fields.response_format,undefined);assert.ok(request.fields.prompt.length<=32000);
  }
  assert.equal(plan.trial_counts.base_requests,6);assert.equal(plan.trial_counts.maximum_requests,12);assert.equal(plan.trial_counts.maximum_image_attachments,20);
  assert.equal(plan.retry_policy.automatic_retries,0);assert.equal(plan.cost.estimated_trial_usd,null);assert.equal(plan.cost.maximum_trial_usd,null);
  assert.equal(plan.cost.permitted_api_calls,0);assert.equal(plan.review.api_transport_implemented,false);assert.equal(plan.review.ai_generation_executed,false);
  assert.equal((await createPilotPlan({name:'Pilot test'})).plan_id,plan.plan_id);
});

test('approval flags, endpoint, prompt, role and geometry edits cannot be mistaken for the prepared plan',async()=>{
  const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,reorder(v[k])])):v;
  assert.equal((await validatePilotPlan(reorder(plan))).plan_id,plan.plan_id);
  for(const change of [p=>p.cost.permitted_api_calls=12,p=>p.requests[0].endpoint='https://example.org',p=>p.requests[0].fields.prompt+='new',p=>p.requests[1].part.rect.x++,p=>p.requests[1].role='neck',p=>p.review.ai_generation_executed=true]){
    const p=structuredClone(plan);change(p);await assert.rejects(()=>validatePilotPlan(p));
  }
});

test('PNG structural conversion preserves coordinates, straight RGBA and transparency without an AI or quality verdict',()=>{
  const result=inspectPilotPart(part,fixture(part));assert.equal(result.report.structure_passed,true);assert.equal(result.report.visible_pixels_in_tile,1);
  const tile=decode(result.tile_png);assert.equal(tile.width,part.part.rect.width);assert.equal(tile.height,part.part.rect.height);
  assert.deepEqual(Array.from(tile.data.subarray((2*tile.width+2)*4,(2*tile.width+2)*4+4)),[79,64,111,73]);
  assert.deepEqual(Array.from(tile.data.subarray((3*tile.width+3)*4,(3*tile.width+3)*4+4)),[19,29,39,0]);
  assert.equal(result.report.appearance_quality_passed,false);assert.equal(result.report.ai_provenance_verified,false);assert.equal(result.report.hidden_surface_quality_verified,false);
});

for(const [name,options] of [['empty',{empty:true}],['opaque background',{opaque:true}],['background inside tile',{opaqueTile:true}],['displaced paint',{spill:true}]])test(name+' is a structural failure and is not repaired by cropping',()=>{
  const {report,tile_png}=inspectPilotPart(part,fixture(part,options));assert.equal(report.structure_passed,false);assert.equal(tile_png,null);
});

test('wrong dimensions and RGB-only inputs are rejected before accepting arbitrary PNG geometry',()=>{
  assert.throws(()=>inspectPilotPart(part,encode(rgba(16,16))),/1024x1024/);
  assert.throws(()=>inspectPilotPart(part,encode({width:1024,height:1024,channels:3,depth:8,data:new Uint8Array(1024*1024*3)})),/RGBA/);
  assert.throws(()=>inspectPilotPart(part,new Uint8Array(9*1024*1024)),/8MiB/);
});

test('technical guide pixels cannot become semantic, hidden-surface or real-AI success',()=>{
  const guide=createGuidePng(part.part),audit=inspectPilotPart(part,guide).report;
  assert.equal(audit.structure_passed,true);assert.equal(audit.appearance_quality_passed,false);assert.equal(audit.ai_provenance_verified,false);assert.equal(audit.color_line_consistency_verified,false);
});

test('CLI prepares real technical PNGs and exact request attachments without reading a key or executing any API',async t=>{
  const temp=await mkdtemp(join(tmpdir(),'ai-image-pilot-test-'));t.after(()=>rm(temp,{recursive:true,force:true}));const output=join(temp,'prepared');
  const env={...process.env,OPENAI_API_KEY:'test-only-secret-must-not-be-read-or-written'};
  const result=await run(process.execPath,[prepare,'--output',output],{cwd:ROOT,env});assert.equal(JSON.parse(result.stdout).api_key_read,false);
  const prepared=await validatePilotPlan(JSON.parse(await readFile(join(output,'pilot_plan.json'),'utf8')));
  assert.equal(prepared.review.external_requests_sent,0);assert.equal((await readdir(join(output,'guides'))).length,5);
  for(const request of prepared.requests.slice(1)){
    const image=request.images[1],bytes=await readFile(join(output,image.asset));assert.equal(image.sha256,sha(bytes));assert.equal(decode(bytes).width,1024);
  }
  for(const file of ['pilot_plan.json','pricing_status.json','REVIEW_BEFORE_API.md'])assert.ok(!(await readFile(join(output,file),'utf8')).includes(env.OPENAI_API_KEY));
  await assert.rejects(()=>run(process.execPath,[prepare,'--output',join(temp,'forbidden'),'--execute'],{cwd:ROOT}));
  assert.ok(!(await readdir(temp)).includes('forbidden'));
  const before=await readFile(join(output,'pilot_plan.json'));await assert.rejects(()=>run(process.execPath,[prepare,'--output',output],{cwd:ROOT}));assert.deepEqual(await readFile(join(output,'pilot_plan.json')),before);
  await assert.rejects(()=>run(process.execPath,[prepare,'--output',join(ROOT,'pilot-artifacts-must-not-exist')],{cwd:ROOT}));
  const link=join(temp,'git-link');await symlink(ROOT,link);await assert.rejects(()=>run(process.execPath,[prepare,'--output',join(link,'pilot-artifacts-must-not-exist')],{cwd:ROOT}));
});

test('private inspection rejects missing parts and records partial structural success without generating a model',async t=>{
  const temp=await mkdtemp(join(tmpdir(),'ai-image-review-test-'));t.after(()=>rm(temp,{recursive:true,force:true}));const input=join(temp,'raw');await mkdir(input);
  const planPath=join(temp,'pilot_plan.json');await writeFile(planPath,JSON.stringify(plan));
  await assert.rejects(()=>run(process.execPath,[checker,'--plan',planPath,'--input',input,'--output',join(temp,'missing')],{cwd:ROOT}));assert.ok(!(await readdir(temp)).includes('missing'));
  for(const request of plan.requests.slice(1))await writeFile(join(input,request.role+'.png'),fixture(request));
  const result=await run(process.execPath,[checker,'--plan',planPath,'--input',input,'--output',join(temp,'review')],{cwd:ROOT});const report=JSON.parse(result.stdout);
  assert.equal(report.all_structure_passed,true);assert.equal(report.parts.length,5);assert.equal(report.actual_ai_generation_confirmed,false);assert.equal(report.semantic_quality_passed,false);assert.equal(report.complete_33_part_batch,false);assert.equal(report.inochi_model_generated,false);
});
