import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTemplateManifest,partSvg} from '../../src/character-generation/template.js';
import {GENERATED_ROLES,validateCharacterManifest,validateRecipe,createRigMetadata,createInochiIntermediate} from '../../shared/generated-character.js';

test('generated parts keep complete overlapping layers separate from the old observed partition format',()=>{
  const m=createTemplateManifest();assert.equal(m.parts.length,33);assert.deepEqual(new Set(m.parts.map(p=>p.role)),new Set(GENERATED_ROLES));
  assert.equal(m.generator.ai_generated,false);assert.equal(m.rigged,false);
  assert.throws(()=>validateCharacterManifest({...m,format:'ai-live2d-maker-character-parts'}));
  const face=m.parts.find(p=>p.role==='face_base'),eye=m.parts.find(p=>p.role==='eye_white_l');
  assert.ok(eye.rect.x>face.rect.x&&eye.rect.y>face.rect.y);assert.equal(m.parts.find(p=>p.role==='mouth_inside').enabled_in_neutral,false);
});

test('every paired part uses character-personal left and mirrored positions and anchors',()=>{
  const m=createTemplateManifest();for(const p of m.parts.filter(p=>p.side==='l')){
    const r=m.parts.find(r=>r.role===p.role.slice(0,-1)+'r');assert.ok(r);assert.ok(p.rect.x>r.rect.x);
    assert.equal(p.rect.x,768-r.rect.x-r.rect.width);assert.deepEqual(p.anchor,[768-r.anchor[0],r.anchor[1]]);
  }
});

for(const [name,change] of [
  ['missing role',m=>m.parts.pop()],['duplicate role',m=>m.parts[0]={...m.parts[1]}],
  ['off-canvas placement',m=>m.parts[0].rect.width=768],['wrong side',m=>m.parts.find(p=>p.side==='l').side='r'],
  ['invalid parent',m=>m.parts[0].parent='unknown'],['group cycle',m=>m.groups[1].parent='group_head'],
  ['invalid clip',m=>m.parts.find(p=>p.role==='iris_l').clip_to='eye_white_r'],['unsafe filename',m=>m.parts[0].file='../private.png'],
  ['unrecorded recipe',m=>delete m.generator.recipe],['false AI claim',m=>m.generator.ai_generated=true],
  ['unimplemented pose',m=>m.scope.pose='profile'],['invalid anchor',m=>m.parts[0].anchor=[-1,0]],
])test('manifest rejects '+name,()=>{const m=createTemplateManifest();change(m);assert.throws(()=>validateCharacterManifest(m));});

test('source geometry is unchanged by rig and Inochi intermediate creation and world positions reconstruct',()=>{
  const m=createTemplateManifest(),before=structuredClone(m),rig=createRigMetadata(m),scene=createInochiIntermediate(m),byId=new Map(scene.nodes.map(n=>[n.id,n]));
  assert.deepEqual(m,before);assert.equal(rig.motion_keys.length,0);assert.equal(scene.native_model,false);assert.equal(scene.runtime_verified,false);
  assert.equal(scene.nodes.filter(n=>n.type==='Part').length,33);assert.equal(new Set(scene.nodes.map(n=>n.uuid)).size,scene.nodes.length);
  const world=n=>{const p=n.parent?world(byId.get(n.parent)):[0,0];return [p[0]+n.transform.trans[0],p[1]+n.transform.trans[1]];};
  for(const p of m.parts){const n=byId.get(p.id),offset=world(n);assert.equal(n.mesh.verts[0]+offset[0],p.rect.x-scene.origin[0]);assert.equal(n.mesh.verts[1]+offset[1],p.rect.y-scene.origin[1]);
    assert.deepEqual(n.mesh.uvs.slice(0,2),[0,0]);assert.equal(n.mesh.indices.length,24);assert.equal(n.zsort,-p.order);
    if(p.clip_to)assert.equal(n.masks[0].source,byId.get(p.clip_to).uuid);
  }
});

test('template and dummy recipes are explicit, deterministic, and do not accept external content',()=>{
  const m=createTemplateManifest();assert.deepEqual(m,createTemplateManifest());
  assert.equal(createTemplateManifest({provider:'dummy'}).generator.id,'dummy');
  for(const p of m.parts){const svg=partSvg(p,m.generator.recipe);assert.ok(svg.includes('<svg'));assert.ok(!/href=|<script|https?:\/\//.test(svg.replace('http://www.w3.org/2000/svg','')));}
  for(const bad of [{provider:'external-ai'},{hair:'<script>'},{url:'https://example.com'},{version:2}])assert.throws(()=>validateRecipe(bad));
});
