import {decode} from 'fast-png';
import {DESIGN_HAIR_ROLES,DEFAULT_STYLE_POLICY,REFERENCE_LIMITS,inspectReferenceHeader,validateReferenceMeta,validateStylePolicy,bindingMatches} from '../../shared/design-reference.js';
import {measureDesignPixels,compareDesignMeasurements,paletteDistance} from '../../shared/design-part-quality.js';
import {makerDigest,matchMakerFiles} from '../../shared/modular-character.js';
import {checkAbort} from '../character-generation/generator.js';
import {replaceMakerParts} from './project.js';
import {prepareBangsImport} from './bangs-import.js';

const need=(v,m)=>{if(!v)throw new Error(m);};
const canonicalPolicy=value=>{const p=validateStylePolicy(value);return JSON.stringify({line_width_px:p.line_width_px,hair_palette:p.hair_palette,shading:p.shading,lighting:p.lighting});};
export const stylePolicyDigest=p=>makerDigest(new TextEncoder().encode(canonicalPolicy(p)));
const createCanvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
function checkReferenceContent(image){
  const scale=Math.min(1,256/image.width,256/image.height),c=createCanvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));
  try{
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,c.width,c.height);const data=ctx.getImageData(0,0,c.width,c.height).data,colors=new Set();let visible=0;
    for(let i=0;i<data.length;i+=4)if(data[i+3]>=32){visible++;colors.add([data[i],data[i+1],data[i+2]].map(n=>n>>4).join(','));}
    need(visible>=256&&colors.size>=4,'原画が空、薄すぎる、または単色に近いため比較できません。キャラクターの完成画像を使用してください。');
  }finally{c.width=c.height=0;}
}

export async function validateDesignReference(reference,{signal}={}){
  const m=validateReferenceMeta(reference?.meta),b=reference.blob;
  need(b instanceof Blob&&b.size===m.source.bytes,'共通原画の実データが不足しています。');
  const bytes=new Uint8Array(await b.arrayBuffer());checkAbort(signal);const header=inspectReferenceHeader(bytes);
  need(header.type===m.source.media_type&&await makerDigest(bytes)===m.source.sha256&&await stylePolicyDigest(m.policy)===m.policy_sha256,'共通原画または画風条件の指紋が一致しません。');
  let im;
  try{
    im=await createImageBitmap(b);checkAbort(signal);
    const direct=im.width===header.width&&im.height===header.height,rotated=header.type==='image/jpeg'&&im.width===header.height&&im.height===header.width;
    need((direct||rotated)&&im.width===m.source.width&&im.height===m.source.height,'共通原画のヘッダー・表示寸法が一致しません。');
    checkReferenceContent(im);
  }finally{im?.close();}
  return {meta:m,blob:b};
}
export async function registerDesignReference(project,file,{signal,label='共通デザイン原画',policy=DEFAULT_STYLE_POLICY}={}){
  need(project?.current?.manifest,'先にベースを組み立ててください。');
  need(file instanceof Blob&&file.size>=33&&file.size<=REFERENCE_LIMITS.bytes,'完成キャラクターの原画を1枚選んでください。8 MiB以下です。');
  const bytes=new Uint8Array(await file.arrayBuffer());checkAbort(signal);const h=inspectReferenceHeader(bytes);let image;
  try{
    image=await createImageBitmap(new Blob([bytes],{type:h.type}));checkAbort(signal);
    need(image.width===h.width&&image.height===h.height||h.type==='image/jpeg'&&image.width===h.height&&image.height===h.width,'原画の寸法を確認できません。');
    checkReferenceContent(image);
    const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[h.type];
    const meta={format:'ai-live2d-design-reference',version:1,label:label.trim(),source:{file:'design/reference.'+ext,media_type:h.type,bytes:bytes.length,width:image.width,height:image.height,sha256:await makerDigest(bytes)},
      policy:validateStylePolicy(policy),policy_sha256:await stylePolicyDigest(policy),claim:'user-supplied-unverified',ai_origin_verified:false,appearance_quality_passed:false};
    validateReferenceMeta(meta);
    // Retain the exact original bytes. Registering an illustration does not
    // cut it into parts or silently replace any of the 33 working textures.
    return {...project,designReference:{meta,blob:new Blob([bytes],{type:h.type})},designAudit:null};
  }finally{image?.close();}
}
export async function createReferenceContract(project,{signal}={}){
  const reference=await validateDesignReference(project.designReference,{signal}),m=project.current.manifest;
  return {format:'ai-live2d-common-design-part-contract',version:1,reference:reference.meta,canvas:m.canvas,
    coordinates:'canvas-pixels-top-left',sides:'character-personal-left-right',generation_performed:false,network_transmission:false,
    phase:{name:'hair-first',groups:3,required_roles:DESIGN_HAIR_ROLES,side_hair_requires_two_pngs:true},
    geometry_source:'existing validated 33-part blueprint, NOT inferred from reference illustration',
    anatomy_alignment_verified:false,style_consistency_verified:false,hidden_surfaces_verified:false,appearance_quality_passed:false,
    parts:m.parts.map(p=>({role:p.role,file:p.role+'.png',rect:p.rect,anchor:p.anchor,parent:p.parent,order:p.order,clip_to:p.clip_to,
      alpha_mask:'PNG alpha; no painted checkerboard or flattened background',
      hidden_regions:{status:'requested-not-verified',occluded_by:p.generation?.occluded_by||[],completion_mask:null,
        requirement:/hair|bangs/.test(p.role)?'Draw the complete root and underlapping strand behind face/other hair. Anchor patch opacity is only a proxy.':/face|ear|neck|torso|shoulder/.test(p.role)?'Draw skin under hair/clothing within the requested part rectangle.':'Keep independent layers and complete underlapping painted areas needed for motion.'}})),
    requirements:['Use the exact same reference image and common policy for EVERY requested part. Do not invent separate character designs.',
      'Four hair PNGs form three groups: bangs_front, side_hair_l + side_hair_r, back_hair.',
      'Return independent RGBA8 transparent PNGs at rect dimensions, or the 768x1024 placement canvas. l/r are the character’s own sides.',
      'Reference illustration pixels are never assumed to align anatomically with the template. Match the placement guide and compare the assembled result.',
      'Respect shared colors, line work, shading, lighting, anchors and draw order. Do not include face/eyes/clothes in a hair layer.',
      'Do not pretend hidden-area completion, real AI provenance or appearance quality was verified by a file or hash.']};
}
export async function importReferenceHair(project,files,{signal,onProgress=()=>{},declaredReference=false}={}){
  need(declaredReference===true,'同じ原画を参照して作った髪素材であることを確認してください（自己申告の記録です）。');
  const ref=await validateDesignReference(project.designReference,{signal}),uploads=matchMakerFiles(files);
  need(uploads.length<=4&&uploads.every(p=>DESIGN_HAIR_ROLES.includes(p.role)),'まずは前髪・左右の横髪・後ろ髪のPNGだけを選んでください。');
  let manifest=project.current.manifest,fit=null;const staged=[];
  for(const upload of uploads){
    checkAbort(signal);let file=upload.file;
    if(upload.role==='bangs_front'){
      const h=new DataView(await file.slice(0,33).arrayBuffer()),q=manifest.parts.find(p=>p.role===upload.role).rect;
      const w=h.getUint32(16),v=h.getUint32(20);
      if(!((w===q.width&&v===q.height)||(w===768&&v===1024)||(w===1024&&v===1024))){fit=await prepareBangsImport(project,file,{signal,onProgress});file=fit.file;manifest=fit.manifest;}
    }
    staged.push(new File([file],upload.role+'.png',{type:'image/png'}));
  }
  // One atomic rebuild for the whole intake. Any failed PNG leaves the old
  // reference, origins, native model, preview and history untouched.
  const next=await replaceMakerParts(project,staged,{signal,onProgress,assemblyManifest:manifest,label:'共通原画用の髪PNG（参照は自己申告）'});
  for(const {role} of uploads)next.origins[role].design_binding={format:'ai-live2d-design-part-binding',version:1,reference_sha256:ref.meta.source.sha256,policy_sha256:ref.meta.policy_sha256,claim:'user-declared-common-reference',ai_origin_verified:false};
  if(fit){next.origins.bangs_front.import_preparation=fit.report;next.current.quality.bangs_import=fit.report;next.bangsImport=fit;}
  next.designAudit=null;return next;
}
async function referenceCanvas(reference,m,signal){
  const c=createCanvas(m.canvas.width,m.canvas.height);let image;
  try{
    image=await createImageBitmap(reference.blob);checkAbort(signal);const scale=Math.min(c.width/image.width,c.height/image.height),x=(c.width-image.width*scale)/2,y=(c.height-image.height*scale)/2;
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,x,y,image.width*scale,image.height*scale);
    return {pixels:ctx.getImageData(0,0,c.width,c.height).data,width:c.width,height:c.height,mapping:{mode:'uniform-contain',scale,offset:[x,y],anatomy_alignment_verified:false}};
  }finally{image?.close();c.width=c.height=0;}
}
export async function auditReferenceDesign(project,{signal,onProgress=()=>{}}={}){
  const ref=await validateDesignReference(project.designReference,{signal}),m=project.current.manifest,reference=await referenceCanvas(ref,m,signal),parts=[],decoded=new Map();
  const currentImage=async role=>{if(!decoded.has(role))decoded.set(role,decode(new Uint8Array(await project.current.assets.get(role).arrayBuffer())));return decoded.get(role);};
  for(const [i,p] of m.parts.entries()){
    checkAbort(signal);onProgress(`共通原画との比較を準備中 ${i+1}/33: ${p.label}`);
    const blob=project.current.assets.get(p.role),bytes=new Uint8Array(await blob.arrayBuffer());need(await makerDigest(bytes)===project.origins[p.role].sha256,'品質検査のPNG指紋が一致しません。');
    const image=decode(bytes),r=p.rect;need(image.channels===4&&image.width===r.width&&image.height===r.height,'品質検査のPNG寸法が一致しません。');
    const patch=new Uint8Array(image.data.length);
    // Sample the reference under the CURRENT part alpha, not under arbitrary
    // bounding-box background. This is still a placement proxy, not hair/skin
    // semantic detection, and cannot certify a new reference fits the base.
    for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){
      const j=(y*r.width+x)*4,k=((r.y+y)*reference.width+r.x+x)*4;
      patch[j]=reference.pixels[k];patch[j+1]=reference.pixels[k+1];patch[j+2]=reference.pixels[k+2];patch[j+3]=Math.round(reference.pixels[k+3]*image.data[j+3]/255);
    }
    const measurement=measureDesignPixels(image,{anchor:[p.anchor[0]-r.x,p.anchor[1]-r.y]}),target=measureDesignPixels({data:patch,width:r.width,height:r.height});
    const origin=project.origins[p.role],binding=origin.design_binding?(bindingMatches(origin,ref.meta)?'declared-current-reference':'stale-reference-or-policy'):'not-linked-to-reference';
    const checks=compareDesignMeasurements(measurement,target,{policy:ref.meta.policy,isHair:DESIGN_HAIR_ROLES.includes(p.role)});
    const occluders=[];
    for(const role of p.generation?.occluded_by||[]){const part=m.parts.find(v=>v.role===role);if(part)occluders.push({part,image:await currentImage(role)});}
    let tested=0,missing=0;
    if(occluders.length){
      const basePart=project.base.manifest.parts.find(v=>v.role===p.role),baseline=decode(new Uint8Array(await project.base.assets.get(p.role).arrayBuffer()));
      // Every second baseline pixel under declared occluders: a bounded
      // geometry/alpha probe, not an inferred hidden-anatomy segmentation.
      for(let y=0;y<baseline.height;y+=2)for(let x=0;x<baseline.width;x+=2){
        if(baseline.data[(y*baseline.width+x)*4+3]<240)continue;
        const wx=basePart.rect.x+x,wy=basePart.rect.y+y;
        if(!occluders.some(o=>{const ox=wx-o.part.rect.x,oy=wy-o.part.rect.y;return ox>=0&&oy>=0&&ox<o.image.width&&oy<o.image.height&&o.image.data[(oy*o.image.width+ox)*4+3]>=240;}))continue;
        tested++;const px=wx-r.x,py=wy-r.y;if(px<0||py<0||px>=image.width||py>=image.height||image.data[(py*image.width+px)*4+3]<240)missing++;
      }
      if(tested>=64&&missing/tested>.05)checks.warning_codes.push('underlap-missing-candidate');
    }
    parts.push({role:p.role,sha256:origin.sha256,source_kind:origin.kind,source_label:origin.label,ai_origin_verified:false,reference_binding:binding,rect:r,anchor:p.anchor,parent:p.parent,order:p.order,
      structure:'validated-33-part-geometry',measurement,reference_placement_sample:target,
      hidden_overlap_probe:{source:'every second baseline-opaque pixel under declared current occluders',tested_pixels:tested,missing_opaque_pixels:missing,occluders:occluders.map(o=>o.part.role),hidden_anatomy_verified:false},...checks});
    if(i%4===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  const hair=parts.filter(p=>DESIGN_HAIR_ROLES.includes(p.role)),pairs=[];
  for(let i=0;i<hair.length;i++)for(let j=i+1;j<hair.length;j++){
    const a=hair[i],b=hair[j],ab=paletteDistance(a.measurement.palette,b.measurement.palette),ba=paletteDistance(b.measurement.palette,a.measurement.palette);
    pairs.push({roles:[a.role,b.role],palette_delta_e76:ab===null||ba===null?null:Number(((ab+ba)/2).toFixed(5)),semantic_match_verified:false});
  }
  const linked=hair.filter(p=>p.reference_binding==='declared-current-reference').length;
  return {format:'ai-live2d-reference-design-audit',version:1,reference_sha256:ref.meta.source.sha256,policy_sha256:ref.meta.policy_sha256,model_sha256:await makerDigest(project.current.native.inp),
    reference_mapping:reference.mapping,sampling:'current-part-alpha over uniformly contained reference; not semantic alignment',parts,hair_pair_checks:pairs,
    hair_progress:{groups:3,required_pngs:4,linked_pngs:linked,missing_roles:hair.filter(p=>p.reference_binding!=='declared-current-reference').map(p=>p.role)},
    warning_count:parts.reduce((n,p)=>n+p.warning_codes.length,0),state:linked<4?'incomplete-reference-set':'visual-review-required',
    generation_performed:false,ai_generation_performed:false,model_file_generated:true,network_transmission:false,ai_origin_verified:false,style_consistency_verified:false,hidden_surfaces_verified:false,
    official_creator_tested_by_this_audit:false,appearance_quality_passed:false,
    limitations:['The owner declares which reference was used; the application cannot authenticate a ChatGPT generation.',
      'Color distances, short dark runs and contrast are pixel warning candidates. They do not measure artistic style or approve quality.',
      'Opacity around an anchor does not prove hidden roots/anatomy, strand order, or motion safety.',
      'A full reference illustration is not automatically cut into layers. Missing supplied parts remain explicit.',
      'Hair/face/eyes/outfit lighting, seams and intermediate motion require visual review. This audit never auto-completes a character.']};
}
