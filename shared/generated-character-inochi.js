// Independent, browser/Node adapter for complete generated layers. The tested
// observed-image exporters remain unchanged. Legacy schema/bindings follow
// scripts/inochi2d/{model,quality-model,head-rig}.mjs and SDK v0.8.6.
import {decode, encode} from 'fast-png';
import {validateCharacterManifest, createInochiIntermediate} from './generated-character.js';

export const GENERATED_RIG_PROFILE = 'generated-maid-rig-v1';
export const GENERATED_INOCHI_PIN = Object.freeze({sdkTag:'v0.8.6', sdkCommit:'dda3a8f005f808104caa43183ab8753fb989e30f', creatorTag:'v0.8.6', creatorCommit:'371e5f4e21117102dbecc82371bfd9a6e2f5df02', container:'legacy-inp1'});
const MIB=1024*1024, NONE=4294967295;
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const flatten=n=>[n,...n.children.flatMap(flatten)];
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const bind=(node,param_name,values)=>({node,param_name,values:values.map(v=>[v]),isSet:values.map(()=>[true]),interpolate_mode:'Linear'});
const parameter=(uuid,name,min,max,initial,bindings,axis)=>({uuid,name,is_vec2:false,min:[min,0],max:[max,1],defaults:[initial,0],axis_points:[axis,[0]],bindings});
const abort=signal=>{if(signal?.aborted)throw new DOMException('モデル生成を中止しました。','AbortError');};

function grid(p,nx=3,ny=3){
  const {x,y,width:w,height:h}=p.rect,verts=[],uvs=[],indices=[];
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    verts.push(x+w*i/(nx-1)-p.anchor[0],y+h*j/(ny-1)-p.anchor[1]);uvs.push(i/(nx-1),j/(ny-1));
  }
  for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
    const a=j*nx+i;indices.push(a,a+1,a+nx,a+1,a+nx+1,a+nx);
  }
  return {verts,uvs,indices,origin:[0,0]};
}

function pngHeader(bytes,p){
  need(bytes instanceof Uint8Array&&bytes.length>=33&&bytes.length<=4*MIB,`${p.role}: PNGのサイズが正しくありません。`);
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  need([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)&&String.fromCharCode(...bytes.slice(12,16))==='IHDR'
    &&v.getUint32(16)===p.rect.width&&v.getUint32(20)===p.rect.height&&bytes[24]===8&&bytes[25]===6,`${p.role}: 8bit RGBAと配置サイズが必要です。`);
}

// Smooth column curves measured from the actual independent PNGs. Fitting a
// quadratic keeps the lid thickness instead of squeezing the lash artwork.
function fit(samples,cx,scale){
  need(samples.length>=20,'目・まつ毛の輪郭が不足しています。モデル化できません。');
  const a=Array.from({length:3},()=>[0,0,0,0]);
  for(const [x,y] of samples){const t=(x-cx)/scale,v=[1,t,t*t];for(let i=0;i<3;i++){for(let j=0;j<3;j++)a[i][j]+=v[i]*v[j];a[i][3]+=v[i]*y;}}
  for(let i=0;i<3;i++){
    let pivot=i;for(let j=i+1;j<3;j++)if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;
    [a[i],a[pivot]]=[a[pivot],a[i]];const d=a[i][i];need(Math.abs(d)>1e-8,'目の曲線を推定できません。');
    for(let k=i;k<4;k++)a[i][k]/=d;
    for(let j=0;j<3;j++)if(j!==i){const f=a[j][i];for(let k=i;k<4;k++)a[j][k]-=f*a[i][k];}
  }
  const coefficients=a.map(row=>row[3]);
  return {coefficients,cx,scale};
}
const at=(c,x)=>{const t=Math.max(-1.45,Math.min(1.45,(x-c.cx)/c.scale));return c.coefficients[0]+c.coefficients[1]*t+c.coefficients[2]*t*t;};

function eyeCurves(white,lash,images){
  const w=images.get(white.role),l=images.get(lash.role),upper=[],lower=[],line=[];
  for(let x=0;x<w.width;x++){
    const ys=[];for(let y=0;y<w.height;y++)if(w.data[(y*w.width+x)*4+3]>=192)ys.push(y+white.rect.y);
    if(ys.length>=8){upper.push([x+white.rect.x,ys[0]]);lower.push([x+white.rect.x,ys.at(-1)]);}
  }
  need(upper.length>=40,'白目の有効領域が不足しています。');
  const lo=upper[0][0],hi=upper.at(-1)[0],cx=(lo+hi)/2,scale=(hi-lo)/2;
  for(let x=0;x<l.width;x++){
    const gx=x+lash.rect.x;if(gx<lo+8||gx>hi-8)continue;
    const ys=[];for(let y=0;y<l.height;y++){
      const i=(y*l.width+x)*4;if(l.data[i+3]>=192&&Math.max(...l.data.subarray(i,i+3))<150)ys.push(y+lash.rect.y);
    }
    if(ys.length)line.push([gx,ys[Math.floor(ys.length/2)]]);
  }
  const u=fit(upper,cx,scale),d=fit(lower,cx,scale),s=fit(line,cx,scale);
  need(at(d,cx)-at(u,cx)>=12,'目の開口が小さすぎます。');
  return {upper:u,lower:d,lash:s,closed:{...u,coefficients:u.coefficients.map((v,i)=>.3*v+.7*d.coefficients[i])}};
}

function encodedTexture(p,images,parts){
  const source=images.get(p.role),data=new Uint8Array(source.data);
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
    const i=(y*source.width+x)*4;
    if(p.clip_to){
      const mask=images.get(p.clip_to),q=parts.get(p.clip_to),mx=p.rect.x+x-q.rect.x,my=p.rect.y+y-q.rect.y;
      const alpha=mx>=0&&my>=0&&mx<mask.width&&my<mask.height?mask.data[(my*mask.width+mx)*4+3]:0;
      // Preserve the original independent PNG; preclip this storage copy so
      // the neutral soft edge is not replaced by a binary stencil edge.
      data[i+3]=Math.round(data[i+3]*alpha/255);
    }
    for(let c=0;c<3;c++)data[i+c]=Math.floor(data[i+c]*data[i+3]/255);
  }
  return encode({width:source.width,height:source.height,data,channels:4,depth:8});
}

export function packGeneratedContainer(model,textures){
  const utf8=new TextEncoder(),json=utf8.encode(JSON.stringify(model));
  need(json.length>0&&json.length<=2*MIB&&textures.length===33,'モデル設定の上限または素材数が正しくありません。');
  const uint=n=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n);return b;};
  const chunks=[utf8.encode('TRNSRTS\0'),uint(json.length),json,utf8.encode('TEX_SECT'),uint(textures.length),...textures.flatMap(p=>[uint(p.length),new Uint8Array([0]),p])];
  const size=chunks.reduce((n,b)=>n+b.length,0);need(size<=16*MIB,'モデルの保存サイズが上限を超えています。');
  const out=new Uint8Array(size);let offset=0;for(const b of chunks){out.set(b,offset);offset+=b.length;}return out;
}

export async function buildGeneratedInochi(manifest,assets,{signal,onProgress=()=>{}}={}){
  const m=validateCharacterManifest(manifest);abort(signal);
  need(m.generator.id==='template','配置確認用の図形は動作モデルとして出力できません。テンプレートを選んでください。');
  for(const p of m.parts){
    need(p.enabled_in_neutral===(p.role!=='mouth_inside'),`${p.role}: テンプレートの通常表示と一致しません。`);
    need(p.clip_to===(/^(iris|highlight)_/.test(p.role)?`eye_white_${p.side}`:null),`${p.role}: 目のクリップ参照が一致しません。`);
    const parent=/^(eye_white|iris|highlight|eyelid_upper|eyelid_lower|eyelashes)_/.test(p.role)?`group_eye_${p.side}`:
      p.role.startsWith('mouth_')?'group_mouth':p.role.includes('hair')||p.role==='bangs_front'?'group_hair':
      p.role==='face_base'||/^(ear|brow)_/.test(p.role)?'group_head':p.role==='neck'?'group_neck':'group_body';
    need(p.parent===parent,`${p.role}: 動作に必要な親グループと一致しません。`);
  }
  const sourceGroups=new Map(m.groups.map(g=>[g.id,g]));
  need(sourceGroups.get('root').anchor[0]===384&&sourceGroups.get('root').anchor[1]===512,'モデルの原点はキャンバス中心である必要があります。');
  for(const id of ['group_eye_l','group_eye_r','group_mouth','group_hair'])need(sourceGroups.get(id)?.parent==='group_head',`${id}: 頭に追従するグループが必要です。`);
  need(assets instanceof Map&&assets.size===33&&m.parts.every(p=>assets.has(p.role)),'33枚すべてのPNGが必要です。');
  // Complete header and allocation preflight BEFORE decoding the first image.
  let bytes=0;for(const p of m.parts){const b=assets.get(p.role);pngHeader(b,p);bytes+=b.length;}
  need(bytes<=12*MIB,'素材PNGの合計が上限を超えています。');
  const images=new Map(),parts=new Map(m.parts.map(p=>[p.role,p]));
  for(const p of m.parts){
    abort(signal);const im=decode(assets.get(p.role));
    need(im.channels===4&&im.depth===8&&im.data.length===p.rect.width*p.rect.height*4&&im.data.some((v,i)=>i%4===3&&v>0),`${p.role}: 空または不正なPNGはモデル化できません。`);
    images.set(p.role,im);
  }
  const intermediate=createInochiIntermediate(m),nodes=new Map();
  for(const s of intermediate.nodes){
    const p=parts.get(s.id),isEye=p&&/^(eye_white|eyelid_upper|eyelid_lower|eyelashes)_/.test(p.role);
    nodes.set(s.id,{uuid:s.uuid,name:s.id,type:s.type,enabled:true,zsort:s.zsort??0,transform:structuredClone(s.transform),lockToRoot:false,children:[],
      ...(p?{mesh:grid(p,isEye?17:p.role==='neck'?7:3,isEye?7:p.role==='neck'?13:3),textures:[m.parts.indexOf(p),NONE,NONE],opacity:1,mask_threshold:.001,tint:[1,1,1],screenTint:[0,0,0],blend_mode:'Normal',masks:structuredClone(s.masks)}:{})});
  }
  for(const s of intermediate.nodes)if(s.parent)nodes.get(s.parent).children.push(nodes.get(s.id));
  // Creator 0.8.6 normalizes the puppet root's display name to "Root" on
  // import/save. Keep the source ID "root", but use its canonical UI name so
  // strict saved hierarchy comparisons retain names as well as UUIDs.
  nodes.get('root').name='Root';
  need(nodes.get('group_head')&&nodes.get('group_neck')&&nodes.get('group_body'),'頭・首・胴体のグループが必要です。');
  const groupById=new Map(m.groups.map(g=>[g.id,g]));
  need(groupById.get('group_head').parent==='group_neck'&&groupById.get('group_neck').parent==='group_body'&&groupById.get('group_body').parent==='root','頭・首・胴体の親子関係が一致しません。');
  for(const role of ['torso','dress_base','collar','ribbon','apron','shoulder_l','shoulder_r','sleeve_l','sleeve_r'])need(parts.get(role).parent==='group_body',`${role}: 固定する胴体グループが必要です。`);
  need(parts.get('neck').parent==='group_neck','首の親が一致しません。');
  const axis=[0,.025,.075,.15,.25,.5,.75,1],params=[],curves={};
  const points=(p,node,fn)=>Array.from({length:node.mesh.verts.length/2},(_,i)=>fn(node.mesh.verts[i*2]+p.anchor[0],node.mesh.verts[i*2+1]+p.anchor[1]));
  for(const [i,side] of ['l','r'].entries()){
    const white=parts.get(`eye_white_${side}`),lash=parts.get(`eyelashes_${side}`),c=eyeCurves(white,lash,images);curves[side]=c;
    const bindings=[];
    for(const role of [`eye_white_${side}`,`eyelid_upper_${side}`,`eyelid_lower_${side}`,`eyelashes_${side}`]){
      const p=parts.get(role),n=nodes.get(role),kind=role.startsWith('eye_white')?'white':role.startsWith('eyelid_lower')?'lower':'upper';
      bindings.push(bind(n.uuid,'deform',axis.map(v=>points(p,n,(x,y)=>[0,v===1?0:(1-v)*(at(c.closed,x)-(kind==='white'?y:at(kind==='lower'?c.lower:c.lash,x)))]))));
      if(kind==='white'||kind==='lower')bindings.push(bind(n.uuid,'opacity',axis.map(v=>kind==='white'?Math.min(1,v/.025):smooth(v/.25))));
    }
    for(const role of [`iris_${side}`,`highlight_${side}`])bindings.push(bind(nodes.get(role).uuid,'opacity',axis.map(v=>Math.min(1,v/.025))));
    params.push(parameter(1001+i,`EyeOpen${side.toUpperCase()}`,0,1,1,bindings,axis));
  }
  const mouth=nodes.get('mouth_inside'),mp=parts.get('mouth_inside'),mouthAxis=[0,.075,.15,.25,.5,1];
  params.push(parameter(1005,'MouthOpen',0,1,0,[
    bind(nodes.get('mouth_base').uuid,'opacity',mouthAxis.map(v=>1-smooth(v/.15))),
    bind(mouth.uuid,'opacity',mouthAxis.map(v=>Math.min(1,v/.075))),
    bind(mouth.uuid,'deform',mouthAxis.map(v=>points(mp,mouth,(x,y)=>[0,(y-mp.anchor[1])*(.08+.92*v-1)]))),
  ],mouthAxis));
  const head=nodes.get('group_head'),neck=nodes.get('neck'),np=parts.get('neck'),pivot=groupById.get('group_head').anchor;
  const neckWeight=y=>1-smooth((y-(pivot[1]+11))/40),headAxis=[0,.5,1];
  for(const [id,name,field,amount] of [[1003,'HeadX','transform.t.x',8],[1006,'HeadY','transform.t.y',4],[1004,'HeadTilt','transform.r.z',.025]]){
    const values=[-amount,0,amount];
    const deform=values.map(v=>points(np,neck,(x,y)=>{
      if(v===0)return [0,0];const w=neckWeight(y);if(w===0)return [0,0];
      if(name==='HeadX')return [w*v,0];if(name==='HeadY')return [0,w*v];
      const dx=x-pivot[0],dy=y-pivot[1],co=Math.cos(v),si=Math.sin(v);return [w*(co*dx-si*dy-dx),w*(si*dx+co*dy-dy)];
    }));
    params.push(parameter(id,name,-1,1,0,[bind(head.uuid,field,values),bind(neck.uuid,'deform',deform)],headAxis));
  }
  const model={meta:{name:'Parts-first maid character',version:'v0.8.6',rigger:'AI Live2D Maker generated-part adapter',artist:'',copyright:'',licenseURL:'',contact:'',reference:'',preservePixels:false},
    physics:{pixelsPerMeter:1000,gravity:9.8},nodes:nodes.get('root'),param:params,automation:[],animations:{}};
  const textures=[];
  for(const [i,p] of m.parts.entries()){
    abort(signal);textures.push(encodedTexture(p,images,parts));onProgress({completed:i+1,total:33,label:p.label});
    // Yield between PNG encodes so mobile UI can process cancellation.
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  abort(signal);const inp=packGeneratedContainer(model,textures),all=flatten(model.nodes),drawables=all.filter(n=>n.type==='Part');
  const report={format:'ai-live2d-generated-inochi-report',version:1,profile:GENERATED_RIG_PROFILE,pinned:GENERATED_INOCHI_PIN,
    source_format:m.format,recipe:structuredClone(m.generator.recipe),parts:33,textures:33,nodes:all.length,
    vertices:drawables.reduce((s,n)=>s+n.mesh.verts.length/2,0),triangles:drawables.reduce((s,n)=>s+n.mesh.indices.length/3,0),
    decoded_texture_bytes:m.parts.reduce((s,p)=>s+p.rect.width*p.rect.height*4,0),parameters:params.map(p=>({name:p.name,min:p.min[0],max:p.max[0],default:p.defaults[0]})),
    eye_curves:curves,texture_encoding:'premultiplied-floor-rgb-8bit',source_pngs_unchanged:true,
    neutral_background:'transparent; composite against the selected preview background for comparison',
    file_generation_passed:true,official_creator_tested:false,appearance_quality_passed:false,ai_generated:false,cubism_compatible:false,vtube_studio_tested:false,
    limitations:['Template anatomy only; dummy geometry is rejected.','HeadX/Y are planar translation and HeadTilt is Z rotation, not reconstructed yaw/pitch.','Generated INP/INX use the legacy 0.8.6 runtime container without editor-specific metadata.','No hair physics, tracking or generative AI. Official runtime and visual acceptance require separate verification.']};
  return {inp,inx:inp.slice(),model,report,rig:{format:'ai-live2d-generated-motion-rig',version:1,profile:GENERATED_RIG_PROFILE,
    coordinates:m.coordinates,sides:m.sides,groups:structuredClone(m.groups),parts:m.parts.map(p=>({role:p.role,parent:p.parent,anchor:p.anchor,rect:p.rect,order:p.order,mesh:nodes.get(p.role).mesh})),
    parameters:structuredClone(params),rest_pose_only:false,physics:[],runtime_verified:false,appearance_quality_passed:false}};
}
