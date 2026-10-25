import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proposePortraitRegions} from '../../shared/portrait-region-proposals.js';

const W=768,H=1024;
function portrait({split=true,extra=false}={}){
  const mask=new Uint8Array(W*H);
  // Broad oval-like upper profile, narrow neck and wide lower silhouette.
  for(let y=120;y<425;y++)for(let x=180;x<590;x++){
    const nx=(x-385)/205,ny=(y-272)/153;
    if(nx*nx+ny*ny<1)mask[y*W+x]=255;
  }
  for(let y=405;y<520;y++)for(let x=350;x<420;x++)mask[y*W+x]=255;
  for(let y=500;y<920;y++)for(let x=90;x<675;x++)mask[y*W+x]=255;
  if(extra)for(let y=100;y<950;y++)for(let x=0;x<89;x++)mask[y*W+x]=255;
  if(!split)for(let y=120;y<920;y++)for(let x=90;x<675;x++)mask[y*W+x]=255;
  return mask;
}
test('geometric neck allows tentative upper/lower boxes but never semantic anatomy',()=>{
  const report=proposePortraitRegions(portrait());
  assert.equal(report.status,'candidate');
  assert.equal(report.method,'connected-silhouette-neck-heuristic');
  assert(report.split_y>=400&&report.split_y<=520);
  assert(report.upper_candidate.rect.y<report.split_y);
  assert(report.lower_candidate.rect.y>=report.split_y);
  assert(report.warning_codes.includes('not-anatomically-validated'));
  assert.equal(report.independent_parts_generated,0);
  assert.equal(report.anatomical_segmentation_performed,false);
  assert.equal(report.landmarks_detected,false);
});
test('uniform rectangle has no defensible head / torso border',()=>{
  const result=proposePortraitRegions(portrait({split:false}));
  assert.equal(result.status,'ambiguous');
  assert.equal(result.reason,'no-clear-neck-narrowing');
  assert.equal(result.upper_candidate,null);
  assert.equal(result.split_y,null);
});
test('multiple significant disconnected figures is ambiguous',()=>{
  const result=proposePortraitRegions(portrait({extra:true}));
  assert.equal(result.status,'ambiguous');
  assert.equal(result.reason,'multiple-significant-components');
  assert(result.component_count>=2);
  assert(result.main_component_fraction<.85);
});
test('tiny disconnected island is reported but does not dominate',()=>{
  const mask=portrait();
  mask[5*W+5]=255;
  const result=proposePortraitRegions(mask);
  assert.equal(result.status,'candidate');
  assert.equal(result.component_count,2);
  assert(result.warning_codes.includes('disconnected-islands-present'));
  assert(result.main_component_fraction>.99);
});
test('reject malformed or empty masks instead of inventing a portrait',()=>{
  assert.throws(()=>proposePortraitRegions(new Uint8Array(10)),/768×1024/);
  assert.throws(()=>proposePortraitRegions(new Uint8Array(W*H)),/少なすぎ/);
  assert.throws(()=>proposePortraitRegions(new Uint8ClampedArray(W*H)),/前景マスク/);
});
