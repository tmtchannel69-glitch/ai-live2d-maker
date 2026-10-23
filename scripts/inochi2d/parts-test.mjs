import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encode,decode} from 'fast-png';
import {buildPartsModel} from './parts-adapter.mjs';
import {readCharacterContainer} from './character-model.mjs';

function fixture(){
  const source={width:100,height:120},images={},parts=[];
  const image=(w,h)=>({width:w,height:h,data:new Uint8Array(w*h*4)});
  const add=(id,role,im,box,side=null,completion=false)=>{
    const path=(completion?'completion/':'observed/')+id+'.png';images[path]=im;
    const descriptor={rgba:path,mask:null,pixels:im.data.filter((v,i)=>i%4===3&&v>0).length};
    parts.push({id,role,side,source_box_xywh:box,observed:completion?{rgba:null,mask:null,pixels:0}:descriptor,completion:completion?descriptor:{rgba:null,mask:null,pixels:0}});
  };
  const base=image(100,120);for(let i=0;i<base.data.length;i+=4)base.data.set([245,210,190,255],i);
  base.data.set([100,80,60,128],(100*100+50)*4);
  const skin=image(100,120),blink={};
  for(const [index,side] of ['l','r'].entries()){
    const x=index?28:58,y=28,w=12,h=16,box=[x,y,w,h];
    const bands=Object.fromEntries(['sclera','iris','pupil','highlight','eyelash_upper','eyelash_lower'].map(r=>[r,image(w,h)]));
    for(let j=0;j<h;j++)for(let i=0;i<w;i++){
      let role='sclera',color=[250,249,247,255];
      if(j<3){role='eyelash_upper';color=[40,30,35,255];}
      else if(j===h-1){role='eyelash_lower';color=[70,50,60,255];}
      else if(i>3&&i<9){role='iris';color=[90,80,170,255];if(i===6&&j>5&&j<10){role='pupil';color=[25,25,40,255];}if(i===5&&j===5){role='highlight';color=[255,255,255,255];}}
      bands[role].data.set(color,(j*w+i)*4);base.data.fill(0,((y+j)*100+x+i)*4,((y+j)*100+x+i+1)*4);skin.data.set([245,210,190,255],((y+j)*100+x+i)*4);
    }
    for(const [role,im] of Object.entries(bands))add(`eye_${side}_${role}`,role,im,box,side);
    const closed=image(w,h);for(let i=1;i<w-1;i++)closed.data.set([45,30,35,255],(8*w+i)*4);
    add(`eye_${side}_closed`,'closed_eyelash',closed,box,side,true);
    blink[side]={box_xywh:box,upper_center_y:Array(13).fill(1.5),closed_center_y:Array(13).fill(8),source_lash_width:3,closed_lash_width:1};
  }
  add('foreground_base','foreground_remainder',base,[0,0,100,120]);add('eye_skin_underpaint','skin_completion',skin,[0,0,100,120],null,true);
  return {graph:{format:'ai-live2d-maker-character-parts',version:1,source,parts,motions:{blink,head:{pivot:{x:.5,y:.58},neck_blend:{rigidY:.54,fixedY:.68}}}},images};
}
function flat(n){return [n,...n.children.flatMap(flat)];}

test('shared eye assets stay independent while the runtime declares flattening',()=>{
  const {graph,images}=fixture(),before=structuredClone({graph,images}),built=buildPartsModel(graph,images);
  assert.deepEqual({graph,images},before);
  const parsed=readCharacterContainer(built.inp);
  assert.equal(parsed.textures.length,10);assert.equal(built.report.drawableParts,11);
  assert.equal(built.report.decodedTextureBytes,parsed.textures.reduce((n,p)=>{const im=decode(p);return n+im.width*im.height*4;},0));
  assert.equal(built.report.independentGazeRigged,false);assert.equal(built.report.hairStrandsRigged,false);
  assert.equal(built.report.officialCreatorTested,false);
  for(const side of ['l','r'])for(const role of ['sclera','iris','pupil','highlight'])assert.ok(images[`observed/eye_${side}_${role}.png`]);
});

test('raw closed zero removes upper and lower source lash and original ocular image',()=>{
  const {graph,images}=fixture(),{model}=buildPartsModel(graph,images),nodes=flat(model.nodes);
  for(const side of ['l','r']){
    const p=model.param.find(p=>p.name==='EyeOpen'+side.toUpperCase());
    for(const name of ['eye_white_','eye_lash_','eye_lash_lower_']){
      const node=nodes.find(n=>n.name===name+side),b=p.bindings.find(b=>b.node===node.uuid&&b.param_name==='opacity');
      assert.equal(b.values[0][0],0);assert.equal(b.values.at(-1)[0],1);
    }
    const lower=nodes.find(n=>n.name==='eye_lash_lower_'+side),b=p.bindings.find(b=>b.node===lower.uuid&&b.param_name==='opacity');
    assert.equal(b.values[p.axis_points[0].indexOf(.18)][0],0);
  }
});

test('neutral upper/source lower vertices and alpha remain intact',()=>{
  const {graph,images}=fixture(),{model,inp}=buildPartsModel(graph,images),nodes=flat(model.nodes);
  for(const side of ['l','r']){
    const p=model.param.find(p=>p.name==='EyeOpen'+side.toUpperCase());
    for(const name of ['eye_lash_','eye_lash_lower_']){
      const node=nodes.find(n=>n.name===name+side),b=p.bindings.find(b=>b.node===node.uuid&&b.param_name==='deform');
      assert.ok(b.values.at(-1)[0].every(([x,y])=>Math.abs(x)+Math.abs(y)<1e-9));
    }
  }
  const parsed=readCharacterContainer(inp),base=nodes.find(n=>n.name==='face_base'),im=decode(parsed.textures[base.textures[0]]);
  assert.deepEqual([...im.data.slice((100*100+50)*4,(100*100+50)*4+4)],[50,40,30,128]);
});

test('overlapping observed owners are rejected instead of hidden by completion',()=>{
  const {graph,images}=fixture(),p=structuredClone(graph.parts[0]);p.id='duplicate';graph.parts.push(p);
  assert.throws(()=>buildPartsModel(graph,images),/overlap/);
});
