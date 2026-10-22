// Independent prepared-image adapter for the legacy Inochi2D 0.8.6 schema.
// This module intentionally leaves the verified five-part model.mjs unchanged.
import {decode,encode} from 'fast-png';
import {unzipSync,strFromU8} from 'fflate';
import {readFile,lstat,realpath,writeFile,unlink} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PIN} from './model.mjs';
import {EXPRESSION_ROLE_IDS} from '../../src/expression-assets.js';
import {defaultExpressionLayer,validateExpressionLayers} from '../../src/expression-layer-state.js';
import {GRID,TRIANGLES,validateDeforms} from '../../src/expression-deform.js';
import {defaultGroupTransform,validateGroups} from '../../src/expression-groups.js';
import {validateGroupKeys} from '../../src/group-motion-keys.js';

export {PIN};
export const CHARACTER_ROLES=Object.freeze(['body','top','jacket','sleeve_l','sleeve_r','neck','hair','hair_back','hair_front','hair_side_l','hair_side_r','face_base','eye_white_l','eye_white_r','eye_iris_l','eye_iris_r','eye_lash_l','eye_lash_r','eye_closed_l','eye_closed_r','eyebrow_l','eyebrow_r','mouth_closed','mouth_upper','mouth_lower','mouth_inside','mouth_teeth','mouth_tongue']);
const MIB=1024*1024,MAX_CONTAINER=100*MIB,MAX_INPUT_RGBA=128*MIB,MAX_RGBA=64*MIB,MAX_JSON=2*MIB,MAX_PARTS=40;
const MAGIC=Buffer.from('TRNSRTS\0'),TEX=Buffer.from('TEX_SECT'),NONE=4294967295;
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const record=x=>Boolean(x && typeof x==='object' && !Array.isArray(x));
const uint=n=>{const out=Buffer.alloc(4);out.writeUInt32BE(n);return out;};
const transform=(x=0,y=0)=>({trans:[x,y,0],rot:[0,0,0],scale:[1,1]});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const expressionRole=role=>EXPRESSION_ROLE_IDS.includes(role);
const eyeSide=role=>/^eye_.*_l$/.test(role)?'left':/^eye_.*_r$/.test(role)?'right':null;
function sizeOf(bytes,maxBytes=8*MIB){
  need(bytes instanceof Uint8Array && bytes.length>=33 && bytes.length<=maxBytes,'PNGのサイズが上限を超えているか、画像がありません。');
  const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  need([137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v) && b.toString('ascii',12,16)==='IHDR','PNGのヘッダーが正しくありません。');
  const width=b.readUInt32BE(16),height=b.readUInt32BE(20);
  need(width>0 && height>0 && width<=4096 && height<=4096 && width*height<=16_000_000,'PNGの展開後サイズが上限を超えています。');
  return {width,height};
}
function checkSource(source){need(record(source) && [source.width,source.height].every(n=>Number.isInteger(n) && n>0 && n<=4096) && source.width*source.height<=16_000_000,'元キャンバスのサイズが正しくありません。');return {width:source.width,height:source.height};}
function checkPlacement(p){
  need(record(p) && [p.x,p.y].every(n=>Number.isFinite(n) && n>=0 && n<=1) && [p.width,p.height].every(n=>Number.isFinite(n) && n>=.0001 && n<=1) && p.x+p.width<=1+1e-10 && p.y+p.height<=1+1e-10,'素材の配置が正しくありません。');
}
function grid(width,height){return {verts:GRID.flatMap(([x,y])=>[(x-.5)*width,(y-.5)*height]),uvs:GRID.flat(),indices:TRIANGLES.flat(),origin:[0,0]};}
function standardMesh(mesh){return record(mesh) && JSON.stringify(mesh.grid)===JSON.stringify(GRID) && JSON.stringify(mesh.triangles)===JSON.stringify(TRIANGLES);}
function bind(node,param_name,values){return {node,param_name,values:values.map(v=>[v]),isSet:values.map(()=>[true]),interpolate_mode:'Linear'};}
function parameter(uuid,name,min,max,initial,bindings,axis){return {uuid,name,is_vec2:false,min:[min,0],max:[max,1],defaults:[initial,0],axis_points:[axis,[0]],bindings};}
function baseOrder(role){if(role==='hair_back')return 0;if(['body','top','jacket','sleeve_l','sleeve_r'].includes(role))return 10;if(role==='neck')return 15;if(role==='face_base')return 20;if(role.startsWith('hair'))return 90;if(role.startsWith('eye_closed'))return 65;if(role.startsWith('eye_lash'))return 60;if(role.startsWith('eye_iris'))return 55;return 50;}
function defaultParent(role){return ['body','top','jacket','sleeve_l','sleeve_r','neck'].includes(role)?'root':'head';}
function groupTransform(s,source,pivot){
  const angle=s.angle*Math.PI/180,c=Math.cos(angle)*s.scale,si=Math.sin(angle)*s.scale,x=s.pivotX*source.width-pivot.x,y=s.pivotY*source.height-pivot.y;
  const t=transform(s.dx*source.width+x-c*x+si*y,s.dy*source.height+y-si*x-c*y);t.rot[2]=angle;t.scale=[s.scale,s.scale];return t;
}
function interpolateGroup(s,value){const a=value<0?s.negative:s.center,b=value<0?s.center:s.positive,t=value<0?value+1:value;return Object.fromEntries(Object.keys(a).map(k=>[k,a[k]+(b[k]-a[k])*t]));}
function checkSettings(settings,parts){
  need(record(settings),'素材の動作設定が正しくありません。');
  const assets=parts.filter(p=>expressionRole(p.role)),clips=settings.clips||{},groups=settings.groups||{transforms:{},assignments:{},clipFollow:{}};
  const layers=validateExpressionLayers(settings.layers||{},assets),deforms=validateDeforms(settings.deforms||{},assets);
  validateGroups(groups,assets,clips);validateGroupKeys(settings.groupKeys||{},groups,assets,clips);
  return {layers,deforms,groups,groupKeys:settings.groupKeys||{},clips,clipKeys:settings.clipKeys||{}};
}

/** Parts use source-normalized top-left placements. PNG pixels are not altered. */
export function buildCharacterModel(input){
  const {name='Automatic Inochi2D character',parts,settings={},handoffReport}=input||{},source=checkSource(input?.source);
  need(typeof name==='string' && name.length>0 && name.length<=120,'モデル名が正しくありません。');
  if(input.mesh!==undefined)need(standardMesh(input.mesh),'この変換はアプリ標準の9点メッシュに対応します。');
  need(Array.isArray(parts) && parts.length>=5 && parts.length<=MAX_PARTS && new Set(parts.map(p=>p?.role)).size===parts.length && parts.every(p=>CHARACTER_ROLES.includes(p?.role)),'素材の役割・個数が正しくありません。');
  for(const role of ['face_base','eye_white_l','eye_white_r','eye_closed_l','eye_closed_r'])need(parts.some(p=>p.role===role),`${role}: 顔・左右の開いた目と閉じた目が必要です。`);
  let bytes=0,pixels=0;
  for(const p of parts){
    const size=sizeOf(p.png);need(size.width===p.width && size.height===p.height,'PNGと素材サイズが一致しません。');checkPlacement(p.placement);
    need(p.parent===undefined || ['root','head'].includes(p.parent),'素材の親が正しくありません。');
    need(p.order===undefined || (Number.isInteger(p.order) && p.order>=0 && p.order<=999),'素材の重なり順が正しくありません。');
    pixels+=size.width*size.height;bytes+=p.png.length;
  }
  need(pixels*4<=MAX_RGBA && bytes<=80*MIB,'素材の合計サイズが上限を超えています。');
  // Preflight the complete decoded budget before decoding any compressed PNG.
  for(const p of parts){const image=decode(p.png);need(image.depth===8 && image.channels===4 && image.data.length===p.width*p.height*4,'8bit RGBA PNGが必要です。');need(image.data.some((v,i)=>i%4===3 && v>0),`${p.role}: 透明な画素だけの素材はモデル化できません。`);}
  const s=checkSettings(settings,parts),unsupported=[],transferred=[];
  if(Object.keys(s.clips).length)unsupported.push('clips: per-asset rectangle/ellipse clipping is not transferred');
  if(Object.keys(s.clipKeys).length)unsupported.push('clipKeys: animated clipping is not transferred');
  if(parts.some(p=>p.motion?.swing))unsupported.push('motion.swing: the Canvas hair-swing preview is not physics or an Inochi binding');
  const face=parts.find(p=>p.role==='face_base'),fp=face.placement;
  const pivot={x:(fp.x+fp.width/2)*source.width,y:(fp.y+fp.height)*source.height};
  const root={uuid:1,name:'Root',type:'Node',enabled:true,zsort:0,transform:transform(),lockToRoot:false,children:[]};
  const head={uuid:2,name:'Head',type:'Node',enabled:true,zsort:0,transform:transform(pivot.x-source.width/2,pivot.y-source.height/2),lockToRoot:false,children:[]};root.children.push(head);
  const groups=new Map(),groupIds={face:3,left_eye:4,right_eye:5,mouth:6};
  for(const id of Object.keys(groupIds)){
    const node={uuid:groupIds[id],name:`Group:${id}`,type:'Node',enabled:true,zsort:0,transform:groupTransform(s.groups.transforms[id]||defaultGroupTransform(),source,pivot),lockToRoot:false,children:[]};
    groups.set(id,node);(id==='face'?head:groups.get('face')).children.push(node);
  }
  if(Object.keys(s.groups.transforms).length)transferred.push('groups.transforms');
  if(Object.keys(s.groups.assignments).length)transferred.push('groups.assignments');
  const ordered=parts.slice().sort((a,b)=>(a.order??baseOrder(a.role))-(b.order??baseOrder(b.role)) || CHARACTER_ROLES.indexOf(a.role)-CHARACTER_ROLES.indexOf(b.role));
  const nodes=new Map(),partSettings=new Map();
  const hasMouthOpen=ordered.some(p=>p.role.startsWith('mouth_') && p.role!=='mouth_closed');
  for(const [index,p] of ordered.entries()){
    const layer=s.layers[p.role],parent=p.parent||defaultParent(p.role),assignment=s.groups.assignments[p.role];
    const container=parent==='root'?root:assignment?groups.get(assignment):head,origin=parent==='root'?{x:source.width/2,y:source.height/2}:pivot;
    const order=layer?20+layer.order:p.order??baseOrder(p.role),w=p.placement.width*source.width,h=p.placement.height*source.height;
    const node={uuid:100+index,name:p.role,type:'Part',enabled:layer?.enabled!==false,zsort:1000-order+((ordered.length-index)/1000),transform:transform((p.placement.x+p.placement.width/2)*source.width-origin.x,(p.placement.y+p.placement.height/2)*source.height-origin.y),lockToRoot:false,children:[],mesh:grid(w,h),textures:[index,NONE,NONE],opacity:1,mask_threshold:.5,tint:[1,1,1],screenTint:[0,0,0],blend_mode:'Normal',masks:[]};
    container.children.push(node);nodes.set(p.role,node);
    let condition=layer?.condition;
    if(!condition){const side=eyeSide(p.role);condition=side?`${side}_${p.role.startsWith('eye_closed')?'closed':'open'}`:p.role.startsWith('mouth_') && hasMouthOpen?defaultExpressionLayer(p.role).condition:'always';}
    partSettings.set(p.role,{part:p,node,condition,deform:s.deforms[p.role],explicitLayer:Boolean(layer)});
  }
  if(Object.keys(s.layers).length)transferred.push('layers.enabled','layers.order','layers.condition');
  if(Object.keys(s.deforms).length)transferred.push('deforms.closed/open');
  const params=[];
  for(const [driver,paramName,id] of [['left','EyeOpenL',1001],['right','EyeOpenR',1002],['mouth','MouthOpen',1005]]){
    const affected=[...partSettings.values()].filter(v=>v.condition.startsWith(driver+'_') || v.deform?.driver===driver || (driver!=='mouth' && eyeSide(v.part.role)===driver));
    if(!affected.length || (driver==='mouth' && !hasMouthOpen && !affected.some(v=>v.explicitLayer || v.deform)))continue;
    const explicit=affected.some(v=>v.explicitLayer),axis=explicit?[0,.15,.499999,.5,1]:[0,.15,1],bindings=[];
    for(const v of affected){
      const {node,part,deform,condition}=v,opening=condition===`${driver}_open`,closing=condition===`${driver}_closed`;
      if(opening || closing)bindings.push(bind(node.uuid,'opacity',axis.map(value=>explicit?Number(closing?value<.5:value>=.5):closing?Math.max(0,1-value/.15):Math.min(1,value/.15))));
      if(deform && deform.driver===driver){
        const w=part.placement.width*source.width,h=part.placement.height*source.height;
        bindings.push(bind(node.uuid,'deform',axis.map(value=>GRID.map(([x,y],i)=>[(deform.closed[i][0]+(deform.open[i][0]-deform.closed[i][0])*value-x)*w,(deform.closed[i][1]+(deform.open[i][1]-deform.closed[i][1])*value-y)*h]))));
      }else if(driver!=='mouth' && eyeSide(part.role)===driver && !part.role.startsWith('eye_closed')){
        // A conservative vertical squeeze, not a learned 3-D eyelid model.
        bindings.push(bind(node.uuid,'deform',axis.map(value=>GRID.map((_,i)=>[0,-node.mesh.verts[i*2+1]*(1-value)*.97]))));
      }
    }
    params.push(parameter(id,paramName,0,1,driver==='mouth'?(nodes.has('mouth_closed')?0:1):1,bindings,axis));
  }
  const travel=Math.min(32,source.width*.018);
  params.push(parameter(1003,'HeadX',-1,1,0,[bind(head.uuid,'transform.t.x',[-travel,0,travel])],[0,.5,1]));
  params.push(parameter(1004,'HeadTilt',-1,1,0,[bind(head.uuid,'transform.r.z',[-.06,0,.06])],[0,.5,1]));
  if(Object.keys(s.groupKeys).length){
    const axis=Array.from({length:17},(_,i)=>i/16),bindings=[];
    for(const [id,keys] of Object.entries(s.groupKeys)){
      const node=groups.get(id),base=node.transform,values=axis.map(v=>groupTransform(interpolateGroup(keys,v*2-1),source,pivot));
      for(const [field,index,key] of [['trans',0,'transform.t.x'],['trans',1,'transform.t.y'],['rot',2,'transform.r.z']])bindings.push(bind(node.uuid,key,values.map(t=>t[field][index]-base[field][index])));
      for(let i=0;i<2;i++)bindings.push(bind(node.uuid,`transform.s.${i?'y':'x'}`,values.map(t=>t.scale[i]/base.scale[i])));
    }
    params.push(parameter(1006,'AuthoringTurn',-1,1,0,bindings,axis));transferred.push('groupKeys (17-sample transform interpolation)');
  }
  const model={meta:{name,version:PIN.sdkTag,rigger:'AI Live2D Maker independent character adapter',artist:'',copyright:'',licenseURL:'',contact:'',reference:'',preservePixels:false},physics:{pixelsPerMeter:1000,gravity:9.8},nodes:root,param:params,automation:[],animations:{}};
  const json=Buffer.from(JSON.stringify(model),'utf8');need(json.length<=MAX_JSON,'モデル設定が大きすぎます。');
  const chunks=[MAGIC,uint(json.length),json,TEX,uint(ordered.length)];for(const p of ordered)chunks.push(uint(p.png.length),Buffer.from([0]),p.png);
  const inp=new Uint8Array(Buffer.concat(chunks));need(inp.length<=MAX_CONTAINER,'モデルファイルが大きすぎます。');
  const report={format:'ai-live2d-maker-inochi2d-character',version:1,pinned:PIN,source,headPivot:{x:pivot.x/source.width,y:pivot.y/source.height},roles:ordered.map(p=>p.role),parts:ordered.length,vertices:ordered.length*9,triangles:ordered.length*8,textures:ordered.length,decodedTextureBytes:pixels*4,parameters:params.map(p=>({id:p.uuid,name:p.name,min:p.min[0],max:p.max[0],default:p.defaults[0]})),transferredSettings:transferred,unsupported,containsOriginal:false,inputMode:'prepared-image-parts',automaticImageSeparation:false,automaticCompletion:false,geometryTemplate:true,officialCreatorTested:false,live2dCompatible:false,vtubeStudioTested:false,sourcePngSha256:Object.fromEntries(ordered.map(p=>[p.role,hash(p.png)])),notes:['Legacy INP/INX only; INP2 is unsupported. INX has no Creator editor extension until saved in Creator.','HeadX is planar translation and HeadTilt is planar rotation; neither is a reconstructed 3-D head turn.','Image ownership and missing-region synthesis are preparation tasks; this adapter does not infer hidden anatomy.','PNG generation or parameter presence does not establish expression quality or official runtime acceptance.']};
  if(handoffReport)report.handoff=handoffReport;
  return {inp,inx:inp.slice(),model,report};
}

/** Bounded format inspector for this module, not an official runtime validator. */
export function readCharacterContainer(bytes){
  need(bytes instanceof Uint8Array && bytes.length>=24 && bytes.length<=MAX_CONTAINER,'INPファイルのサイズが正しくありません。');
  const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=0;
  const take=n=>{need(Number.isInteger(n) && n>=0 && n<=b.length-offset,'INPファイルが途中で切れています。');const v=b.subarray(offset,offset+n);offset+=n;return v;};
  const number=()=>take(4).readUInt32BE(0);need(take(8).equals(MAGIC),'旧INP1が必要です。INP2は対象外です。');
  const length=number();need(length>0 && length<=MAX_JSON,'モデル設定のサイズが正しくありません。');const model=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(take(length)));
  need(take(8).equals(TEX),'テクスチャセクションがありません。');const count=number();need(count>0 && count<=MAX_PARTS,'テクスチャ数が正しくありません。');
  const textures=[];let rgba=0;for(let i=0;i<count;i++){const n=number();need(n>0 && n<=8*MIB,'テクスチャサイズが正しくありません。');need(take(1)[0]===0,'PNG以外のテクスチャには対応していません。');const png=new Uint8Array(take(n)),size=sizeOf(png);rgba+=size.width*size.height*4;need(rgba<=MAX_RGBA,'展開後サイズが上限を超えています。');textures.push(png);}
  need(offset===b.length,'この検査はCreator保存前の追加セクションなしINP/INX専用です。');return {model,textures};
}

const AI_ROLES={hair:'hair',face:'face_base',body:'body',eyes:null,hair_front:'hair_front',hair_back:'hair_back',hair_side_l:'hair_side_l',hair_side_r:'hair_side_r',face_skin:'face_base',neck:'neck',eye_l:'eye_white_l',eye_r:'eye_white_r',brow_l:'eyebrow_l',brow_r:'eyebrow_r',mouth_visible:'mouth_inside',top:'top',jacket:'jacket',sleeve_l:'sleeve_l',sleeve_r:'sleeve_r'};
function trimPart(p){
  const image=decode(p.png);need(image.depth===8 && image.channels===4,'8bit RGBA PNGが必要です。');let x0=p.width,y0=p.height,x1=0,y1=0;
  for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++)if(image.data[(y*p.width+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
  need(x1>x0 && y1>y0,`${p.role}: 透明な画素だけの素材です。`);if(x0===0 && y0===0 && x1===p.width && y1===p.height)return p;
  // Crop only raw AI masks. Expression textures retain their mesh coordinate
  // domain so authored 9-point deforms continue to refer to the same positions.
  const width=x1-x0,height=y1-y0,data=new Uint8Array(width*height*4),q=p.placement;
  for(let y=0;y<height;y++)data.set(image.data.subarray(((y0+y)*p.width+x0)*4,((y0+y)*p.width+x1)*4),y*width*4);
  return {...p,width,height,placement:{x:q.x+x0/p.width*q.width,y:q.y+y0/p.height*q.height,width:width/p.width*q.width,height:height/p.height*q.height},png:encode({width,height,data,channels:4,depth:8})};
}

/** Bridge the existing app ZIP; do not imply unsupported clips/physics transfer. */
export function characterFromHandoffZip(bytes){
  need(bytes instanceof Uint8Array && bytes.length>0 && bytes.length<=100*MIB,'入力ZIPは100 MiB以下にしてください。');
  const seen=new Set();let decoded=0;
  const entries=unzipSync(bytes,{filter:e=>{
    need(seen.size<48 && !seen.has(e.name) && /^(handoff\.json|README\.txt|MOTION_CHECKLIST\.txt|EXPRESSION_NOTES\.txt|PART_CHECKLIST\.txt|parts\/[a-z_]+\.png|expressions\/[a-z_]+\.png)$/.test(e.name),'引き継ぎZIPのファイル構成が正しくありません。');seen.add(e.name);decoded+=e.originalSize;
    need(e.compression===0 && e.size===e.originalSize && e.originalSize<=32*MIB && decoded<=100*MIB && (e.name!=='handoff.json' || e.originalSize<=256*1024),'ZIPの展開上限または形式が正しくありません。');return true;
  }});
  let meta;try{meta=JSON.parse(strFromU8(entries['handoff.json']));}catch{throw new Error('制作引き継ぎZIPが必要です。');}
  need(meta.format==='ai-live2d-maker-authoring-handoff' && [1,2].includes(meta.version) && meta.containsOriginal===false && meta.live2dCompatible===false && meta.coordinateSystem==='source-normalized-top-left' && Array.isArray(meta.parts) && meta.parts.length<=19 && Array.isArray(meta.expressions) && meta.expressions.length<=15,'対応する制作引き継ぎZIPが必要です。');
  need(standardMesh(meta.mesh),'引き継ぎ素材はアプリ標準の9点メッシュが必要です。');
  const source=checkSource(meta.source),parts=[],excluded=[],warnings=[],ids=new Set(),expressions=meta.expressions,settings=meta.settings||{};
  let rgba=0;for(const item of [...meta.parts,...expressions]){const png=entries[item.path];need(png,'素材PNGがありません。');const size=sizeOf(png,32*MIB);rgba+=size.width*size.height*4;}need(rgba<=MAX_INPUT_RGBA,'入力素材の展開後サイズが上限を超えています。');
  const aiIds=new Set(meta.parts.filter(p=>p.kind==='ai').map(p=>p.id)),roles=new Set(expressions.filter(p=>settings.layers?.[p.role]?.enabled!==false).map(p=>p.role));
  for(const p of meta.parts){
    need(Object.hasOwn(AI_ROLES,p.id) && !ids.has(p.id) && p.path===`parts/${p.id}.png`,'分離結果のIDまたはパスが正しくありません。');ids.add(p.id);
    if(p.kind==='demo'){excluded.push({role:p.id,reason:'cropped-demo has no source placement'});continue;}
    need(p.kind==='ai' && p.alignment==='source-canvas' && p.dimensions?.width===source.width && p.dimensions?.height===source.height,'元画像と同じ配置のAI結果が必要です。');
    const role=AI_ROLES[p.id],superseded=(p.id==='hair' && [...aiIds].some(id=>id.startsWith('hair_'))) || (p.id==='face' && aiIds.has('face_skin')) || (p.id==='body' && ['top','jacket','sleeve_l','sleeve_r'].some(id=>aiIds.has(id))) || (p.id==='eyes' && ['eye_l','eye_r'].some(id=>aiIds.has(id)));
    if(!role || superseded || roles.has(role)){excluded.push({role:p.id,reason:!role?'combined eyes require separate left/right assets':superseded?'fine parts supersede combined source mask':'expression replacement takes precedence'});continue;}
    const png=entries[p.path],size=sizeOf(png,32*MIB);need(size.width===source.width && size.height===source.height,'AI素材と元画像サイズが一致しません。');
    parts.push(trimPart({role,path:p.path,width:source.width,height:source.height,placement:{x:0,y:0,width:1,height:1},kind:'ai',png,order:p.motion?.order??baseOrder(role),parent:p.motion?.head===false?'root':defaultParent(role),motion:p.motion}));
  }
  ids.clear();for(const p of expressions){
    need(expressionRole(p.role) && !ids.has(p.role) && p.path===`expressions/${p.role}.png`,'表情素材のIDまたはパスが正しくありません。');ids.add(p.role);checkPlacement(p.placement);
    const size=sizeOf(entries[p.path],8*MIB);need(p.width===size.width && p.height===size.height,'表情PNGと素材サイズが一致しません。');
    if(settings.layers?.[p.role]?.enabled===false){excluded.push({role:p.role,reason:'disabled expression'});continue;}
    parts.push({...p,png:entries[p.path],kind:'expression',parent:'head'});
  }
  // Validate all source settings before pruning disabled expressions. Keep only
  // settings whose texture is actually transferred into the exported model.
  const checked=checkSettings({...settings,layers:{...Object.fromEntries(expressions.map(p=>[p.role,defaultExpressionLayer(p.role)])),...settings.layers}},expressions),included=new Set(parts.map(p=>p.role));
  const keep=obj=>Object.fromEntries(Object.entries(obj).filter(([role])=>included.has(role)));
  const converted={...checked,layers:keep(checked.layers),deforms:keep(checked.deforms),clips:keep(checked.clips),clipKeys:keep(checked.clipKeys),groups:{...checked.groups,assignments:keep(checked.groups.assignments),clipFollow:keep(checked.groups.clipFollow)}};
  const assignedGroups=new Set(Object.values(converted.groups.assignments));if(assignedGroups.size)assignedGroups.add('face');converted.groupKeys=Object.fromEntries(Object.entries(checked.groupKeys).filter(([id])=>assignedGroups.has(id)));
  warnings.push('The imported masks may overlap or retain original eye/mouth paint; image ownership and completed skin must be reviewed separately.');
  const unsupported=[];if(Object.keys(checked.clips).length)unsupported.push('clips');if(Object.keys(checked.clipKeys).length)unsupported.push('clipKeys');if(meta.parts.some(p=>p.motion?.swing))unsupported.push('motion.swing');
  return {name:'Imported authoring handoff',source,parts,settings:converted,mesh:{grid:GRID,triangles:TRIANGLES},handoffReport:{format:meta.format,version:meta.version,excluded,unsupported,warnings}};
}

async function boundedFile(path,max){const s=await lstat(path);need(s.isFile() && !s.isSymbolicLink() && s.size>0 && s.size<=max,'入力ファイルの種類かサイズが正しくありません。');const out=new Uint8Array(await readFile(path));need(out.length<=max,'入力ファイルが大きすぎます。');return out;}
export async function generateCharacter(manifestPath,outputBase){
  manifestPath=resolve(manifestPath);const raw=await boundedFile(manifestPath,MAX_CONTAINER),root=await realpath(dirname(manifestPath));let input;
  if(manifestPath.endsWith('.zip'))input=characterFromHandoffZip(raw);
  else{
    need(raw.length<=256*1024,'素材manifestが大きすぎます。');input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));need(Array.isArray(input.parts) && input.parts.length<=MAX_PARTS,'素材manifestが正しくありません。');
    const dir=join(root,'parts');need(!(await lstat(dir)).isSymbolicLink(),'素材ディレクトリのリンクは使用できません。');
    input.parts=await Promise.all(input.parts.map(async p=>{need(CHARACTER_ROLES.includes(p.role) && p.path===`parts/${p.role}.png`,'素材のパスが正しくありません。');return {...p,png:await boundedFile(join(root,p.path),8*MIB)};}));
  }
  const outputDir=await realpath(dirname(resolve(outputBase))),base=join(outputDir,basename(outputBase)),repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),rel=relative(repo,base);
  need(isAbsolute(rel) || rel==='..' || rel.startsWith('..'+sep),'モデルを含む出力はGitの外へ保存してください。');
  const result=buildCharacterModel(input),report={...result.report,inpSha256:hash(result.inp),assetLicense:input.assetLicense||'not specified; source artwork rights remain separate'},outputs=[[base+'.inp',result.inp],[base+'.inx',result.inx],[base+'.json',JSON.stringify(result.model,null,2)],[base+'-report.json',JSON.stringify(report,null,2)]],created=[];
  try{for(const [path,data] of outputs){await writeFile(path,data,{flag:'wx',mode:0o600});created.push(path);}}catch(error){for(const path of created)await unlink(path);throw error;}
  return {outputs:outputs.map(([path])=>path),report};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))try{need(process.argv.length===4,'使い方: character-model.mjs MANIFEST.json|HANDOFF.zip NEW_OUTPUT_BASE');console.log(JSON.stringify(await generateCharacter(...process.argv.slice(2))));}catch(error){console.error(error.message);process.exitCode=1;}
