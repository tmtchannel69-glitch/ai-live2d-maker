// Experimental local batch intake. All checks precede the sole model rebuild.
// The canonical template assets and their provenance are never mutated.
import {matchExternalPartFiles} from '../../shared/external-part-file-list.js';
import {validateDesignedCharacter} from '../../shared/designed-character.js';
import {assembleValidatedCharacter,checkAbort,validateAsset,pngBlob} from './generator.js';
import {buildDesignedInochi} from '../../shared/generated-character-inochi.js';

const pngHeader=[137,80,78,71,13,10,26,10];
const need=(yes,message)=>{if(!yes)throw new Error(message);};
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
async function sha256(bytes){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function inspectExternalPartPng(part,file,{signal}={}){
  need(file instanceof Blob,'パーツ画像がありません。');
  const bytes=await file.arrayBuffer();checkAbort(signal);
  need(bytes.byteLength>=33,'PNGファイルが壊れています。');
  const header=new Uint8Array(bytes,0,33),view=new DataView(bytes);
  need(pngHeader.every((v,i)=>header[i]===v)&&view.getUint32(8)===13&&
    String.fromCharCode(...header.slice(12,16))==='IHDR'&&header[24]===8&&header[25]===6,
    part.role+': 8bit RGBA透過PNGが必要です。');
  const width=view.getUint32(16),height=view.getUint32(20),q=part.rect;
  const isCrop=width===q.width&&height===q.height;
  const isOriginal=width===768&&height===1024;
  const isApi=width===1024&&height===1024;
  need(isCrop||isOriginal||isApi,part.role+': 画像の縦横サイズが合いません。');
  const x=isCrop?0:q.x+(isApi?128:0),y=isCrop?0:q.y;
  need(x>=0&&y>=0&&x+q.width<=width&&y+q.height<=height,
    part.role+': 基準デザインの座標が画像の範囲外です。');
  let bitmap,source,tileCanvas;
  try{
    bitmap=await createImageBitmap(file);checkAbort(signal);
    need(bitmap.width===width&&bitmap.height===height,part.role+': PNGヘッダーと復号結果のサイズが異なります。');
    source=canvas(width,height);
    const ctx=source.getContext('2d',{willReadFrequently:true});need(ctx,part.role+': 画像を確認できません。');
    ctx.drawImage(bitmap,0,0);
    const pixels=ctx.getImageData(0,0,width,height).data;
    let insideOpaque=0,insideTransparent=0,outsideOpaque=0;
    for(let py=0;py<height;py++)for(let px=0;px<width;px++){
      const a=pixels[(py*width+px)*4+3];
      const inside=px>=x&&px<x+q.width&&py>=y&&py<y+q.height;
      if(inside){if(a>0)insideOpaque++;else insideTransparent++;}
      else if(a>0)outsideOpaque++;
    }
    need(outsideOpaque===0,part.role+': 指定範囲外に画像があります。完成絵はパーツとして使えません。');
    need(insideOpaque>0&&insideTransparent>0,part.role+': 空画像または不透明背景です。');
    tileCanvas=canvas(q.width,q.height);
    const tileCtx=tileCanvas.getContext('2d');need(tileCtx,part.role+': パーツを切り出せません。');
    tileCtx.drawImage(source,x,y,q.width,q.height,0,0,q.width,q.height);
    const tile=await pngBlob(tileCanvas);checkAbort(signal);
    await validateAsset(part,tile,signal,{requireTransparency:true});
    return {role:part.role,tile,record:{
      role:part.role,source_filename:file.name,source_sha256:await sha256(bytes),
      source_canvas:[width,height],canonical_rect:structuredClone(q),
      visible_pixels_in_role:insideOpaque,visible_pixels_outside_role:outsideOpaque,
      rgba_structure_passed:true,ai_origin_verified:false}};
  }finally{
    bitmap?.close();
    if(source)source.width=source.height=0;
    if(tileCanvas)tileCanvas.width=tileCanvas.height=0;
  }
}

export async function importExternalPartBatch(character,files,{signal,onProgress=()=>{}}={}){
  need(character?.manifest?.version===2&&character.assets instanceof Map,
    '先に「デザイン指定の端末内描画」で基準キャラクターを生成してください。');
  const manifest=await validateDesignedCharacter(character.manifest);checkAbort(signal);
  need(character.assets.size===33&&manifest.parts.length===33,'33枚の基準パーツが不足しています。');
  const picked=matchExternalPartFiles(files,manifest.parts);
  // A staged copy prevents partially applied PNGs if any later file is invalid.
  const replacements=new Map(),records=[];
  for(let index=0;index<picked.uploads.length;index++){
    checkAbort(signal);
    const {part,file}=picked.uploads[index];
    onProgress({stage:'checking',completed:index,total:picked.uploads.length,role:part.role});
    const result=await inspectExternalPartPng(part,file,{signal});
    replacements.set(part.role,result.tile);records.push(result.record);
    onProgress({stage:'checking',completed:index+1,total:picked.uploads.length,role:part.role});
  }
  checkAbort(signal);
  const assets=new Map(character.assets);
  for(const [role,tile] of replacements)assets.set(role,tile);
  const totalBytes=[...assets.values()].reduce((sum,blob)=>sum+blob.size,0);
  need(totalBytes<=12*1024*1024,'合成後のパーツ合計が12MBを超えています。');
  onProgress({stage:'preview',completed:picked.uploads.length,total:picked.uploads.length});
  const preview=await assembleValidatedCharacter(manifest,assets,{signal});checkAbort(signal);
  const textures=new Map();
  for(const part of manifest.parts){
    checkAbort(signal);
    textures.set(part.role,new Uint8Array(await assets.get(part.role).arrayBuffer()));
  }
  onProgress({stage:'model',completed:picked.uploads.length,total:picked.uploads.length});
  const native=await buildDesignedInochi(manifest,textures,{signal});checkAbort(signal);
  const externalCount=replacements.size;
  const report={
    format:'ai-live2d-external-part-batch-experiment',version:1,
    design_id:manifest.generator.design_id,blueprint_id:manifest.generator.blueprint_id,
    external_part_count:externalCount,local_template_part_count:33-externalCount,
    provided_roles:picked.provided_roles,local_template_roles:picked.missing_roles,
    parts:records,source_kind:'user-supplied-transparent-png',
    model_generated:true,model_build_invocations:1,all_33_texture_slots_present:true,
    ai_origin_verified:false,fully_ai_generated:false,
    no_network_transmission:true,official_creator_tested:false,
    appearance_quality_passed:false,cubism_compatible:false,
    limitation:'選択されたPNGだけを差し替えたInochi2D実験モデル。残りはローカルテンプレート。33枚全部取り込んでも実AI出典や品質は未証明。'
  };
  return {manifest,assets,preview,native,report,replacements};
}
