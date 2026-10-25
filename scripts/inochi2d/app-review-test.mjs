import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {reviewFixture} from './review-fixture.mjs';
import {readModelReview,readReviewEntries} from '../../src/inochi-model-review.js';
const blob=bytes=>new Blob([bytes],{type:'application/zip'});
const read=f=>readModelReview(blob(f.zip()),{expectedMode:'detailed-head',requirePipeline:true});

test('reads the two discrete views and separate original/completion assets without certifying appearance',async()=>{
  const f=reviewFixture(),r=await read(f);
  assert.equal(r.available,true);assert.equal(r.parts.length,1);assert.equal(r.review.views.length,2);
  assert.equal(r.review.views[0].frames.length,10);assert.equal(r.review.official_creator_tested,false);assert.equal(r.review.appearance_quality_passed,false);
  assert.deepEqual(r.entries.get('model.inp'),f.files['model.inp']);
});
test('old five-part and detailed archives stay downloadable without invented comparison images',async()=>{
  const f=reviewFixture();delete f.files['review/review.json'];delete f.pipeline.reviewManifest;f.files['generation-report.json']=strToU8(JSON.stringify(f.pipeline));
  assert.equal((await read(f)).available,false);
  f.pipeline.format='ai-live2d-maker-inochi2d-image-pipeline';f.files['generation-report.json']=strToU8(JSON.stringify(f.pipeline));
  const r=await readModelReview(blob(f.zip()),{expectedMode:'five',requirePipeline:true});assert.equal(r.mode,'five');assert.equal(r.available,false);
});
test('accepts version 2 packaging and refuses unsupported pipeline versions',async()=>{
  const f=reviewFixture();f.pipeline.version=2;f.pipeline.containsPreparationReconstruction=false;
  f.files['generation-report.json']=strToU8(JSON.stringify(f.pipeline));assert.equal((await read(f)).available,true);
  f.pipeline.version=999;f.files['generation-report.json']=strToU8(JSON.stringify(f.pipeline));await assert.rejects(read(f),/版には対応/);
});
test('rejects work ZIPs and arbitrary containers from the local reopen button',async()=>{
  await assert.rejects(readModelReview(blob(zipSync({'source/image':strToU8('private source'),'project.json':strToU8('{}')})),{requirePipeline:true}),/画像変換用モデルZIP/);
});
test('rejects missing images, model hash mismatches, wrong sizes, modes, and paths',async()=>{
  for(const problem of ['missing','hash','size','mode','path','part-position']){
    const f=reviewFixture();
    if(problem==='missing')delete f.files['review/head-00.png'];
    if(problem==='hash')f.review.model_sha256='0'.repeat(64);
    if(problem==='size')f.review.views[0].size=[3,2];
    if(problem==='mode')f.review.mode='five';
    if(problem==='path')f.graph.parts[0].observed.rgba='../../source/image.png';
    if(problem==='part-position')f.graph.parts[0].source_box_xywh=[2,0,2,2];
    f.files['review/review.json']=strToU8(JSON.stringify(f.review));f.files['common/parts.json']=strToU8(JSON.stringify(f.graph));
    await assert.rejects(read(f),undefined,problem);
  }
});
test('rejects duplicate, traversal, absolute, protocol and excessive entries before decompressing',async()=>{
  for(const name of ['../source.png','/source.png','https://example.test/a.png','a/../b.png']){
    await assert.rejects(readReviewEntries(blob(zipSync({[name]:strToU8('no')}))),/保存先/);
  }
  const duplicate=zipSync({'a.png':strToU8('a'),'b.png':strToU8('b')},{level:0});
  // Replace both central and local names with the same path (equal length).
  for(let i=0;i<duplicate.length-5;i++)if(String.fromCharCode(...duplicate.subarray(i,i+5))==='b.png')duplicate[i]=97;
  await assert.rejects(readReviewEntries(blob(duplicate)),/保存先/);
  const many=Object.fromEntries(Array.from({length:257},(_,i)=>[`${i}.txt`,strToU8('x')]));
  await assert.rejects(readReviewEntries(blob(zipSync(many))),/項目数/);
});
test('bounds the declared expanded total and actual output even with forged local and central lengths',async()=>{
  const tooLarge=zipSync({'a.txt':strToU8('x')});
  for(let i=0;i<tooLarge.length-4;i++)if(new DataView(tooLarge.buffer).getUint32(i,true)===0x02014b50)new DataView(tooLarge.buffer).setUint32(i+24,81*1024*1024,true);
  await assert.rejects(readReviewEntries(blob(tooLarge)),/展開後/);
  const forged=zipSync({'a.txt':new Uint8Array(1024*1024).fill(65)},{level:9}),v=new DataView(forged.buffer);
  v.setUint32(22,16,true);
  for(let i=0;i<forged.length-4;i++)if(v.getUint32(i,true)===0x02014b50)v.setUint32(i+24,16,true);
  await assert.rejects(readReviewEntries(blob(forged)),/展開サイズ/);
  await assert.rejects(readReviewEntries(blob(zipSync({'a.txt':new Uint8Array(80)})),{maxBytes:40}),/80 MiB/);
});
test('cancellation interrupts a local archive read',async()=>{
  const control=new AbortController();control.abort();
  await assert.rejects(readModelReview(blob(reviewFixture().zip()),{signal:control.signal}),{name:'AbortError'});
});
test('version 2 comparison reads ten before images and binds the skin report to the current model/assets',async()=>{
  const f=reviewFixture({withBoundary:true}),r=await read(f);
  assert.equal(r.review.version,2);assert.equal(r.review.views.find(v=>v.id==='blink').frames.filter(f=>f.before_file).length,10);
  assert.equal(r.skinBoundary.eyes.l.after.mean_absolute_rgb_difference,2.2);assert.equal(r.parts.length,2);
});
test('incomplete or mismatched before images, values, fingerprints and metrics are refused atomically',async()=>{
  for(const problem of ['missing','opening','skin-hash','model-hash','metric','missing-report']){
    const f=reviewFixture({withBoundary:true});
    if(problem==='missing')delete f.files['review/blink-before-00.png'];
    if(problem==='opening')f.review.views[1].frames[0].before_diagnostics.opening=.5;
    if(problem==='skin-hash')f.boundary.before_png_sha256='0'.repeat(64);
    if(problem==='model-hash')f.boundary.after_model_sha256='0'.repeat(64);
    if(problem==='metric')f.boundary.eyes.l.after.mean_absolute_rgb_difference=-1;
    f.files['review/review.json']=strToU8(JSON.stringify(f.review));f.files['skin-boundary-report.json']=strToU8(JSON.stringify(f.boundary));
    if(problem==='missing-report')delete f.files['skin-boundary-report.json'];
    await assert.rejects(read(f),undefined,problem);
  }
});
