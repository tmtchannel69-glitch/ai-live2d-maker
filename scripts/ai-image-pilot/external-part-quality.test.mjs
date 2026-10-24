import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectExternalPartPixels} from '../../shared/external-part-quality.js';

const pixels=(w,h,points)=>{const a=new Uint8ClampedArray(w*h*4);for(const [x,y,alpha] of points)a[(y*w+x)*4+3]=alpha;return a;};
test('normal partly-transparent part produces measurable bounds without a quality claim',()=>{
  const input=pixels(4,4,[[1,1,255],[2,2,128]]);
  const r=inspectExternalPartPixels(input,4,4,{x:0,y:0,width:4,height:4});
  assert.equal(r.visible_pixels,2);
  assert.equal(r.transparent_pixels,14);
  assert.equal(r.semi_transparent_pixels,1);
  assert.equal(r.visible_ratio,0.125);
  assert.equal(r.edge_coverage_ratio,0);
  assert.deepEqual(r.visible_bounds,{x:1,y:1,width:2,height:2});
  assert.deepEqual(r.warning_codes,[]);
  assert.equal(r.appearance_quality_verified,false);
});
test('very small pixel coverage is flagged for manual review',()=>{
  const r=inspectExternalPartPixels(pixels(100,100,[[49,49,255]]),100,100,{x:0,y:0,width:100,height:100});
  assert.deepEqual(r.warning_codes,['very-low-coverage']);
  assert.equal(r.visible_ratio,0.0001);
  assert.equal(r.visible_bounds.width,1);
});
test('almost opaque part and likely clipping at edges are warned, never passed semantically',()=>{
  const items=[];
  for(let y=0;y<10;y++)for(let x=0;x<10;x++)if(!(x===5&&y===5))items.push([x,y,255]);
  const r=inspectExternalPartPixels(pixels(10,10,items),10,10,{x:0,y:0,width:10,height:10});
  assert.equal(r.visible_pixels,99);
  assert.deepEqual(r.warning_codes,['almost-opaque-tile','high-edge-contact']);
  assert.equal(r.appearance_quality_verified,false);
});
test('out-of-bounds pixels are counted so caller can reject the file',()=>{
  const r=inspectExternalPartPixels(pixels(6,6,[[1,1,255],[2,2,255],[5,5,255]]),6,6,{x:1,y:1,width:3,height:3});
  assert.equal(r.outside_visible_pixels,1);
  assert.equal(r.visible_pixels,2);
  assert.equal(r.transparent_pixels,7);
  assert.deepEqual(r.visible_bounds,{x:0,y:0,width:2,height:2});
});
test('reject oversized, mismatched and illegal RGBA buffer/rectangle dimensions',()=>{
  const data=pixels(2,2,[]);
  assert.throws(()=>inspectExternalPartPixels(data,2,3,{x:0,y:0,width:2,height:2}),/dimensions/);
  assert.throws(()=>inspectExternalPartPixels(data,2,2,{x:1,y:1,width:2,height:2}),/rectangle/);
  assert.throws(()=>inspectExternalPartPixels(data,0,2,{x:0,y:0,width:1,height:1}),/dimensions/);
  assert.throws(()=>inspectExternalPartPixels([1,2,3],2,2,{x:0,y:0,width:2,height:2}),/RGBA/);
});
