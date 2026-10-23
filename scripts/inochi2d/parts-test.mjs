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

function contourFixture(){
  const f=fixture();for(const g of Object.values(f.graph.motions.blink)){
    g.profile='contour-lid-v2';g.lower_center_y=Array(25).fill(15);
  }return f;
}

test('contour profile retains all ten exact keys and the existing head controls',()=>{
  const original=fixture(),v2=contourFixture(),old=buildPartsModel(original.graph,original.images),current=buildPartsModel(v2.graph,v2.images);
  assert.deepEqual(current.model.param.filter(p=>p.name.startsWith('Head')),old.model.param.filter(p=>p.name.startsWith('Head')));
  for(const p of current.model.param.filter(p=>p.name.startsWith('EyeOpen'))){
    assert.deepEqual(p.axis_points[0],[0,.025,.05,.075,.1,.15,.25,.5,.75,1]);
  }
  assert.equal(current.report.blinkRig.profile,'contour-lid-v2');
  assert.equal(old.report.blinkRig,undefined);
});

test('low-opening contour uses one estimated stroke and raw zero hides the ocular image',()=>{
  const {graph,images}=contourFixture(),{model}=buildPartsModel(graph,images),nodes=flat(model.nodes);
  for(const side of ['l','r']){
    const p=model.param.find(p=>p.name==='EyeOpen'+side.toUpperCase());
    for(const [i,v] of p.axis_points[0].entries()){
      if(v>.25)continue;
      for(const name of ['eye_lash_','eye_lash_lower_','eye_closed_','eye_white_']){
        const n=nodes.find(n=>n.name===name+side),b=p.bindings.find(b=>b.node===n.uuid&&b.param_name==='opacity');
        const expected=name==='eye_closed_'?1:name==='eye_white_'&&v>0?1:0;
        assert.equal(b.values[i][0],expected);
      }
    }
  }
});

test('contour projection rejects translucent ocular paint instead of changing original alpha',()=>{
  const {graph,images}=contourFixture();images['observed/eye_l_iris.png'].data[(6*12+7)*4+3]=128;
  assert.throws(()=>buildPartsModel(graph,images),/opaque eye observations/);
});

test('a fully covered lash core never mixes skin into the half-open transition',()=>{
  const {graph,images}=contourFixture(),{model}=buildPartsModel(graph,images),nodes=flat(model.nodes);
  for(const side of ['l','r']){
    const upper=nodes.find(n=>n.name==='eye_lash_'+side),closed=nodes.find(n=>n.name==='eye_closed_'+side),p=model.param.find(p=>p.name==='EyeOpen'+side.toUpperCase());
    assert.ok(closed.zsort>upper.zsort);
    const k=p.axis_points[0].indexOf(.5),opacity=n=>p.bindings.find(b=>b.node===n.uuid&&b.param_name==='opacity').values[k][0];
    const a=opacity(upper),b=opacity(closed);
    const coverage=a+b*(1-a);
    assert.equal(coverage,1);
    const color=40*a+45*b*(1-a)+245*(1-coverage);
    assert.ok(color>=40&&color<=45);
  }
});

test('contour meshes stay unfolded at keys and intermediate values; neutral UV geometry is unchanged',()=>{
  const {graph,images}=contourFixture(),{model}=buildPartsModel(graph,images),nodes=flat(model.nodes);
  for(const p of model.param.filter(p=>p.name.startsWith('EyeOpen'))){
    for(const b of p.bindings.filter(b=>b.param_name==='deform')){
      const n=nodes.find(n=>n.uuid===b.node),w=n.name.endsWith('l')?graph.motions.blink.l.box_xywh[2]:graph.motions.blink.r.box_xywh[2],h=16;
      for(let i=0;i<n.mesh.uvs.length;i+=2){
        assert.ok(Math.abs(n.mesh.verts[i]-(n.mesh.uvs[i]-.5)*w)<1e-8);
        assert.ok(Math.abs(n.mesh.verts[i+1]-(n.mesh.uvs[i+1]-.5)*h)<1e-8);
      }
      const d=b.values.at(-1)[0];assert.ok(d.every(([x,y])=>Math.abs(x)+Math.abs(y)<1e-8)||n.name.startsWith('eye_closed_'));
      for(let key=0;key<b.values.length-1;key++)for(const t of [0,.25,.5,.75,1]){
        const a=b.values[key][0],c=b.values[key+1][0],verts=n.mesh.verts.map((x,i)=>x+a[Math.floor(i/2)][i%2]*(1-t)+c[Math.floor(i/2)][i%2]*t);
        for(let i=0;i<n.mesh.indices.length;i+=3){
          const [aa,bb,cc]=n.mesh.indices.slice(i,i+3).map(j=>[verts[j*2],verts[j*2+1]]);
          assert.ok((bb[0]-aa[0])*(cc[1]-aa[1])-(bb[1]-aa[1])*(cc[0]-aa[0])>=-1e-7,`${n.name} folded at ${key}/${t}`);
        }
      }
    }
  }
});
