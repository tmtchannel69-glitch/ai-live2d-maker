import test from 'node:test';
import assert from 'node:assert/strict';
import {encode} from 'fast-png';
import {inspectReferenceHeader,validateReferenceMeta,validateStylePolicy,validateDesignBinding,bindingMatches,DEFAULT_STYLE_POLICY} from '../../shared/design-reference.js';
import {measureDesignPixels,compareDesignMeasurements,paletteDistance} from '../../shared/design-part-quality.js';
import {validateMakerOrigin} from '../../shared/modular-character.js';

const sha='a'.repeat(64),meta=()=>({format:'ai-live2d-design-reference',version:1,label:'test only',source:{file:'design/reference.png',media_type:'image/png',bytes:100,width:768,height:1024,sha256:sha},policy:structuredClone(DEFAULT_STYLE_POLICY),policy_sha256:'b'.repeat(64),claim:'user-supplied-unverified',ai_origin_verified:false,appearance_quality_passed:false});
const binding=()=>({format:'ai-live2d-design-part-binding',version:1,reference_sha256:sha,policy_sha256:'b'.repeat(64),claim:'user-declared-common-reference',ai_origin_verified:false});
test('reference dimensions are checked before decoding; PNG/JPEG/WebP headers and bounds are explicit',()=>{
  const png=encode({width:64,height:80,data:new Uint8Array(64*80*4),channels:4,depth:8});assert.deepEqual(inspectReferenceHeader(png),{type:'image/png',width:64,height:80});
  const jpeg=new Uint8Array(40);jpeg.set([255,216,255,192,0,17,8,3,0,2,0]);assert.deepEqual(inspectReferenceHeader(jpeg),{type:'image/jpeg',width:512,height:768});
  const webp=new Uint8Array(40),v=new DataView(webp.buffer);webp.set(new TextEncoder().encode('RIFF'));v.setUint32(4,32,true);webp.set(new TextEncoder().encode('WEBPVP8X'),8);webp[24]=255;webp[25]=1;webp[27]=255;webp[28]=2;
  assert.deepEqual(inspectReferenceHeader(webp),{type:'image/webp',width:512,height:768});webp[20]=2;assert.throws(()=>inspectReferenceHeader(webp),/静止/);
  for(const change of [p=>new DataView(p.buffer,p.byteOffset).setUint32(16,100_000),p=>new DataView(p.buffer,p.byteOffset).setUint32(20,63),p=>p.fill(0,0,8)]){const b=png.slice();change(b);assert.throws(()=>inspectReferenceHeader(b));}
  assert.throws(()=>inspectReferenceHeader(new Uint8Array(8*1024*1024+1)));assert.throws(()=>inspectReferenceHeader(new TextEncoder().encode('<svg onload="not an image reference"/>')));
});
test('reference metadata cannot claim verified AI, completed quality, unknown policies or unsafe paths',()=>{
  assert.deepEqual(validateReferenceMeta(meta()),meta());
  for(const change of [m=>m.appearance_quality_passed=true,m=>m.ai_origin_verified=true,m=>m.source.file='../image.png',m=>m.source.width=999999,m=>m.policy.line_width_px='2',m=>m.policy.hair_palette=['red'],m=>m.source.sha256='no',m=>m.policy.extra=true,m=>m.label='\n']){const m=meta();change(m);assert.throws(()=>validateReferenceMeta(m));}
  assert.throws(()=>validateStylePolicy({...DEFAULT_STYLE_POLICY,line_width_px:NaN}));
});
test('bindings are owner declarations; replacing reference or style policy makes them stale',()=>{
  const b=binding(),o={kind:'user-png',label:'fixture',sha256:'c'.repeat(64),ai_origin_verified:false,design_binding:b};assert.deepEqual(validateDesignBinding(b),b);assert.equal(bindingMatches(o,meta()),true);
  const changed=meta();changed.source.sha256='d'.repeat(64);assert.equal(bindingMatches(o,changed),false);changed.source.sha256=sha;changed.policy_sha256='e'.repeat(64);assert.equal(bindingMatches(o,changed),false);assert.equal(bindingMatches({},meta()),false);
  assert.throws(()=>validateMakerOrigin({...o,kind:'local-template'}));assert.throws(()=>validateDesignBinding({...b,ai_origin_verified:true}));assert.throws(()=>validateDesignBinding({...b,hidden_surfaces_verified:true}));
});
test('pixel warnings expose residual alpha, cut boundaries and sparse root without rewriting RGB/alpha',()=>{
  const data=new Uint8Array(64*64*4);
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4;data.set(x<4?[255,255,255,2]:y<32?[185,160,210,253]:[185,160,210,0],i);}
  const original=data.slice(),p=measureDesignPixels({data,width:64,height:64},{anchor:[32,50]}),checks=compareDesignMeasurements(p,p,{policy:DEFAULT_STYLE_POLICY,isHair:true});
  assert.deepEqual(data,original);assert.equal(p.faint_pixels,256);assert.equal(p.anchor_patch.opaque_ratio,0);assert(checks.warning_codes.includes('attachment-patch-thin-candidate'));assert(checks.warning_codes.includes('faint-alpha-residue-candidate'));assert(checks.warning_codes.includes('clipped-boundary-candidate'));
  assert.equal(checks.appearance_quality_passed,false);assert.equal(checks.hidden_surfaces_verified,false);assert(checks.unverified.includes('lighting-direction'));
});
test('measurable color differences never become semantic style or quality approval',()=>{
  const red=[{rgb:[240,50,70],samples:100}],blue=[{rgb:[50,80,240],samples:100}];assert.equal(paletteDistance(red,red),0);assert(paletteDistance(red,blue)>20);assert.equal(paletteDistance([],blue),null);
  const make=rgb=>{const data=new Uint8Array(32*32*4);for(let i=0;i<data.length;i+=4)data.set([...rgb,255],i);return measureDesignPixels({data,width:32,height:32});};
  const c=compareDesignMeasurements(make(red[0].rgb),make(blue[0].rgb),{policy:DEFAULT_STYLE_POLICY});assert(c.warning_codes.includes('palette-difference-candidate'));assert.equal(c.style_consistency_verified,false);
  const same=compareDesignMeasurements(make(red[0].rgb),make(red[0].rgb),{policy:DEFAULT_STYLE_POLICY});assert.equal(same.appearance_quality_passed,false);assert.equal(same.style_consistency_verified,false);
});
