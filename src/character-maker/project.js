import {decode,encode} from 'fast-png';
import {validateCharacterManifest} from '../../shared/generated-character.js';
import {validateDesignedCharacter,sameJSONData} from '../../shared/designed-character.js';
import {createTemplateManifest} from '../character-generation/template.js';
import {DEFAULT_POSE,PART_SETS,matchMakerFiles,makerDigest,validateMakerOrigin,validateMakerPose} from '../../shared/modular-character.js';
import {buildModularRig} from '../../shared/modular-character-rig.js';
import {assembleValidatedCharacter,validateAsset,checkAbort} from '../character-generation/generator.js';
import {inspectExternalPartPng} from '../character-generation/external-part-batch.js';
import {inspectExternalPartPixels} from '../../shared/external-part-quality.js';

export async function validateMakerManifest(m){
  if(m?.version===2)return validateDesignedCharacter(m);
  const value=validateCharacterManifest(m),expected=createTemplateManifest(value.generator.recipe);
  if(!sameJSONData(value.parts,expected.parts)||!sameJSONData(value.groups,expected.groups))throw new Error('旧版の基準配置と異なります。元の作業モードを使うか、正しい33パーツの基準を選んでください。');
  return value;
}

export async function auditMakerAssets(manifest,assets,{signal}={}){
  const records=[],images=new Map(),essential=new Set(['face_base','neck','torso','dress_base','bangs_front','eye_white_l','eye_white_r','iris_l','iris_r','eyelashes_l','eyelashes_r']);let total=0;
  if(!(assets instanceof Map)||assets.size!==33)throw new Error('現在の33パーツが不足しています。');
  for(const p of manifest.parts){
    checkAbort(signal);const blob=assets.get(p.role);await validateAsset(p,blob,signal,{requireTransparency:true});total+=blob.size;
    if(total>12*1024*1024)throw new Error('現在のPNG合計は12 MiB以下にしてください。');
    const image=decode(new Uint8Array(await blob.arrayBuffer()));images.set(p.role,image);
    const stats=inspectExternalPartPixels(image.data,image.width,image.height,{x:0,y:0,width:image.width,height:image.height});
    if(essential.has(p.role)&&stats.visible_ratio<.01)throw new Error(`${p.label}: 描画領域が小さすぎます。空に近い素材を完成品として保存できません。`);
    records.push({role:p.role,...stats});
  }
  for(const side of ['l','r']){
    const iris=manifest.parts.find(p=>p.role==='iris_'+side),white=manifest.parts.find(p=>p.role==='eye_white_'+side),a=images.get(iris.role),b=images.get(white.role);let visible=0,inside=0;
    for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)if(a.data[(y*a.width+x)*4+3]){
      visible++;const mx=iris.rect.x+x-white.rect.x,my=iris.rect.y+y-white.rect.y;
      if(mx>=0&&my>=0&&mx<b.width&&my<b.height&&b.data[(my*b.width+mx)*4+3]>0)inside++;
    }
    if(!visible||inside/visible<.25)throw new Error(`本人${side==='l'?'左':'右'}の虹彩が白目の範囲から外れています。配置と左右を確認してください。`);
  }
  const l=records.find(p=>p.role==='eye_white_l').visible_pixels,r=records.find(p=>p.role==='eye_white_r').visible_pixels;
  if(Math.min(l,r)/Math.max(l,r)<.25)throw new Error('左右の白目の大きさが大きく異なります。本人基準の左右と寸法を確認してください。');
  const neck=manifest.parts.find(p=>p.role==='neck'),image=images.get('neck'),pivot=manifest.groups.find(g=>g.id==='group_head').anchor;
  const follow=manifest.rig_geometry?.neck_follow_y??pivot[1]+11,fixed=manifest.rig_geometry?.neck_fixed_y??pivot[1]+51;let neckPixels=0;
  for(let y=Math.ceil(follow);y<=Math.floor(fixed);y++)for(let x=Math.round(pivot[0])-2;x<=Math.round(pivot[0])+2;x++){
    const px=x-neck.rect.x,py=y-neck.rect.y;neckPixels++;
    if(px<0||py<0||px>=image.width||py>=image.height||image.data[(py*image.width+px)*4+3]<240)throw new Error('首の接続に透明な隙間があります。動作に必要な肌の範囲を描いた独立PNGを使用してください。');
  }
  return {format:'ai-live2d-modular-structure-audit',version:1,parts:records,structural_checks_passed:true,
    neck_stem_tested_pixels:neckPixels,neck_stem_transparent_pixels:0,
    appearance_quality_passed:false,style_consistency_verified:false,hidden_surfaces_verified:false,official_creator_tested:false};
}

async function assembled(manifest,assets,signal){
  const quality=await auditMakerAssets(manifest,assets,{signal});checkAbort(signal);
  const preview=await assembleValidatedCharacter(manifest,assets,{signal});
  const native=await buildModularRig(manifest,assets,{signal});checkAbort(signal);
  return {manifest,assets,preview,native,quality};
}
export async function createMakerProject(character,{signal,imported=false}={}){
  const manifest=await validateMakerManifest(character.manifest),assets=new Map(character.assets),origins={};
  for(const p of manifest.parts)origins[p.role]={kind:imported?'user-png':'local-template',label:imported?'既存ZIPから読み込み（由来未確認）':'端末内の自作テンプレート',ai_origin_verified:false,sha256:await makerDigest(await assets.get(p.role).arrayBuffer())};
  const current=await assembled(manifest,assets,signal);
  return {format:'ai-live2d-modular-session',base:{manifest,assets,origins:structuredClone(origins)},current,origins,pose:{...DEFAULT_POSE},revision:0,history:[],undo:[]};
}

export async function replaceMakerParts(project,files,{signal,originKind='user-png',label='ユーザーの独立PNG（AI出典未確認）',onProgress=()=>{}}={}){
  const uploads=matchMakerFiles(files),manifest=await validateMakerManifest(project.current.manifest),assets=new Map(project.current.assets),origins=structuredClone(project.origins),changes=[];
  if(!['user-png','local-preset','local-template'].includes(originKind))throw new Error('交換元の種類が正しくありません。');
  for(const [i,item] of uploads.entries()){
    checkAbort(signal);const part=manifest.parts.find(p=>p.role===item.role),file=new File([item.file],item.role+'.png',{type:'image/png'});
    onProgress(`PNGを確認中 ${i+1}/${uploads.length}: ${part.label}`);
    try{await inspectExternalPartPng(part,file,{signal});}catch(error){if(error.name==='AbortError')throw error;throw new Error(`${error.message} ${part.role}は${part.rect.width}×${part.rect.height}px、または配置済み768×1024pxの透過PNGで用意してください。`);}checkAbort(signal);
    // Preserve original RGBA bytes for canonical crops. For a reference canvas,
    // crop decoded RGBA directly instead of a lossy canvas premultiply roundtrip.
    const bytes=new Uint8Array(await file.arrayBuffer()),image=decode(bytes),q=part.rect;
    let tile=file;
    if(image.width!==q.width||image.height!==q.height){
      const x=q.x+(image.width===1024?128:0),y=q.y,data=new Uint8Array(q.width*q.height*4);
      for(let row=0;row<q.height;row++)data.set(image.data.subarray(((y+row)*image.width+x)*4,((y+row)*image.width+x+q.width)*4),row*q.width*4);
      tile=new Blob([encode({width:q.width,height:q.height,data,channels:4,depth:8})],{type:'image/png'});
    }
    assets.set(item.role,tile);origins[item.role]={kind:originKind,label,ai_origin_verified:false,sha256:await makerDigest(await tile.arrayBuffer())};
    changes.push({role:item.role,source_filename:item.sourceName,sha256:origins[item.role].sha256});
  }
  onProgress('配置を検査し、同じ共通動作でモデルを組み立てています…');
  const current=await assembled(manifest,assets,signal);checkAbort(signal);
  return {...project,current,origins,revision:project.revision+1,pose:validateMakerPose(project.pose),
    history:[...project.history.slice(-99),{revision:project.revision+1,kind:originKind,label,changes}],
    undo:[...project.undo.slice(-9),{current:project.current,origins:project.origins,history:project.history,revision:project.revision}]};
}
export function undoMakerChange(project){
  const old=project.undo.at(-1);return old?{...project,...old,undo:project.undo.slice(0,-1)}:project;
}
export async function restoreMakerParts(project,set,options={}){
  if(!PART_SETS[set])throw new Error('戻す範囲が正しくありません。');
  const files=PART_SETS[set].map(role=>new File([project.base.assets.get(role)],role+'.png',{type:'image/png'}));
  const next=await replaceMakerParts(project,files,{...options,originKind:'local-template',label:'保存した基準パーツに戻す'});
  for(const role of PART_SETS[set])next.origins[role]=structuredClone(project.base.origins[role]);
  next.history.at(-1).kind='restore';return next;
}
export function makerAssemblyManifest(project){
  return {format:'ai-live2d-character-assembly',version:1,canvas:project.current.manifest.canvas,sides:'character-personal-left-right',
    coordinates:'canvas-pixels-top-left',parts:project.current.manifest.parts.map(p=>({role:p.role,file:p.file,rect:p.rect,anchor:p.anchor,parent:p.parent,order:p.order,clip_to:p.clip_to,origin:validateMakerOrigin(project.origins[p.role])})),
    groups:project.current.manifest.groups,rig_profile:'modular-character-rig-v1',appearance_quality_passed:false};
}
