import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {normalizeDesign,createDesignPlan,createAIGenerationRequest,hashJSON,point} from '../../shared/character-design.js';
import {manifestFromPlan,validateDesignedCharacter} from '../../shared/designed-character.js';
import {createInochiGeometry} from '../../shared/generated-character.js';
import {resolveDesignProvider,validateDesignBatch} from '../../src/character-generation/design-provider.js';

const presets=JSON.parse(await readFile(new URL('./design-examples.json',import.meta.url),'utf8'));
test('common design is normalized without mutating input and uses the same SHA256 as independent Node crypto',async()=>{
  const d={name:'テスト',features:{hair:{color:'#AbCDEF'}}},before=structuredClone(d),n=normalizeDesign(d);
  assert.deepEqual(d,before);assert.equal(n.features.hair.color,'#abcdef');assert.equal(await hashJSON(n),createHash('sha256').update(JSON.stringify(n)).digest('hex'));
  assert.deepEqual(n,normalizeDesign(JSON.parse(JSON.stringify(n))));
});

for(const [name,input] of Object.entries(presets))test(name+' creates one canonical whole-character plan with 33 complete roles and valid dynamic geometry',async()=>{
  const p=await createDesignPlan(input),m=await validateDesignedCharacter(manifestFromPlan(p,{id:'local-design-v1',ai_generated:false}));
  assert.equal(m.parts.length,33);assert.equal(new Set(m.parts.map(p=>p.role)).size,33);assert.equal(m.generator.ai_generated,false);
  for(const part of m.parts){assert.equal(part.generation.design_id,m.generator.design_id);assert.equal(part.generation.complete_layer,true);assert.ok(part.anchor[0]>=part.rect.x&&part.anchor[1]>=part.rect.y);}
  assert.ok(m.rig_geometry.neck_fixed_y>m.rig_geometry.neck_follow_y+12);assert.deepEqual(m.rig_geometry.head_pivot,m.groups.find(g=>g.id==='group_head').anchor);
  assert.equal(createInochiGeometry(m).nodes.filter(n=>n.type==='Part').length,33);
});

test('hair/eyes/face/outfit vary actual bounds, anchors and neck transition rather than only a label or palette',async()=>{
  const a=await createDesignPlan(presets.soft),b=await createDesignPlan(presets.bob),c=await createDesignPlan(presets.cool);
  const part=(p,r)=>p.blueprint.parts.find(x=>x.role===r);
  assert.ok(part(a,'side_hair_l').rect.height>part(b,'side_hair_l').rect.height*1.5);
  assert.ok(part(a,'eye_white_l').rect.height>part(b,'eye_white_l').rect.height);
  assert.notDeepEqual(part(a,'face_base').rect,part(c,'face_base').rect);assert.notDeepEqual(a.blueprint.rig_geometry,c.blueprint.rig_geometry);
  assert.ok(part(a,'sleeve_l').rect.height>part(b,'sleeve_l').rect.height);assert.equal(new Set([a.blueprint_id,b.blueprint_id,c.blueprint_id]).size,3);
});

test('upturned eye choice raises the outer corner on BOTH character-personal sides',async()=>{
  const p=await createDesignPlan(presets.cool);
  for(const [side,outer,inner] of [['r',[249,352],[363,348]],['l',[519,352],[405,348]]]){
    const m=p.blueprint.parts.find(p=>p.role==='eye_white_'+side).generation.reference_transform;
    assert.ok(point(m,outer)[1]<point(m,inner)[1]-1,'The outer eye corner must be higher than the inner corner.');
  }
});

for(const bad of [{features:{hair:{style:'unsupported'}}},{features:{eyes:{color:'red'}}},{features:{outfit:{style:'kimono'}}},{style:{ink:'#eeeeee'}},{style:{line_width:50}},{style:{lighting:'random'}},{version:2},{apiKey:'not-supported'}])test('unsupported or unsafe design '+JSON.stringify(bad)+' fails explicitly',()=>assert.throws(()=>normalizeDesign(bad)));

for(const kind of ['geometry','design-id','blueprint','fake-ai','extra-field'])test('version 2 rejects '+kind+' instead of accepting mixed design/provenance',async()=>{
  const plan=await createDesignPlan(presets.soft),m=manifestFromPlan(plan,{id:'local-design-v1',ai_generated:false});
  if(kind==='geometry')m.parts[0].rect.x++;
  if(kind==='design-id')m.generator.design_id='0'.repeat(64);
  if(kind==='blueprint')m.blueprint.palette.hair.base='#ffffff';
  if(kind==='fake-ai')m.generator.ai_generated=true;
  if(kind==='extra-field')m.fake_ai_success=true;
  await assert.rejects(()=>validateDesignedCharacter(m));
});

test('batch validation refuses missing roles, mixed designs and geometry, and never promotes fixtures into AI output',async()=>{
  const p=await createDesignPlan(presets.soft),make=()=>({provider:{id:'local-design-v1',ai_generated:false,external:false},design_id:p.blueprint.design_id,blueprint_id:p.blueprint_id,
    parts:new Map(p.blueprint.parts.map(r=>[r.role,{role:r.role,design_id:p.blueprint.design_id,blueprint_id:p.blueprint_id,rect:{...r.rect},anchor:[...r.anchor],parent:r.parent,order:r.order,complete_layer:true,blob:new Blob(['metadata fixture only'])}]))});
  validateDesignBatch(p,make());
  for(const kind of ['missing','mixed','placement','fake-ai']){
    const b=make();if(kind==='missing')b.parts.delete('face_base');if(kind==='mixed')b.parts.get('face_base').design_id='another';if(kind==='placement')b.parts.get('face_base').rect.x++;if(kind==='fake-ai')b.provider.ai_generated=true;
    assert.throws(()=>validateDesignBatch(p,b));
  }
  for(const id of ['openai','gemini','local-diffusion','unknown'])assert.throws(()=>resolveDesignProvider(id),{code:'AI_PROVIDER_NOT_CONNECTED'});
});

test('AI request export is one coherent design with full hidden layers, with no sent request or AI-success claim',async()=>{
  const p=await createDesignPlan(presets.bob),r=createAIGenerationRequest(p);
  assert.equal(r.blueprint.parts.length,33);assert.equal(r.request_sent,false);assert.equal(r.ai_generation_performed,false);assert.equal(r.status,'not-connected');
  assert.equal(r.blueprint.provider_policy.batch,'one-design-all-33-parts');assert.equal(r.blueprint.provider_policy.external_transmission_enabled,false);
  assert.equal(r.approval_required.current_prices_and_budget,true);assert.deepEqual(r.expected_reference_images,[]);
});

test('valid provider JSON survives object-key reordering without accepting extra or changed data',async()=>{
  const p=await createDesignPlan(presets.cool),m=manifestFromPlan(p,{id:'local-design-v1',ai_generated:false});
  const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,reorder(v[k])])):v;
  const sorted=reorder(m);assert.equal((await validateDesignedCharacter(sorted)).generator.design_id,m.generator.design_id);
  sorted.parts[0].rect.x++;await assert.rejects(()=>validateDesignedCharacter(sorted));
});
