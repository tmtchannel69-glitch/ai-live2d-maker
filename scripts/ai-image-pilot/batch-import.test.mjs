import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchExternalPartFiles,MAX_BATCH_BYTES} from '../../shared/external-part-file-list.js';

const parts=Array.from({length:33},(_,i)=>({role:'part_'+i,rect:{width:60,height:80}}));
const file=(role,size=128)=>({name:role+'.png',size,type:'image/png'});
test('recognizes one or several roles in canonical manifest order, records 33-role gaps',()=>{
  const result=matchExternalPartFiles([file('part_8'),file('part_2')],parts);
  assert.deepEqual(result.provided_roles,['part_2','part_8']);
  assert.equal(result.provided_count,2);assert.equal(result.missing_count,31);
  assert.equal(result.missing_roles.includes('part_0'),true);
  assert.equal(result.total_input_bytes,256);
});
test('reject duplicate, unknown, mismatched, unsupported formats and empty inputs',()=>{
  assert.throws(()=>matchExternalPartFiles([],parts),/1〜33/);
  assert.throws(()=>matchExternalPartFiles([file('part_1'),file('part_1')],parts),/重複/);
  assert.throws(()=>matchExternalPartFiles([file('not_a_part')],parts),/未対応/);
  assert.throws(()=>matchExternalPartFiles([{...file('part_1'),name:'part_1 (1).png'}],parts),/ファイル名/);
  assert.throws(()=>matchExternalPartFiles([{...file('part_1'),type:'image/jpeg'}],parts),/PNG以外/);
  assert.throws(()=>matchExternalPartFiles([file('part_1',32)],parts),/8MB/);
  assert.throws(()=>matchExternalPartFiles([file('part_1',8*1024*1024+1)],parts),/8MB/);
});
test('reject invalid blueprints, no silent fake template roles',()=>{
  assert.throws(()=>matchExternalPartFiles([file('part_1')],parts.slice(0,32)),/33パーツ/);
  assert.throws(()=>matchExternalPartFiles([file('part_1')],[...parts.slice(0,32),parts[0]]),/パーツ定義/);
});
test('caps total size and accepts all 33 parts without claiming AI provenance',()=>{
  assert.throws(()=>matchExternalPartFiles([file('part_0',8*1024*1024),file('part_1',5*1024*1024)],parts),/12MB/);
  const result=matchExternalPartFiles(parts.map(p=>file(p.role,128)),parts);
  assert.equal(result.missing_count,0);assert.equal(result.provided_count,33);
  assert.equal(result.total_input_bytes,33*128);
  assert.equal(MAX_BATCH_BYTES,12*1024*1024);
});
