// Read-only comparison metadata for a user-uploaded part. Never infer quality from similarity.
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const warningLabels=Object.freeze({
  'very-low-coverage':'描画範囲が極端に小さい',
  'almost-opaque-tile':'透明部分が非常に少ない',
  'high-edge-contact':'パーツの端に描画が集中'
});
export function buildExternalPartComparison(manifest,report,role){
  need(manifest?.parts?.length===33&&report?.format==='ai-live2d-external-part-batch-experiment'&&
    Array.isArray(report.provided_roles)&&Array.isArray(report.parts)&&typeof role==='string',
    '一括取り込み結果が必要です。');
  need(report.provided_roles.includes(role),'選択したパーツは外部PNGで差し替えられていません。');
  const part=manifest.parts.find(p=>p.role===role),record=report.parts.find(p=>p.role===role);
  need(part&&record&&record.pixel_diagnostics?.format==='ai-live2d-external-part-pixel-diagnostics'&&
    record.rgba_structure_passed===true&&Array.isArray(record.pixel_diagnostics.warning_codes),
    '比較用の画素診断結果が不足しています。');
  const d=record.pixel_diagnostics;
  const warnings=d.warning_codes.map(code=>({code,label:warningLabels[code]??'確認が必要: '+code}));
  const round=n=>Math.round(n*1000)/10;
  return {role,label:part.label,filename:record.source_filename,
    canvas:structuredClone(d.rect_size),source_hash:record.source_sha256,
    visible_percent:round(d.visible_ratio),edge_contact_percent:round(d.edge_coverage_ratio),
    visible_bounds:d.visible_bounds?structuredClone(d.visible_bounds):null,
    warnings,warning_count:warnings.length,
    original_kind:'local-template',replacement_kind:'user-supplied-png',
    appearance_quality_verified:false,ai_origin_verified:false,
    note:'元のテンプレートと差し替えPNGを比較するための表示です。画素の合致や警告の有無は芸術的品質を証明しません。'};
}
