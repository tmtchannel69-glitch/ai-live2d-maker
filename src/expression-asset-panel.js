import {createMaterialAssignmentPreview,materialRoleAdvice} from './material-assignment-preview.js';
import {PART_LABELS} from './parts.js';
import {promptSignature} from './prompt-state.js';
import {createAssetPlacementEditor} from './asset-placement-editor.js';
import {EXPRESSION_ROLES,readExpressionImage,defaultExpressionPlacement} from './expression-assets.js';

export function createExpressionAssetPanel({getState,onChange,onBusy}) {
  const section=document.createElement('section');section.className='panel asset-panel';section.hidden=true;
  section.innerHTML=`<h2>表情素材の読み込み・位置合わせ</h2><p class="muted">用意したPNGを役割ごとに読み込みます。画像はブラウザ内で扱い、作業ファイルに保存できます。一つの役割に一枚まで。元画像にない形の生成は行いません。開閉の形は下の合成画面で編集できます。</p>
  <div class="asset-controls"><label>素材の役割<select id="asset-role"></select></label><button id="asset-open" class="secondary">PNGを読み込む・置き換える</button><input id="asset-file" type="file" accept="image/png" hidden><label>位置合わせの背景<select id="asset-view"><option value="source">元画像</option><option value="transparent">透明背景</option></select></label></div>
  <details class="asset-result-import"><summary>分離済みのAIパーツを使う</summary><p class="muted">上で選んだ素材の役割へ、補正済みPNGを直接コピーします。元画像上の位置を保ち、分離結果は変更しません。素材の細分化や閉じた形の生成は行いません。</p><label>使う分離結果<select id="asset-result"></select></label><div class="motion-stage assignment-stage"><canvas id="asset-result-canvas" width="1" height="1" aria-label="コピー前の分離結果・透明背景"></canvas></div><p id="asset-result-preview-status" role="status" aria-live="polite"></p><p id="asset-copy-target"></p><button id="asset-use-result" class="secondary">選んだ役割へコピー</button><p id="asset-result-note" class="muted"></p></details>
  <p id="asset-role-advice" class="muted"></p><p id="asset-inventory" class="muted"></p><p id="asset-info" class="muted"></p><p id="asset-status" role="status" aria-live="polite"></p>
  <div class="motion-workspace"><div class="motion-stage"><canvas id="asset-canvas" width="1" height="1" aria-label="選択した表情素材の配置プレビュー"></canvas></div><div class="motion-controls">
  <button id="asset-touch" class="secondary">指で位置を合わせる</button><form id="asset-placement"><div class="coordinate-grid"><label>左端 X（%）<input id="asset-x" type="number" min="0" max="100" step="0.01" required></label><label>上端 Y（%）<input id="asset-y" type="number" min="0" max="100" step="0.01" required></label><label>幅（元画像に対する%）<input id="asset-width" type="number" min="0.01" max="100" step="0.01" required></label><label>高さ（元画像に対する%）<input id="asset-height" type="number" min="0.01" max="100" step="0.01" required></label></div><button id="asset-apply" class="secondary">配置を反映</button></form>
  <button id="asset-download" class="secondary">この素材の元PNGを保存</button><button id="asset-remove" class="secondary">この役割の素材を外す</button><p class="muted">表示は選択した一枚だけです。座標は元画像の左上が0%、右下が100%。はみ出した部分はプレビューの外側に隠れます。初期配置は比率を保って中央に置きます。</p><p class="muted">元画像に描かれた目や口は背景に残っています。この画面は位置合わせ用です。配置は下の合成・開閉プレビューに反映します。元PNG・制作素材ZIP・PSDは変更しません。</p></div></div>`;
  document.querySelector('.expression-panel').after(section);
  const $=s=>section.querySelector(s),canvas=$('#asset-canvas'),ctx=canvas.getContext('2d');
  for(const [id,label] of EXPRESSION_ROLES){const o=document.createElement('option');o.value=id;o.textContent=label;$('#asset-role').append(o);}
  let source=null,asset=null,lastRole='',sourceBitmap=null,assetBitmap=null,renderTicket=0,importTicket=0,importBusy=false,loading=false;
  const assignmentPreview=createMaterialAssignmentPreview({details:$('.asset-result-import'),canvas:$('#asset-result-canvas'),status:$('#asset-result-preview-status'),getSelection:()=>{const state=getState();return {file:state.file,part:(state.results||[]).find(p=>p.ai && p.id===$('#asset-result').value)};}});
  const current=()=>getState().assets.find(a=>a.role===$('#asset-role').value);
  const placementEditor=createAssetPlacementEditor({isLocked:()=>getState().locked || importBusy || loading,onApply:placement=>{const state=getState(),a=current();if(state.locked || importBusy || loading || !a)return false;onChange(state.assets.map(v=>v===a?{...v,placement}:v));$('#asset-status').textContent='配置を反映しました。作業ファイルを保存すると配置も保持できます。';return true;}});
  function release(){placementEditor.close();sourceBitmap?.close();assetBitmap?.close();sourceBitmap=null;assetBitmap=null;ctx.clearRect(0,0,canvas.width,canvas.height);}
  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(sourceBitmap && $('#asset-view').value==='source')ctx.drawImage(sourceBitmap,0,0,canvas.width,canvas.height);
    const p=current()?.placement;
    if(assetBitmap && p)ctx.drawImage(assetBitmap,p.x*canvas.width,p.y*canvas.height,p.width*canvas.width,p.height*canvas.height);
  }
  function controls() {
    const state=getState(),locked=state.locked || importBusy;
    section.hidden=!state.file;
    for(const input of section.querySelectorAll('input,select,button'))input.disabled=!state.file || locked;
    for(const input of $('#asset-placement').querySelectorAll('input,button'))input.disabled=locked || loading || !current();
    $('#asset-touch').disabled=locked || loading || !current() || !sourceBitmap || !assetBitmap;
    if(locked)placementEditor.close();
    $('#asset-download').disabled=locked || !current();$('#asset-remove').disabled=locked || !current();
    const choices=(state.results||[]).filter(p=>p.ai),previous=$('#asset-result').value;
    const options=choices.map(p=>[p.id,`${PART_LABELS[p.id]}${p.manual?'・補正済み':''}${p.signature!==promptSignature(state.prompts?.[p.id])?'・指定変更あり':''}`]);
    const signature=JSON.stringify(options);
    if($('#asset-result').dataset.options!==signature){$('#asset-result').replaceChildren(...options.map(([id,label])=>new Option(label,id)));if(choices.some(p=>p.id===previous))$('#asset-result').value=previous;$('#asset-result').dataset.options=signature;}
    $('#asset-result').disabled=locked || !choices.length;
    $('#asset-use-result').disabled=locked || !choices.length;
    $('#asset-role-advice').textContent=materialRoleAdvice($('#asset-role').value);
    $('#asset-copy-target').textContent=`コピー先：${EXPRESSION_ROLES.find(([id])=>id===$('#asset-role').value)[1]}。${current()?'現在の素材を置き換え、配置を元位置へ戻します。':'この役割へ新しく追加します。'}`;
    assignmentPreview.update();
    $('#asset-use-result').textContent=current()?'選んだ役割の素材を置き換える':'選んだ役割へコピー';
    $('#asset-result-note').textContent=choices.length?'全構成のAI結果が対象です。10 MiB以下。コピー後の素材は独立し、再分離・ブラシ補正で自動更新しません。既存素材を置き換える場合は配置を元位置へ戻し、表示や変形設定は保持します。':'AI分離の結果がまだありません。デモは元位置を保持しないため、この操作の対象外です。';
    $('#asset-inventory').textContent=`読み込み済み ${state.assets.length} / ${EXPRESSION_ROLES.length} 役割：${state.assets.map(a=>EXPRESSION_ROLES.find(([id])=>id===a.role)[1]).join('、')||'なし'}。読込済みでも素材の品質や動作は未確認です。`;
    const a=current();$('#asset-info').textContent=a?`${a.name} · ${a.width} × ${a.height} px`:'この役割の素材はまだありません。';
  }
  function fields() {const p=current()?.placement;for(const k of ['x','y','width','height'])$(`#asset-${k}`).value=p?+(p[k]*100).toFixed(2):'';}
  async function preview(ticket,file,selected) {
    const decoded=[];let full;
    try {
      full=await createImageBitmap(file);if(ticket!==renderTicket)return;
      const ratio=Math.min(1,640/full.width,960/full.height),w=Math.max(1,Math.round(full.width*ratio)),h=Math.max(1,Math.round(full.height*ratio));
      const bg=await createImageBitmap(full,{resizeWidth:w,resizeHeight:h});decoded.push(bg);full.close();full=null;
      if(ticket!==renderTicket)return;
      if(selected) {
        full=await createImageBitmap(selected.blob);if(ticket!==renderTicket)return;
        const s=Math.min(1,640/full.width,960/full.height);
        decoded.push(await createImageBitmap(full,{resizeWidth:Math.max(1,Math.round(full.width*s)),resizeHeight:Math.max(1,Math.round(full.height*s))}));full.close();full=null;
      }
      if(ticket!==renderTicket)return;
      canvas.width=w;canvas.height=h;[sourceBitmap,assetBitmap]=decoded.splice(0);draw();
    } catch(e) {if(ticket===renderTicket)$('#asset-status').textContent=`プレビューを読み込めませんでした。素材は保持しています。${e.message}`;}
    finally {full?.close();decoded.forEach(b=>b.close());if(ticket===renderTicket){loading=false;controls();}}
  }
  function update() {
    const state=getState(),next=current(),role=$('#asset-role').value,changed=source!==state.file || asset?.blob!==next?.blob || lastRole!==role;
    if(source!==state.file){importTicket++;importBusy=false;$('#asset-status').textContent='';}
    if(changed) {
      renderTicket++;release();source=state.file;asset=next;lastRole=role;loading=Boolean(source);fields();
      if(source)void preview(renderTicket,source,next);
    } else if(asset!==next){placementEditor.close();asset=next;fields();draw();}
    controls();
  }
  $('#asset-result').addEventListener('change',()=>controls());
  $('#asset-role').addEventListener('change',()=>{update();fields();draw();});
  $('#asset-view').addEventListener('change',()=>{placementEditor.close();draw();});
  $('#asset-touch').addEventListener('click',()=>{const a=current();if(getState().locked || importBusy || loading || !a || !sourceBitmap || !assetBitmap)return;placementEditor.open({asset:a,sourceBitmap,assetBitmap,sourceVisible:$('#asset-view').value==='source'});});
  $('#asset-open').addEventListener('click',()=>$('#asset-file').click());
  $('#asset-file').addEventListener('change',async event=>{
    const image=event.target.files[0];event.target.value='';const state=getState();if(!image || !state.file || state.locked || importBusy)return;
    const ticket=++importTicket,file=state.file,role=$('#asset-role').value;importBusy=true;onBusy(true);controls();$('#asset-status').textContent='表情素材を確認しています…';
    let bitmap;
    try {
      const next=await readExpressionImage(image);if(ticket!==importTicket || file!==getState().file)return;
      const stateNow=getState();
      if(stateNow.baseBytes+stateNow.assets.filter(a=>a.role!==role).reduce((sum,a)=>sum+a.blob.size,0)+next.blob.size>100*1024*1024-256*1024)throw new Error('作業全体が100 MiBの保存上限に近づいています。読み込む素材を小さくしてください。');
      bitmap=await createImageBitmap(file);const placement=defaultExpressionPlacement(next,bitmap);bitmap.close();bitmap=null;
      if(ticket!==importTicket || file!==getState().file)return;
      if(getState().locked)throw new Error('別の処理が進行中です。完了後に読み込み直してください。');
      onChange([...getState().assets.filter(a=>a.role!==role),{role,...next,placement}]);$('#asset-status').textContent='素材を読み込みました。配置を確認し、作業ファイルを保存してください。';
    } catch(e) {if(ticket===importTicket && file===getState().file)$('#asset-status').textContent=`読み込みに失敗しました。以前の素材は保持しています。${e.message}`;}
    finally {bitmap?.close();if(ticket===importTicket){importBusy=false;onBusy(false);controls();}}
  });
  $('#asset-use-result').addEventListener('click',async()=>{
    const state=getState(),part=(state.results||[]).find(p=>p.id===$('#asset-result').value && p.ai);
    if(!state.file || state.locked || importBusy || !part)return;
    const ticket=++importTicket,file=state.file,role=$('#asset-role').value;
    importBusy=true;onBusy(true);controls();$('#asset-status').textContent='分離結果を表情素材へコピーしています…';
    let bitmap;
    try {
      const next=await readExpressionImage(new File([part.blob],`${part.id}.png`,{type:'image/png'}));
      if(ticket!==importTicket || file!==getState().file)return;
      bitmap=await createImageBitmap(file);
      if(next.width!==bitmap.width || next.height!==bitmap.height)throw new Error('元画像と同じサイズのAI結果が必要です。');
      bitmap.close();bitmap=null;
      if(ticket!==importTicket || file!==getState().file)return;
      const now=getState();if(now.locked || !(now.results||[]).includes(part))throw new Error('分離結果が変更されています。もう一度選んでください。');
      if(now.baseBytes+now.assets.filter(a=>a.role!==role).reduce((sum,a)=>sum+a.blob.size,0)+next.blob.size>100*1024*1024-256*1024)throw new Error('作業全体が100 MiBの保存上限に近づいています。');
      onChange([...now.assets.filter(a=>a.role!==role),{role,...next,placement:{x:0,y:0,width:1,height:1}}]);
      $('#asset-status').textContent=`分離結果をコピーしました。元画像上の位置を保持しています。役割に合う素材か確認し、作業を保存してください。${part.signature!==promptSignature(now.prompts?.[part.id])?'指定変更前の結果です。再確認してください。':''}`;
    } catch(e){if(ticket===importTicket && file===getState().file)$('#asset-status').textContent=`コピーに失敗しました。以前の素材は保持しています。${e.message}`;}
    finally{bitmap?.close();if(ticket===importTicket){importBusy=false;onBusy(false);controls();}}
  });
  $('#asset-placement').addEventListener('submit',event=>{
    event.preventDefault();const state=getState(),a=current();if(state.locked || importBusy || loading || !a || !$('#asset-placement').reportValidity())return;
    const placement=Object.fromEntries(['x','y','width','height'].map(k=>[k,Number($(`#asset-${k}`).value)/100]));
    onChange(state.assets.map(v=>v===a?{...v,placement}:v));$('#asset-status').textContent='配置を反映しました。作業ファイルを保存すると配置も保持できます。';
  });
  $('#asset-remove').addEventListener('click',()=>{if(getState().locked || importBusy)return;onChange(getState().assets.filter(a=>a.role!==$('#asset-role').value));$('#asset-status').textContent='この役割の素材を外しました。';});
  $('#asset-download').addEventListener('click',()=>{
    const a=current();if(!a || getState().locked || importBusy)return;
    const url=URL.createObjectURL(a.blob),link=document.createElement('a');link.href=url;link.download=a.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);
  });
  return {update,cancelPending(){importTicket++;if(importBusy){$('#asset-status').textContent='読み込みを中止しました。以前の素材は保持しています。';importBusy=false;onBusy(false);}controls();}};
}
