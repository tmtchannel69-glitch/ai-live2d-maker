import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encode,decode} from 'fast-png';
import {mkdtemp,mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTemplateManifest} from '../../src/character-generation/template.js';
import {buildGeneratedInochi} from '../../shared/generated-character-inochi.js';
import {readCharacterContainer} from '../inochi2d/character-model.mjs';
import {generateModelDirectory} from './model.mjs';

const flat=n=>[n,...n.children.flatMap(flat)];
// Synthetic test textures only. Real template PNGs are exercised by the
// browser and official Creator audits, not replaced with this fixture.
function fixture(){
  const manifest=createTemplateManifest(),assets=new Map();
  for(const p of manifest.parts){
    const {x,y,width:w,height:h}=p.rect,data=new Uint8Array(w*h*4),cx=p.side==='l'?462:306;
    for(let j=0;j<h;j++)for(let i=0;i<w;i++){
      const t=(x+i-cx)/55,gy=y+j;
      const visible=p.role.startsWith('eye_white')?Math.abs(t)<1&&gy>331+20*t*t&&gy<377-21*t*t:
        p.role.startsWith('eyelashes')?Math.abs(t)<1&&Math.abs(gy-333-20*t*t)<3:i>1&&j>1&&i<w-2&&j<h-2;
      if(visible){const n=(j*w+i)*4;data.set([64,48,66,255],n);}
    }
    assets.set(p.role,encode({width:w,height:h,data,channels:4,depth:8}));
  }return {manifest,assets};
}
let original;
function sharedFixture(){return original??=fixture();}
const build=()=>{const f=sharedFixture();return buildGeneratedInochi(f.manifest,f.assets);};

test('legacy 0.8.6 model contains the original 33 roles, centered hierarchy, anchors, orders and six independent controls',async()=>{
  const f=sharedFixture(),before=structuredClone(f.manifest),bytes=[...f.assets].map(([r,b])=>[r,b.slice()]),built=await build();
  const parsed=readCharacterContainer(built.inp),all=flat(parsed.model.nodes),nodes=new Map(all.map(n=>[n.name,n]));
  assert.equal(parsed.model.nodes.name,'Root'); // Official save's canonical root.
  assert.equal(all.length,41);assert.equal(parsed.textures.length,33);assert.deepEqual(built.inp,built.inx);
  assert.deepEqual(built.model.param.map(p=>[p.name,p.defaults[0]]),[['EyeOpenL',1],['EyeOpenR',1],['MouthOpen',0],['HeadX',0],['HeadY',0],['HeadTilt',0]]);
  for(const p of f.manifest.parts){assert.ok(nodes.get(p.role).zsort===-p.order);assert.equal(nodes.get(p.parent).children.filter(n=>n.name===p.role).length,1);}
  assert.deepEqual(f.manifest,before);for(const [r,b] of bytes)assert.deepEqual(f.assets.get(r),b);
  assert.equal(built.report.official_creator_tested,false);assert.equal(built.report.appearance_quality_passed,false);
});

test('eye and mouth bindings have disjoint targets, exact neutral eye geometry and no visible iris at raw zero',async()=>{
  const {model}=await build(),nodes=new Map(flat(model.nodes).map(n=>[n.uuid,n])),params=new Map(model.param.map(p=>[p.name,p]));
  for(const side of ['L','R']){
    const eye=params.get('EyeOpen'+side);
    for(const b of eye.bindings){assert.ok(nodes.get(b.node).name.endsWith('_'+side.toLowerCase()));
      if(b.param_name==='deform')assert.ok(b.values.at(-1)[0].every(([x,y])=>x===0&&y===0));
      if(/^(eye_white|iris|highlight)_/.test(nodes.get(b.node).name)&&b.param_name==='opacity')assert.equal(b.values[0][0],0);
    }
  }
  for(const b of params.get('MouthOpen').bindings)assert.ok(nodes.get(b.node).name.startsWith('mouth_'));
  const inside=flat(model.nodes).find(n=>n.name==='mouth_inside');assert.equal(inside.opacity,1);
  assert.equal(params.get('MouthOpen').bindings.find(b=>b.node===inside.uuid&&b.param_name==='opacity').values[0][0],0);
});

test('head motions bind only Head and neck; collar and torso are fixed; the neck base has zero displacement',async()=>{
  const f=sharedFixture(),{model}=await build(),all=flat(model.nodes),nodes=new Map(all.map(n=>[n.uuid,n])),p=f.manifest.parts.find(p=>p.role==='neck');
  for(const param of model.param.filter(p=>p.name.startsWith('Head'))){
    assert.deepEqual(param.bindings.map(b=>nodes.get(b.node).name),['group_head','neck']);
    const n=all.find(n=>n.name==='neck'),b=param.bindings.find(b=>b.param_name==='deform');
    for(const key of b.values)for(let i=0;i<key[0].length;i++)if(n.mesh.verts[i*2+1]+p.anchor[1]>=588)assert.deepEqual(key[0][i],[0,0]);
  }
});

test('all blink, mouth and neck key meshes retain orientation without folded triangles',async()=>{
  const {model}=await build(),nodes=new Map(flat(model.nodes).map(n=>[n.uuid,n]));
  for(const param of model.param)for(const b of param.bindings.filter(b=>b.param_name==='deform')){
    const mesh=nodes.get(b.node).mesh;
    for(const key of b.values)for(let i=0;i<mesh.indices.length;i+=3){
      const q=mesh.indices.slice(i,i+3).map(v=>[mesh.verts[v*2]+key[0][v][0],mesh.verts[v*2+1]+key[0][v][1]]);
      const cross=(q[1][0]-q[0][0])*(q[2][1]-q[0][1])-(q[1][1]-q[0][1])*(q[2][0]-q[0][0]);
      assert.ok(cross>=-1e-7,`${param.name}: folded triangle`);
    }
  }
});

test('source alpha and colour remain intact; only runtime storage is premultiplied and preclipped',async()=>{
  const f=fixture(),p=f.manifest.parts.find(p=>p.role==='face_base'),source=decode(f.assets.get(p.role));
  source.data.set([200,100,51,128],(5*source.width+5)*4);f.assets.set(p.role,encode({...source,channels:4,depth:8}));
  const built=await buildGeneratedInochi(f.manifest,f.assets),runtime=decode(readCharacterContainer(built.inp).textures[f.manifest.parts.indexOf(p)]);
  assert.deepEqual([...runtime.data.slice((5*source.width+5)*4,(5*source.width+5)*4+4)],[100,50,25,128]);
  assert.deepEqual([...decode(f.assets.get(p.role)).data.slice((5*source.width+5)*4,(5*source.width+5)*4+4)],[200,100,51,128]);
});

for(const kind of ['missing','size','blank','dummy','anatomy','fixed-parent','moving-parent','origin'])test('invalid '+kind+' input fails rather than falling back to dummy or reporting success',async()=>{
  const f=fixture();
  if(kind==='missing')f.assets.delete('ear_l');
  if(kind==='size')f.assets.set('ear_l',encode({width:2,height:2,data:new Uint8Array(16),channels:4,depth:8}));
  if(kind==='blank'||kind==='anatomy'){
    const p=f.manifest.parts.find(p=>p.role===(kind==='blank'?'ear_l':'eyelashes_l')),data=new Uint8Array(p.rect.width*p.rect.height*4);
    if(kind==='anatomy')data.set([64,48,66,255],0);
    f.assets.set(p.role,encode({width:p.rect.width,height:p.rect.height,data,channels:4,depth:8}));
  }
  if(kind==='dummy'){f.manifest.generator.id='dummy';f.manifest.generator.recipe.provider='dummy';}
  if(kind==='fixed-parent')f.manifest.parts.find(p=>p.role==='collar').parent='group_head';
  if(kind==='moving-parent')f.manifest.parts.find(p=>p.role==='face_base').parent='group_body';
  if(kind==='origin')f.manifest.groups.find(g=>g.id==='root').anchor=[384,513];
  await assert.rejects(()=>buildGeneratedInochi(f.manifest,f.assets));
});

test('cancellation during texture encoding rejects without mutating the original generation',async()=>{
  const f=sharedFixture(),controller=new AbortController(),before=structuredClone(f.manifest);
  await assert.rejects(()=>buildGeneratedInochi(f.manifest,f.assets,{signal:controller.signal,onProgress:p=>{if(p.completed===3)controller.abort();}}),{name:'AbortError'});
  assert.deepEqual(f.manifest,before);
});

test('directory CLI reproduces in-memory INP, preserves PNG bytes and refuses overwrite and symlink input',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'generated-inochi-test-')),input=join(dir,'input'),f=sharedFixture();await mkdir(input);await mkdir(join(input,'parts'));
  await writeFile(join(input,'character_manifest.json'),JSON.stringify(f.manifest));for(const p of f.manifest.parts)await writeFile(join(input,p.file),f.assets.get(p.role));
  const result=await generateModelDirectory(input,join(dir,'output')),built=await build();assert.equal(result.file_generation_passed,true);
  assert.deepEqual(new Uint8Array(await readFile(join(dir,'output','character.inp'))),built.inp);
  await assert.rejects(()=>generateModelDirectory(input,join(dir,'output')));
  const link=join(dir,'linked');await mkdir(link);await writeFile(join(link,'character_manifest.json'),JSON.stringify(f.manifest));await symlink(join(input,'parts'),join(link,'parts'),'dir');
  await assert.rejects(()=>generateModelDirectory(link,join(dir,'rejected')));
});
