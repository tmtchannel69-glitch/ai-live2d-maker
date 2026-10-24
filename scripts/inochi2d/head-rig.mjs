// Opt-in common-parts extension. The verified five-part/blink writers are used
// as inputs, never patched to accommodate this independent layered rig.
import {buildPartsModel} from './parts-adapter.mjs';
import {readCharacterContainer} from './character-model.mjs';
import {decode,encode} from 'fast-png';
import {createHash} from 'node:crypto';
import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const uint=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const digest=b=>createHash('sha256').update(b).digest('hex');
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const empty=(width,height)=>({width,height,data:new Uint8Array(width*height*4)});
const binding=(node,param_name,values)=>({node,param_name,values:values.map(v=>[v]),isSet:values.map(()=>[true]),interpolate_mode:'Linear'});
const flatten=n=>[n,...n.children.flatMap(flatten)];
const transform=(x=0,y=0)=>({trans:[x,y,0],rot:[0,0,0],scale:[1,1]});
function mesh(width,height,nx=25,ny=41){
  const uvs=[],verts=[],indices=[];
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){uvs.push(i/(nx-1),j/(ny-1));verts.push((i/(nx-1)-.5)*width,(j/(ny-1)-.5)*height);}
  for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){const a=j*nx+i;indices.push(a,a+1,a+nx,a+1,a+nx+1,a+nx);}
  return {verts,uvs,indices,origin:[0,0]};
}
function paste(dst,im,x,y){
  need(x>=0&&y>=0&&x+im.width<=dst.width&&y+im.height<=dst.height,'Layer is outside the source canvas.');
  for(let j=0;j<im.height;j++)for(let i=0;i<im.width;i++){
    const a=(j*im.width+i)*4,b=((y+j)*dst.width+x+i)*4;
    if(im.data[a+3])dst.data.set(im.data.subarray(a,a+4),b);
  }
}
function crop(im){
  let x0=im.width,y0=im.height,x1=0,y1=0;
  for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++)if(im.data[(y*im.width+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
  need(x1>x0&&y1>y0,'An observed semantic layer is missing; dummy layers are not supported.');
  const out=empty(x1-x0,y1-y0);
  for(let y=y0;y<y1;y++)out.data.set(im.data.subarray((y*im.width+x0)*4,(y*im.width+x1)*4),(y-y0)*out.width*4);
  return {image:out,box:[x0,y0,out.width,out.height]};
}
function premultiply(im){
  const data=new Uint8Array(im.data);
  for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)data[i+c]=Math.floor(data[i+c]*data[i+3]/255);
  return encode({...im,data,depth:8,channels:4});
}
function pack(model,textures){
  const json=Buffer.from(JSON.stringify(model));need(json.length<=2*1024*1024,'Layered model JSON exceeds budget.');
  const bytes=new Uint8Array(Buffer.concat([Buffer.from('TRNSRTS\0'),uint(json.length),json,Buffer.from('TEX_SECT'),uint(textures.length),...textures.flatMap(p=>[uint(p.length),Buffer.from([0]),p])]));
  need(bytes.length<=100*1024*1024,'Layered model container exceeds budget.');return bytes;
}

export function buildHeadModel(graph,images){
  const q=graph?.motions?.independent_head;
  need(q?.profile==='head-neck-body-v1','Automatic independent-head preparation is required.');
  const sw=graph.source.width,sh=graph.source.height,jaw=q.jaw;
  need(jaw?.coefficients_normalized_x?.length===3&&jaw.coefficients_normalized_x.every(Number.isFinite)
    &&Number.isFinite(jaw.center_x)&&jaw.x_scale>0&&Number.isFinite(q.collar_y),'Invalid measured neck geometry.');
  const built=buildPartsModel(graph,images),model=structuredClone(built.model);
  const parsed=readCharacterContainer(built.inp),textures=[...parsed.textures],nodes=flatten(model.nodes);
  const head=nodes.find(n=>n.name==='Head'),base=nodes.find(n=>n.name==='face_base');
  const originalPivot=[head.transform.trans[0]+sw/2,head.transform.trans[1]+sh/2];
  const pivot=q.head_pivot_xy;
  need(pivot?.length===2&&pivot.every(Number.isFinite)&&q.collar_y>pivot[1]+4,'Invalid independent head pivot/collar.');
  const jawAt=x=>{const z=(x-jaw.center_x)/jaw.x_scale,[a,b,c]=jaw.coefficients_normalized_x;return a*(jaw.basis==='absolute-linear'?Math.abs(z):z*z)+b*z+c;};
  if(q.collar_curve){const t=q.collar_curve;
    need(t.x?.length===25&&t.y?.length===25&&[...t.x,...t.y].every(Number.isFinite)
      &&t.x.every((x,i)=>i===0||x>t.x[i-1])&&t.y.every(y=>y>0&&y<=sh)
      &&Number.isInteger(t.fixed_border_pixels)&&t.fixed_border_pixels>=0&&t.fixed_border_pixels<=6,'Invalid measured collar curve.');
  }
  const collarAt=x=>{
    const trace=q.collar_curve;if(!trace)return q.collar_y;
    if(x<=trace.x[0])return trace.y[0]-trace.fixed_border_pixels;
    for(let i=1;i<trace.x.length;i++)if(x<=trace.x[i]){
      const t=(x-trace.x[i-1])/(trace.x[i]-trace.x[i-1]);return trace.y[i-1]*(1-t)+trace.y[i]*t-trace.fixed_border_pixels;
    }
    return trace.y.at(-1)-trace.fixed_border_pixels;
  };
  const byId=new Map(graph.parts.map(p=>[p.id,p]));
  for(const role of ['head_surface','neck','body'])need(byId.get(role)?.observed.rgba,'Missing observed '+role+'.');
  // Preserve the verified blink's exact premultiplied skin/lid projection.
  const fullBase=empty(sw,sh),basePixels=decode(textures[base.textures[0]]),basePlacement=built.layout.parts.find(p=>p.role==='face_base').placement;
  paste(fullBase,basePixels,Math.round(basePlacement.x*sw),Math.round(basePlacement.y*sh));
  const surface=empty(sw,sh);
  for(const p of graph.parts.filter(p=>p.role==='head_surface'||p.side||p.id==='eye_skin_underpaint')){
    const key=p.id==='eye_skin_underpaint'?'completion':'observed',path=p[key].rgba;
    if(!path)continue;
    const im=images[path],[x,y,w,h]=p.source_box_xywh;
    for(let j=0;j<h;j++)for(let i=0;i<w;i++)if(im.data[(j*w+i)*4+3]){
      const a=((y+j)*sw+x+i)*4;surface.data.set(fullBase.data.subarray(a,a+4),a);
    }
  }
  for(const child of head.children){child.transform.trans[0]+=originalPivot[0]-pivot[0];child.transform.trans[1]+=originalPivot[1]-pivot[1];}
  head.transform.trans=[pivot[0]-sw/2,pivot[1]-sh/2,0];
  const bodyGroup={uuid:1900,name:'Body',type:'Node',enabled:true,zsort:0,transform:transform(),lockToRoot:false,children:[]};
  const neckGroup={...structuredClone(bodyGroup),uuid:1901,name:'Neck',children:[head]};
  bodyGroup.children.push(neckGroup);
  model.nodes.children=model.nodes.children.filter(n=>n.uuid!==head.uuid&&n.uuid!==base.uuid);
  model.nodes.children.push(bodyGroup);
  const layers=[],runtimeParts=[];
  function addLayer(name,pixels,parent,uuid,order,alreadyPremultiplied=false){
    const {image,box}=crop(pixels),[x,y,w,h]=box;
    const origin=parent===head?pivot:[sw/2,sh/2];
    const texture=uuid===base.uuid?base.textures[0]:textures.length;
    const node={...structuredClone(base),uuid,name,zsort:order,children:[],
      transform:transform(x+w/2-origin[0],y+h/2-origin[1]),mesh:mesh(w,h),textures:[texture,4294967295,4294967295],masks:[]};
    const bytes=alreadyPremultiplied?encode({...image,depth:8,channels:4}):premultiply(image);
    if(texture===textures.length)textures.push(bytes);else textures[texture]=bytes;
    parent.children.push(node);layers.push({node,box});
    runtimeParts.push({role:name,width:w,height:h,placement:{x:x/sw,y:y/sh,width:w/sw,height:h/sh}});
    return node;
  }
  const surfaceNode=addLayer('head_surface',surface,head,base.uuid,980,true);
  for(const [role,parent,id,z] of [['body',bodyGroup,2000,1000],['neck',neckGroup,2001,990]]){
    const p=byId.get(role),im=empty(sw,sh),[x,y]=p.source_box_xywh;
    paste(im,images[p.observed.rgba],x,y);addLayer(role,im,parent,id,z);
  }
  for(const [index,p] of graph.parts.filter(p=>['hair_strand','hair_region'].includes(p.role)&&p.observed.rgba).entries()){
    const im=empty(sw,sh),[x,y]=p.source_box_xywh;
    paste(im,images[p.observed.rgba],x,y);addLayer(p.id,im,head,2100+index,970-index*.001);
  }
  const observedNodes=new Map(layers.map(l=>[l.node.name,l.node]));
  for(const [role,parent,id,z] of [['body',bodyGroup,2400,1001],['neck',neckGroup,2401,991]]){
    const p=byId.get(role);if(!p.completion.rgba)continue;
    const im=empty(sw,sh),[x,y]=p.source_box_xywh;paste(im,images[p.completion.rgba],x,y);
    // A continuous hidden bed also reuses near-solid observed texels. Without
    // that interior, two filtered complementary cut edges can each be 50%
    // covered and source-over leaves an artificial 25% transparent seam.
    // Partial source edges are never duplicated. Every neutral bed texel is
    // inverse-masked by its original owner, including this observed layer.
    const original=images[p.observed.rgba],supported={...original,data:new Uint8Array(original.data)};
    for(let i=0;i<supported.data.length;i+=4)if(supported.data[i+3]<250)supported.data.fill(0,i,i+4);
    paste(im,supported,x,y);
    const n=addLayer(role+'_underpaint',im,parent,id,z);
    need(p.occluded_by?.length>0,'Completion requires measured source occluders.');
    n.masks=[...new Set([...p.occluded_by,role])].map(id=>{
      const source=observedNodes.get(id);need(source,'Unsupported underpaint occluder: '+id);
      // Only near-solid current coverage suppresses the inferred bed. Source
      // alpha is unchanged; filtered alpha at moving mesh edges can reveal the
      // bed instead of leaving a translucent stitch in otherwise solid skin.
      source.mask_threshold=.96;
      return {source:source.uuid,mode:'DodgeMask'};
    });
  }
  const necks=layers.filter(l=>l.node.name==='neck'||l.node.name==='neck_underpaint');
  const travel=q.maximum_translation_pixels,angle=q.maximum_tilt_radians;
  need(travel>0&&travel<=12&&angle>0&&angle<=.045,'Unsupported automatic head motion range.');
  const neckWarp=(neck,shift,tilt)=>{const [nx,ny,nw,nh]=neck.box;return neck.node.mesh.uvs.reduce((out,u,i,uv)=>{
    if(i%2===0){const x=nx+u*nw,y=ny+uv[i+1]*nh,seam=jawAt(x)+2;
      const weight=1-smooth((y-seam)/Math.max(4,collarAt(x)-seam));
      const c=Math.cos(tilt),s=Math.sin(tilt),dx=x-pivot[0],dy=y-pivot[1];
      out.push([(shift+(c-1)*dx-s*dy)*weight,(s*dx+(c-1)*dy)*weight]);}
    return out;
  },[]);};
  for(const [name,field,range,isTilt] of [
    ['HeadX','transform.t.x',travel,false],
    ['HeadTilt','transform.r.z',angle,true]]){
    const p=model.param.find(p=>p.name===name);need(p,'Verified head control is missing.');
    p.bindings=[binding(head.uuid,field,[-range,0,range]),...necks.map(neck=>binding(neck.node.uuid,'deform',[-1,0,1].map(v=>neckWarp(neck,isTilt?0:v*travel,isTilt?v*angle:0))))];
  }
  model.meta.rigger='AI Live2D Maker independent head / neck / fixed body';
  const inp=pack(model,textures),all=flatten(model.nodes).filter(n=>n.type==='Part');
  let decoded=0;for(const t of textures){const d=decode(t);decoded+=d.width*d.height*4;}
  need(decoded<=64*1024*1024,'Layered textures exceed decoded budget.');
  return {inp,inx:inp.slice(),model,layout:{...built.layout,parts:[...built.layout.parts.filter(p=>p.role!=='face_base'),...runtimeParts],
      quality:{...built.layout.quality,neckBlend:{rigidY:jaw.center_y/sh,fixedY:q.collar_y/sh}},independent_head:q},
    report:{...built.report,format:'ai-live2d-maker-independent-head',profile:q.profile,
      inpSha256:digest(inp),baselineBlinkModelSha256:built.report.inpSha256,
      drawableParts:all.length,textures:textures.length,decodedTextureBytes:decoded,
      parts:all.filter(p=>!p.name.startsWith('EyeAperture:')).length,
      roles:all.filter(p=>!p.name.startsWith('EyeAperture:')).map(p=>p.name),
      vertices:all.reduce((n,p)=>n+p.mesh.verts.length/2,0),triangles:all.reduce((n,p)=>n+p.mesh.indices.length/3,0),
      semanticHeadBodySeparation:true,neckBridgeRigged:true,torsoFixedBelowNormalizedY:q.collar_y/sh,
      headPivot:{x:pivot[0]/sw,y:pivot[1]/sh},neckBlend:{rigidY:jaw.center_y/sh,fixedY:q.collar_y/sh},
      faceAnglesXYRigged:false,headTiltIsPlanarZ:true,hairStrandsRigged:false,physicsRigged:false,
      appearanceQualityVerified:false,officialCreatorTested:false,
      notes:['Observed semantic layers retain source RGBA; narrow underlaps are explicitly estimated.',
        'HeadX is translation and HeadTilt is planar Z rotation, not reconstructed yaw/pitch.',
        'Hair layers follow the head together; inferred front/back depth is unverified.',
        'Blink artwork and naturalness limitations from STEP 1 remain.']}};
}

export async function generateHeadModel(manifestPath,outputBase){
  const manifest=resolve(manifestPath),folder=await realpath(dirname(manifest));
  const stat=await lstat(manifest);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=512*1024,'Invalid common manifest.');
  const output=resolve(outputBase),outdir=await realpath(dirname(output)),rel=relative(ROOT,join(outdir,output.split(sep).at(-1)));
  need(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep),'Models must be written outside Git.');
  const graph=JSON.parse(await readFile(manifest,'utf8'));
  need(Array.isArray(graph.parts)&&graph.parts.length<=80,'Invalid shared parts.');
  const paths=new Set(graph.parts.flatMap(p=>[p.observed?.rgba,p.completion?.rgba]).filter(Boolean)),images={};let budget=0;
  for(const path of paths){
    need(/^(observed|completion)\/[a-z0-9_]+\.png$/.test(path),'Invalid common asset path.');
    const directory=await lstat(join(folder,dirname(path))),file=join(folder,path),s=await lstat(file);
    need(!directory.isSymbolicLink()&&s.isFile()&&!s.isSymbolicLink()&&s.size>33&&s.size<=8*1024*1024,'Invalid common asset.');
    const bytes=await readFile(file),w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);
    need(w>0&&h>0&&w<=4096&&h<=4096,'Common dimensions exceed budget.');budget+=w*h*4;need(budget<=128*1024*1024,'Common decoded budget exceeded.');
    const im=decode(bytes);need(im.depth===8&&im.channels===4,'8-bit RGBA required.');images[path]=im;
  }
  const result=buildHeadModel(graph,images);
  for(const [ext,data] of [['inp',result.inp],['inx',result.inx],['json',JSON.stringify(result.model,null,2)],['layout.json',JSON.stringify(result.layout,null,2)],['report.json',JSON.stringify(result.report,null,2)]])await writeFile(output+'.'+ext,data,{flag:'wx',mode:0o600});
  return result.report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{
  need(process.argv.length===4,'Usage: head-rig.mjs COMMON_PARTS.json NEW_OUTPUT_BASE');console.log(JSON.stringify(await generateHeadModel(...process.argv.slice(2))));
}catch(error){console.error(error.message);process.exitCode=1;}
