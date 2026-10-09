import {emptyReview} from './review-state.js';
export function createReviewPanel({labels,getState,onChange,isDirty}) {
  const section=document.createElement('section');section.className='panel review-panel';section.hidden=true;
  section.innerHTML='<h2>パーツの確認記録</h2><p class="muted">見える領域の境界と、隠れ部分の描き足しが必要かを記録します。確認済みでも Live2D 素材の完成を意味しません。記録は作業ファイルに保存してください。</p><p id="review-summary" role="status"></p><div id="review-list"></div>';
  document.querySelector('.results-panel').after(section);
  const dialog=document.createElement('dialog');dialog.id='review-dialog';dialog.setAttribute('aria-labelledby','review-title');
  dialog.innerHTML='<div class="dialog-header"><h2 id="review-title"></h2><button id="close-review" class="secondary">閉じる</button></div><label>比較表示 <select id="review-view"><option value="result">分離結果</option><option value="source">元画像</option></select></label><div class="dialog-preview"><img id="review-image" alt="確認用画像"></div><p id="review-result-note" class="muted"></p><div class="review-fields"><label>見える領域の境界 <select id="review-boundary"><option value="unchecked">未確認</option><option value="checked">見える部分は確認済み</option><option value="needs_fix">境界修正が必要</option></select></label><label>隠れ部分の描き足し <select id="review-fill"><option value="unknown">未確認</option><option value="needed">必要</option><option value="not_needed">この用途では不要</option></select></label><label>作業メモ（500文字まで）<textarea id="review-note" maxlength="500" rows="4"></textarea></label></div><p class="muted">描き足しの実行・完成判定は行いません。変更は現在の作業に反映されます。</p>';
  document.body.append(dialog);
  const $=selector=>dialog.querySelector(selector);let current=null;
  const close=()=>{dialog.close();current=null;$('#review-image').removeAttribute('src');};
  $('#close-review').addEventListener('click',close);dialog.addEventListener('close',()=>{current=null;$('#review-image').removeAttribute('src');});
  function update() {
    const state=getState();section.hidden=!state.file;
    const locked=state.locked;
    const chosen=state.selected.map(id=>({id,record:state.reviews[id]||emptyReview(),part:state.results.find(p=>p.id===id)}));
    section.querySelector('#review-summary').textContent=`選択中 ${chosen.length} 項目：境界確認済み ${chosen.filter(({record,part})=>record.boundary==='checked' && part?.ai && !isDirty(part)).length} ／ 境界修正が必要 ${chosen.filter(({record})=>record.boundary==='needs_fix').length} ／ 描き足しが必要 ${chosen.filter(({record})=>record.fill==='needed').length} ／ 結果なし ${chosen.filter(({part})=>!part).length} ／ 指定変更あり ${chosen.filter(({part})=>part && isDirty(part)).length}`;
    const list=section.querySelector('#review-list');list.replaceChildren();
    for(const id of state.ids) {
      const record=state.reviews[id]||emptyReview(),part=state.results.find(p=>p.id===id);
      const row=document.createElement('div');row.className='review-row';row.dataset.review=id;
      const text=document.createElement('span');text.textContent=`${labels[id]}：${{unchecked:'未確認',checked:'境界確認済み',needs_fix:'境界修正が必要'}[record.boundary]}${part && isDirty(part)?'（指定変更あり・再分離後に再確認）':''} ／ ${{unknown:'描き足し未確認',needed:'描き足しが必要',not_needed:'この用途では描き足し不要'}[record.fill]}`;
      const button=document.createElement('button');button.className='secondary';button.textContent=`${labels[id]}の確認を記録`;button.disabled=locked;button.addEventListener('click',()=>{current=id;$('#review-view').value=part?'result':'source';update();dialog.showModal();});row.append(text,button);list.append(row);
    }
    if(!current)return;
    const record=state.reviews[current]||emptyReview(),part=state.results.find(p=>p.id===current);
    $('#review-title').textContent=`${labels[current]}の確認記録`;
    $('#review-view option[value=result]').disabled=!part;if(!part)$('#review-view').value='source';
    $('#review-image').src=$('#review-view').value==='result'?part.url:state.sourceUrl;
    $('#review-result-note').textContent=!part?'結果はまだありません。必要な作業を記録できます。':!part.ai?'デモ結果です。境界確認済みにはできません。':isDirty(part)?'指定変更前の結果です。再分離後に境界を再確認してください。':'現在の指定の結果です。境界や不要な領域を確認してください。';
    $('#review-boundary option[value=checked]').disabled=!part?.ai || isDirty(part);
    for(const [id,key] of [['#review-boundary','boundary'],['#review-fill','fill'],['#review-note','note']]){const input=$(id);if(input.value!==record[key])input.value=record[key];input.disabled=locked;}
    $('#review-view').disabled=locked;
  }
  for(const id of ['#review-boundary','#review-fill','#review-note'])$(id).addEventListener(id==='#review-note'?'input':'change',()=>{
    const state=getState();if(!current || state.locked)return;
    const boundary=$('#review-boundary').value,part=state.results.find(p=>p.id===current);
    if(boundary==='checked' && (!part?.ai || isDirty(part)) && state.reviews[current]?.boundary!=='checked')return;
    onChange(current,{boundary,fill:$('#review-fill').value,note:$('#review-note').value});update();
  });
  $('#review-view').addEventListener('change',update);
  return {update,close};
}
