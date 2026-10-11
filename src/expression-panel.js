import {EXPRESSION_GROUPS,EXPRESSION_STATUS,expressionPlan,expressionReport,fillLabel} from './expression-plan.js';

export function createExpressionPanel({getState,onPrepare}) {
  const section=document.createElement('section');section.className='panel expression-panel';section.hidden=true;
  section.innerHTML='<div class="panel-title"><h2>瞬き・口の動きの素材準備</h2><button id="expression-report" class="secondary">準備一覧を保存</button></div><p class="muted">制作向けの目・口・顔の肌を準備します。未選択の既存結果も一覧に含みます。「見える境界は確認済み」でも、動く表情の完成ではありません。閉じた目・口の内部・下地の肌は別途準備が必要です。</p><p class="muted">保存する準備一覧は画像を含まず、確認記録のメモを含みます。作業の再開には別途、作業ファイルを保存してください。</p><div id="expression-groups"></div><p id="expression-status" role="status" aria-live="polite"></p>';
  document.querySelector('.motion-panel').after(section);
  const assetSummary=document.createElement('p');assetSummary.className='muted';assetSummary.id='expression-assets-summary';section.querySelector('#expression-groups').before(assetSummary);
  const rows=new Map();let source=null;
  for(const group of EXPRESSION_GROUPS) {
    const card=document.createElement('article');card.className='expression-card';card.dataset.expression=group.id;
    const title=document.createElement('h3');title.textContent=group.label;
    const button=document.createElement('button');button.className='secondary';button.dataset.prepare=group.id;button.textContent=group.id==='blink'?'目の分離項目を選択':'口の分離項目を選択';
    button.addEventListener('click',()=>{const state=getState();if(state.locked || !state.file)return;onPrepare(group.parts);section.querySelector('#expression-status').textContent=`${group.label}の分離項目を追加で選択しました。「切り抜く場所を指定」から指定してください。以前の選択・指定・結果は保持しています。`;document.querySelector('#edit-prompts').focus();});
    const list=document.createElement('ul');list.className='expression-parts';
    for(const id of group.parts){const row=document.createElement('li');row.dataset.expressionPart=id;list.append(row);rows.set(`${group.id}:${id}`,row);}
    const taskTitle=document.createElement('h4');taskTitle.textContent='次に確認する素材と設定（この画面では未確認）';
    const tasks=document.createElement('ul');for(const text of group.tasks){const li=document.createElement('li');li.textContent=text;tasks.append(li);}
    card.append(title,button,list,taskTitle,tasks);section.querySelector('#expression-groups').append(card);
  }
  function update() {
    const state=getState();section.hidden=!state.file;
    assetSummary.textContent=`追加の表情素材：${state.assets?.length||0}役割を読み込み済み。読み込み・位置合わせは下の画面で行います。読込済みでも形や動作品質は未確認です。`;
    if(state.file!==source){source=state.file;section.querySelector('#expression-status').textContent='';}
    for(const button of section.querySelectorAll('#expression-report,[data-prepare]'))button.disabled=state.locked || !state.file;
    if(!state.file)section.querySelector('#expression-status').textContent='';
    for(const group of expressionPlan(state))for(const part of group.parts) {
      const row=rows.get(`${group.id}:${part.id}`);row.dataset.state=part.status;row.textContent=`${part.label}：${EXPRESSION_STATUS[part.status]} ／ ${fillLabel(part.fill)}`;
    }
  }
  section.querySelector('#expression-report').addEventListener('click',()=>{
    const state=getState();if(state.locked || !state.file)return;
    const url=URL.createObjectURL(new Blob([expressionReport(state)],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');
    link.href=url;link.download='ai-live2d-expression-preparation.txt';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);
    section.querySelector('#expression-status').textContent='準備一覧の保存を開始しました。画像は含まず、確認記録のメモを含みます。作業の再開には作業ファイルを保存してください。';
  });
  return {update};
}
