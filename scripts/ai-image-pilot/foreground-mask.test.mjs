import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createForegroundMask} from '../../shared/portrait-foreground-mask.js';
const W=768,H=1024;
const area={x:100,y:100,width:500,height:800};
function paint({bg=[255,255,255,255],rect=area,subject={x:280,y:370,width:110,height:210},color=[65,80,100,255]}={}){
  const out=new Uint8ClampedArray(W*H*4);
  for(let y=rect.y;y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++){
    const i=(y*W+x)*4;out.set(bg,i);
  }
  if(subject)for(let y=subject.y;y<subject.y+subject.height;y++)for(let x=subject.x;x<subject.x+subject.width;x++){
    const i=(y*W+x)*4;out.set(color,i);
  }
  return out;
}
const alpha=(mask,x,y)=>mask[y*W+x];
test('uses true alpha to isolate opaque figure on transparent canvas',()=>{
  const pixels=paint({bg:[0,0,0,0]});
  const {mask,report}=createForegroundMask(pixels,area);
  assert.equal(report.method,'existing-alpha');
  assert.equal(alpha(mask,280,370),255);
  assert.equal(alpha(mask,200,200),0);
  assert.equal(alpha(mask,20,20),0);
  assert.equal(report.independent_parts_generated,0);
  assert.equal(report.anatomical_segmentation_performed,false);
  assert.equal(report.foreground_mask_generated,true);
});
test('flood fills connected white corners without erasing contrasting subject',()=>{
  const pixels=paint();
  const {mask,report}=createForegroundMask(pixels,area);
  assert.equal(report.method,'flat-background-flood');
  assert.deepEqual(report.background_corner_rgb,[255,255,255]);
  assert.equal(alpha(mask,200,200),0);
  assert.equal(alpha(mask,300,400),255);
  assert.equal(alpha(mask,20,20),0);
  assert(report.warning_codes.includes('flat-background-color-loss-possible'));
  assert(report.foreground_fraction>0.04&&report.foreground_fraction<0.07);
});
test('leaves interior holes non-background when background is not connected to border',()=>{
  const data=paint();
  // A high-contrast ring surrounding white pixel: this white hole must remain foreground.
  for(let y=500;y<535;y++)for(let x=350;x<385;x++)data.set([20,35,40,255],(y*W+x)*4);
  for(let y=509;y<526;y++)for(let x=359;x<376;x++)data.set([255,255,255,255],(y*W+x)*4);
  const {mask}=createForegroundMask(data,area);
  assert.equal(alpha(mask,365,515),255);
  assert.equal(alpha(mask,380,520),255);
  assert.equal(alpha(mask,110,110),0);
});
test('rejects inconsistent corner colors rather than faking a segmentation',()=>{
  const data=paint();
  data.set([255,0,0,255],((area.y+1)*W+area.x+1)*4);
  assert.throws(()=>createForegroundMask(data,area),/四隅/);
});
test('rejects uniform opaque and invisible portraits',()=>{
  assert.throws(()=>createForegroundMask(paint({subject:null}),area),/前景と背景/);
  assert.throws(()=>createForegroundMask(paint({bg:[0,0,0,0],subject:null}),area),/可視領域/);
});
test('flags an accepted figure touching the input border',()=>{
  const subject={x:area.x,y:370,width:110,height:210};
  const {report}=createForegroundMask(paint({subject}),area);
  assert.equal(report.foreground_touches_source_edge,true);
  assert(report.warning_codes.includes('foreground-touches-input-edge'));
});
test('rejects forged dimensions, rectangles and unsafe thresholds',()=>{
  assert.throws(()=>createForegroundMask(new Uint8ClampedArray(20),area),/RGBA/);
  assert.throws(()=>createForegroundMask(new Uint8ClampedArray(W*H*4),{x:-1,y:0,width:W,height:H}),/配置/);
  assert.throws(()=>createForegroundMask(paint(),area,{threshold:1000}),/色差/);
});
