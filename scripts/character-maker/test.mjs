import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {matchMakerFiles,DEFAULT_POSE,validateMakerPose,validateMakerOrigin,validateMakerHistory} from '../../shared/modular-character.js';
import {readBoundedZip} from '../../shared/bounded-zip.js';
import {auditModularMeshes} from '../../shared/modular-mesh-audit.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,symlink,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const file=(name,size=100)=>({name,size});
const origin={kind:'user-png',label:'User PNG',sha256:'a'.repeat(64),ai_origin_verified:false};
test('role matching uses personal left/right, known aliases and normalized filenames',()=>{
  assert.deepEqual(matchMakerFiles([file('front-hair.png'),file('left_iris.PNG'),file('RIGHT-EYELASHES.png'),file('maid_dress.png')]).map(p=>p.role),['bangs_front','iris_l','eyelashes_r','dress_base']);
});
test('ambiguous composite eyes, unknown roles, duplicates and excessive source bytes are rejected',()=>{
  for(const files of [[],[file('eye_l.png')],[file('../iris_l.png')],[file('nose.png')],[file('iris_l.png'),file('left_iris.png')],[file('iris_l.png',9*1024*1024)],[file('iris_l.png',7*1024*1024),file('iris_r.png',7*1024*1024)]])assert.throws(()=>matchMakerFiles(files));
});
test('pose has seven explicit bounded controls; extra keys and nonfinite values fail',()=>{
  assert.deepEqual(validateMakerPose(),DEFAULT_POSE);for(const v of [{...DEFAULT_POSE,HeadX:2},{...DEFAULT_POSE,Breath:NaN},{...DEFAULT_POSE,fake:1},{}])assert.throws(()=>validateMakerPose(v));
});
test('origin metadata never promotes a user PNG to verified AI; history validates every role/hash',()=>{
  assert.deepEqual(validateMakerOrigin(origin),origin);assert.throws(()=>validateMakerOrigin({...origin,ai_origin_verified:true}));
  const event={revision:1,kind:'user-png',label:'Import',changes:[{role:'iris_l',source_filename:'iris_l.png',sha256:origin.sha256}]};
  assert.equal(validateMakerHistory([event],1).length,1);
  for(const [events,revision] of [[[event,event],2],[[event],0],[[{...event,changes:[{...event.changes[0],role:'../source'}]}],1],[[event],Infinity]])assert.throws(()=>validateMakerHistory(events,revision));
});
test('bounded ZIP reader supports legitimate folders and refuses unsafe paths, excessive expansion and cancellation',async()=>{
  const data=zipSync({'parts/':new Uint8Array(),'parts/iris_l.png':strToU8('test')});const blob=new Blob([data]);
  const files=await readBoundedZip(blob,{allowDirectories:true,maxBytes:1024});assert.equal(files.get('parts/iris_l.png').length,4);
  await assert.rejects(()=>readBoundedZip(blob,{allowDirectories:false}));
  await assert.rejects(()=>readBoundedZip(new Blob([zipSync({'../source.png':strToU8('x')})])));
  await assert.rejects(()=>readBoundedZip(new Blob([zipSync({'huge.png':new Uint8Array(65536)})]),{maxBytes:1024,maxCompressedBytes:4096}));
  const c=new AbortController();c.abort();await assert.rejects(()=>readBoundedZip(blob,{signal:c.signal}),{name:'AbortError'});
});
const model=values=>({nodes:{uuid:1,name:'eye_white_l',type:'Part',children:[],mesh:{verts:[0,0,1,0,0,1],indices:[0,1,2]}},param:[{axis_points:[[0,1],[0]],bindings:[{node:1,param_name:'deform',values:values.map(v=>[v])}]}]});
test('mesh audit detects folding inside an interval even when both endpoints and midpoint have positive area',()=>{
  const zero=[[0,0],[0,0],[0,0]],safe=[[0,0],[0,0],[0,-1]];
  assert.equal(auditModularMeshes(model([zero,safe])).folds_detected,0);
  const hidden=[[0,0],[-10,0],[0,-10/3]];
  assert.throws(()=>auditModularMeshes(model([zero,hidden])),/折り返/);
});
test('private regeneration rejects both dot-prefixed and symlinked output inside Git before creating anything',async()=>{
  const root=fileURLToPath(new URL('../..',import.meta.url)),folder=await mkdtemp(join(tmpdir(),'maker-output-guard-')),link=join(folder,'repo');await symlink(root,link);
  for(const output of [join(root,'..private-maker-output-guard'),join(link,'private-maker-output-guard')]){
    await assert.rejects(()=>promisify(execFile)(process.execPath,[join(root,'scripts/character-maker/trial.mjs'),'--output',output]),e=>e.stderr.includes('outside Git'));
    await assert.rejects(()=>access(output),{code:'ENOENT'});
  }
});
