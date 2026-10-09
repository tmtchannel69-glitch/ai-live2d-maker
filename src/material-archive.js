import {zip,strToU8} from 'fflate';
import {TEMPLATES,PART_LABELS} from './parts.js';
import {emptyReview,validateReviews} from './review-state.js';
import {promptSignature} from './prompt-state.js';

const MIB=1024*1024;
const MAX_BYTES=100*MIB;
const issueLabels={
  missing_result:'分離結果がありません',
  demo_result:'デモの固定領域です。制作向けにAI分離・位置の確認が必要です',
  prompt_changed:'指定変更前の結果です。再分離・境界の再確認が必要です',
  boundary_unchecked:'見える領域の境界が未確認です',
  boundary_needs_fix:'境界修正が必要です',
  fill_unknown:'隠れ部分の描き足しが必要か未確認です',
  fill_needed:'隠れ部分の描き足しが必要です',
};
const boundaryLabels={unchecked:'未確認',checked:'見える部分は確認済み',needs_fix:'境界修正が必要'};
const fillLabels={unknown:'未確認',needed:'必要',not_needed:'この用途では不要'};
function pngDimensions(bytes) {
  const signature=[137,80,78,71,13,10,26,10];
  if(bytes.length<33 || signature.some((byte,i)=>bytes[i]!==byte) || bytes[12]!==73 || bytes[13]!==72 || bytes[14]!==68 || bytes[15]!==82)throw new Error('パーツのPNGを読み込めません。');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint32(16),height=view.getUint32(20);
  if(!width || !height || width>4096 || height>4096 || width*height>16_000_000)throw new Error('パーツの画像サイズが制限を超えています。');
  return {width,height};
}
function reviewIssues(part) {
  const issues=[];
  if(part.kind==='missing')issues.push('missing_result');
  if(part.kind==='demo')issues.push('demo_result');
  if(part.resultMatchesPrompt===false)issues.push('prompt_changed');
  if(part.currentBoundary==='unchecked')issues.push('boundary_unchecked');
  if(part.currentBoundary==='needs_fix')issues.push('boundary_needs_fix');
  if(part.review.fill==='unknown')issues.push('fill_unknown');
  if(part.review.fill==='needed')issues.push('fill_needed');
  return issues;
}
function checklist(manifest) {
  const s=manifest.summary;
  const lines=['AI Live2D Maker — 制作素材の確認・不足一覧',
    `構成：${manifest.template==='production'?'制作向け・上半身15項目':'基本の四分類'}`,
    `元画像のサイズ：${manifest.source.width} × ${manifest.source.height} px`,
    `選択中 ${s.selected} 項目 ／ PNGあり ${s.exported} ／ 結果なし ${s.missing} ／ 指定変更あり ${s.stale} ／ デモ ${s.demo}`,
    `境界確認済み ${s.boundaryChecked} ／ 境界未確認 ${s.boundaryUnchecked} ／ 境界修正が必要 ${s.boundaryNeedsFix}`,
    `描き足し未確認 ${s.fillUnknown} ／ 描き足しが必要 ${s.fillNeeded}`,
    '', 'これは書き出し時点の確認記録です。素材の品質やLive2Dモデルの完成を保証しません。',
    '確認済みでも、目の細分化・隠れ部分の描き足し・Cubismでの変形や動きの設定は別工程です。',''];
  for(const part of manifest.parts) {
    lines.push(`【${part.label}】 (${part.id})`,
      `PNG：${part.path||'なし'}`,
      `境界（現在の結果）：${boundaryLabels[part.currentBoundary]}`,
      `境界（記録）：${boundaryLabels[part.review.boundary]}`,
      `描き足し：${fillLabels[part.review.fill]}`,
      `ブラシ補正：${part.manual?'反映済み':'なし'}`);
    if(part.dimensions)lines.push(`画像サイズ：${part.dimensions.width} × ${part.dimensions.height} px`);
    lines.push('不足・未確認事項：',...(part.issues.length?part.issues.map(code=>`  - ${issueLabels[code]}`):['  記録上の不足・未確認事項はありません。素材の完成判定ではありません。']));
    lines.push('メモ：',...(part.review.note?part.review.note.replace(/\r\n?/g,'\n').split('\n').map(line=>`  ${line}`):['  なし']),'');
  }
  return lines.join('\r\n');
}
const instructions=`AI Live2D Maker — 制作素材ZIP

CHECKLIST.txt：日本語の確認記録と不足・未確認一覧。まずこのファイルを読んでください。
manifest.json：選択項目、PNGの有無・サイズ・位置、確認記録をまとめた情報。
parts/：選択中の項目で、結果があるパーツだけのPNG。未選択・別構成の結果は含みません。

AI結果は元画像と同じキャンバスサイズで、左上を原点として位置を保ちます。
自動トリミング・縮小・画像へのラベル追加は行いません。ブラシ補正済みPNGもそのまま保存します。
デモは固定領域の切り出しです。元画像上の位置をこのZIPでは再現できません。
左右はキャラクター本人の左右です。正面では「左＝画面右」「右＝画面左」です。
指定を変更して再分離していない結果は、以前のPNGと再確認の案内を含みます。
分離結果がない項目はPNGなしで一覧に残ります。

このZIPは完成したLive2Dモデル・PSDではありません。
PNGの輪郭、重なり、隠れ部分、必要な目や口の素材を確認し、画像編集とCubismでの制作を進めてください。
隠れ部分の描き足しや動き付けは自動で行いません。
元画像・点や枠・履歴を含まず、このアプリの「作業ファイルを開く」では復元できません。
続きから作業するには、別途「作業ファイルを保存」でai-live2d-work.zipを保存してください。
確認記録・メモと選択したPNGを含むため、他の人に渡す前に内容を確認してください。
`;

export async function createMaterialArchive({file,template,mode,selected,prompts,results,reviews}) {
  const allowed=TEMPLATES[template]?.map(part=>part.id);
  if(!allowed || !['ai','demo'].includes(mode) || (template==='production' && mode!=='ai') || !Array.isArray(selected) || !selected.length || new Set(selected).size!==selected.length || selected.some(id=>!allowed.includes(id)))throw new Error('書き出すパーツを選択してください。');
  const chosen=allowed.filter(id=>selected.includes(id));
  const selectedResults=results.filter(part=>chosen.includes(part.id));
  if(new Set(selectedResults.map(part=>part.id)).size!==selectedResults.length || selectedResults.some(part=>part.ai!==(mode==='ai')))throw new Error('結果の処理方式が正しくありません。');
  const selectedReviews=Object.fromEntries(chosen.map(id=>[id,reviews[id]||emptyReview()]));
  validateReviews(selectedReviews,selectedResults);
  if(selectedResults.some(part=>part.blob.size>32*MIB) || selectedResults.reduce((size,part)=>size+part.blob.size,0)>MAX_BYTES-256*1024)throw new Error('制作素材が大きすぎます。上限は100 MiB、各PNGは32 MiBです。');
  let bitmap,source;
  try {bitmap=await createImageBitmap(file);source={width:bitmap.width,height:bitmap.height};}
  finally {bitmap?.close();}
  if(source.width>4096 || source.height>4096 || source.width*source.height>16_000_000)throw new Error('元画像のサイズが制限を超えています。');
  const entries={},parts=[];
  // Read sequentially so only one PNG is validated at a time.
  for(const id of chosen) {
    const result=selectedResults.find(part=>part.id===id),review=selectedReviews[id];
    const part={id,label:PART_LABELS[id],path:null,dimensions:null,kind:result?(result.ai?'ai':'demo'):'missing',alignment:'none',origin:null,manual:Boolean(result?.manual),resultMatchesPrompt:result?.ai?result.signature===promptSignature(prompts[id]):null,review,currentBoundary:review.boundary};
    if(result) {
      const bytes=new Uint8Array(await result.blob.arrayBuffer());part.dimensions=pngDimensions(bytes);
      if(result.ai && (part.dimensions.width!==source.width || part.dimensions.height!==source.height))throw new Error('AIパーツは元画像と同じサイズにしてください。');
      part.path=`parts/${id}.png`;part.alignment=result.ai?'source-canvas':'cropped-demo';part.origin=result.ai?{x:0,y:0}:null;
      entries[part.path]=bytes;
    }
    if(part.currentBoundary==='checked' && (part.kind!=='ai' || !part.resultMatchesPrompt))part.currentBoundary='unchecked';
    part.issues=reviewIssues(part);parts.push(part);
  }
  const summary={selected:parts.length,exported:parts.filter(p=>p.path).length,missing:parts.filter(p=>p.kind==='missing').length,stale:parts.filter(p=>p.resultMatchesPrompt===false).length,demo:parts.filter(p=>p.kind==='demo').length,boundaryChecked:parts.filter(p=>p.currentBoundary==='checked').length,boundaryUnchecked:parts.filter(p=>p.currentBoundary==='unchecked').length,boundaryNeedsFix:parts.filter(p=>p.currentBoundary==='needs_fix').length,fillUnknown:parts.filter(p=>p.review.fill==='unknown').length,fillNeeded:parts.filter(p=>p.review.fill==='needed').length};
  const manifest={format:'ai-live2d-maker-materials',version:1,template,mode,source,containsOriginal:false,coordinateSystem:'pixels-from-top-left',summary,parts};
  entries['manifest.json']=strToU8(JSON.stringify(manifest,null,2));
  // UTF-8 BOM allows Windows text editors to recognise Japanese text.
  entries['CHECKLIST.txt']=strToU8('\uFEFF'+checklist(manifest));entries['README.txt']=strToU8('\uFEFF'+instructions.replace(/\n/g,'\r\n'));
  if(Object.values(entries).reduce((size,bytes)=>size+bytes.length,0)>MAX_BYTES-4096)throw new Error('制作素材が大きすぎます。上限は100 MiBです。');
  return new Promise((resolve,reject)=>zip(entries,{level:0},(error,data)=>error?reject(error):resolve(new Blob([data],{type:'application/zip'}))));
}
