import {ALL_IDS} from './parts.js';

// App preview settings. These are not Cubism parameters or a compiled Live2D model.
export function defaultMotion(id) {
  const hair=id.startsWith('hair'),head=hair || ['face','face_skin','eyes','eye_l','eye_r','brow_l','brow_r','mouth_visible'].includes(id);
  const order=['body','face','hair','eyes','hair_back','top','jacket','sleeve_r','sleeve_l','neck','face_skin','hair_side_r','hair_side_l','mouth_visible','eye_r','eye_l','brow_r','brow_l','hair_front'];
  return {x:0.5,y:hair?0.15:0.3,order:order.indexOf(id),head,swing:hair?3:0};
}
export function validateMotion(value) {
  const fail=()=>{throw new Error('動きの試作設定が正しくありません。');};
  if(!value || typeof value!=='object' || Array.isArray(value))fail();
  for(const [id,setting] of Object.entries(value)) {
    if(!ALL_IDS.includes(id) || !setting || typeof setting!=='object' || Array.isArray(setting) || Object.keys(setting).sort().join(',')!=='head,order,swing,x,y')fail();
    if(typeof setting.head!=='boolean' || ![setting.x,setting.y].every(n=>Number.isFinite(n) && n>=0 && n<=1) || !Number.isInteger(setting.order) || setting.order<0 || setting.order>99 || !Number.isFinite(setting.swing) || setting.swing<0 || setting.swing>15)fail();
  }
  return structuredClone(value);
}
