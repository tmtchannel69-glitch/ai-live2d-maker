import {zip,strToU8} from 'fflate';
import {ALL_IDS,PART_LABELS} from './parts.js';
import {promptSignature} from './prompt-state.js';
import {emptyReview,validateReviews} from './review-state.js';
import {defaultMotion,validateMotion} from './motion-state.js';
import {EXPRESSION_ROLE_IDS,validateExpressionAssets,expressionPngSize} from './expression-assets.js';
import {defaultExpressionLayer,validateExpressionLayers} from './expression-layer-state.js';
import {GRID,TRIANGLES,validateDeforms} from './expression-deform.js';
import {validateClips} from './expression-clips.js';
import {emptyGroups,validateGroups} from './expression-groups.js';
import {validateGroupKeys} from './group-motion-keys.js';
import {validateClipKeys} from './expression-clip-keys.js';
import {motionCheckReport} from './motion-checklist.js';

const boundaryLabels={unchecked:'未確認',checked:'見える部分は確認済み',needs_fix:'修正が必要'},fillLabels={unknown:'未確認',needed:'必要',not_needed:'この用途では不要'};
const MIB=1024*1024,MAX_BYTES=100*MIB;
const guide=`AI Live2D Maker — 制作引き継ぎZIP（独自形式・版1）
まずPART_CHECKLIST.txtとMOTION_CHECKLIST.txtを確認してください。
handoff.json：元画像のサイズ、全分離結果、追加素材、配置・表示・変形・範囲・所属・動きのキー。
parts/：全構成の分離結果。選択中の項目だけではありません。
expressions/：追加した表情素材。非表示の素材も含みます。PNGは加工せず保存します。
元画像・読込ファイル名・指定点そのものは含みません。確認メモは含みます。

座標は左上原点、xは右、yは下。placementとclipの座標は元画像の幅/高さで正規化。
左右はキャラクター本人の左右（正面では左＝画面右）。
表示orderは小さい順。同じ値はexpressionRoleOrder順。開き値0=閉/1=開、0.5以上がopen表示。
9点メッシュはmesh.gridからdeforms.closed/openへ線形補間。点は素材の配置内の正規化座標。
配置座標に変形を適用し、グループ変換、表示範囲の順で描画します。
グループはfaceを親にleft_eye/right_eye/mouth。所属なしの素材は独立。
dx/dyとpivotX/pivotYは元画像基準、angleは度、scaleは倍率。
グループキーはturn=-1/0/1でnegative/center/positive、間は全値を線形補間。
キーありのグループは通常の変換を置き換え、その後に親の変換を合成します。
表示範囲のキーも開き値で線形補間。clipFollowがtrueの範囲だけ所属グループに追従します。
頭・髪のmotionも独自プレビュー用で、Cubismパラメータへの変換は行いません。
AIパーツは元画像キャンバス上の位置を保持。デモは切り出しで位置情報がありません。

完成Live2Dモデル・Cubismプロジェクト・VTube Studio用モデルではありません。
Cubism/VTube StudioへこのZIPやJSONを直接読み込む機能はありません。
画像編集・メッシュや動きの再設定・moc3への出力と実ソフトでの確認は別工程です。
アプリで再開するには別途「作業ファイルを保存」を使ってください。
第三者に渡す前に画像・確認メモの内容を確認してください。
`;

export async function createAuthoringHandoff({file,results=[],prompts={},reviews={},motion={},assets=[],layers={},deforms={},clips={},groups=emptyGroups(),groupKeys={},clipKeys={}}) {
  if(!file || !Array.isArray(results) || new Set(results.map(p=>p.id)).size!==results.length || results.some(p=>!ALL_IDS.includes(p.id) || typeof p.ai!=='boolean'))throw new Error('分離結果の情報が正しくありません。');
  const images=[...results.map(p=>({blob:p.blob,max:32*MIB})),...assets.map(a=>({blob:a.blob,max:10*MIB}))];
  if(images.some(p=>!(p.blob instanceof Blob) || !p.blob.size || p.blob.size>p.max) || images.reduce((n,p)=>n+p.blob.size,0)>MAX_BYTES-1024*1024)throw new Error('引き継ぎ素材が大きすぎます。合計100 MiB、パーツ32 MiB、追加素材10 MiBが上限です。');
  const expressions=validateExpressionAssets(assets.map(a=>({role:a.role,name:`${a.role}.png`,path:`expressions/${a.role}.png`,width:a.width,height:a.height,placement:a.placement})));
  const settings={layers:validateExpressionLayers(layers,expressions),deforms:validateDeforms(deforms,expressions),clips:validateClips(clips,expressions),groups:validateGroups(groups,expressions,clips),groupKeys:validateGroupKeys(groupKeys,groups,expressions,clips),clipKeys:validateClipKeys(clipKeys,expressions,clips)};
  settings.layers=Object.fromEntries(expressions.map(a=>[a.role,settings.layers[a.role]||defaultExpressionLayer(a.role)]));
  const checkedReviews=validateReviews(reviews,results),checkedMotion=validateMotion(motion);
  let bitmap,source;
  try {bitmap=await createImageBitmap(file);source={width:bitmap.width,height:bitmap.height};}finally{bitmap?.close();}
  if(!source.width || !source.height || source.width>4096 || source.height>4096 || source.width*source.height>16_000_000)throw new Error('元画像のサイズが制限を超えています。');
  const entries={},parts=[];
  for(const p of results){
    const bytes=new Uint8Array(await p.blob.arrayBuffer()),dimensions=expressionPngSize(bytes);
    if(p.ai && (dimensions.width!==source.width || dimensions.height!==source.height))throw new Error('AIパーツのサイズが元画像と一致しません。');
    const review=checkedReviews[p.id]||emptyReview(),matches=p.ai?p.signature===promptSignature(prompts[p.id]):null;
    parts.push({id:p.id,label:PART_LABELS[p.id],path:`parts/${p.id}.png`,dimensions,kind:p.ai?'ai':'demo',alignment:p.ai?'source-canvas':'cropped-demo',origin:p.ai?{x:0,y:0}:null,manual:Boolean(p.manual),resultMatchesPrompt:matches,review,currentBoundary:review.boundary==='checked' && (!p.ai || !matches)?'unchecked':review.boundary,motion:checkedMotion[p.id]||defaultMotion(p.id)});
    entries[`parts/${p.id}.png`]=bytes;
  }
  for(const a of expressions){const bytes=new Uint8Array(await assets.find(p=>p.role===a.role).blob.arrayBuffer()),size=expressionPngSize(bytes);if(size.width!==a.width || size.height!==a.height)throw new Error('追加素材のサイズが一致しません。');entries[a.path]=bytes;}
  const manifest={format:'ai-live2d-maker-authoring-handoff',version:1,containsOriginal:false,live2dCompatible:false,source,coordinateSystem:'source-normalized-top-left',parts,expressions,settings,mesh:{grid:GRID,triangles:TRIANGLES},expressionRoleOrder:EXPRESSION_ROLE_IDS,groupParents:{face:null,left_eye:'face',right_eye:'face',mouth:'face'},reviews:checkedReviews};
  const metadata=strToU8(JSON.stringify(manifest,null,2));if(metadata.length>256*1024)throw new Error('設定が大きすぎます。');
  entries['handoff.json']=metadata;entries['README.txt']=strToU8('\uFEFF'+guide.replace(/\n/g,'\r\n'));
  entries['MOTION_CHECKLIST.txt']=strToU8(motionCheckReport({assets:expressions,...settings}));
  entries['PART_CHECKLIST.txt']=strToU8('\uFEFF'+['全分離結果の確認記録（素材の完成判定ではありません）',`PNG ${parts.length}個 / 追加素材 ${expressions.length}役割`,'未分離の項目はここに含みません。目・口の不足はMOTION_CHECKLIST.txtも確認してください。',...parts.map(p=>`${p.label}：${p.kind==='demo'?'デモ・位置情報なし':'AI'} / 指定一致 ${p.resultMatchesPrompt===null?'対象外':p.resultMatchesPrompt?'一致':'変更あり・再確認が必要'} / 境界 ${boundaryLabels[p.currentBoundary]} / 描き足し ${fillLabels[p.review.fill]}\nメモ：${p.review.note||'なし'}`)].join('\r\n'));
  if(Object.values(entries).reduce((n,b)=>n+b.length,0)>MAX_BYTES-4096)throw new Error('引き継ぎ素材が大きすぎます。');
  return new Promise((resolve,reject)=>zip(entries,{level:0},(error,bytes)=>error?reject(error):resolve(new Blob([bytes],{type:'application/zip'}))));
}
