import {GENERATED_ROLES} from './generated-character.js';
export const MAKER_FORMAT='ai-live2d-modular-character-project';
export const MAKER_RIG_PROFILE='modular-character-rig-v1';
export const MAKER_PARAMETERS=Object.freeze({EyeOpenL:[0,1,1],EyeOpenR:[0,1,1],MouthOpen:[0,1,0],HeadX:[-1,1,0],HeadY:[-1,1,0],HeadTilt:[-1,1,0],Breath:[0,1,0]});
export const DEFAULT_POSE=Object.freeze(Object.fromEntries(Object.entries(MAKER_PARAMETERS).map(([k,v])=>[k,v[2]])));
export const PART_SETS=Object.freeze({bangs:['bangs_front'],eyes:GENERATED_ROLES.filter(r=>/^(eye_white|iris|highlight|eyelid_upper|eyelid_lower|eyelashes|brow)_/.test(r)),outfit:['dress_base','collar','ribbon','sleeve_l','sleeve_r','apron']});
const aliases={front_hair:'bangs_front',hair_front:'bangs_front',front_bangs:'bangs_front',bangs:'bangs_front',maid_dress:'dress_base',dress:'dress_base'};
for(const s of ['l','r'])for(const role of ['eye_white','iris','highlight','eyelid_upper','eyelid_lower','eyelashes','brow','side_hair','sleeve']){
  aliases[`${s==='l'?'left':'right'}_${role}`]=`${role}_${s}`;
}
export function matchMakerFiles(files){
  const input=Array.from(files||[]),seen=new Set();let bytes=0;
  if(!input.length||input.length>33)throw new Error('独立したPNGを1〜33枚選択してください。');
  return input.map(file=>{
    if(typeof file.name!=='string'||file.name.length>120||!/^[-a-zA-Z0-9_]+\.png$/i.test(file.name)||file.size<33||file.size>8*1024*1024)throw new Error('役割名の透過PNGを選んでください。1枚8 MiB以下です。');
    const name=file.name.slice(0,-4).toLowerCase().replaceAll('-','_'),role=aliases[name]||name;
    if(!GENERATED_ROLES.includes(role))throw new Error(`役割を照合できません: ${file.name}。bangs_front.png、iris_l.pngなどの役割名を使用してください。`);
    if(seen.has(role))throw new Error(`同じ役割が重複しています: ${role}`);seen.add(role);bytes+=file.size;
    if(bytes>12*1024*1024)throw new Error('PNGの合計は12 MiB以下にしてください。');
    return {role,file,sourceName:file.name};
  });
}
export function validateMakerPose(value=DEFAULT_POSE){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==7)throw new Error('動作値の形式が正しくありません。');
  for(const [name,[min,max]] of Object.entries(MAKER_PARAMETERS))if(!Number.isFinite(value[name])||value[name]<min||value[name]>max)throw new Error(`${name}の動作値が範囲外です。`);
  return structuredClone(value);
}
export const makerDigest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
export function validateMakerOrigin(origin){
  if(!origin||!['local-template','local-preset','user-png'].includes(origin.kind)||origin.ai_origin_verified!==false||typeof origin.label!=='string'||origin.label.length>120||typeof origin.sha256!=='string'||!/^[a-f0-9]{64}$/.test(origin.sha256))throw new Error('パーツの由来・指紋が正しくありません。');
  return structuredClone(origin);
}
export function validateMakerHistory(history,revision){
  if(!Number.isSafeInteger(revision)||revision<0||!Array.isArray(history)||history.length>100)throw new Error('交換履歴が正しくありません。');
  let previous=-1;
  for(const item of history){
    if(!item||!Number.isSafeInteger(item.revision)||item.revision<=previous||item.revision>revision||!['local-template','local-preset','user-png','restore'].includes(item.kind)||typeof item.label!=='string'||item.label.length>120||!Array.isArray(item.changes)||!item.changes.length||item.changes.length>33)throw new Error('交換履歴が正しくありません。');
    previous=item.revision;const seen=new Set();
    for(const c of item.changes){if(!c||!GENERATED_ROLES.includes(c.role)||seen.has(c.role)||typeof c.source_filename!=='string'||c.source_filename.length>120||!/^[-a-zA-Z0-9_]+\.png$/i.test(c.source_filename)||typeof c.sha256!=='string'||!/^[a-f0-9]{64}$/.test(c.sha256))throw new Error('交換履歴の役割・指紋が正しくありません。');seen.add(c.role);}
  }
  return structuredClone(history);
}
