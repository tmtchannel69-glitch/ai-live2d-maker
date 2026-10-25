import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readModelArchive,MAX_MODEL_ARCHIVE_BYTES} from '../../src/inochi-model-download.js';

const signature=new Uint8Array([0x50,0x4b,3,4]);
function streamed(chunks,headers={}){
  let cancelled=false;return {response:new Response(new ReadableStream({start(c){for(const b of chunks)c.enqueue(b);},cancel(){cancelled=true;}}),{headers}),cancelled:()=>cancelled};
}
test('archive receive limit matches both server exporters and preserves received bytes',async()=>{
  assert.equal(MAX_MODEL_ARCHIVE_BYTES,80*1024*1024);
  const response=new Response(signature);const blob=await readModelArchive(response);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),signature);
});
test('oversized declared length is rejected and cancels the response before reading',async()=>{
  const s=streamed([signature],{'Content-Length':'9'});await assert.rejects(()=>readModelArchive(s.response,{maxBytes:8}),/上限/);assert.equal(s.cancelled(),true);
});
for(const headers of [{},{'Content-Length':'4'}])test('bounded stream rejects overflowing content even with '+JSON.stringify(headers),async()=>{
  const s=streamed([signature,new Uint8Array(9)],headers);await assert.rejects(()=>readModelArchive(s.response,{maxBytes:8}),/上限/);assert.equal(s.cancelled(),true);
});
test('empty, invalid and aborted results never become replacement models',async()=>{
  await assert.rejects(()=>readModelArchive(new Response(new Uint8Array())),/空/);
  await assert.rejects(()=>readModelArchive(new Response(new Uint8Array([1,2,3,4]))),/形式/);
  const s=streamed([signature]),control=new AbortController();control.abort();
  await assert.rejects(()=>readModelArchive(s.response,{signal:control.signal}),{name:'AbortError'});assert.equal(s.cancelled(),true);
});
