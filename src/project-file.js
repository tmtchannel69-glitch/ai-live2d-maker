import { zip, unzipSync, strToU8, strFromU8 } from 'fflate';
import { promptSignature } from './prompt-state.js';

import { ALL_IDS, BASIC_IDS, defaultTemplates, partTemplate } from './parts.js';
const IDS = ALL_IDS;
const MIB = 1024 * 1024;
export const MAX_PROJECT_BYTES = 100 * MIB;
const MAX_PART_BYTES = 32 * MIB;
const MAX_METADATA_BYTES = 256 * 1024;
const invalid = message => { throw new Error(message || '作業ファイルの内容が正しくありません。'); };
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid();
}
const coordinate = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
export function validatePrompt(value) {
  object(value, ['points','box']);
  if (value.points !== undefined) {
    if (!Array.isArray(value.points) || !value.points.length || value.points.length > 32) invalid();
    for (const point of value.points) {
      object(point, ['x','y','label']);
      if (!coordinate(point.x) || !coordinate(point.y) || ![0,1].includes(point.label)) invalid();
    }
  }
  if (value.box !== undefined && (!Array.isArray(value.box) || value.box.length !== 4 || !value.box.every(coordinate) || value.box[0] >= value.box[2] || value.box[1] >= value.box[3])) invalid();
  // Exclusion-only and empty drafts are valid unfinished editor states.
  return structuredClone(value);
}
function dimensions(width,height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16_000_000) invalid('画像のサイズが制限を超えています。');
}
function pngSize(bytes) {
  const signature=[137,80,78,71,13,10,26,10];
  if (bytes.length < 33 || signature.some((b,i)=>bytes[i]!==b) || strFromU8(bytes.subarray(12,16)) !== 'IHDR') invalid('パーツの PNG が正しくありません。');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint32(16),height=view.getUint32(20);
  dimensions(width,height); return {width,height};
}
function sourceMagic(bytes,type) {
  if (type==='image/png') return bytes.length>=8 && bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71;
  if (type==='image/jpeg') return bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  return type==='image/webp' && bytes.length>=12 && strFromU8(bytes.subarray(0,4))==='RIFF' && strFromU8(bytes.subarray(8,12))==='WEBP';
}
async function imageSize(blob) {
  let bitmap;
  try {bitmap=await createImageBitmap(blob);dimensions(bitmap.width,bitmap.height);return {width:bitmap.width,height:bitmap.height};}
  catch(error) {throw new Error(`画像を読み込めませんでした。${error.message}`);}
  finally {bitmap?.close();}
}
function validateMetadata(data) {
  object(data,['format','version','source','mode','selected','prompts','parts','template','templates']);
  if (data.format!=='ai-live2d-maker') invalid('AI Live2D Maker の作業ファイルではありません。');
  if (![1,2].includes(data.version)) invalid('この版の作業ファイルには対応していません。');
  let template,templates,ids;
  if(data.version===1) {
    object(data,['format','version','source','mode','selected','prompts','parts']);
    template='basic';templates=defaultTemplates();templates.basic={mode:data.mode,selected:data.selected};ids=BASIC_IDS;
  } else {
    if(!['basic','production'].includes(data.template))invalid();
    template=data.template;templates=data.templates;ids=ALL_IDS;
    object(templates,['basic','production']);
    for(const name of ['basic','production']) {
      const config=templates[name];object(config,['mode','selected']);
      const allowed=ALL_IDS.filter(id=>partTemplate(id)===name);
      if(!['ai','demo'].includes(config.mode) || (name==='production' && config.mode!=='ai') || !Array.isArray(config.selected) || config.selected.length>allowed.length || config.selected.some(id=>!allowed.includes(id)) || new Set(config.selected).size!==config.selected.length)invalid();
    }
    if(data.mode!==templates[template].mode || JSON.stringify(data.selected)!==JSON.stringify(templates[template].selected))invalid();
  }
  object(data.source,['name','type','path','width','height']);
  const source=data.source;
  if (typeof source.name!=='string' || !source.name.length || source.name.length>120 || /[\\/\x00-\x1f]/.test(source.name) || !['image/png','image/jpeg','image/webp'].includes(source.type) || source.path!=='source/image') invalid();
  dimensions(source.width,source.height);
  const activeIds=ids.filter(id=>partTemplate(id)===template);
  if (!['ai','demo'].includes(data.mode) || !Array.isArray(data.selected) || data.selected.length>activeIds.length || data.selected.some(id=>!activeIds.includes(id)) || new Set(data.selected).size!==data.selected.length) invalid();
  object(data.prompts,ids);for(const value of Object.values(data.prompts)) validatePrompt(value);
  if (!Array.isArray(data.parts) || data.parts.length>ids.length || new Set(data.parts.map(p=>p?.id)).size!==data.parts.length) invalid();
  for(const part of data.parts) {
    object(part,['id','path','ai','manual','generatedPrompt']);
    if(!ids.includes(part.id) || part.path!==`parts/${part.id}.png` || typeof part.ai!=='boolean' || typeof part.manual!=='boolean' || part.ai!==(templates[partTemplate(part.id)].mode==='ai') || (part.manual && !part.ai)) invalid();
    validatePrompt(part.generatedPrompt);
  }
  return {...data,template,templates};
}

export async function createProjectFile({file,mode,selected,prompts,results,template='basic',templates}) {
  const sizes = await imageSize(file);
  const metadata = {
    format:'ai-live2d-maker',version:1,
    source:{name:file.name.replace(/[\\/\x00-\x1f]/g,'_').slice(0,120)||'character.png',type:file.type,path:'source/image',...sizes},
    mode,selected,prompts,parts:results.map(part=>({id:part.id,path:`parts/${part.id}.png`,ai:part.ai,manual:Boolean(part.manual),generatedPrompt:JSON.parse(part.signature||'{}')})),
  };
  if(template!=='basic' || Object.keys(prompts).some(id=>!BASIC_IDS.includes(id)) || results.some(part=>!BASIC_IDS.includes(part.id)) || templates?.production.selected.length) {
    metadata.version=2;metadata.template=template;metadata.templates=structuredClone(templates);
  }
  validateMetadata(metadata);
  const manifest=strToU8(JSON.stringify(metadata));
  if(file.size>10*MIB || results.some(part=>part.blob.size>MAX_PART_BYTES) || manifest.length>MAX_METADATA_BYTES || file.size+manifest.length+results.reduce((sum,p)=>sum+p.blob.size,0)>MAX_PROJECT_BYTES-4096) invalid('作業ファイルが大きすぎます。上限は 100 MiB、各パーツ 32 MiB です。');
  const sourceBytes=new Uint8Array(await file.arrayBuffer());
  if(!sourceMagic(sourceBytes,file.type))invalid('元画像の形式が正しくありません。');
  const entries={'project.json':manifest,'source/image':sourceBytes};
  for(const part of results) entries[`parts/${part.id}.png`]=new Uint8Array(await part.blob.arrayBuffer());
  return new Promise((resolve,reject)=>zip(entries,{level:0},(error,data)=>error?reject(error):resolve(new Blob([data],{type:'application/zip'}))));
}

export async function readProjectFile(file) {
  if (!file.size || file.size>MAX_PROJECT_BYTES) invalid('作業ファイルは 100 MiB 以下にしてください。');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const seen=new Set();let total=0,entries;
  try {
    entries=unzipSync(bytes,{filter:entry=>{
      if (seen.has(entry.name) || !['project.json','source/image',...IDS.map(id=>`parts/${id}.png`)].includes(entry.name)) invalid();
      seen.add(entry.name);total+=entry.originalSize;
      const limit=entry.name==='project.json'?MAX_METADATA_BYTES:entry.name==='source/image'?10*MIB:MAX_PART_BYTES;
      if(entry.compression!==0 || entry.size!==entry.originalSize || entry.originalSize>limit || total>MAX_PROJECT_BYTES) invalid('作業ファイルのサイズや保存形式が正しくありません。');
      return true;
    }});
  } catch(error) {throw new Error(`作業ファイルを展開できませんでした。${error.message}`);}
  if(!entries['project.json'] || !entries['source/image']) invalid('作業情報または元画像がありません。');
  let metadata;
  try {metadata=validateMetadata(JSON.parse(strFromU8(entries['project.json'])));}
  catch(error) {throw new Error(`作業情報を読み込めませんでした。${error.message}`);}
  const expected=['project.json','source/image',...metadata.parts.map(p=>p.path)];
  if(Object.keys(entries).length!==expected.length || expected.some(name=>!entries[name])) invalid('パーツ画像が不足しているか、余分なデータがあります。');
  if(!sourceMagic(entries['source/image'],metadata.source.type)) invalid('元画像の形式が正しくありません。');
  if(metadata.source.type==='image/png')pngSize(entries['source/image']);
  const source=new File([entries['source/image']],metadata.source.name,{type:metadata.source.type});
  const sourceSize=await imageSize(source);
  if(sourceSize.width!==metadata.source.width || sourceSize.height!==metadata.source.height) invalid('元画像のサイズが作業情報と一致しません。');
  const results=[];
  // Validate and decode one at a time; do not retain multiple image bitmaps.
  for(const part of metadata.parts) {
    const size=pngSize(entries[part.path]);
    if(part.ai && (size.width!==sourceSize.width || size.height!==sourceSize.height)) invalid('AI パーツは元画像と同じサイズにしてください。');
    const blob=new Blob([entries[part.path]],{type:'image/png'});await imageSize(blob);
    results.push({id:part.id,name:`${part.id}.png`,blob,ai:part.ai,manual:part.manual,signature:promptSignature(part.generatedPrompt)});
  }
  return {file:source,dimensions:sourceSize,mode:metadata.mode,selected:metadata.selected,prompts:metadata.prompts,results,template:metadata.template,templates:metadata.templates};
}
