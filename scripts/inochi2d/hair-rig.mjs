// STEP 3 is an opt-in extension of the verified independent head builder.
// Source-supported small bends and native 0.8.6 pendulum drivers are separate
// outputs. No browser runtime workaround, manual rig or new image API.
import {buildHeadModel,generateHeadModel,packRigContainer} from './head-rig.mjs';
import {readCharacterContainer} from './character-model.mjs';
import {decode,encode} from 'fast-png';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const need=(v,m)=>{if(!v)throw new Error(m);};
const flat=n=>[n,...n.children.flatMap(flat)];
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const binding=(node,values)=>({node,param_name:'deform',values:values.map(v=>[v]),isSet:values.map(()=>[true]),interpolate_mode:'Linear'});
const transform=(x=0,y=0)=>({trans:[x,y,0],rot:[0,0,0],scale:[1,1]});
function grid(w,h,nx=13,ny=25){
  const verts=[],uvs=[],indices=[];
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){verts.push((x/(nx-1)-.5)*w,(y/(ny-1)-.5)*h);uvs.push(x/(nx-1),y/(ny-1));}
  for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){const a=y*nx+x;indices.push(a,a+1,a+nx,a+1,a+nx+1,a+nx);}
  return {verts,uvs,indices,origin:[0,0]};
}
function premultiply(im){
  const data=new Uint8Array(im.data);for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)data[i+c]=Math.floor(data[i+c]*data[i+3]/255);
  return encode({...im,data,channels:4,depth:8});
}
function crop(im){
  let ax=im.width,ay=im.height,bx=0,by=0;
  for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++)if(im.data[(y*im.width+x)*4+3]){ax=Math.min(ax,x);ay=Math.min(ay,y);bx=Math.max(bx,x+1);by=Math.max(by,y+1);}
  if(bx<=ax||by<=ay)return null;
  const out={width:bx-ax,height:by-ay,data:new Uint8Array((bx-ax)*(by-ay)*4)};
  for(let y=ay;y<by;y++)out.data.set(im.data.subarray((y*im.width+ax)*4,(y*im.width+bx)*4),(y-ay)*out.width*4);
  return {image:out,offset:[ax,ay]};
}

export function buildHairModel(graph,images,{physics=false}={}){
  const headBuilt=buildHeadModel(graph,images),model=structuredClone(headBuilt.model);
  const {textures}=readCharacterContainer(headBuilt.inp),all=flat(model.nodes),nodes=new Map(all.map(n=>[n.name,n]));
  const head=nodes.get('Head'),pivot=graph.motions.independent_head.head_pivot_xy,{width:sw,height:sh}=graph.source;
  const candidates=graph.parts.filter(p=>p.role==='hair_strand'&&p.observed.rgba);
  need(candidates.length>0&&candidates.length<=10,'Source-supported hair strand candidates are required.');
  // Rigid static parts need only an affine textured grid. Do not re-mesh the
  // verified neck bridge or the eye deformation/mask geometry.
  for(const node of all.filter(n=>n.type==='Part')){
    if(['head_surface','body','body_underpaint'].includes(node.name)||node.name.startsWith('hair_region_')){
      const im=decode(textures[node.textures[0]]);node.mesh=grid(im.width,im.height,3,3);
    }
  }
  const owner=new Int16Array(sw*sh).fill(-1),alpha=new Uint8Array(sw*sh),sourceParts=graph.parts;
  for(const [index,p] of sourceParts.entries())if(p.observed.rgba){
    const im=images[p.observed.rgba],[x,y,w,h]=p.source_box_xywh;
    for(let j=0;j<h;j++)for(let i=0;i<w;i++){const a=im.data[(j*w+i)*4+3],k=(y+j)*sw+x+i;if(a){owner[k]=index;alpha[k]=a;}}
  }
  const hairSources=sourceParts.filter(p=>['hair_strand','hair_region'].includes(p.role)&&p.observed.rgba);
  const regionOrder=region=>region==='front'?940:region==='back'?995:945;
  for(const [index,p] of hairSources.entries())nodes.get(p.id).zsort=regionOrder(p.hair_region)-index*.001;
  const masksFor=ids=>[...new Set(ids)].map(id=>{const n=nodes.get(id);need(n,'Missing observed hair occluder: '+id);n.mask_threshold=.96;return {source:n.uuid,mode:'DodgeMask'};});
  const newLayers=[],strands=[];
  function underlay(id,im,box,parent,origin,uuid,order,occluders){
    const cropped=crop(im);if(!cropped)return null;
    const x=box[0]+cropped.offset[0],y=box[1]+cropped.offset[1],w=cropped.image.width,h=cropped.image.height;
    const n={...structuredClone(nodes.get('head_surface')),uuid,name:id,children:[],zsort:order,
      transform:transform(x+w/2-origin[0],y+h/2-origin[1]),mesh:grid(w,h,9,17),textures:[textures.length,4294967295,4294967295],masks:masksFor(occluders)};
    textures.push(premultiply(cropped.image));parent.children.push(n);nodes.set(id,n);newLayers.push({node:n,box:[x,y,w,h]});
    return newLayers.at(-1);
  }
  for(const [index,p] of candidates.entries()){
    const root=p.motion?.root_xy,[x,y,w,h]=p.source_box_xywh;
    need(root?.length===2&&root.every(Number.isFinite)&&root[0]>=x&&root[0]<=x+w&&root[1]>=y&&root[1]<y+h-3,'Invalid automatic strand root.');
    need(p.motion.maximum_exposure_pixels>=2,'Insufficient source-supported hidden-root padding.');
    const observed=nodes.get(p.id);need(observed,'Head model did not retain the observed strand.');
    const info=headBuilt.layout.parts.find(v=>v.role===p.id);need(info,'Missing source-coordinate strand layout.');
    const ox=Math.round(info.placement.x*sw),oy=Math.round(info.placement.y*sh),ow=info.width,oh=info.height;
    observed.mesh=grid(ow,oh);
    const rootNode={uuid:3200+index,name:'HairRoot:'+String(index).padStart(2,'0'),type:'Node',enabled:true,zsort:0,
      transform:transform(root[0]-pivot[0],root[1]-pivot[1]),lockToRoot:false,children:[observed]};
    head.children=head.children.filter(n=>n.uuid!==observed.uuid);head.children.push(rootNode);
    observed.transform.trans=[ox+ow/2-root[0],oy+oh/2-root[1],0];
    const original=images[p.observed.rgba],paint={...original,data:new Uint8Array(original.data.length)},occluders=new Set([p.id]);
    let inferred=0;
    for(let j=0;j<h;j++)for(let i=0;i<w;i++){
      const a=(j*w+i)*4,k=(y+j)*sw+x+i;
      if(original.data[a+3]>=250)paint.data.set(original.data.subarray(a,a+4),a);
      else if(p.completion.rgba){
        const generated=images[p.completion.rgba],source=sourceParts[owner[k]];
        if(generated.data[a+3]&&alpha[k]>=250&&source){
          // Own-strand continuation may be hidden by face/neck/clothing too.
          // Keep those measured owners as inverse masks rather than exposing
          // the inferred hair over their unchanged visible paint in neutral.
          const runtimeOwner=source.side?'head_surface':source.id;
          need(nodes.has(runtimeOwner),'Unsupported observed underlap owner: '+runtimeOwner);
          paint.data.set(generated.data.subarray(a,a+4),a);occluders.add(runtimeOwner);inferred++;
        }
      }
    }
    const bed=underlay('hair_underpaint_'+String(index).padStart(2,'0'),paint,p.source_box_xywh,rootNode,root,3400+index,regionOrder(p.hair_region)+2-index*.001,[...occluders]);
    const travel=Math.min(1.75,p.motion.maximum_exposure_pixels*.35,oh*.006);
    const radius=Math.max(...[[ox,oy],[ox+ow,oy],[ox,oy+oh],[ox+ow,oy+oh]].map(([x,y])=>Math.hypot(x-root[0],y-root[1])));
    const angle=Math.min(.006,travel/Math.max(radius,1));
    const bend=(node,box,value)=>node.mesh.uvs.reduce((points,u,i,uv)=>{
      if(i%2===0){const px=box[0]+u*box[2],py=box[1]+uv[i+1]*box[3],dx=px-root[0],dy=py-root[1];
        const weight=smooth((py-root[1])/Math.max(4,oy+oh-root[1]));
        const a=value*angle*weight,c=Math.cos(a),s=Math.sin(a);points.push([(c-1)*dx-s*dy,s*dx+(c-1)*dy]);}
      return points;
    },[]);
    const name='HairSway'+String(index).padStart(2,'0'),param={uuid:1100+index,name,is_vec2:false,min:[-1,0],max:[1,1],defaults:[0,0],axis_points:[[0,.5,1],[0]],
      bindings:[binding(observed.uuid,[-1,0,1].map(v=>bend(observed,[ox,oy,ow,oh],v))),
        ...(bed?[binding(bed.node.uuid,[-1,0,1].map(v=>bend(bed.node,bed.box,v)))]:[])]};
    model.param.push(param);
    if(physics)rootNode.children.push({uuid:3300+index,name:'HairPhysics:'+String(index).padStart(2,'0'),type:'SimplePhysics',
      enabled:true,zsort:0,transform:transform(),lockToRoot:false,children:[],param:param.uuid,
      // Fghj v1.0.2 serializes D enum member names, not their underlying
      // lowercase string values. The official 0.8.6 loader rejects the latter.
      model_type:'Pendulum',map_mode:'AngleLength',gravity:1,length:Math.max(40,Math.min(600,(oy+oh-root[1])*.85)),
      frequency:1,angle_damping:.45,length_damping:.6,output_scale:[40,0],local_only:false});
    strands.push({source_id:p.id,parameter:name,root_xy:root,root_is_observed_fragment_top:true,
      anatomical_root_verified:false,hair_region:p.hair_region,front_back_depth_verified:false,
      maximum_tip_travel_pixels:travel,maximum_angle_radians:angle,inferred_underlap_pixels:inferred});
  }
  // Existing bounded skin continuation behind fringe supports only its measured
  // narrow exposure. It is never relabelled as recovered hidden forehead.
  const fringe=sourceParts.find(p=>p.id==='face_skin_behind_fringe'&&p.completion.rgba);
  if(fringe){
    const im=images[fringe.completion.rgba],paint={...im,data:new Uint8Array(im.data)},[x,y,w,h]=fringe.source_box_xywh;const occluders=new Set();
    for(let j=0;j<h;j++)for(let i=0;i<w;i++){
      const a=(j*w+i)*4,k=(y+j)*sw+x+i,source=sourceParts[owner[k]];
      if(!paint.data[a+3])continue;
      if(alpha[k]<250||!source||!['hair_strand','hair_region'].includes(source.role))paint.data.fill(0,a,a+4);
      else occluders.add(source.id);
    }
    underlay('fringe_skin_underpaint',paint,fringe.source_box_xywh,head,pivot,3500,941,[...occluders]);
  }
  model.meta.rigger='AI Live2D Maker bounded strand rig'+(physics?' / native 0.8.6 pendulum':' / independent keys');
  const inp=packRigContainer(model,textures),drawables=flat(model.nodes).filter(n=>n.type==='Part');
  need(textures.length<=40,'Hair model texture count exceeds legacy inspection budget.');
  let decoded=0;for(const t of textures){const im=decode(t);decoded+=im.width*im.height*4;}
  need(decoded<=64*1024*1024,'Hair textures exceed decoded budget.');
  return {inp,inx:inp.slice(),model,layout:{...headBuilt.layout,hair_rig:{profile:'bounded-strands-v1',physics_configured:physics,strands}},
    report:{...headBuilt.report,format:'ai-live2d-maker-automatic-hair-rig',profile:'bounded-strands-v1',
      inpSha256:createHash('sha256').update(inp).digest('hex'),verifiedHeadModelSha256:headBuilt.report.inpSha256,
      drawableParts:drawables.length,textures:textures.length,decodedTextureBytes:decoded,
      parts:drawables.filter(n=>!n.name.startsWith('EyeAperture:')).length,
      roles:drawables.filter(n=>!n.name.startsWith('EyeAperture:')).map(n=>n.name),
      vertices:drawables.reduce((s,n)=>s+n.mesh.verts.length/2,0),triangles:drawables.reduce((s,n)=>s+n.mesh.indices.length/3,0),
      parameters:model.param.map(p=>({id:p.uuid,name:p.name,min:p.min[0],max:p.max[0],default:p.defaults[0]})),
      strands,hairStrandsRigged:true,coarseHairMassesUnrigged:sourceParts.filter(p=>p.role==='hair_region').length,
      physicsConfigured:physics,physicsRigged:physics,physicsRuntimeVerified:false,officialCreatorTested:false,
      appearanceQualityVerified:false,anatomicalRootsVerified:false,frontBackHairDepthVerified:false,
      hairLayerOrder:'tentative-location-based-front-side-back; not verified occlusion depth',
      notes:[`${candidates.length} source candidates are local fragments; their upper support is not proof of a scalp root.`,
        'Small bounded bends are auto-keyed; head/blink/neck settings and stable exporters are retained.',
        'Common observed RGBA stays separate from inferred, inverse-masked underpaint.',
        'Native pendulum nodes require separate official time-series/save/reload evidence.',
        'Face XY angles and mobile UI integration remain unimplemented; hidden anatomy and general-image quality are unverified.']}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{
  need(process.argv.length===4||process.argv.length===5&&process.argv[4]==='--physics','Usage: hair-rig.mjs COMMON_PARTS.json NEW_OUTPUT_BASE [--physics]');
  console.log(JSON.stringify(await generateHeadModel(process.argv[2],process.argv[3],{builder:(g,i)=>buildHairModel(g,i,{physics:process.argv.includes('--physics')})})));
}catch(error){console.error(error.message);process.exitCode=1;}
