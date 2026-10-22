import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encode,decode} from 'fast-png';
import {zipSync,strToU8} from 'fflate';
import {buildCharacterModel,readCharacterContainer,characterFromHandoffZip} from './character-model.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const identity=[1,0,0,1,0,0];
const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
const grid=Array.from({length:9},(_,i)=>[i%3/2,Math.floor(i/3)/2]);
const triangles=[[0,1,3],[1,4,3],[1,2,4],[2,5,4],[3,4,6],[4,7,6],[4,5,7],[5,8,7]];

function png(width,height,color){const data=new Uint8Array(width*height*4);for(let i=0;i<data.length;i+=4)data.set(color,i);return encode({width,height,data,channels:4,depth:8});}
function input(){
  const source={width:100,height:120};
  const specs=[
    ['hair_back',20,5,60,65,[180,180,210,255],0,'head'],
    ['body',30,70,40,40,[45,45,55,255],10,'root'],
    ['face_base',30,10,40,50,[250,220,200,255],20,'head'],
    ['eye_white_l',53,28,8,6,[40,90,210,255],35,'head'],
    ['eye_white_r',39,28,8,6,[60,110,230,255],35,'head'],
    ['eye_closed_l',53,30,8,2,[30,25,40,255],45,'head'],
    ['eye_closed_r',39,30,8,2,[35,25,45,255],45,'head'],
    ['eyebrow_l',54,25,6,1,[110,100,130,255],50,'head'],
    ['eyebrow_r',40,25,6,1,[115,100,135,255],50,'head'],
    ['mouth_closed',46,50,8,2,[160,70,80,255],55,'head'],
    ['hair_front',25,5,50,13,[190,190,220,255],90,'head'],
  ];
  return {name:'Original rectangular character fixture',source,parts:specs.map(([role,x,y,width,height,color,order,parent])=>({role,width,height,placement:{x:x/100,y:y/120,width:width/100,height:height/120},png:png(width,height,color),kind:role.startsWith('eye_closed')?'generated-local':'source',order,parent}))};
}
function flatten(node,parent=null,result=[]){result.push({node,parent});for(const child of node.children||[])flatten(child,node,result);return result;}

// Independent legacy-container check: no exporter reader is used here.
function sections(bytes){
  const b=Buffer.from(bytes);assert.equal(b.toString('ascii',0,8),'TRNSRTS\0');
  const length=b.readUInt32BE(8),model=JSON.parse(b.toString('utf8',12,12+length));let offset=12+length;
  assert.equal(b.toString('ascii',offset,offset+8),'TEX_SECT');offset+=8;
  const count=b.readUInt32BE(offset);offset+=4;const textures=[];
  for(let i=0;i<count;i++){const length=b.readUInt32BE(offset);offset+=4;assert.equal(b[offset++],0);textures.push(new Uint8Array(b.subarray(offset,offset+length)));offset+=length;}
  assert.equal(offset,b.length);return {model,textures};
}
function interpolate(values,axis,t){
  if(t<=axis[0])return values[0][0];if(t>=axis.at(-1))return values.at(-1)[0];
  const i=axis.findIndex(x=>x>=t),u=(t-axis[i-1])/(axis[i]-axis[i-1]);
  const blend=(a,b)=>Array.isArray(a)?a.map((x,k)=>blend(x,b[k])):a+(b-a)*u;
  return blend(values[i-1][0],values[i][0]);
}
function evaluated(model,requested={}){
  const states=new Map(flatten(model.nodes).map(({node})=>[node.uuid,{node,transform:structuredClone(node.transform),opacity:node.opacity??1,deform:node.mesh?Array.from({length:node.mesh.verts.length/2},()=>[0,0]):null}]));
  for(const p of model.param){
    const raw=requested[p.name]??p.defaults[0],t=(raw-p.min[0])/(p.max[0]-p.min[0]);
    for(const b of p.bindings){
      const s=states.get(b.node),v=interpolate(b.values,p.axis_points[0],t);
      if(b.param_name==='opacity')s.opacity*=v;
      else if(b.param_name==='deform')s.deform=s.deform.map((x,i)=>x.map((a,k)=>a+v[i][k]));
      else {const match=/^transform\.([trs])\.([xyz])$/.exec(b.param_name);assert.ok(match,`known binding ${b.param_name}`);const field={t:'trans',r:'rot',s:'scale'}[match[1]],i='xyz'.indexOf(match[2]);if(field==='scale')s.transform[field][i]*=v;else s.transform[field][i]+=v;}
    }
  }
  const world=new Map();
  function visit(node,parent=identity){const s=states.get(node.uuid),t=s.transform,c=Math.cos(t.rot[2]),n=Math.sin(t.rot[2]),local=[c*t.scale[0],n*t.scale[0],-n*t.scale[1],c*t.scale[1],t.trans[0],t.trans[1]],m=multiply(parent,local);world.set(node.uuid,m);for(const child of node.children||[])visit(child,m);}
  visit(model.nodes);return {states,world};
}

// Small opaque fixture renderer, independent of official runtime checks. It
// checks source ownership and neutral UV/mesh/placement without antialiasing.
function render(model,textures,source,requested={}){
  const result=new Uint8Array(source.width*source.height*4),{states,world}=evaluated(model,requested);
  const parts=[...states.values()].filter(s=>s.node.type==='Part'&&s.node.enabled!==false&&s.opacity>0).sort((a,b)=>b.node.zsort-a.node.zsort);
  for(const s of parts){
    const n=s.node,im=decode(textures[n.textures[0]]),m=world.get(n.uuid),v=Array.from({length:n.mesh.verts.length/2},(_,i)=>point(m,n.mesh.verts[i*2]+s.deform[i][0]+0,n.mesh.verts[i*2+1]+s.deform[i][1]));
    const loX=Math.max(0,Math.floor(Math.min(...v.map(p=>p[0]))+source.width/2)),hiX=Math.min(source.width,Math.ceil(Math.max(...v.map(p=>p[0]))+source.width/2));
    const loY=Math.max(0,Math.floor(Math.min(...v.map(p=>p[1]))+source.height/2)),hiY=Math.min(source.height,Math.ceil(Math.max(...v.map(p=>p[1]))+source.height/2));
    for(let y=loY;y<hiY;y++)for(let x=loX;x<hiX;x++){
      const px=x+.5-source.width/2,py=y+.5-source.height/2;let uv;
      for(let j=0;j<n.mesh.indices.length;j+=3){const ids=n.mesh.indices.slice(j,j+3),[a,b,c]=ids.map(i=>v[i]),den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-10)continue;const u=((b[1]-c[1])*(px-c[0])+(c[0]-b[0])*(py-c[1]))/den,w=((c[1]-a[1])*(px-c[0])+(a[0]-c[0])*(py-c[1]))/den,z=1-u-w;if(Math.min(u,w,z)<-1e-8)continue;uv=[0,1].map(k=>u*n.mesh.uvs[ids[0]*2+k]+w*n.mesh.uvs[ids[1]*2+k]+z*n.mesh.uvs[ids[2]*2+k]);break;}
      if(!uv)continue;const sx=Math.min(im.width-1,Math.max(0,Math.floor(uv[0]*im.width))),sy=Math.min(im.height-1,Math.max(0,Math.floor(uv[1]*im.height))),a=(sy*im.width+sx)*4,d=(y*source.width+x)*4,sa=im.data[a+3]/255*s.opacity,da=result[d+3]/255,oa=sa+da*(1-sa);if(!oa)continue;
      for(let k=0;k<3;k++)result[d+k]=Math.round((im.data[a+k]*sa+result[d+k]*da*(1-sa))/oa);result[d+3]=Math.round(oa*255);
    }
  }
  return result;
}
function expectedNeutral(spec){
  const data=new Uint8Array(spec.source.width*spec.source.height*4);
  for(const p of spec.parts.filter(p=>!p.role.startsWith('eye_closed')).sort((a,b)=>a.order-b.order)){
    const im=decode(p.png),left=Math.round(p.placement.x*spec.source.width),top=Math.round(p.placement.y*spec.source.height);
    for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++)data.set(im.data.subarray((y*im.width+x)*4,(y*im.width+x+1)*4),((top+y)*spec.source.width+left+x)*4);
  }
  return data;
}
function handoff(overrides={}){
  const original=input(),expressions=original.parts.filter(p=>p.role.startsWith('eye_')||p.role==='face_base'||p.role==='mouth_closed').map(({png,...p})=>({...p,name:`${p.role}.png`,path:`expressions/${p.role}.png`}));
  const body=original.parts.find(p=>p.role==='body'),data=new Uint8Array(original.source.width*original.source.height*4),bodyIm=decode(body.png);
  for(let y=0;y<body.height;y++)data.set(bodyIm.data.subarray(y*body.width*4,(y+1)*body.width*4),((70+y)*100+30)*4);
  const bodyPng=encode({width:100,height:120,data,depth:8,channels:4});
  const manifest={format:'ai-live2d-maker-authoring-handoff',version:2,containsOriginal:false,live2dCompatible:false,source:original.source,coordinateSystem:'source-normalized-top-left',parts:[{id:'body',kind:'ai',alignment:'source-canvas',path:'parts/body.png',dimensions:original.source,motion:{x:.5,y:.3,order:0,head:false,swing:0}}],expressions,settings:{layers:{},deforms:{},clips:{},groups:{transforms:{},assignments:{},clipFollow:{}},groupKeys:{},clipKeys:{}},mesh:{grid,triangles},groupParents:{face:null,left_eye:'face',right_eye:'face',mouth:'face'},...overrides};
  const entries={'handoff.json':strToU8(JSON.stringify(manifest)),'parts/body.png':bodyPng};
  for(const p of original.parts)if(expressions.some(e=>e.role===p.role))entries[`expressions/${p.role}.png`]=p.png;
  return {manifest,entries,zip:zipSync(entries,{level:0})};
}

test('character exporter writes deterministic legacy containers and keeps original PNG assets unchanged',()=>{
  const spec=input(),before=spec.parts.map(p=>hash(p.png)),a=buildCharacterModel(spec),b=buildCharacterModel(spec),parsed=sections(a.inp),read=readCharacterContainer(a.inp);
  assert.deepEqual(a.inp,b.inp);assert.deepEqual(a.inx,b.inx);assert.deepEqual(a.inp,a.inx);assert.equal(parsed.model.meta.version,'v0.8.6');
  assert.deepEqual(read.model,parsed.model);assert.deepEqual(parsed.textures.map(hash).sort(),before.slice().sort());assert.deepEqual(spec.parts.map(p=>hash(p.png)),before);
  assert.equal(a.report.live2dCompatible,false);assert.equal(a.report.officialCreatorTested,false);
  const tree=flatten(parsed.model.nodes),parts=tree.filter(({node})=>node.type==='Part');assert.equal(parts.length,spec.parts.length);assert.equal(new Set(tree.map(({node})=>node.uuid)).size,tree.length);
  for(const {node} of parts){assert.equal(node.mesh.verts.length,node.mesh.uvs.length);assert.ok(node.mesh.verts.every(Number.isFinite));assert.ok(node.mesh.uvs.every(n=>Number.isFinite(n)&&n>=0&&n<=1));assert.ok(node.mesh.indices.every(i=>Number.isInteger(i)&&i>=0&&i<node.mesh.verts.length/2));assert.ok(node.textures[0]>=0&&node.textures[0]<parsed.textures.length);}
});

test('neutral full-character assembly reproduces all owned source pixels and hides the closed-eye replacement',()=>{
  const spec=input(),{model,textures}=sections(buildCharacterModel(spec).inp);
  assert.deepEqual(render(model,textures,spec.source),expectedNeutral(spec));
  const state=evaluated(model),byName=new Map([...state.states.values()].map(s=>[s.node.name,s]));
  for(const role of ['eye_closed_l','eye_closed_r'])assert.equal(byName.get(role).opacity,0);
  for(const role of ['eye_white_l','eye_white_r'])assert.equal(byName.get(role).opacity,1);
});

test('eyes blink independently, while horizontal motion and planar tilt are separate from the static body',()=>{
  const spec=input(),{model,textures}=sections(buildCharacterModel(spec).inp),tree=flatten(model.nodes),byName=new Map(tree.map(x=>[x.node.name,x])),params=new Map(model.param.map(p=>[p.name,p]));
  for(const name of ['EyeOpenL','EyeOpenR','HeadX','HeadTilt'])assert.ok(params.has(name),name);
  const leftIds=new Set(params.get('EyeOpenL').bindings.map(b=>b.node));assert.ok(params.get('EyeOpenR').bindings.every(b=>!leftIds.has(b.node)));
  assert.ok(params.get('HeadX').bindings.some(b=>b.param_name==='transform.t.x'));assert.ok(params.get('HeadX').bindings.every(b=>b.param_name!=='transform.r.z'));
  assert.ok(params.get('HeadTilt').bindings.some(b=>b.param_name==='transform.r.z'));assert.ok(params.get('HeadTilt').bindings.every(b=>b.param_name!=='transform.t.x'));
  const normal=evaluated(model),closed=evaluated(model,{EyeOpenL:0}),moved=evaluated(model,{HeadX:1}),tilted=evaluated(model,{HeadTilt:1});
  assert.equal(closed.states.get(byName.get('eye_white_l').node.uuid).opacity,0);assert.equal(closed.states.get(byName.get('eye_closed_l').node.uuid).opacity,1);
  assert.equal(closed.states.get(byName.get('eye_white_r').node.uuid).opacity,1);assert.equal(closed.states.get(byName.get('eye_closed_r').node.uuid).opacity,0);
  const body=byName.get('body').node.uuid;assert.deepEqual(moved.world.get(body),normal.world.get(body));assert.deepEqual(tilted.world.get(body),normal.world.get(body));
  const face=byName.get('face_base').node.uuid;assert.notDeepEqual(moved.world.get(face),normal.world.get(face));assert.notDeepEqual(tilted.world.get(face),normal.world.get(face));
  const openImage=render(model,textures,spec.source),leftClosedImage=render(model,textures,spec.source,{EyeOpenL:0});
  for(let y=28;y<34;y++)for(let x=39;x<47;x++){const i=(y*100+x)*4;assert.deepEqual(leftClosedImage.subarray(i,i+4),openImage.subarray(i,i+4));}
  assert.notDeepEqual(leftClosedImage,openImage);
});

test('handoff bridge preserves placements, enabled layer order, mesh deformation, group keys and unsupported-setting reports',()=>{
  const source=handoff(),settings=source.manifest.settings;
  settings.layers.eye_white_l={enabled:true,order:17,condition:'left_open'};
  settings.layers.eye_closed_l={enabled:true,order:31,condition:'left_closed'};
  settings.deforms.eye_white_l={driver:'left',closed:grid.map(([x,y])=>[x,.45+y*.1]),open:grid.map(p=>[...p])};
  const transform={dx:.02,dy:-.01,pivotX:.5,pivotY:.3,angle:3,scale:1};
  settings.groups={transforms:{face:transform},assignments:{face_base:'face',eye_white_l:'left_eye',eye_closed_l:'left_eye'},clipFollow:{}};
  settings.groupKeys={face:{negative:{...transform,dx:-.02,angle:-3},center:transform,positive:{...transform,dx:.04,angle:7}}};
  settings.clips.eye_white_l={type:'rect',x:.53,y:28/120,width:.08,height:.05};
  source.entries['handoff.json']=strToU8(JSON.stringify(source.manifest));
  const adapted=characterFromHandoffZip(zipSync(source.entries,{level:0})),result=buildCharacterModel(adapted),tree=flatten(result.model.nodes),byName=new Map(tree.map(x=>[x.node.name,x.node]));
  assert.deepEqual(adapted.source,source.manifest.source);assert.ok(adapted.parts.some(p=>p.role==='body'));assert.ok(byName.has('Group:face'));assert.ok(byName.has('Group:left_eye'));
  const eye=adapted.parts.find(p=>p.role==='eye_white_l');assert.deepEqual(eye.placement,source.manifest.expressions.find(p=>p.role==='eye_white_l').placement);
  assert.ok(byName.get('eye_closed_l').zsort<byName.get('eye_white_l').zsort,'higher app order draws in front');
  const p=result.model.param.find(p=>p.name==='EyeOpenL'),binding=p.bindings.find(b=>b.node===byName.get('eye_white_l').uuid&&b.param_name==='deform');assert.ok(binding);assert.ok(binding.values[0][0].some(p=>p[1]!==0));assert.ok(binding.values.at(-1)[0].every(p=>p[0]===0&&p[1]===0));
  assert.ok(result.model.param.some(p=>p.bindings.some(b=>b.node===byName.get('Group:face').uuid)),'group keys bind actual nodes');
  assert.ok(result.report.unsupported.some(s=>/clip|範囲/i.test(s)));assert.deepEqual(result.report.handoff,adapted.handoffReport);
});

test('handoff bridge excludes positionless demo results and refuses malformed PNG dimensions and unsafe ZIP entries',()=>{
  const source=handoff();source.manifest.parts.push({id:'hair',kind:'demo',alignment:'cropped-demo',path:'parts/hair.png',dimensions:{width:1,height:1}});source.entries['parts/hair.png']=png(1,1,[255,255,255,255]);source.entries['handoff.json']=strToU8(JSON.stringify(source.manifest));
  const adapted=characterFromHandoffZip(zipSync(source.entries,{level:0}));assert.ok(!adapted.parts.some(p=>p.role==='hair'));assert.ok(adapted.handoffReport.excluded.some(p=>p.role==='hair'));
  const bad=handoff();bad.manifest.expressions[0].width++;bad.entries['handoff.json']=strToU8(JSON.stringify(bad.manifest));assert.throws(()=>buildCharacterModel(characterFromHandoffZip(zipSync(bad.entries,{level:0}))));
  assert.throws(()=>characterFromHandoffZip(zipSync({...handoff().entries,'../escape.png':png(1,1,[0,0,0,255])},{level:0})));
  assert.throws(()=>characterFromHandoffZip(new Uint8Array(0)));
});

test('invalid source, roles, placements and truncated containers fail without returning a model',()=>{
  const spec=input();
  for(const source of [{width:0,height:120},{width:100,height:NaN},{width:4097,height:120}])assert.throws(()=>buildCharacterModel({...spec,source}));
  assert.throws(()=>buildCharacterModel({...spec,parts:[...spec.parts,spec.parts[0]]}));
  assert.throws(()=>buildCharacterModel({...spec,parts:spec.parts.map((p,i)=>i?p:{...p,width:p.width+1})}));
  for(const placement of [{x:-.1},{y:Infinity},{width:0},{x:.9,width:.3}])assert.throws(()=>buildCharacterModel({...spec,parts:spec.parts.map((p,i)=>i?p:{...p,placement:{...p.placement,...placement}})}));
  const {inp}=buildCharacterModel(spec);for(const n of [0,8,12,inp.length-1])assert.throws(()=>readCharacterContainer(inp.slice(0,n)));
  const wrong=inp.slice();wrong[7]=50;assert.throws(()=>readCharacterContainer(wrong));
});
