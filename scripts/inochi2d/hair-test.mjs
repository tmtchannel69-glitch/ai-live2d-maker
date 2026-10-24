import {test} from 'node:test';
import assert from 'node:assert/strict';
import {headFixture} from './rig-fixture.mjs';
import {buildHeadModel} from './head-rig.mjs';
import {buildHairModel} from './hair-rig.mjs';
import {readCharacterContainer} from './character-model.mjs';

const flat=n=>[n,...n.children.flatMap(flat)];
function fixture(){
  const f=headFixture(),image=(w,h,color)=>{const data=new Uint8Array(w*h*4);for(let i=0;i<data.length;i+=4)data.set(color,i);return {width:w,height:h,data};};
  const box=[8,4,10,61],hair=image(10,61,[120,135,180,255]);
  for(let y=4;y<65;y++)for(let x=8;x<18;x++)f.images['observed/head_surface.png'].data.fill(0,(y*100+x)*4,(y*100+x+1)*4);
  f.images['observed/hair_strand_00.png']=hair;
  f.graph.parts.push({id:'hair_strand_00',role:'hair_strand',side:null,source_box_xywh:box,hair_region:'front',
    observed:{rgba:'observed/hair_strand_00.png'},completion:{rgba:null},motion:{root_xy:[13,7],maximum_exposure_pixels:5}});
  f.images['completion/face_skin_behind_fringe.png']=image(10,61,[245,210,190,255]);
  f.graph.parts.push({id:'face_skin_behind_fringe',role:'skin_completion',side:null,source_box_xywh:box,
    observed:{rgba:null},completion:{rgba:'completion/face_skin_behind_fringe.png'}});
  return f;
}

test('bounded hair extension preserves input and verified head/blink parameters',()=>{
  const f=fixture(),before=structuredClone(f),head=buildHeadModel(f.graph,f.images),out=buildHairModel(f.graph,f.images);
  assert.deepEqual(f,before);assert.deepEqual(out.model.param.slice(0,4),head.model.param);
  assert.equal(out.report.verifiedHeadModelSha256,head.report.inpSha256);
  assert.equal(out.report.anatomicalRootsVerified,false);assert.equal(out.report.frontBackHairDepthVerified,false);
  assert.equal(out.report.physicsConfigured,false);
  const parsed=readCharacterContainer(out.inp);assert.equal(parsed.textures.length,out.report.textures);
});

test('strand root support is fixed, neutral deformation is zero, and every mesh stays unfolded',()=>{
  const f=fixture(),out=buildHairModel(f.graph,f.images),nodes=flat(out.model.nodes),p=out.model.param.find(p=>p.name==='HairSway00');
  for(const b of p.bindings){
    const n=nodes.find(n=>n.uuid===b.node);
    assert.ok(b.values[1][0].every(v=>v.every(c=>c===0)));
    for(const key of b.values){
      const v=n.mesh.verts.map((x,i)=>x+key[0][Math.floor(i/2)][i%2]);
      for(let i=0;i<n.mesh.indices.length;i+=3){const [a,b,c]=n.mesh.indices.slice(i,i+3).map(j=>[v[j*2],v[j*2+1]]);assert.ok((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0);}
    }
  }
  const part=nodes.find(n=>n.name==='hair_strand_00'),b=p.bindings.find(b=>b.node===part.uuid);
  assert.ok(b.values.every(key=>key[0].slice(0,13).every(v=>v.every(c=>c===0))));
  assert.ok(b.values[2][0].some(([x,y])=>Math.abs(x)+Math.abs(y)>0));
});

test('native pendulum targets the automatic strand parameter and uses its measured root',()=>{
  const f=fixture(),out=buildHairModel(f.graph,f.images,{physics:true}),nodes=flat(out.model.nodes);
  const driver=nodes.find(n=>n.type==='SimplePhysics'),root=nodes.find(n=>n.name==='HairRoot:00'),p=out.model.param.find(p=>p.name==='HairSway00');
  assert.ok(root.children.includes(driver));assert.equal(driver.param,p.uuid);assert.equal(driver.model_type,'Pendulum');
  assert.equal(driver.local_only,false);assert.equal(driver.map_mode,'AngleLength');assert.deepEqual(driver.output_scale,[40,0]);
  assert.equal(out.report.physicsConfigured,true);assert.equal(out.report.physicsRuntimeVerified,false);
  assert.deepEqual(out.inp,buildHairModel(f.graph,f.images,{physics:true}).inp);
});

test('inferred fringe is inverse-masked by observed hair and missing/invalid roots are rejected',()=>{
  let f=fixture(),out=buildHairModel(f.graph,f.images),nodes=flat(out.model.nodes),bed=nodes.find(n=>n.name==='fringe_skin_underpaint');
  assert.ok(bed.masks.length);assert.ok(bed.masks.every(m=>m.mode==='DodgeMask'));
  assert.ok(bed.masks.every(m=>nodes.find(n=>n.uuid===m.source).mask_threshold===.96));
  f=fixture();f.graph.parts.find(p=>p.role==='hair_strand').motion.root_xy=[-10,0];assert.throws(()=>buildHairModel(f.graph,f.images),/root/);
  f=headFixture();assert.throws(()=>buildHairModel(f.graph,f.images),/candidates/);
});
