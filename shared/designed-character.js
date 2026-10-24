import {FORMAT,validateGeneratedGeometry,createInochiGeometry} from './generated-character.js';
import {createDesignPlan,DESIGN_TEMPLATE} from './character-design.js';

const need=(v,s)=>{if(!v)throw new Error(s);};
// JSON object key order is not part of the provider contract. Arrays (roles,
// meshes, transforms) retain their meaningful order; unknown fields still fail.
export function sameJSONData(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const ka=Object.keys(a).sort(),kb=Object.keys(b).sort();
  return ka.length===kb.length&&ka.every((k,i)=>k===kb[i]&&sameJSONData(a[k],b[k]));
}
export function manifestFromPlan(plan,origin){
  need(origin?.id==='local-design-v1'&&origin.ai_generated===false,'この版は端末内のデザイン描画だけが接続済みです。実AIの生成を装うことはできません。');
  const b=plan.blueprint;
  return {format:FORMAT,version:2,canvas:b.canvas,coordinates:b.coordinates,sides:b.sides,preview:'preview.png',background:plan.design.background,
    template:DESIGN_TEMPLATE,scope:b.scope,rigged:false,appearance_quality_passed:false,
    generator:{id:origin.id,version:1,ai_generated:false,recipe:plan.design,design_id:b.design_id,blueprint_id:plan.blueprint_id,
      provenance:{method:'local-parametric-svg',model:null,external_request:false,anatomy_reference:b.anatomy_reference}},
    design:plan.design,blueprint:b,groups:b.groups,parts:b.parts,rig_geometry:b.rig_geometry};
}

export async function validateDesignedCharacter(m){
  need(m?.format===FORMAT&&m.version===2&&m.template===DESIGN_TEMPLATE,'デザイン指定キャラクターの版2が必要です。');
  const plan=await createDesignPlan(m.design),expected=manifestFromPlan(plan,{id:'local-design-v1',ai_generated:false});
  need(Object.keys(m).length===Object.keys(expected).length,'キャラクターデータに未対応の項目があります。');
  // All geometry is a single canonical plan. Corrupted placements or mixed
  // design batches must not enter rigging even if every PNG is nonempty.
  for(const key of Object.keys(expected))need(sameJSONData(m[key],expected[key]),`デザインと${key}が一致しません。異なる生成結果は混ぜられません。`);
  return validateGeneratedGeometry(m);
}

export function createDesignedRigMetadata(validated){
  const scene=createInochiGeometry(validated),nodes=new Map(scene.nodes.map(n=>[n.id,n]));
  return {format:'ai-live2d-generated-rig-metadata',version:2,coordinates:validated.coordinates,sides:validated.sides,design_id:validated.generator.design_id,
    groups:structuredClone(validated.groups),parts:validated.parts.map(p=>({role:p.role,parent:p.parent,anchor:p.anchor,rect:p.rect,order:p.order,clip_to:p.clip_to,mesh:nodes.get(p.role).mesh})),
    rest_pose_only:true,motion_keys:[],physics:[],runtime_verified:false,appearance_quality_passed:false};
}
