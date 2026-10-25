import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanBangsAlpha} from '../../shared/bangs-image.js';
import {withBangsPlacement,canonicalBangsManifest,validateBangsPlacement} from '../../shared/bangs-placement.js';
import {createDesignPlan} from '../../shared/character-design.js';
import {manifestFromPlan,validateDesignedCharacter} from '../../shared/designed-character.js';
const fixture=()=>{const width=128,height=128,data=new Uint8ClampedArray(width*height*4);for(let y=30;y<98;y++)for(let x=30;x<98;x++)data.set([192,170,225,253],(y*width+x)*4);return {width,height,data};};
test('alpha cleanup removes distant faint residue but preserves every strong RGB/alpha and nearby soft edge',async()=>{
  const im=fixture();im.data.set([255,0,255,2],(10*128+10)*4);im.data.set([213,191,232,3],(29*128+50)*4);const source=im.data.slice(),out=await cleanBangsAlpha(im);
  assert.deepEqual(im.data,source);assert.deepEqual([...out.data.slice((10*128+10)*4,(10*128+10)*4+4)],[0,0,0,0]);assert.deepEqual([...out.data.slice((29*128+50)*4,(29*128+50)*4+4)],[213,191,232,3]);
  for(let i=0;i<source.length;i+=4)if(source[i+3]>=8)assert.deepEqual(out.data.slice(i,i+4),source.slice(i,i+4));
  assert.equal(out.report.strong_pixels_removed,0);assert.equal(out.report.removed_low_alpha_pixels,1);assert.equal(out.report.source_colour_repainted,false);
});
test('opaque, empty, clipped and oversized front-hair candidates fail rather than substituting a template',async()=>{
  for(const kind of ['opaque','empty','clipped','oversized']){const im=fixture();if(kind==='opaque')im.data.fill(255);if(kind==='empty')im.data.fill(0);if(kind==='clipped')im.data.set([200,180,230,200],0);if(kind==='oversized')im.width=2049;await assert.rejects(()=>cleanBangsAlpha(im));}
});
test('alpha processing honors cancellation',async()=>{const c=new AbortController();c.abort();await assert.rejects(()=>cleanBangsAlpha(fixture(),{signal:c.signal}),{name:'AbortError'});});
test('front-hair placement preserves the exact canonical blueprint including fresh shared references',async()=>{
  const base=manifestFromPlan(await createDesignPlan(),{id:'local-design-v1',ai_generated:false}),before=JSON.stringify(base),rect={x:159,y:42,width:450,height:445};
  assert.equal(base.parts,base.blueprint.parts);const placed=await withBangsPlacement(base,rect);assert.equal(JSON.stringify(base),before);assert.deepEqual(canonicalBangsManifest(placed),base);assert.deepEqual(placed.parts.find(p=>p.role==='bangs_front').rect,rect);assert.notEqual(placed.parts,placed.blueprint.parts);
  assert.equal(await validateBangsPlacement(placed),placed);await assert.rejects(()=>validateDesignedCharacter(placed));
  for(const role of base.parts.filter(p=>p.role!=='bangs_front').map(p=>p.role))assert.deepEqual(placed.parts.find(p=>p.role===role),base.parts.find(p=>p.role===role));
});
for(const kind of ['far-out','body-edit','anchor-edit','order-edit','unknown-extension'])test('placement rejects '+kind,async()=>{
  const base=manifestFromPlan(await createDesignPlan(),{id:'local-design-v1',ai_generated:false}),placed=await withBangsPlacement(base,{x:159,y:42,width:450,height:445});
  if(kind==='far-out'){placed.assembly_extension.rect.y=0;placed.parts.find(p=>p.role==='bangs_front').rect.y=0;}
  if(kind==='body-edit')placed.parts.find(p=>p.role==='dress_base').rect.y++;
  if(kind==='anchor-edit')placed.parts.find(p=>p.role==='bangs_front').anchor[1]++;
  if(kind==='order-edit')placed.parts.find(p=>p.role==='bangs_front').order++;
  if(kind==='unknown-extension')placed.assembly_extension.script='untrusted';
  await assert.rejects(()=>validateBangsPlacement(placed));
});
