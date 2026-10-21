// A bounded hint for the known psd2live drawable names, not a visual verdict.
// Opacity may be further affected by visibility/clipping. Custom IDs are allowed.
const OPEN=/^ArtMeshMouthOpen(?:_[A-Za-z0-9_]+)?$/;
const CLOSED=/^ArtMeshMouthClose(?:_[A-Za-z0-9_]+)?$/;
export function summarizeMouthVisibility(runtime){
  const unknown={status:'unverified',sampleValue:null,openLayers:[],closedLayers:[]};
  const samples=runtime?.mouth_opacity_samples;
  if(!samples || samples.parameter!=='ParamMouthOpenY' || !Array.isArray(samples.sample_values) || samples.sample_values.length!==5 || samples.sample_values.some((v,i,a)=>!Number.isFinite(v) || (i>0 && v<=a[i-1])) || !Array.isArray(samples.drawables) || !samples.drawables.length || samples.drawables.length>64)return unknown;
  const ids=new Set(),openLayers=[],closedLayers=[];
  for(const d of samples.drawables){
    if(!d || typeof d.id!=='string' || d.id.length>128 || ids.has(d.id) || (!OPEN.test(d.id) && !CLOSED.test(d.id)) || !Array.isArray(d.opacity) || d.opacity.length!==5 || d.opacity.some(v=>!Number.isFinite(v) || v<0 || v>1))return unknown;
    ids.add(d.id);(OPEN.test(d.id)?openLayers:closedLayers).push({id:d.id,opacity:d.opacity[0]});
  }
  if(!openLayers.length || !closedLayers.some(d=>d.opacity>1e-4))return unknown;
  return {status:openLayers.some(d=>d.opacity>1e-4)?'open_layer_visible_at_minimum':'no_overlap_at_minimum',sampleValue:samples.sample_values[0],openLayers,closedLayers};
}
