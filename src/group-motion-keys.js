import {GROUP_IDS,defaultGroupTransform,groupMembers,validateGroups} from './expression-groups.js';
export const GROUP_KEY_LABELS={negative:'左（−1）',center:'中央（0）',positive:'右（1）'};
export function defaultGroupKeys(groups,id){const s=groups.transforms[id]||defaultGroupTransform();return {negative:{...s},center:{...s},positive:{...s}};}
export function validateGroupKeys(value,groups,assets,clips){
  const fail=()=>{throw new Error('グループの動きの設定が正しくありません。所属する素材と左・中央・右の位置を確認してください。');};
  if(!value || typeof value!=='object' || Array.isArray(value))fail();
  for(const [id,setting] of Object.entries(value)){
    if(!GROUP_IDS.includes(id) || !groupMembers(groups,id,assets).length || !setting || typeof setting!=='object' || Array.isArray(setting) || Object.keys(setting).sort().join(',')!=='center,negative,positive')fail();
    for(const key of Object.keys(GROUP_KEY_LABELS)){try{validateGroups({...groups,transforms:{[id]:setting[key]}},assets,clips);}catch{fail();}}
  }
  return structuredClone(value);
}
export function evaluateGroupKeys(groups,keys,value){
  const next={...groups,transforms:{...groups.transforms}},v=Math.max(-1,Math.min(1,value));
  for(const [id,s] of Object.entries(keys)) {
    const a=v<0?s.negative:s.center,b=v<0?s.center:s.positive,t=v<0?v+1:v;
    next.transforms[id]=Object.fromEntries(Object.keys(a).map(k=>[k,a[k]+(b[k]-a[k])*t]));
  }
  return next;
}
export const pruneGroupKeys=(keys,groups,assets)=>Object.fromEntries(Object.entries(keys).filter(([id])=>groupMembers(groups,id,assets).length));
