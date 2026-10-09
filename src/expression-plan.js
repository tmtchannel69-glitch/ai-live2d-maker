import {PART_LABELS} from './parts.js';
import {emptyReview} from './review-state.js';
import {promptSignature} from './prompt-state.js';
import {EXPRESSION_ROLES} from './expression-assets.js';

export const EXPRESSION_GROUPS=[
  {id:'blink',label:'瞬き・目の表情',parts:['face_skin','eye_l','eye_r','brow_l','brow_r'],parameters:'ParamEyeLOpen / ParamEyeROpen（開閉 0〜1）',tasks:[
    '白目・瞳・まつげ・まぶたを別々に動かせる素材にする（現在の目パーツは細分化前）。',
    '閉じた目の形と、目を動かした下に見える肌を準備する。開いた目を縮めるだけでは下の目の絵が残る場合があります。',
    '左目・右目の開閉を別々に設定し、開く・半分・閉じるの形と重なりを確認する。',
  ]},
  {id:'mouth',label:'口の開閉・表情',parts:['face_skin','mouth_visible'],parameters:'ParamMouthOpenY（開閉 0〜1）/ ParamMouthForm（形 −1〜1）',tasks:[
    '上唇・下唇・口の内部を分け、必要に応じて歯・舌を準備する（現在は口の見える部分のみ）。',
    '口を動かした下に見える肌と、閉じた形・開いた形の素材を準備する。元画像に見えない口の内部は分離できません。',
    '閉じる・半分・開くの変形と、口の形の表情を別々に設定する。',
  ]},
];
export const EXPRESSION_STATUS={missing:'未分離',demo:'デモ結果・位置の確認が必要',stale:'指定変更あり・再分離が必要',needs_fix:'境界修正が必要',unchecked:'境界未確認',checked:'見える境界は確認済み'};
const FILL={unknown:'描き足しの必要性は未確認',needed:'描き足しが必要',not_needed:'記録上、この用途では描き足し不要'};

// Existing review records describe visible masks, not whether a complete expression exists.
export function expressionPlan({results,prompts,reviews}) {
  return EXPRESSION_GROUPS.map(group=>({...group,parts:group.parts.map(id=>{
    const part=results.find(p=>p.id===id),review=reviews[id]||emptyReview();
    const stale=Boolean(part?.ai && part.signature!==promptSignature(prompts[id]));
    const status=!part?'missing':!part.ai?'demo':stale?'stale':review.boundary==='checked'?'checked':review.boundary==='needs_fix'?'needs_fix':'unchecked';
    return {id,label:PART_LABELS[id],status,fill:review.fill,note:review.note};
  })}));
}
export function expressionReport(state) {
  const groups=expressionPlan(state),lines=['AI Live2D Maker — 瞬き・口の動きの素材準備',
    '制作向けの目・口・顔の肌の状況（未選択の既存結果も含みます）。',
    '見える境界の確認済みは、瞬き・口の動きやLive2Dモデルの完成を意味しません。',
    '細分化した素材・閉じた目・口の内部・下地の肌・変形キーは、この画面では未確認です。',
    '以下のパラメーターIDは今後の設計目標です。モデルへの設定・moc3出力は未実装です。',
    'この一覧は画像を含みません。作業再開は別途、作業ファイルを保存してください。',''];
  for(const group of groups) {
    lines.push(`【${group.label}】`,group.parameters,'分離と確認の状況：');
    for(const part of group.parts) {
      lines.push(`- ${part.label} (${part.id})：${EXPRESSION_STATUS[part.status]} ／ ${FILL[part.fill]}`);
      if(part.note)lines.push('  作業メモ：',...part.note.replace(/\r\n?/g,'\n').split('\n').map(line=>`    ${line}`));
    }
    lines.push('次に確認する素材と設定（この画面では未確認）：',...group.tasks.map(task=>`- ${task}`),'');
  }
  if(state.assets?.length) {
    lines.push('【追加で読み込んだ表情素材】','読込済みです。形・境界・配置・動作品質は未確認です。画像はこの一覧に含みません。');
    for(const a of state.assets)lines.push(`- ${EXPRESSION_ROLES.find(([id])=>id===a.role)[1]}：${a.width} × ${a.height} px ／ 左端${+(a.placement.x*100).toFixed(2)}% 上端${+(a.placement.y*100).toFixed(2)}% 幅${+(a.placement.width*100).toFixed(2)}% 高さ${+(a.placement.height*100).toFixed(2)}%`);
  }
  return '\uFEFF'+lines.join('\r\n');
}
export const fillLabel=value=>FILL[value];
