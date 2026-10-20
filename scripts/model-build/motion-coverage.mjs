const CHECKS=[['ParamAngleX','顔の左右'],['ParamAngleY','顔の上下'],['ParamAngleZ','顔の傾き'],['ParamEyeLOpen','左目の開閉'],['ParamEyeROpen','右目の開閉'],['ParamMouthOpenY','口の開閉']];
// Recommended IDs only. A model using custom IDs may be mapped manually in VTS.
// Nonzero geometry/opacity delta is evidence of motion, not natural expression.
export function summarizeMotionCoverage(runtime){
  return CHECKS.map(([id,label])=>{
    if(!runtime || !Array.isArray(runtime.parameters))return {id,label,status:'unverified',maxDelta:null};
    const p=runtime.parameters.find(p=>p.id===id);if(!p)return {id,label,status:'missing_recommended_id',maxDelta:null};
    const samples=p.max_output_delta_samples;if(!Array.isArray(samples) || !samples.length || samples.some(n=>!Number.isFinite(n) || n<0))return {id,label,status:'unverified',maxDelta:null};
    const maxDelta=Math.max(...samples);return {id,label,status:maxDelta>1e-6?'sampled_change':'no_sampled_change',maxDelta};
  });
}
