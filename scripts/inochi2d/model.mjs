// Independent experimental exporter. Schema references and BSD notices are in
// docs/INOCHI2D_FEASIBILITY.md. No official SDK code or model assets are vendored.
import {decode} from 'fast-png';

export const PIN=Object.freeze({container:'legacy-inp1',sdkTag:'v0.8.6',sdkCommit:'dda3a8f005f808104caa43183ab8753fb989e30f',creatorTag:'v0.8.6',creatorCommit:'371e5f4e21117102dbecc82371bfd9a6e2f5df02'});
export const ROLES=Object.freeze(['face_base','eye_white_l','eye_white_r','eye_closed_l','eye_closed_r']);
const MIB=1024*1024,MAX_BYTES=32*MIB,MAX_PIXELS=16*MIB/4;
const MAGIC=Buffer.from('TRNSRTS\0'),TEX=Buffer.from('TEX_SECT');
const require=(ok,message)=>{if(!ok)throw new Error(message);};
const uint=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const transform=(x=0,y=0)=>({trans:[x,y,0],rot:[0,0,0],scale:[1,1]});
function pngSize(bytes){
  require(bytes instanceof Uint8Array && bytes.length>=33 && bytes.length<=8*MIB,'PNGは8 MiB以下の画像が必要です。');
  const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  require([137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v) && b.toString('ascii',12,16)==='IHDR','PNGのヘッダーが正しくありません。');
  const width=b.readUInt32BE(16),height=b.readUInt32BE(20);
  require(width>0 && height>0 && width<=2048 && height<=2048 && width*height<=MAX_PIXELS,'PNGの展開後サイズが上限を超えています。');
  return {width,height};
}
function grid(width,height){
  const verts=[],uvs=[],indices=[];
  for(let y=0;y<3;y++)for(let x=0;x<3;x++){verts.push((x/2-.5)*width,(y/2-.5)*height);uvs.push(x/2,y/2);}
  for(let y=0;y<2;y++)for(let x=0;x<2;x++){const a=y*3+x;indices.push(a,a+1,a+4,a,a+4,a+3);}
  return {verts,uvs,indices,origin:[0,0]};
}
function binding(node,param_name,keys){return {node,param_name,values:keys.map(v=>[v]),isSet:keys.map(()=>[true]),interpolate_mode:'Linear'};}
function parameter(uuid,name,min,max,defaults,bindings,axis=[0,1]){
  return {uuid,name,is_vec2:false,min:[min,0],max:[max,1],defaults:[defaults,0],axis_points:[axis,[0]],bindings};
}
export function buildInochiModel({name='Minimal Inochi2D trial',source,parts}){
  require(typeof name==='string' && name.length>0 && name.length<=120,'モデル名が正しくありません。');
  require(source && [source.width,source.height].every(n=>Number.isInteger(n) && n>0 && n<=4096),'元キャンバスのサイズが正しくありません。');
  require(Array.isArray(parts) && parts.length===ROLES.length && new Set(parts.map(p=>p?.role)).size===ROLES.length && parts.every(p=>ROLES.includes(p?.role)),'顔・左右の目・左右の閉眼の5役割が必要です。');
  let compressed=0,pixels=0;
  const ordered=ROLES.map(role=>parts.find(p=>p.role===role));
  for(const p of ordered){
    const size=pngSize(p.png);compressed+=p.png.length;pixels+=size.width*size.height;
    require(p.width===size.width && p.height===size.height,'PNGと素材サイズが一致しません。');
    const q=p.placement;
    require(q && [q.x,q.y].every(n=>Number.isFinite(n) && n>=0 && n<=1) && [q.width,q.height].every(n=>Number.isFinite(n) && n>=.0001 && n<=1) && q.x+q.width<=1+1e-12 && q.y+q.height<=1+1e-12,'素材の配置が正しくありません。');
  }
  // Check total decoded budget before the first PNG allocation.
  require(compressed<=24*MIB && pixels<=MAX_PIXELS,'素材の合計サイズが上限を超えています。');
  for(const p of ordered){const image=decode(p.png);require(image.depth===8 && image.channels===4 && image.data.length===p.width*p.height*4,'8bit RGBA PNGが必要です。');}
  const nodes=ordered.map((p,i)=>{
    const w=p.placement.width*source.width,h=p.placement.height*source.height;
    return {uuid:10+i,name:p.role,type:'Part',enabled:true,zsort:i===0?100:i<3?50:20,transform:transform((p.placement.x+p.placement.width/2-.5)*source.width,(p.placement.y+p.placement.height/2-.5)*source.height),lockToRoot:false,children:[],mesh:grid(w,h),textures:[i,4294967295,4294967295],opacity:1,mask_threshold:.5,tint:[1,1,1],screenTint:[0,0,0],blend_mode:'Normal',masks:[]};
  });
  const eyes=['l','r'].map((side,index)=>{
    const eye=nodes.find(n=>n.name===`eye_white_${side}`),lid=nodes.find(n=>n.name===`eye_closed_${side}`);
    const closed=Array.from({length:9},(_,v)=>[0,-eye.mesh.verts[v*2+1]*.97]),open=Array.from({length:9},()=>[0,0]);
    // A technical template, not learned facial anatomy: flatten the eye and
    // exchange it for the closed line over the final 15% of closure.
    const flattened=closed.map(([x,y])=>[x,y*.85]);
    return parameter(101+index,`EyeOpen${side.toUpperCase()}`,0,1,1,[binding(eye.uuid,'deform',[closed,flattened,open]),binding(eye.uuid,'opacity',[0,1,1]),binding(lid.uuid,'opacity',[1,0,0])],[0,.15,1]);
  });
  const head={uuid:2,name:'Head',type:'Node',enabled:true,zsort:0,transform:transform(),lockToRoot:false,children:nodes};
  // Optional metadata is explicit because Inox currently requires these keys.
  // Empty artwork/license fields grant no rights over the supplied PNG assets.
  const model={meta:{name,version:PIN.sdkTag,rigger:'AI Live2D Maker experimental exporter',artist:'',copyright:'',licenseURL:'',contact:'',reference:'',preservePixels:false},physics:{pixelsPerMeter:1000,gravity:9.8},nodes:{uuid:1,name:'Root',type:'Node',enabled:true,zsort:0,transform:transform(),lockToRoot:false,children:[head]},param:[...eyes,parameter(103,'HeadX',-1,1,0,[binding(2,'transform.t.x',[-14,0,14]),binding(2,'transform.r.z',[-.06,0,.06])],[0,.5,1])],automation:[],animations:{}};
  const json=Buffer.from(JSON.stringify(model),'utf8');
  require(json.length<=256*1024,'モデル設定が大きすぎます。');
  const chunks=[MAGIC,uint(json.length),json,TEX,uint(ordered.length)];
  for(const p of ordered)chunks.push(uint(p.png.length),Buffer.from([0]),p.png);
  const inp=new Uint8Array(Buffer.concat(chunks));require(inp.length<=MAX_BYTES,'モデルファイルが大きすぎます。');
  return {inp,inx:inp.slice(),model,report:{format:'ai-live2d-maker-inochi2d-trial',version:1,pinned:PIN,source:{...source},roles:ROLES,parts:nodes.length,vertices:nodes.length*9,triangles:nodes.length*8,textures:ordered.length,decodedTextureBytes:pixels*4,parameters:model.param.map(p=>({id:p.uuid,name:p.name,min:p.min[0],max:p.max[0],default:p.defaults[0]})),containsOriginal:false,automaticImageSeparation:false,automaticCompletion:false,geometryTemplate:true,officialCreatorTested:false,live2dCompatible:false,vtubeStudioTested:false,notes:['Legacy INP and INX use the same runtime container. This minimal INX has no Creator editor extension data.','HeadX is parent translation and planar tilt, not three-dimensional head rotation.','Actual runtime/editor loading must be verified separately; file generation alone is not acceptance.']}};
}

// Bounded inspector for this exporter subset, independent from runtime acceptance.
export function readInochiContainer(bytes){
  require(bytes instanceof Uint8Array && bytes.length<=MAX_BYTES && bytes.length>=24,'INPファイルのサイズが正しくありません。');
  const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=0;
  function take(n){require(Number.isInteger(n) && n>=0 && n<=b.length-offset,'INPファイルが途中で切れています。');const value=b.subarray(offset,offset+n);offset+=n;return value;}
  const number=()=>take(4).readUInt32BE(0);
  require(take(8).equals(MAGIC),'旧INP1のヘッダーが必要です。INP2は対象外です。');
  const length=number();require(length>0 && length<=256*1024,'モデル設定のサイズが正しくありません。');
  const model=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(take(length)));
  require(take(8).equals(TEX),'テクスチャセクションがありません。');
  const count=number();require(count>0 && count<=16,'テクスチャ数が正しくありません。');
  const textures=[];let pixels=0;
  for(let i=0;i<count;i++){const size=number();require(size>0 && size<=8*MIB,'テクスチャサイズが正しくありません。');require(take(1)[0]===0,'この検査はPNGテクスチャだけに対応します。');const data=new Uint8Array(take(size)),png=pngSize(data);pixels+=png.width*png.height;require(pixels<=MAX_PIXELS,'展開後サイズが上限を超えています。');textures.push(data);}
  require(offset===b.length,'この検査は追加セクションのない最小INP/INXだけに対応します。');
  return {model,textures};
}
