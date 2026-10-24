import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decode} from 'fast-png';
import {buildHeadModel} from './head-rig.mjs';
import {buildPartsModel} from './parts-adapter.mjs';
import {readCharacterContainer} from './character-model.mjs';

function fixture(){
  const image=(width,height)=>({width,height,data:new Uint8Array(width*height*4)});
  const images={},parts=[],base=image(100,120),skin=image(100,120),blink={};
  for(let i=0;i<base.data.length;i+=4)base.data.set([245,210,190,255],i);
  base.data.set([100,80,60,128],(100*100+50)*4);
  const add=(id,role,im,box,side=null,completion=false)=>{
    const path=(completion?'completion/':'observed/')+id+'.png';images[path]=im;
    parts.push({id,role,side,source_box_xywh:box,observed:{rgba:completion?null:path},completion:{rgba:completion?path:null}});
  };
  for(const [index,side] of ['l','r'].entries()){
    const x=index?28:58,y=28,w=12,h=16,box=[x,y,w,h];
    const bands=Object.fromEntries(['sclera','iris','eyelash_upper','eyelash_lower'].map(r=>[r,image(w,h)]));
    for(let j=0;j<h;j++)for(let i=0;i<w;i++){
      const role=j<3?'eyelash_upper':j===h-1?'eyelash_lower':i>3&&i<9?'iris':'sclera';
      const color=role.includes('eyelash')?[40,30,35,255]:role==='iris'?[90,80,170,255]:[250,249,247,255];
      bands[role].data.set(color,(j*w+i)*4);base.data.fill(0,((y+j)*100+x+i)*4,((y+j)*100+x+i+1)*4);
      skin.data.set([245,210,190,255],((y+j)*100+x+i)*4);
    }
    for(const [role,im] of Object.entries(bands))add(`eye_${side}_${role}`,role,im,box,side);
    const closed=image(w,h);for(let i=1;i<w-1;i++)closed.data.set([45,30,35,255],(8*w+i)*4);
    add(`eye_${side}_closed`,'closed_eyelash',closed,box,side,true);
    blink[side]={profile:'contour-lid-v2',box_xywh:box,upper_center_y:Array(25).fill(1.5),
      closed_center_y:Array(25).fill(8),lower_center_y:Array(25).fill(15),source_lash_width:3,closed_lash_width:1};
  }
  for(const [role,y,h] of [['head_surface',0,70],['neck',70,15],['body',85,35]]){
    const im=image(100,h);im.data.set(base.data.subarray(y*100*4,(y+h)*100*4));add(role,role,im,[0,y,100,h]);
  }
  add('eye_skin_underpaint','skin_completion',skin,[0,0,100,120],null,true);
  return {images,graph:{format:'ai-live2d-maker-character-parts',version:1,source:{width:100,height:120},parts,
    motions:{blink,head:{pivot:{x:.5,y:.58},neck_blend:{rigidY:.54,fixedY:.68}},
      independent_head:{profile:'head-neck-body-v1',jaw:{coefficients_normalized_x:[0,0,70],center_x:50,x_scale:60,center_y:70},
        collar_y:85,head_pivot_xy:[50,70],maximum_translation_pixels:1.4,maximum_tilt_radians:.045}}}};
}
const flat=n=>[n,...n.children.flatMap(flat)];

test('layered rig preserves input and the serialized blink bindings',()=>{
  const f=fixture(),before=structuredClone(f),baseline=buildPartsModel(f.graph,f.images),out=buildHeadModel(f.graph,f.images);
  assert.deepEqual(f,before);
  assert.deepEqual(out.model.param.filter(p=>p.name.startsWith('Eye')),baseline.model.param.filter(p=>p.name.startsWith('Eye')));
  assert.equal(out.report.baselineBlinkModelSha256,baseline.report.inpSha256);
  assert.equal(out.report.faceAnglesXYRigged,false);assert.equal(out.report.physicsRigged,false);
});

test('body, neck and head have separate parents and torso has no head bindings',()=>{
  const f=fixture(),{model}=buildHeadModel(f.graph,f.images),nodes=flat(model.nodes);
  const body=nodes.find(n=>n.name==='Body'),neck=nodes.find(n=>n.name==='Neck'),head=nodes.find(n=>n.name==='Head');
  assert.ok(model.nodes.children.includes(body));assert.ok(body.children.includes(neck));assert.ok(neck.children.includes(head));
  const bodyPart=nodes.find(n=>n.name==='body');assert.ok(body.children.includes(bodyPart));
  assert.equal(model.param.filter(p=>p.name.startsWith('Head')).flatMap(p=>p.bindings).some(b=>b.node===bodyPart.uuid),false);
});

test('neck top follows head while collar vertices stay exactly fixed, also between keys',()=>{
  const f=fixture(),{model}=buildHeadModel(f.graph,f.images),neck=flat(model.nodes).find(n=>n.name==='neck');
  const x=model.param.find(p=>p.name==='HeadX').bindings.find(b=>b.node===neck.uuid),tilt=model.param.find(p=>p.name==='HeadTilt').bindings.find(b=>b.node===neck.uuid);
  for(const b of [x,tilt])for(const frame of b.values){
    for(let i=neck.mesh.verts.length/2-25;i<neck.mesh.verts.length/2;i++)assert.ok(frame[0][i].every(v=>v===0));
  }
  assert.equal(x.values[0][0][0][0],-1.4);assert.equal(x.values[2][0][0][0],1.4);
  for(const a of [-1,-.5,0,.5,1])for(const b of [-1,-.5,0,.5,1]){
    const sample=(binding,value,i,c)=>{const key=value<0?0:1,t=value<0?value+1:value;return binding.values[key][0][i][c]*(1-t)+binding.values[key+1][0][i][c]*t;};
    const v=neck.mesh.verts.map((p,i)=>p+sample(x,a,Math.floor(i/2),i%2)+sample(tilt,b,Math.floor(i/2),i%2));
    for(let i=0;i<neck.mesh.indices.length;i+=3){
      const [aa,bb,cc]=neck.mesh.indices.slice(i,i+3).map(j=>[v[j*2],v[j*2+1]]);
      assert.ok((bb[0]-aa[0])*(cc[1]-aa[1])-(bb[1]-aa[1])*(cc[0]-aa[0])>0);
    }
  }
});

test('stored partial alpha is not premultiplied twice and generation is deterministic',()=>{
  const f=fixture(),out=buildHeadModel(f.graph,f.images),parsed=readCharacterContainer(out.inp);
  const body=flat(parsed.model.nodes).find(n=>n.name==='body'),im=decode(parsed.textures[body.textures[0]]);
  assert.deepEqual([...im.data.slice(((100-85)*100+50)*4,((100-85)*100+50)*4+4)],[50,40,30,128]);
  assert.deepEqual(out.inp,buildHeadModel(f.graph,f.images).inp);
  assert.equal(out.report.decodedTextureBytes,parsed.textures.reduce((n,p)=>{const im=decode(p);return n+im.width*im.height*4;},0));
});

test('missing neck and unsupported motion ranges fail explicitly',()=>{
  let f=fixture();f.graph.parts=f.graph.parts.filter(p=>p.id!=='neck');assert.throws(()=>buildHeadModel(f.graph,f.images),/neck/);
  f=fixture();f.graph.motions.independent_head.maximum_tilt_radians=.5;assert.throws(()=>buildHeadModel(f.graph,f.images),/motion range/);
  f=fixture();f.images['observed/neck.png'].data.fill(0);assert.throws(()=>buildHeadModel(f.graph,f.images),/missing|dummy/);
});

test('hidden underlap is a separately inverse-masked node, preserving alpha254 source',()=>{
  const f=fixture(),body=f.graph.parts.find(p=>p.id==='body'),im={width:100,height:120,data:new Uint8Array(100*120*4)};
  im.data.set(f.images[body.observed.rgba].data,85*100*4);f.images[body.observed.rgba]=im;body.source_box_xywh=[0,0,100,120];
  const fill={width:100,height:120,data:new Uint8Array(100*120*4)};
  for(let x=0;x<4;x++){
    fill.data.set([190,180,150,255],(65*100+x)*4);
    f.images['observed/head_surface.png'].data[(65*100+x)*4+3]=254;
  }
  body.completion.rgba='completion/body.png';body.occluded_by=['head_surface'];f.images[body.completion.rgba]=fill;
  const out=buildHeadModel(f.graph,f.images),parsed=readCharacterContainer(out.inp),nodes=flat(parsed.model.nodes);
  const under=nodes.find(n=>n.name==='body_underpaint'),surface=nodes.find(n=>n.name==='head_surface');
  assert.deepEqual(under.masks,[{source:surface.uuid,mode:'DodgeMask'},
    {source:nodes.find(n=>n.name==='body').uuid,mode:'DodgeMask'}]);
  const tex=decode(parsed.textures[surface.textures[0]]);assert.equal(tex.data[(65*100)*4+3],254);
  const bed=decode(parsed.textures[under.textures[0]]);assert.equal(bed.data[((100-65)*100+50)*4+3],0);
  assert.ok(under.zsort>nodes.find(n=>n.name==='body').zsort);
});

test('measured curved collar anchors slanted side boundaries without moving the torso',()=>{
  const f=fixture(),q=f.graph.motions.independent_head;
  q.collar_curve={x:Array.from({length:25},(_,i)=>i*100/24),y:Array.from({length:25},(_,i)=>85-Math.abs(i-12)/12*5),fixed_border_pixels:3};
  const out=buildHeadModel(f.graph,f.images),neck=flat(out.model.nodes).find(n=>n.name==='neck');
  for(const p of out.model.param.filter(p=>p.name.startsWith('Head'))){
    const b=p.bindings.find(b=>b.node===neck.uuid);
    for(let i=0;i<neck.mesh.uvs.length;i+=2){
      const x=neck.mesh.uvs[i]*100,y=70+neck.mesh.uvs[i+1]*15,edge=85-Math.abs(x-50)/50*5-3;
      if(y>=edge)for(const key of b.values)assert.ok(key[0][i/2].every(v=>v===0));
    }
  }
  q.collar_curve.x.fill(0);assert.throws(()=>buildHeadModel(f.graph,f.images),/collar curve/);
});
