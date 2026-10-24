import {createTemplateManifest,partSvg} from './template.js';
import {createRigMetadata,createInochiIntermediate,validateCharacterManifest} from '../../shared/generated-character.js';

const MIB=1024*1024;
export function checkAbort(signal){if(signal?.aborted)throw new DOMException('生成を中止しました。','AbortError');}
const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
function context(c){const ctx=c.getContext('2d');if(!ctx)throw new Error('描画機能を使用できません。');return ctx;}
export function pngBlob(c){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('PNGを作成できませんでした。')),'image/png'));}

async function rasterize(part,recipe,signal){
  checkAbort(signal);const image=new Image(),url=URL.createObjectURL(new Blob([partSvg(part,recipe)],{type:'image/svg+xml'}));
  const c=canvas(part.rect.width,part.rect.height);
  try{
    image.src=url;await image.decode();checkAbort(signal);context(c).drawImage(image,0,0);
    const blob=await pngBlob(c);checkAbort(signal);return blob;
  }finally{image.src='';URL.revokeObjectURL(url);c.width=c.height=0;}
}

// A replacement generator supplies one independent PNG for each requested
// role, dimensions and shared recipe. No finished portrait is cut into parts.
// No network provider or paid service is registered by this MVP.
export const localPartProvider=Object.freeze({id:'local-template-v1',aiGenerated:false,generate:rasterize});

async function validateAsset(part,blob,signal){
  checkAbort(signal);
  if(!(blob instanceof Blob)||blob.type!=='image/png'||!blob.size||blob.size>4*MIB)throw new Error(`${part.label}のPNGを生成できませんでした。`);
  const b=new Uint8Array(await blob.slice(0,33).arrayBuffer()),v=new DataView(b.buffer);
  if(b.length<33||[137,80,78,71,13,10,26,10].some((n,i)=>b[i]!==n)||String.fromCharCode(...b.slice(12,16))!=='IHDR'||v.getUint32(16)!==part.rect.width||v.getUint32(20)!==part.rect.height||b[24]!==8||b[25]!==6)throw new Error(`${part.label}の画像形式・サイズが一致しません。`);
  let bitmap;const c=canvas(part.rect.width,part.rect.height);
  try{
    bitmap=await createImageBitmap(blob);checkAbort(signal);context(c).drawImage(bitmap,0,0);
    const data=context(c).getImageData(0,0,c.width,c.height).data;
    if(!data.some((value,index)=>index%4===3&&value>0))throw new Error(`${part.label}が空の画像です。生成をやり直してください。`);
  }finally{bitmap?.close();c.width=c.height=0;}
}

export async function assembleCharacter(manifest,assets,{signal}={}){
  const m=validateCharacterManifest(manifest);checkAbort(signal);
  if(!(assets instanceof Map)||assets.size!==m.parts.length||m.parts.some(p=>!assets.has(p.role)))throw new Error('パーツが不足しています。');
  const c=canvas(m.canvas.width,m.canvas.height),ctx=context(c),parts=new Map(m.parts.map(p=>[p.role,p]));
  try{
    if(m.background!=='transparent'){ctx.fillStyle=m.background==='white'?'#ffffff':'#eeeaf7';ctx.fillRect(0,0,c.width,c.height);}
    for(const p of [...m.parts].sort((a,b)=>a.order-b.order)){
      checkAbort(signal);if(!p.enabled_in_neutral)continue;
      let bitmap,mask;let scratch;
      try{
        bitmap=await createImageBitmap(assets.get(p.role));checkAbort(signal);
        if(p.clip_to){
          const target=parts.get(p.clip_to);scratch=canvas(p.rect.width,p.rect.height);const sc=context(scratch);
          sc.drawImage(bitmap,0,0);mask=await createImageBitmap(assets.get(p.clip_to));checkAbort(signal);
          sc.globalCompositeOperation='destination-in';sc.drawImage(mask,target.rect.x-p.rect.x,target.rect.y-p.rect.y);
          ctx.drawImage(scratch,p.rect.x,p.rect.y);
        }else ctx.drawImage(bitmap,p.rect.x,p.rect.y);
      }finally{bitmap?.close();mask?.close();if(scratch)scratch.width=scratch.height=0;}
    }
    const output=await pngBlob(c);checkAbort(signal);return output;
  }finally{c.width=c.height=0;}
}

export async function generateCharacter(recipe={}, {signal,onProgress=()=>{},provider=localPartProvider}={}){
  const manifest=createTemplateManifest(recipe),assets=new Map();let bytes=0;
  if(typeof provider?.generate!=='function'||provider.id!=='local-template-v1'||provider.aiGenerated!==false)throw new Error('この版は端末内のテンプレート生成に対応しています。');
  for(const [index,part] of manifest.parts.entries()){
    checkAbort(signal);const blob=await provider.generate(structuredClone(part),{...manifest.generator.recipe},signal);
    checkAbort(signal);await validateAsset(part,blob,signal);bytes+=blob.size;
    if(bytes>12*MIB)throw new Error('生成パーツの合計サイズが上限を超えています。');
    assets.set(part.role,blob);onProgress({completed:index+1,total:manifest.parts.length,label:part.label});
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  const preview=await assembleCharacter(manifest,assets,{signal});checkAbort(signal);
  return {manifest,assets,preview,rig:createRigMetadata(manifest),intermediate:createInochiIntermediate(manifest)};
}
