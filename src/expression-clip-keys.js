import {validateClips} from './expression-clips.js';
export const CLIP_DRIVERS={left:'左目の開き',right:'右目の開き',mouth:'口の開き'};
export function defaultClipKeys(clip,driver){return {driver,closed:{...clip},open:{...clip}};}
export function validateClipKeys(value,assets,clips){
  const fail=()=>{throw new Error('開閉する表示範囲が正しくありません。固定範囲と開いた・閉じた範囲、動きに使う値を確認してください。');};
  if(!value || typeof value!=='object' || Array.isArray(value))fail();
  for(const [role,s] of Object.entries(value)){
    if(!clips[role] || !s || typeof s!=='object' || Array.isArray(s) || Object.keys(s).sort().join(',')!=='closed,driver,open' || !Object.hasOwn(CLIP_DRIVERS,s.driver))fail();
    try{validateClips({[role]:s.closed},assets);validateClips({[role]:s.open},assets);}catch{fail();}
    if(s.closed.shape!==s.open.shape)fail();
  }
  return structuredClone(value);
}
export function interpolateClip(s,value){const t=Math.max(0,Math.min(1,value));return {shape:s.open.shape,...Object.fromEntries(['x','y','width','height'].map(k=>[k,s.closed[k]+(s.open[k]-s.closed[k])*t]))};}
export const pruneClipKeys=(keys,clips)=>Object.fromEntries(Object.entries(keys).filter(([role])=>clips[role]));
