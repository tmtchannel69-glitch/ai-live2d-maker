import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {access,lstat,mkdtemp,readFile,rename,rm,symlink,unlink,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureInput,createFixture} from './create-fixture.mjs';
import {buildInochiModel,readInochiContainer} from './model.mjs';
import {generateTrial} from './generate.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const repo=fileURLToPath(new URL('../../',import.meta.url));
function nodes(root,parent=null,result=[]){result.push({node:root,parent});for(const child of root.children||[])nodes(child,root,result);return result;}
// This parser deliberately does not call the implementation's reader: the
// byte lengths, endianness, encoded texture blobs and section positions are
// checked against the legacy format independently.
function sections(bytes){
  const b=Buffer.from(bytes);assert.equal(b.toString('ascii',0,8),'TRNSRTS\0');
  const length=b.readUInt32BE(8),json=JSON.parse(b.toString('utf8',12,12+length));let p=12+length;
  assert.equal(b.toString('ascii',p,p+8),'TEX_SECT');p+=8;
  const count=b.readUInt32BE(p);p+=4;const textures=[];
  for(let i=0;i<count;i++){const n=b.readUInt32BE(p);p+=4;assert.equal(b[p++],0,'fixture textures are encoded PNG');textures.push(b.subarray(p,p+n));p+=n;}
  return {json,textures,end:p,textureCountOffset:12+length+8};
}

test('generated legacy INP and INX preserve input PNGs and deterministically encode byte lengths and mesh references',()=>{
  const input=fixtureInput(),before=input.parts.map(p=>hash(p.png)),a=buildInochiModel(input),b=buildInochiModel(input),parsed=sections(a.inp);
  assert.deepEqual(a.inp,b.inp);assert.deepEqual(a.inx,b.inx);assert.equal(parsed.json.meta.version,'v0.8.6');assert.equal(parsed.textures.length,5);
  assert.deepEqual(parsed.textures.map(hash).sort(),before.slice().sort());assert.deepEqual(input.parts.map(p=>hash(p.png)),before);
  const read=readInochiContainer(a.inp),editor=readInochiContainer(a.inx);
  assert.deepEqual(read.model,parsed.json);assert.deepEqual(editor.model,parsed.json);
  assert.deepEqual(read.textures.map(hash),parsed.textures.map(hash));
  const tree=nodes(read.model.nodes),parts=tree.filter(({node})=>node.type==='Part');assert.equal(parts.length,5);
  assert.equal(new Set(tree.map(({node})=>node.uuid)).size,tree.length);
  for(const {node} of parts){
    assert.equal(node.mesh.verts.length,18);assert.equal(node.mesh.uvs.length,18);assert.ok(node.mesh.verts.every(Number.isFinite));assert.ok(node.mesh.uvs.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
    assert.equal(node.mesh.indices.length,24);assert.ok(node.mesh.indices.every(i=>Number.isInteger(i)&&i>=0&&i<9));
    for(let i=0;i<node.mesh.indices.length;i+=3){const [a,b,c]=node.mesh.indices.slice(i,i+3).map(k=>node.mesh.verts.slice(k*2,k*2+2));assert.notEqual((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),0);}
    assert.ok(node.textures[0]>=0&&node.textures[0]<read.textures.length);
  }
});

test('independent eye parameters bind deformation and opacity to existing parts, while head motion targets their shared ancestor',()=>{
  const {model}=buildInochiModel(fixtureInput()),tree=nodes(model.nodes),byId=new Map(tree.map(x=>[x.node.uuid,x])),params=new Map(model.param.map(p=>[p.name,p]));
  assert.deepEqual([...params.keys()].sort(),['EyeOpenL','EyeOpenR','HeadX']);
  for(const name of ['EyeOpenL','EyeOpenR']){
    const p=params.get(name);assert.deepEqual(p.min,[0,0]);assert.deepEqual(p.max,[1,1]);assert.deepEqual(p.axis_points[1],[0]);
    const keys=p.axis_points[0];assert.equal(keys[0],0);assert.equal(keys.at(-1),1);assert.ok(keys.every((v,i)=>Number.isFinite(v)&&(!i||v>keys[i-1])));
    const opacity=p.bindings.filter(b=>b.param_name==='opacity'),deform=p.bindings.filter(b=>b.param_name==='deform');assert.ok(opacity.length>=2);assert.ok(deform.length>=1);
    assert.ok(opacity.some(b=>b.values[0][0]===0&&b.values.at(-1)[0]===1));assert.ok(opacity.some(b=>b.values[0][0]===1&&b.values.at(-1)[0]===0));
    for(const binding of p.bindings){
      assert.ok(byId.has(binding.node));assert.equal(binding.values.length,keys.length);assert.ok(binding.values.every(v=>v.length===1));
      if(binding.param_name==='deform')for(const key of binding.values){assert.equal(key[0].length,9);assert.ok(key[0].flat().every(Number.isFinite));}
    }
  }
  const leftIds=new Set(params.get('EyeOpenL').bindings.map(b=>b.node));assert.ok(params.get('EyeOpenR').bindings.every(b=>!leftIds.has(b.node)));
  const ancestorIds=new Set(params.get('HeadX').bindings.map(b=>b.node));
  for(const {node} of tree.filter(({node})=>node.type==='Part')){
    let p=byId.get(node.uuid).parent,following=false;while(p){if(ancestorIds.has(p.uuid))following=true;p=byId.get(p.uuid)?.parent;}
    assert.ok(following,'every face/eye/eyelid part follows a head-bound ancestor');
  }
});

test('invalid or missing image roles, duplicate roles and mismatched PNG dimensions fail before output',()=>{
  const input=fixtureInput();
  for(const missing of input.parts.map(p=>p.role))assert.throws(()=>buildInochiModel({...input,parts:input.parts.filter(p=>p.role!==missing)}));
  assert.throws(()=>buildInochiModel({...input,parts:[...input.parts,input.parts[0]]}));
  assert.throws(()=>buildInochiModel({...input,parts:input.parts.map((p,i)=>i? p:{...p,role:'unknown'})}));
  assert.throws(()=>buildInochiModel({...input,parts:input.parts.map((p,i)=>i? p:{...p,width:p.width+1})}));
  assert.throws(()=>buildInochiModel({...input,parts:input.parts.map((p,i)=>i? p:{...p,png:p.png.slice(0,20)})}));
});

test('nonfinite, out-of-bounds and oversized source or placement values are rejected',()=>{
  const input=fixtureInput();
  for(const source of [{width:NaN,height:320},{width:256,height:Infinity},{width:4097,height:320},{width:0,height:320}])assert.throws(()=>buildInochiModel({...input,source}));
  for(const placement of [{x:NaN},{y:Infinity},{x:-.1},{width:0},{height:2},{x:1,width:.5}])assert.throws(()=>buildInochiModel({...input,parts:input.parts.map((p,i)=>i?p:{...p,placement:{...p.placement,...placement}})}));
});

test('bounded container reader refuses wrong magic, truncated sections and absurd lengths without allocation',()=>{
  const {inp}=buildInochiModel(fixtureInput());
  for(const n of [0,4,8,12,inp.length-2])assert.throws(()=>readInochiContainer(inp.slice(0,n)));
  const badMagic=inp.slice();badMagic[0]^=255;assert.throws(()=>readInochiContainer(badMagic));
  const largeJson=inp.slice();new DataView(largeJson.buffer,largeJson.byteOffset,largeJson.byteLength).setUint32(8,0xffffffff,false);assert.throws(()=>readInochiContainer(largeJson));
  const hugeSlots=inp.slice(),at=sections(inp).textureCountOffset;new DataView(hugeSlots.buffer,hugeSlots.byteOffset,hugeSlots.byteLength).setUint32(at,0xffffffff,false);assert.throws(()=>readInochiContainer(hugeSlots));
});

test('fixture output is new and outside Git, with a manifest and PNGs that reproduce the in-memory input',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'inochi-fixture-test-'));
  try{
    const path=join(parent,'fixture'),result=await createFixture(path),manifest=JSON.parse(await readFile(join(path,'manifest.json'),'utf8'));
    assert.equal(manifest.synthetic,true);assert.deepEqual(manifest.source,{width:256,height:320});
    for(const part of result.parts)assert.deepEqual(new Uint8Array(await readFile(join(path,'parts',`${part.role}.png`))),part.png);
    const sentinel=join(path,'keep.txt');await writeFile(sentinel,'keep');await assert.rejects(createFixture(path));assert.equal(await readFile(sentinel,'utf8'),'keep');
    await assert.rejects(createFixture(join(repo,'inochi-fixture-output-test')),/Git/);
    await symlink(repo,join(parent,'repo-link'));await assert.rejects(createFixture(join(parent,'repo-link','inochi-fixture-output-test')),/Git/);
  }finally{await rm(parent,{recursive:true,force:true});}
});

test('real CLI round-trips UTF-8 names, preserves inputs and protects existing outputs through partial failures and symlinks',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'inochi-cli-test-'));
  try{
    const input=join(parent,'fixture with spaces');await createFixture(input);
    const manifestPath=join(input,'manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
    manifest.name='顔と瞬き・試験 😀';await writeFile(manifestPath,JSON.stringify(manifest,null,2));
    const sourcePaths=[manifestPath,...manifest.parts.map(p=>join(input,p.path))],before=await Promise.all(sourcePaths.map(p=>readFile(p))),base=join(parent,'model with spaces');
    const {stdout}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./generate.mjs',import.meta.url)),manifestPath,base],{timeout:10000,maxBuffer:128*1024}),result=JSON.parse(stdout);
    assert.equal(result.outputs.length,4);assert.equal(result.report.officialCreatorTested,false);assert.equal(result.report.live2dCompatible,false);assert.equal(result.report.vtubeStudioTested,false);
    const outputs=await Promise.all(result.outputs.map(p=>readFile(p)));assert.equal(hash(outputs[0]),result.report.inpSha256);
    for(const extension of ['.inp','.inx'])assert.equal(readInochiContainer(new Uint8Array(await readFile(base+extension))).model.meta.name,manifest.name);
    assert.deepEqual(sections(outputs[0]).json.meta.name,manifest.name);
    assert.deepEqual(await Promise.all(sourcePaths.map(p=>readFile(p))),before);
    await assert.rejects(generateTrial(manifestPath,base),/EEXIST/);
    assert.deepEqual(await Promise.all(result.outputs.map(p=>readFile(p))),outputs);

    // A collision at the second output must remove only the first newly made
    // file, retaining the pre-existing sibling and avoiding partial manifests.
    const partial=join(parent,'partial');await writeFile(partial+'.inx','keep editor file');
    await assert.rejects(generateTrial(manifestPath,partial),/EEXIST/);
    assert.equal(await readFile(partial+'.inx','utf8'),'keep editor file');
    for(const suffix of ['.inp','.json','-report.json'])await assert.rejects(access(partial+suffix));
    const target=join(parent,'keep-target');await writeFile(target,'keep target');
    const linked=join(parent,'linked');await symlink(target,linked+'.inx');
    await assert.rejects(generateTrial(manifestPath,linked),/EEXIST/);
    assert.equal(await readFile(target,'utf8'),'keep target');assert.ok((await lstat(linked+'.inx')).isSymbolicLink());await assert.rejects(access(linked+'.inp'));

    const linkedManifest=join(parent,'manifest-link.json');await symlink(manifestPath,linkedManifest);
    await assert.rejects(generateTrial(linkedManifest,join(parent,'from-linked-manifest')));
    const image=join(input,'parts','eye_white_l.png'),backup=join(input,'eye-backup.png');
    await rename(image,backup);await symlink(backup,image);
    await assert.rejects(generateTrial(manifestPath,join(parent,'from-linked-image')),/リンク|種類/);
    await unlink(image);await rename(backup,image);
    assert.deepEqual(await Promise.all(sourcePaths.map(p=>readFile(p))),before);

    const originalParts=join(input,'original-parts');await rename(join(input,'parts'),originalParts);await symlink(originalParts,join(input,'parts'));
    await assert.rejects(generateTrial(manifestPath,join(parent,'from-linked-directory')),/リンク/);
    await unlink(join(input,'parts'));await rename(originalParts,join(input,'parts'));
    await symlink(repo,join(parent,'repo-link'));
    await assert.rejects(generateTrial(manifestPath,join(parent,'repo-link','inochi-output-guard-test')),/Git/);
    assert.deepEqual(await Promise.all(sourcePaths.map(p=>readFile(p))),before);
  }finally{await rm(parent,{recursive:true,force:true});}
});
