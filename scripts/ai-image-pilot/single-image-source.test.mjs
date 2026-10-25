import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SOURCE_CANVAS,planPortraitNormalization,auditPortraitPixels} from '../../shared/single-image-source.js';

const makeParts=()=>Array.from({length:33},(_,i)=>({
  role:'part_'+i,label:'Part '+i,rect:{x:(i%11)*60,y:Math.floor(i/11)*100,width:45,height:55}
}));
const makePixels=(opacity=0)=>{
  const {width,height}=SOURCE_CANVAS;
  const pixels=new Uint8ClampedArray(width*height*4);
  if(opacity)for(let i=3;i<pixels.length;i+=4)pixels[i]=opacity;
  return pixels;
};
test('normalization contains portrait without cropping or inventing detected subject',()=>{
  const r=planPortraitNormalization(400,600);
  assert.deepEqual(r.source_size,[400,600]);
  assert.deepEqual(r.canvas_size,[768,1024]);
  assert.deepEqual(r.draw_rect,{x:42,y:0,width:683,height:1024});
  assert.equal(r.fit,'contain');
  assert.equal(r.subject_landmarks_detected,false);
  assert.equal(r.auto_subject_alignment,false);
});
test('rejects invalid source sizes and huge images',()=>{
  for(const [w,h] of [[0,400],[127,128],[4097,128],[4096,4096],[200,NaN]]){
    assert.throws(()=>planPortraitNormalization(w,h));
  }
});
test('empty portrait flags missing subject and all 33 empty candidate regions',()=>{
  const result=auditPortraitPixels(makePixels(),makeParts());
  assert.equal(result.roles_checked,33);
  assert.equal(result.independent_parts_generated,0);
  assert.equal(result.hidden_surfaces_recovered,0);
  assert.equal(result.rigging_performed,false);
  assert.equal(result.auto_subject_alignment,undefined);
  assert.equal(result.automatic_segmentation_performed,false);
  assert.deepEqual(result.warning_codes,['empty-source']);
  assert(result.role_windows.every(x=>x.warning_codes.includes('empty-region')));
});
test('opaque source is never treated as 33 isolated layers',()=>{
  const report=auditPortraitPixels(makePixels(255),makeParts(),{
    drawRect:{x:0,y:0,width:768,height:1024}
  });
  assert.equal(report.visible_fraction,1);
  assert(report.warning_codes.includes('opaque-background-needs-separation'));
  assert(report.warning_codes.includes('foreground-touches-canvas-edge'));
  assert(report.role_windows.every(x=>x.visible_fraction===1&&x.role_contents_isolated===false));
  assert.equal(report.appearance_quality_verified,false);
});
test('letterboxing warns about unknown alignment and reports transparent margins',()=>{
  const pixels=makePixels(),w=SOURCE_CANVAS.width;
  for(let y=200;y<300;y++)for(let x=250;x<350;x++)pixels[(y*w+x)*4+3]=255;
  const result=auditPortraitPixels(pixels,makeParts(),{
    drawRect:{x:42,y:0,width:683,height:1024}
  });
  assert.equal(result.visible_fraction,Math.round(10000/(768*1024)*10000)/10000);
  assert(result.warning_codes.includes('source-letterboxed-no-subject-alignment'));
  assert.deepEqual(result.foreground_bbox,{x:250,y:200,width:100,height:100});
});
test('rejects forged pixels or role contract',()=>{
  assert.throws(()=>auditPortraitPixels(new Uint8ClampedArray(100),makeParts()),/RGBA/);
  assert.throws(()=>auditPortraitPixels(makePixels(),makeParts().slice(0,32)),/33パーツ/);
  const p=makeParts();p[32].role=p[0].role;
  assert.throws(()=>auditPortraitPixels(makePixels(),p),/33パーツ/);
  const q=makeParts();q[0].rect.x=-1;
  assert.throws(()=>auditPortraitPixels(makePixels(),q),/座標/);
});
