// Stored preparation numbers are untrusted provenance, not evidence of AI
// authorship or official-runtime/appearance acceptance.
const need=(v,m)=>{if(!v)throw new Error(m||'前髪の取り込み記録が正しくありません。');};
const ratio=n=>Number.isFinite(n)&&n>=0&&n<=1;
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function rect(q,w,h){return q&&['x','y','width','height'].every(k=>Number.isInteger(q[k]))&&q.x>=0&&q.y>=0&&q.width>0&&q.height>0&&q.x+q.width<=w&&q.y+q.height<=h;}
function placement(p){
  need(p&&rect(p.rect,768,1024)&&Number.isFinite(p.scale)&&p.scale>0&&p.scale<=1&&Array.isArray(p.draw_size)&&p.draw_size.length===2&&p.draw_size.every(n=>Number.isFinite(n)&&n>0)&&p.draw_size[0]<=p.rect.width&&p.draw_size[1]<=p.rect.height&&ratio(p.score)&&ratio(p.old_bangs_coverage)&&typeof p.accepted==='boolean');
  need(p.occlusion&&Object.keys(p.occlusion).length===6&&['iris_l','iris_r','brow_l','brow_r','eye_white_l','eye_white_r'].every(k=>ratio(p.occlusion[k])));
}
export function validateBangsPreparation(p,preparedSha){
  need(p?.format==='ai-live2d-bangs-import'&&p.version===1&&p.role==='bangs_front'&&sha(p.source_sha256)&&sha(p.prepared_sha256)&&p.prepared_sha256===preparedSha&&p.ai_origin_verified===false&&typeof p.source_claim==='string'&&p.source_claim.length<=160);
  need(p.uniform_scaling===true&&p.upscaled===false&&p.original_preserved===true&&p.original_rgb_repainted===false&&p.source_crop_clipped===false&&p.appearance_quality_passed===false&&p.style_consistency_verified===false&&p.official_creator_tested===false);
  placement(p.placement);need(p.placement.accepted&&Array.isArray(p.candidates)&&p.candidates.length>0&&p.candidates.length<=64);p.candidates.forEach(placement);
  need(p.thresholds?.iris_occlusion===.04&&p.thresholds.brow_occlusion===.5&&p.thresholds.eye_white_occlusion===.22);
  const c=p.cleanup;need(c?.algorithm==='low-alpha-background-v1'&&c.alpha_threshold===8&&c.edge_halo_radius===2&&Array.isArray(c.source_size)&&c.source_size.length===2&&c.source_size.every(n=>Number.isInteger(n)&&n>=64&&n<=2048));
  const [w,h]=c.source_size,n=w*h;
  for(const k of ['source_visible_pixels','source_semitransparent_pixels','source_strong_pixels','source_edge_visible_pixels','source_edge_strong_pixels','removed_low_alpha_pixels','removed_alpha_sum','strong_pixels_removed'])need(Number.isSafeInteger(c[k])&&c[k]>=0&&c[k]<=n*7);
  need(c.source_visible_pixels<=n&&c.source_strong_pixels<=c.source_visible_pixels&&c.source_semitransparent_pixels<=c.source_visible_pixels&&c.removed_low_alpha_pixels<=c.source_visible_pixels&&c.source_edge_strong_pixels===0&&c.strong_pixels_removed===0&&c.source_colour_repainted===false&&c.original_alpha_boosted===false&&c.semantically_verified===false);
  need(Array.isArray(c.source_visible_bounds)&&c.source_visible_bounds.length===4&&c.source_visible_bounds.every(Number.isInteger)&&c.source_visible_bounds[0]>=0&&c.source_visible_bounds[1]>=0&&c.source_visible_bounds[2]<=w&&c.source_visible_bounds[3]<=h);
  need(rect(p.cleaned_bounds,w,h));return p;
}
