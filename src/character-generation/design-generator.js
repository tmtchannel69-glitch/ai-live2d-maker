import {createDesignPlan,createAIGenerationRequest} from '../../shared/character-design.js';
import {manifestFromPlan,validateDesignedCharacter,createDesignedRigMetadata} from '../../shared/designed-character.js';
import {createInochiGeometry} from '../../shared/generated-character.js';
import {buildDesignedInochi} from '../../shared/generated-character-inochi.js';
import {resolveDesignProvider,validateDesignBatch} from './design-provider.js';
import {checkAbort,validateAsset,assembleValidatedCharacter} from './generator.js';

export async function generateDesignedCharacter(design={}, {signal,onProgress=()=>{},providerId='local-design-v1'}={}){
  const provider=resolveDesignProvider(providerId),plan=await createDesignPlan(design);checkAbort(signal);
  const batch=validateDesignBatch(plan,await provider.generateCharacter(structuredClone(plan),{signal,onProgress}));checkAbort(signal);
  const manifest=await validateDesignedCharacter(manifestFromPlan(plan,batch.provider)),assets=new Map(),bytes=new Map();let total=0;
  for(const p of manifest.parts){
    const b=batch.parts.get(p.role).blob;await validateAsset(p,b,signal,{requireTransparency:true});total+=b.size;if(total>12*1024*1024)throw new Error('生成パーツの合計が上限を超えています。');
    assets.set(p.role,b);bytes.set(p.role,new Uint8Array(await b.arrayBuffer()));
  }
  const preview=await assembleValidatedCharacter(manifest,assets,{signal});
  const native=await buildDesignedInochi(manifest,bytes,{signal,onProgress:p=>onProgress({...p,completed:p.completed+33,total:66,stage:'model'})});checkAbort(signal);
  return {manifest,assets,preview,native,design:plan.design,blueprint:plan.blueprint,aiRequest:createAIGenerationRequest(plan),
    rig:createDesignedRigMetadata(manifest),intermediate:createInochiGeometry(manifest),
    quality:{format:'ai-live2d-design-structure-check',version:1,design_id:manifest.generator.design_id,blueprint_id:plan.blueprint_id,
      coherent_metadata_batch:true,parts_checked:33,nonempty_rgba_parts:33,placement_contract_passed:true,
      ai_generation_performed:false,ai_visual_consistency_tested:false,official_creator_tested:false,appearance_quality_passed:false}};
}
