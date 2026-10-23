// Shared source/completion data -> optional blink model. Stable writers and
// the common editing data are unchanged by this output-specific flattening.
import {decode,encode} from 'fast-png';
import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildQualityModel} from './quality-model.mjs';
import {readCharacterContainer} from './character-model.mjs';

const need=(condition,message)=>{if(!condition)throw new Error(message);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const uint=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const smooth=v=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);};
const png=image=>encode({...image,channels:4,depth:8});
const empty=(width,height)=>({width,height,data:new Uint8Array(width*height*4)});
const binding=(node,param_name,values)=>({node,param_name,values:values.map(v=>[v]),isSet:values.map(()=>[true]),interpolate_mode:'Linear'});
function paste(destination,source,x=0,y=0,owners){
  for(let row=0;row<source.height;row++)for(let col=0;col<source.width;col++){
    const a=(row*source.width+col)*4,b=((y+row)*destination.width+x+col)*4;
    if(!source.data[a+3])continue;
    if(owners){need(!owners[b/4],'Shared observed ownership overlaps.');owners[b/4]=1;}
    destination.data.set(source.data.subarray(a,a+4),b);
  }
}
function premultiply(image){const data=new Uint8Array(image.data);for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)data[i+c]=Math.floor(data[i+c]*data[i+3]/255);return png({...image,data});}
function part(role,image,box,source){const [x,y,w,h]=box;return {role,width:image.width,height:image.height,png:png(image),placement:{x:x/source.width,y:y/source.height,width:w/source.width,height:h/source.height},kind:'common-source-parts-projection'};}
function crop(image){
  let x0=image.width,y0=image.height,x1=0,y1=0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.data[(y*image.width+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
  need(x1>x0 && y1>y0,'No observed foreground.');const out=empty(x1-x0,y1-y0);
  for(let y=y0;y<y1;y++)out.data.set(image.data.subarray((y*image.width+x0)*4,(y*image.width+x1)*4),(y-y0)*out.width*4);
  return {image:out,box:[x0,y0,out.width,out.height]};
}

export function buildPartsModel(graph,images){
  need(graph?.format==='ai-live2d-maker-character-parts' && graph.version===1,'Common character parts version 1 required.');
  const source=graph.source,{width,height}=source;
  need([width,height].every(v=>Number.isInteger(v)&&v>=64&&v<=4096)&&width*height<=4_000_000,'Common source canvas exceeds budget.');
  need(Array.isArray(graph.parts)&&graph.parts.length<=80&&new Set(graph.parts.map(p=>p.id)).size===graph.parts.length,'Invalid shared parts.');
  const full=empty(width,height),owners=new Uint8Array(width*height),byId=new Map(graph.parts.map(p=>[p.id,p]));
  for(const p of graph.parts){
    const [x,y,w,h]=p.source_box_xywh;need([x,y,w,h].every(Number.isInteger)&&x>=0&&y>=0&&w>0&&h>0&&x+w<=width&&y+h<=height,'Invalid shared source coordinates.');
    if(p.observed.rgba){const image=images[p.observed.rgba];need(image&&image.width===w&&image.height===h,'Shared texture dimensions differ.');paste(full,image,x,y,owners);}
  }
  const projection=[],lowerImages={},skin=byId.get('eye_skin_underpaint');
  need(skin?.completion.rgba && images[skin.completion.rgba],'Separate eye skin underpainting is required.');
  const underpaint=images[skin.completion.rgba];need(underpaint.width===width&&underpaint.height===height,'Underpaint canvas mismatch.');
  const blink={};
  for(const side of ['l','r']){
    const geometry=graph.motions?.blink?.[side],box=geometry?.box_xywh;
    need(Array.isArray(box)&&box.length===4,'Measured eye geometry required.');
    const [x,y,w,h]=box,opened=empty(w,h);
    for(const p of graph.parts.filter(p=>p.side===side&&p.observed.rgba)){
      need(JSON.stringify(p.source_box_xywh)===JSON.stringify(box),'Eye parts must share source-coordinate texture domains.');
      paste(opened,images[p.observed.rgba]);
    }
    const lash=byId.get(`eye_${side}_eyelash_upper`),lower=byId.get(`eye_${side}_eyelash_lower`),closed=byId.get(`eye_${side}_closed`);
    need(lash?.observed.rgba&&closed?.completion.rgba,'Source upper lash and estimated closed contour required.');
    const upperImage=images[lash.observed.rgba],lowerImage=lower?.observed.rgba?images[lower.observed.rgba]:null;
    for(let j=0;j<h;j++)for(let i=0;i<w;i++){
      const a=(j*w+i)*4,b=((y+j)*width+x+i)*4;
      if(opened.data[a+3]){need(underpaint.data[b+3]===255,'Source eye must have an opaque, separately estimated skin bed.');full.data.set(underpaint.data.subarray(b,b+4),b);}
      if(upperImage.data[a+3] || lowerImage?.data[a+3])opened.data.fill(0,a,a+4);
    }
    projection.push(part(`eye_white_${side}`,opened,box,source),part(`eye_lash_${side}`,upperImage,box,source),part(`eye_closed_${side}`,images[closed.completion.rgba],box,source));
    lowerImages[side]=lowerImage;
    blink[side]={upper_y:geometry.upper_center_y,closed_y:geometry.closed_center_y};
  }
  const base=crop(full);projection.push(part('face_base',base.image,base.box,source));
  const head=graph.motions.head,q={profile:'aperture-head-v1',blink,headPivot:head.pivot,neckBlend:head.neck_blend};
  const built=buildQualityModel({name:'Detailed source parts / blink trial',source,parts:projection,quality:q});
  const parsed=readCharacterContainer(built.inp),model=built.model,textures=parsed.textures;
  const nodes=new Map();const visit=n=>{nodes.set(n.name,n);for(const c of n.children)visit(c);};visit(model.nodes);
  const headNode=nodes.get('Head');
  for(const [index,side] of ['l','r'].entries()){
    const param=model.param.find(p=>p.name==='EyeOpen'+side.toUpperCase()),axis=param.axis_points[0],g=graph.motions.blink[side];
    const upper=nodes.get('eye_lash_'+side),closed=nodes.get('eye_closed_'+side),eye=nodes.get('eye_white_'+side),mask=nodes.get('EyeAperture:'+side);
    const w=g.box_xywh[2],h=g.box_xywh[3],minimum=Math.max(.18,Math.min(.6,g.closed_lash_width/Math.max(1,g.source_lash_width)));
    const deform=(node,v,fn)=>node.mesh.uvs.reduce((out,u,i,uv)=>{if(i%2===0){const y=uv[i+1]*h,col=Math.round(u*12);out.push([0,fn(col,y,v)-y]);}return out;},[]);
    const replace=(node,name,values)=>{const b=param.bindings.find(b=>b.node===node.uuid&&b.param_name===name);need(b,'Expected base quality binding.');b.values=values.map(v=>[v]);};
    replace(eye,'opacity',axis.map(v=>smooth(v/.16)));
    replace(upper,'opacity',axis.map(v=>smooth(v/.26)));
    replace(closed,'opacity',axis.map(v=>1-smooth(v/.26)));
    replace(upper,'deform',axis.map(v=>deform(upper,v,(i,y,v)=>{
      const center=g.upper_center_y[i]+(g.closed_center_y[i]-g.upper_center_y[i])*(1-v);
      return center+(y-g.upper_center_y[i])*(minimum+(1-minimum)*v);
    })));
    replace(mask,'deform',axis.map(v=>deform(mask,v,(i,y,v)=>{
      if(v===1)return y;
      const center=g.upper_center_y[i]+(g.closed_center_y[i]-g.upper_center_y[i])*(1-v);
      const top=center-g.source_lash_width*(minimum+(1-minimum)*v)/2;
      const bottom=h*v+g.closed_center_y[i]*(1-v);
      return top+(bottom-top)*(y/h);
    })));
    if(lowerImages[side]){
      const lower={...structuredClone(upper),uuid:900+index,name:'eye_lash_lower_'+side,textures:[textures.length,4294967295,4294967295],masks:[]};
      textures.push(premultiply(lowerImages[side]));headNode.children.push(lower);nodes.set(lower.name,lower);
      const pixels=lowerImages[side].data,ys=[];for(let j=0;j<h;j++)for(let i=0;i<w;i++)if(pixels[(j*w+i)*4+3])ys.push(j);
      const center=ys.reduce((a,b)=>a+b,0)/ys.length;
      param.bindings.push(binding(lower.uuid,'opacity',axis.map(v=>smooth((v-.20)/.55))));
      param.bindings.push(binding(lower.uuid,'deform',axis.map(v=>deform(lower,v,(i,y,v)=>y+(g.closed_center_y[i]-center)*(1-v)))));
    }
  }
  model.meta.rigger='AI Live2D Maker common-parts blink adapter';
  const json=Buffer.from(JSON.stringify(model));need(json.length<=2*1024*1024,'Detailed model JSON exceeds budget.');
  const inp=new Uint8Array(Buffer.concat([Buffer.from('TRNSRTS\0'),uint(json.length),json,Buffer.from('TEX_SECT'),uint(textures.length),...textures.flatMap(p=>[uint(p.length),Buffer.from([0]),p])]));
  need(inp.length<=100*1024*1024,'Detailed model exceeds budget.');
  const drawable=[...nodes.values()].filter(n=>n.type==='Part');
  return {inp,inx:inp.slice(),model,layout:{format:'inochi-runtime-inspection-layout',source,
    parts:projection.map(({png,...p})=>p),quality:q},report:{...built.report,format:'ai-live2d-maker-common-parts-blink',
    commonPartsFormat:graph.format,commonPartsVersion:graph.version,sourcePartCount:graph.parts.length,
    parts:drawable.length-2,roles:drawable.filter(n=>!n.name.startsWith('EyeAperture:')).map(n=>n.name),
    drawableParts:drawable.length,textures:textures.length,
    decodedTextureBytes:built.report.decodedTextureBytes+Object.values(lowerImages).filter(Boolean).reduce((n,im)=>n+im.width*im.height*4,0),
    vertices:drawable.reduce((n,p)=>n+p.mesh.verts.length/2,0),
    triangles:drawable.reduce((n,p)=>n+p.mesh.indices.length/3,0),inpSha256:hash(inp),
    blinkMethod:'source-ink-center-alignment-independent-lower-lash',
    runtimeFlattening:'sclera/iris/pupil/highlight/lid-skin/context are combined only for this four-parameter blink output; common assets remain separate',
    independentGazeRigged:false,hairStrandsRigged:false,
    notes:[...built.report.notes,'Detailed source masks/completion and hair candidates remain in the engine-independent common parts file.',
      'The current runtime projection does not independently animate iris, pupil, highlights or hair strands.']}};
}

export async function generatePartsModel(manifestPath,outputBase){
  const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),manifest=resolve(manifestPath),folder=await realpath(dirname(manifest));
  const outdir=await realpath(dirname(resolve(outputBase))),base=join(outdir,resolve(outputBase).split(sep).at(-1)),rel=relative(repo,base);
  need(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep),'Output must be outside Git.');
  const s=await lstat(manifest);need(s.isFile()&&!s.isSymbolicLink()&&s.size<=512*1024,'Invalid common manifest.');
  const graph=JSON.parse(await readFile(manifest,'utf8'));need(Array.isArray(graph.parts)&&graph.parts.length<=80,'Invalid shared part list.');
  const paths=new Set(graph.parts.flatMap(p=>[p.observed?.rgba,p.completion?.rgba]).filter(Boolean)),images={};let budget=0;
  for(const path of paths){
    need(/^(observed|completion)\/[a-z0-9_]+\.png$/.test(path),'Invalid common asset path.');
    const dir=await lstat(join(folder,dirname(path))),file=join(folder,path),stat=await lstat(file);
    need(!dir.isSymbolicLink()&&stat.isFile()&&!stat.isSymbolicLink()&&stat.size>33&&stat.size<=8*1024*1024,'Invalid common texture.');
    const bytes=await readFile(file),w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);
    need(w>0&&h>0&&w<=4096&&h<=4096,'Common texture dimensions exceed budget.');budget+=w*h*4;need(budget<=128*1024*1024,'Common texture decoded budget exceeded.');
    const image=decode(bytes);need(image.depth===8&&image.channels===4,'8-bit RGBA common texture required.');images[path]=image;
  }
  const result=buildPartsModel(graph,images);
  for(const [ext,data] of [['inp',result.inp],['inx',result.inx],['json',JSON.stringify(result.model,null,2)],['layout.json',JSON.stringify(result.layout,null,2)],['report.json',JSON.stringify(result.report,null,2)]])await writeFile(base+'.'+ext,data,{flag:'wx',mode:0o600});
  return result.report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{
  need(process.argv.length===4,'Usage: parts-adapter.mjs COMMON_PARTS.json NEW_OUTPUT_BASE');console.log(JSON.stringify(await generatePartsModel(...process.argv.slice(2))));
}catch(error){console.error(error.message);process.exitCode=1;}
