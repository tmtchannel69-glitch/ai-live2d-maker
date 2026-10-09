import {EXPRESSION_ROLE_IDS} from './expression-assets.js';
export const EXPRESSION_CONDITIONS={always:'常に表示',left_open:'左目が開いている',left_closed:'左目が閉じている',right_open:'右目が開いている',right_closed:'右目が閉じている',mouth_open:'口が開いている',mouth_closed:'口が閉じている'};
export function defaultExpressionLayer(role) {
  let condition='always',order=0;
  if(role.startsWith('eye_')) {
    const side=role.endsWith('_l')?'left':'right',closed=role.startsWith('eye_closed');
    condition=`${side}_${closed?'closed':'open'}`;order=closed?25:role.startsWith('eye_white')?10:role.startsWith('eye_iris')?15:20;
  } else if(role.startsWith('mouth_')) {condition=role==='mouth_closed'?'mouth_closed':['mouth_inside','mouth_teeth','mouth_tongue'].includes(role)?'mouth_open':'always';order=role==='mouth_closed'?20:role==='mouth_inside'?5:15;}
  return {enabled:true,order,condition};
}
export function validateExpressionLayers(value,assets) {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('表情素材の表示設定が正しくありません。');
  for(const [role,s] of Object.entries(value)) {
    if(!EXPRESSION_ROLE_IDS.includes(role) || !assets.some(a=>a.role===role) || !s || Object.keys(s).sort().join(',')!=='condition,enabled,order' || typeof s.enabled!=='boolean' || !Number.isInteger(s.order) || s.order<0 || s.order>99 || typeof s.condition!=='string' || !Object.hasOwn(EXPRESSION_CONDITIONS,s.condition))throw new Error('表情素材の表示設定が正しくありません。');
  }
  return structuredClone(value);
}
export function expressionLayerVisible(layer,values) {
  if(!layer.enabled)return false;
  const open={left:values.left>=.5,right:values.right>=.5,mouth:values.mouth>=.5};
  if(layer.condition==='always')return true;
  const [group,state]=layer.condition.split('_');return state==='open'?open[group]:!open[group];
}
