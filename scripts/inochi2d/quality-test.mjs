import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encode,decode} from 'fast-png';
import {buildQualityModel} from './quality-model.mjs';
import {readCharacterContainer} from './character-model.mjs';

function fixture(){
  const roles=['face_base','eye_white_l','eye_white_r','eye_closed_l','eye_closed_r','eye_lash_l','eye_lash_r'];
  const parts=roles.map((role,i)=>{
    const width=i?10:80,height=i?12:120,placement=i?{x:i%2?.56:.30,y:.25,width:.1,height:.1}:{x:.1,y:0,width:.8,height:1};
    const data=new Uint8Array(width*height*4);for(let p=0;p<data.length;p+=4)data.set([90+i*15,70,60,255],p);
    return {role,width,height,placement,path:`parts/${role}.png`,png:encode({width,height,data,depth:8,channels:4})};
  });
  return {name:'Original geometry fixture',source:{width:100,height:120},parts,quality:{profile:'aperture-head-v1',
    headPivot:{x:.5,y:.58},neckBlend:{rigidY:.54,fixedY:.68},
    blink:Object.fromEntries(['l','r'].map(side=>[side,{upper_y:Array(13).fill(2),closed_y:Array(13).fill(6)}]))}};
}
function flatten(n){return [n,...n.children.flatMap(flatten)];}
function blend(p,b,t){
  const axis=p.axis_points[0],end=axis.findIndex(v=>v>=t),i=Math.max(1,end<0?axis.length-1:end),a=b.values[i-1][0],c=b.values[i][0],u=(t-axis[i-1])/(axis[i]-axis[i-1]);
  const mix=(a,b)=>Array.isArray(a)?a.map((x,j)=>mix(x,b[j])):a+(b-a)*u;
  return mix(a,c);
}

test('quality container keeps opaque source pixels and one explicit procedural stencil',()=>{
  const input=fixture(),original=structuredClone(input),built=buildQualityModel(input),parsed=readCharacterContainer(built.inp);
  assert.deepEqual(input,original);
  assert.equal(parsed.textures.length,8);
  for(const p of input.parts)assert.ok(parsed.textures.some(png=>Buffer.from(png).equals(Buffer.from(p.png))));
  assert.deepEqual(parsed.model,JSON.parse(JSON.stringify(built.model))); // JSON canonicalizes signed zero.
  assert.equal(built.report.officialCreatorTested,false);assert.equal(built.report.appearanceQualityVerified,false);
});

test('runtime premultiplication preserves alpha and input PNGs, without a white fringe',()=>{
  const input=fixture(),part=input.parts[0],im=decode(part.png),data=new Uint8Array(im.data);
  data.set([200,110,60,64],0);data.set([20,30,40,0],4);
  part.png=encode({width:im.width,height:im.height,data,depth:8,channels:4});
  const bytes=part.png.slice(),built=buildQualityModel(input),runtime=readCharacterContainer(built.inp);
  const base=flatten(runtime.model.nodes).find(n=>n.name==='face_base'),pixels=decode(runtime.textures[base.textures[0]]).data;
  assert.deepEqual([...pixels.slice(0,8)],[50,27,15,64,0,0,0,0]);
  assert.deepEqual(part.png,bytes);
  assert.equal(built.report.runtimeTextureAlphaEncoding,'premultiplied-floor-rgb-8bit');
});

test('head movement and tilt preserve every vertex below the fixed neck line',()=>{
  const input=fixture(),{model}=buildQualityModel(input),base=flatten(model.nodes).find(n=>n.name==='face_base');
  for(const name of ['HeadX','HeadTilt']){
    const param=model.param.find(p=>p.name===name),binding=param.bindings.find(b=>b.node===base.uuid);
    for(let t=0;t<=1;t+=.05){
      const offsets=blend(param,binding,t);
      for(let i=0;i<offsets.length;i++){
        const y=base.mesh.uvs[i*2+1]*120;
        if(y>=input.quality.neckBlend.fixedY*120-1e-9)assert.deepEqual(offsets[i],[0,0]);
      }
    }
    assert.ok(binding.values[0][0].some(([x,y])=>Math.abs(x)+Math.abs(y)>0));
    assert.ok(binding.values[1][0].every(([x,y])=>Math.abs(x)+Math.abs(y)<1e-10));
  }
});

test('aperture area closes monotonically while the iris mesh stays undeformed',()=>{
  const {model}=buildQualityModel(fixture()),nodes=flatten(model.nodes);
  for(const side of ['l','r']){
    const param=model.param.find(p=>p.name==='EyeOpen'+side.toUpperCase()),eye=nodes.find(p=>p.name==='eye_white_'+side),mask=nodes.find(p=>p.name==='EyeAperture:'+side);
    assert.ok(!param.bindings.some(b=>b.node===eye.uuid && b.param_name==='deform'));
    assert.deepEqual(eye.masks,[{source:mask.uuid,mode:'Mask'}]);assert.equal(mask.opacity,0);
    const binding=param.bindings.find(b=>b.node===mask.uuid),areas=[];
    for(let step=0;step<=100;step++){
      const offsets=blend(param,binding,step/100),verts=offsets.map(([dx,dy],i)=>[mask.mesh.verts[i*2]+dx,mask.mesh.verts[i*2+1]+dy]);
      let area=0;for(let i=0;i<mask.mesh.indices.length;i+=3){const [a,b,c]=mask.mesh.indices.slice(i,i+3).map(i=>verts[i]);const signed=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);assert.ok(signed>=-1e-9,'aperture must not fold');area+=signed/2;}
      areas.push(area);
    }
    assert.ok(Math.abs(areas[0])<1e-9);
    assert.ok(areas.every((a,i)=>i===0 || a>=areas[i-1]-1e-9));
    assert.ok(areas.at(-1)>100);
    for(const other of nodes.filter(n=>n.name.endsWith('_'+(side==='l'?'r':'l'))))assert.ok(!param.bindings.some(b=>b.node===other.uuid));
  }
});

test('neutral source lash vertices are unchanged and unsupported geometry is rejected',()=>{
  const input=fixture(),{model}=buildQualityModel(input);
  for(const side of ['l','r']){
    const n=flatten(model.nodes).find(n=>n.name==='eye_lash_'+side),p=model.param.find(p=>p.name==='EyeOpen'+side.toUpperCase());
    const offsets=blend(p,p.bindings.find(b=>b.node===n.uuid && b.param_name==='deform'),1);
    assert.ok(offsets.every(([x,y])=>Math.abs(x)+Math.abs(y)<1e-10));
  }
  input.quality.neckBlend.fixedY=input.quality.neckBlend.rigidY;
  assert.throws(()=>buildQualityModel(input),/neck/);
  delete input.quality;
  assert.throws(()=>buildQualityModel(input),/quality/);
});
