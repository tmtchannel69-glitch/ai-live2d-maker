// Official OpenAPI 8243cc8 + SDK 718aee9. Capabilities are documented;
// price/performance rankings and account access have NOT been verified.
export const MODEL_PROFILES=Object.freeze([
  Object.freeze({id:'gpt-image-1.5',alias:'gpt-image-1.5',label:'GPT Image 1.5',snapshot:false,input_fidelity:'high',extra_quality_levels:[]}),
  Object.freeze({id:'gpt-image-2.5-flare-2026-09-08',alias:'gpt-image-2.5-flare',label:'GPT Image 2.5 Flare',snapshot:true,input_fidelity:null,extra_quality_levels:['xhigh','max']}),
  Object.freeze({id:'gpt-image-2.5-sunburst-2026-09-08',alias:'gpt-image-2.5-sunburst',label:'GPT Image 2.5 Sunburst',snapshot:true,input_fidelity:null,extra_quality_levels:['xhigh','max']})
]);
export const DEFAULT_TWO_CALL_MODEL=MODEL_PROFILES[1].id;
export function modelProfile(value=DEFAULT_TWO_CALL_MODEL){
  const profile=MODEL_PROFILES.find(p=>p.id===value||p.alias===value);
  if(!profile)throw new Error('Choose GPT Image 1.5, 2.5 Flare or 2.5 Sunburst; unknown models are not silently substituted.');
  return profile;
}
