// Opt-in aperture/neck experiment. Neither verified exporter is modified.
import {encode,decode} from 'fast-png';
import {buildCharacterModel,readCharacterContainer} from './character-model.mjs';
import {createHash} from 'node:crypto';
import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const need=(ok,message)=>{if(!ok)throw new Error(message);};
const bind=(node,param_name,values)=>({node,param_name,values:values.map(v=>[v]),isSet:values.map(()=>[true]),interpolate_mode:'Linear'});
const uint=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const hash=b=>createHash('sha256').update(b).digest('hex');
function mesh(xs,ys,width,height){
  const indices=[];for(let y=0;y<ys.length-1;y++)for(let x=0;x<xs.length-1;x++){
    const a=y*xs.length+x,b=a+1,c=a+xs.length,d=c+1;indices.push(a,b,c,b,d,c);
  }
  return {verts:ys.flatMap(y=>xs.flatMap(x=>[(x-.5)*width,(y-.5)*height])),uvs:ys.flatMap(y=>xs.flatMap(x=>[x,y])),indices,origin:[0,0]};
}
function parameter(uuid,name,min,max,initial,bindings,axis){return {uuid,name,is_vec2:false,min:[min,0],max:[max,1],defaults:[initial,0],axis_points:[axis,[0]],bindings};}

export function buildQualityModel(input){
  const q=input?.quality;
  need(q?.profile==='aperture-head-v1','The opt-in quality preparation manifest is required.');
  const {width:sw,height:sh}=input.source;
  for(const obj of [q.headPivot,q.neckBlend])need(obj && Object.values(obj).every(v=>Number.isFinite(v) && v>0 && v<1),'Invalid automatic head geometry.');
  need(q.neckBlend.fixedY>q.neckBlend.rigidY,'Invalid neck transition.');
  for(const side of ['l','r'])for(const key of ['upper_y','closed_y'])need(Array.isArray(q.blink?.[side]?.[key]) && q.blink[side][key].length===13 && q.blink[side][key].every(Number.isFinite),'Missing measured lash geometry.');
  const parts=input.parts.map(p=>({...p,parent:p.role==='face_base'?'root':'head'}));
  need(parts.length===7 && ['eye_lash_l','eye_lash_r'].every(role=>parts.some(p=>p.role===role)),'Seven partitioned image parts are required.');
  const built=buildCharacterModel({...input,parts});
  const {textures}=readCharacterContainer(built.inp),model=built.model;
  const root=model.nodes,head=root.children.find(n=>n.name==='Head'),nodes=new Map();
  const visit=n=>{if(n.type==='Part')nodes.set(n.name,n);for(const c of n.children)visit(c);};visit(root);
  const pivot={x:q.headPivot.x*sw,y:q.headPivot.y*sh};
  head.transform.trans=[pivot.x-sw/2,pivot.y-sh/2,0];
  for(const p of parts.filter(p=>p.parent==='head')){
    const n=nodes.get(p.role);n.transform.trans=[(p.placement.x+p.placement.width/2)*sw-pivot.x,(p.placement.y+p.placement.height/2)*sh-pivot.y,0];
  }
  const axis=[0,.04,.1,.18,.35,.5,.7,1],parameters=[];
  // A transparent, one-pixel Part supplies alpha to the SDK stencil pass.
  // This is geometry, never a substitute for missing character artwork.
  const maskTexture=textures.length;textures.push(encode({width:1,height:1,data:new Uint8Array([255,255,255,255]),channels:4,depth:8}));
  for(const [index,side] of ['l','r'].entries()){
    const eye=nodes.get(`eye_white_${side}`),lash=nodes.get(`eye_lash_${side}`),closed=nodes.get(`eye_closed_${side}`);
    const p=parts.find(p=>p.role===eye.name),width=p.placement.width*sw,height=p.placement.height*sh;
    const xs=Array.from({length:13},(_,i)=>i/12),ys=[0,.5,1];
    const data=q.blink[side],upper=data.upper_y,close=data.closed_y;
    const mask={...structuredClone(eye),uuid:800+index,name:`EyeAperture:${side}`,opacity:0,children:[],masks:[],textures:[maskTexture,4294967295,4294967295],mesh:mesh(xs,ys,width,height)};
    head.children.push(mask);eye.masks=[{source:mask.uuid,mode:'Mask'}];
    lash.mesh=mesh(xs,ys,width,height);closed.mesh=mesh(xs,ys,width,height);
    const delta=(node,fn)=>node.mesh.uvs.reduce((points,u,i,uvs)=>{if(i%2===0){const v=uvs[i+1],col=Math.round(u*12),y=v*height;points.push([0,fn(col,y,v)-y]);}return points;},[]);
    const bindings=[
      bind(eye.uuid,'opacity',axis.map(v=>Math.min(1,v/.04))),
      bind(lash.uuid,'opacity',axis.map(v=>Math.min(1,v/.18))),
      bind(closed.uuid,'opacity',axis.map(v=>Math.max(0,1-v/.18))),
      bind(lash.uuid,'deform',axis.map(v=>delta(lash,(i,y)=>upper[i]+(close[i]-upper[i])*(1-v)+(y-upper[i])*(.6+.4*v)))),
      bind(closed.uuid,'deform',axis.map(v=>delta(closed,(i,y)=>y+(upper[i]-close[i])*v))),
      bind(mask.uuid,'deform',axis.map(v=>delta(mask,(i,y,t)=>{
        if(v===1)return y;
        const top=upper[i]+(close[i]-upper[i])*(1-v),bottom=height*v+close[i]*(1-v);
        return top+(bottom-top)*t;
      }))),
    ];
    parameters.push(parameter(1001+index,`EyeOpen${side.toUpperCase()}`,0,1,1,bindings,axis));
  }
  // One continuous foreground mesh avoids holes from moving a hard head cut.
  // The face/hair turn rigidly above the neck; the torso below fixedY is exact
  // identity. This is still a planar warp, not independent 3-D head layers.
  const base=nodes.get('face_base'),bp=parts.find(p=>p.role==='face_base').placement;
  const bx=bp.x*sw,by=bp.y*sh,bw=bp.width*sw,bh=bp.height*sh;
  const xs=Array.from({length:25},(_,i)=>i/24);
  const ys=[...new Set([...Array.from({length:41},(_,i)=>i/40),...Object.values(q.neckBlend).map(y=>(y*sh-by)/bh).filter(y=>y>0 && y<1)])].sort((a,b)=>a-b);
  base.mesh=mesh(xs,ys,bw,bh);
  const weight=y=>{const t=Math.max(0,Math.min(1,(y/sh-q.neckBlend.rigidY)/(q.neckBlend.fixedY-q.neckBlend.rigidY)));return 1-t*t*(3-2*t);};
  const travel=Math.min(12,sw*.014),angle=.045;
  const warp=(v,tilt)=>base.mesh.uvs.reduce((out,u,i,uv)=>{if(i%2===0){const x=bx+u*bw,y=by+uv[i+1]*bh,w=weight(y),a=tilt?v*angle:0,c=Math.cos(a),s=Math.sin(a);out.push(tilt?[(pivot.x+c*(x-pivot.x)-s*(y-pivot.y)-x)*w,(pivot.y+s*(x-pivot.x)+c*(y-pivot.y)-y)*w]:[v*travel*w,0]);}return out;},[]);
  parameters.push(parameter(1003,'HeadX',-1,1,0,[bind(head.uuid,'transform.t.x',[-travel,0,travel]),bind(base.uuid,'deform',[-1,0,1].map(v=>warp(v,false)))],[0,.5,1]));
  parameters.push(parameter(1004,'HeadTilt',-1,1,0,[bind(head.uuid,'transform.r.z',[-angle,0,angle]),bind(base.uuid,'deform',[-1,0,1].map(v=>warp(v,true)))],[0,.5,1]));
  model.param=parameters;model.meta.rigger='AI Live2D Maker opt-in aperture / neck experiment';
  // Creator imports straight PNGs with inTexPremultiply, but the pinned INP
  // loader consumes stored bytes directly. Match that official runtime
  // contract here only. The preparation PNGs retain original straight RGBA.
  // Alpha and coordinates remain exact; 8-bit premultiplication floors RGB.
  const runtimeTextures=textures.map(png=>{
    const image=decode(png),data=new Uint8Array(image.data);
    for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)data[i+c]=Math.floor(data[i+c]*data[i+3]/255);
    return encode({width:image.width,height:image.height,data,depth:8,channels:4});
  });
  const json=Buffer.from(JSON.stringify(model));need(json.length<=2*1024*1024,'Quality rig exceeds the JSON budget.');
  const inp=new Uint8Array(Buffer.concat([Buffer.from('TRNSRTS\0'),uint(json.length),json,Buffer.from('TEX_SECT'),uint(runtimeTextures.length),...runtimeTextures.flatMap(p=>[uint(p.length),Buffer.from([0]),p])]));
  need(inp.length<=100*1024*1024,'Quality model exceeds the container budget.');
  const drawables=[...nodes.values(),...head.children.filter(n=>n.name.startsWith('EyeAperture:'))];
  const report={...built.report,format:'ai-live2d-maker-inochi2d-quality-trial',qualityProfile:q.profile,
    vertices:drawables.reduce((n,p)=>n+p.mesh.verts.length/2,0),
    triangles:drawables.reduce((n,p)=>n+p.mesh.indices.length/3,0),drawableParts:drawables.length,
    textures:textures.length,decodedTextureBytes:built.report.decodedTextureBytes+4,
    parameters:parameters.map(p=>({id:p.uuid,name:p.name,min:p.min[0],max:p.max[0],default:p.defaults[0]})),
    headPivot:q.headPivot,neckBlend:q.neckBlend,headTravelPixels:travel,headTiltRadians:angle,
    blinkMethod:'stationary-iris-aperture-and-source-lash-warp',
    semanticHeadBodySeparation:false,frontBackHairSeparation:false,
    torsoFixedBelowNormalizedY:q.neckBlend.fixedY,appearanceQualityVerified:false,
    preparationPngAlphaEncoding:'straight',runtimeTextureAlphaEncoding:'premultiplied-floor-rgb-8bit',
    inpSha256:hash(inp),notes:[...built.report.notes,'One invisible solid alpha texture is a procedural stencil, not character artwork.',
      'The base is a continuous foreground mesh with an anchored torso, not a completed layered head.',
      'INP textures use the pinned SDK premultiplied-alpha contract; preparation PNGs retain source straight RGBA.',
      'SDK additive deformation can differ from rigid composition when HeadX and HeadTilt are combined.']};
  return {inp,inx:inp.slice(),model,report};
}

export async function generateQuality(manifestPath,outputBase){
  const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),dir=await realpath(dirname(resolve(outputBase))),base=join(dir,outputBase.split(/[\\/]/).at(-1)),rel=relative(repo,base);
  need(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep),'Image/model output must be outside Git.');
  const manifest=resolve(manifestPath),folder=await realpath(dirname(manifest));
  const stat=await lstat(manifest);need(stat.isFile() && !stat.isSymbolicLink() && stat.size<=256*1024,'Invalid quality manifest.');
  const input=JSON.parse(await readFile(manifest,'utf8'));
  need(Array.isArray(input.parts) && input.parts.length===7,'Seven quality parts are required.');
  need(!(await lstat(join(folder,'parts'))).isSymbolicLink(),'Linked parts directory is unsupported.');
  const parts=[];for(const p of input.parts){need(/^parts\/(face_base|eye_(white|closed|lash)_[lr])\.png$/.test(p.path) && p.path===`parts/${p.role}.png`,'Invalid quality part path.');
    const path=join(folder,p.path),s=await lstat(path);need(s.isFile() && !s.isSymbolicLink() && s.size>0 && s.size<=8*1024*1024,'Invalid quality PNG.');parts.push({...p,png:new Uint8Array(await readFile(path))});}
  const result=buildQualityModel({...input,parts});
  // New output directory is required by the Python entry point. Each file
  // also uses exclusive creation so direct CLI use cannot overwrite a model.
  for(const [ext,data] of [['inp',result.inp],['inx',result.inx],['json',JSON.stringify(result.model,null,2)],['report.json',JSON.stringify(result.report,null,2)]])await writeFile(`${base}.${ext}`,data,{flag:'wx',mode:0o600});
  return result.report;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))try{
  need(process.argv.length===4,'Usage: quality-model.mjs MANIFEST NEW_OUTPUT_BASE');console.log(JSON.stringify(await generateQuality(...process.argv.slice(2))));
}catch(error){console.error(error.message);process.exitCode=1;}
