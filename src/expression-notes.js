import {EXPRESSION_ROLES} from './expression-assets.js';
export const NOTE_STATUSES={unchecked:'未確認',needs_fix:'修正が必要',checked:'この状態は確認済み'};
export function validateExpressionNotes(notes,assets){
  const fail=()=>{throw new Error('表情の確認メモが正しくありません。');};
  if(!notes || typeof notes!=='object' || Array.isArray(notes))fail();
  for(const [role,n] of Object.entries(notes)){
    if(!EXPRESSION_ROLES.some(([id])=>id===role) || !assets.some(a=>a.role===role) || !n || typeof n!=='object' || Array.isArray(n) || Object.keys(n).sort().join(',')!=='isolated,note,pose,reference,stale,status' || !Object.hasOwn(NOTE_STATUSES,n.status) || typeof n.note!=='string' || n.note.length>1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(n.note) || ['isolated','reference','stale'].some(k=>typeof n[k]!=='boolean'))fail();
    if(!n.pose || typeof n.pose!=='object' || Array.isArray(n.pose) || Object.keys(n.pose).sort().join(',')!=='left,mouth,right,turn' || Object.entries(n.pose).some(([k,v])=>typeof v!=='number' || !Number.isFinite(v) || v<(k==='turn'?-1:0) || v>1))fail();
  }
  return structuredClone(notes);
}
export function invalidateExpressionNotes(notes,assets){return Object.fromEntries(Object.entries(notes).filter(([role])=>assets.some(a=>a.role===role)).map(([role,n])=>[role,{...n,stale:true}]));}
export function expressionNoteReport(notes={}){
  return ['表情素材の確認メモ（利用者の記録・モデルの完成判定ではありません）',...Object.entries(notes).map(([role,n])=>`${EXPRESSION_ROLES.find(([id])=>id===role)?.[1]||role}：${n.stale?'設定/素材が変わったため再確認が必要':NOTE_STATUSES[n.status]}\n左目 ${n.pose.left} / 右目 ${n.pose.right} / 口 ${n.pose.mouth} / 向き ${n.pose.turn} / ${n.isolated?'単独表示':'合成表示'} / 元画像比較 ${n.reference?'あり':'なし'}\nメモ：${n.note||'なし'}`)].join('\r\n');
}
