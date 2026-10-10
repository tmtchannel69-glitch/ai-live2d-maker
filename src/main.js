import {createWorkflowNavigation} from './workflow-navigation.js';
import {defaultExpressionLayer} from './expression-layer-state.js';
import {createExpressionScene} from './expression-scene.js';
import {createExpressionAssetPanel} from './expression-asset-panel.js';
import {createExpressionPanel} from './expression-panel.js';
import {createMotionPanel} from './motion-panel.js';
import {createPsdExport} from './psd-export.js';
import {createMaterialArchive} from './material-archive.js';
import {createReviewPanel} from './review-panel.js';
import {invalidateReview} from './review-state.js';
import './style.css';
import { TEMPLATES, PART_LABELS, BASIC_IDS, defaultTemplates } from './parts.js';
import { createProjectFile, readProjectFile } from './project-file.js';
import { createBrushEditor } from './brush-editor.js';
import { hasUsablePrompt, promptSignature } from './prompt-state.js';
import { createPromptEditor } from './prompt-editor.js';
import { createPartsArchive } from './archive.js';
import { separateParts } from './separator.js';

const labels=PART_LABELS;
let template='basic',templates=defaultTemplates();
const activeIds=()=>TEMPLATES[template].map(part=>part.id);
const visibleResults=()=>results.filter(part=>activeIds().includes(part.id));
let file = null, sourceUrl = null, results = [], busy = false, controller = null, archiveBusy = false, projectBusy = false, projectVersion = 0;
const app = document.querySelector('#app');
app.innerHTML = `
<header><a class="brand" href="./"><span class="brand-icon">✦</span> AI Live2D <b>Maker</b></a><span class="badge">WORKSPACE / BETA</span></header>
<main>
<section class="intro"><span class="eyebrow">FROM IMAGE TO CHARACTER</span><h1>キャラクターに、<span>動きの第一歩を。</span></h1><p>画像をアップロードして、Live2D 制作のためのパーツを準備しましょう。</p></section>
<div class="steps"><span class="active">01 <b>画像を選択</b></span><i></i><span>02 <b>パーツを分離</b></span><i></i><span>03 <b>ダウンロード</b></span></div>
<section class="project-panel"><div class="project-actions"><button id="save-project" class="secondary" disabled>作業ファイルを保存</button><button id="open-project" class="secondary">作業ファイルを開く</button></div><input id="project-file" type="file" accept=".zip,application/zip" hidden><p class="muted">元画像・すべての指定・反映済みパーツ・確認記録・動きの試作設定・追加した表情素材を端末に保存します。開くと現在の作業を置き換えます。</p><p id="project-status" role="status" aria-live="polite"></p></section>
<div class="workspace">
<section class="panel upload-panel"><div class="panel-title"><h2><span>01</span> キャラクター画像</h2><button id="reset" class="text-button" disabled>リセット</button></div>
<label class="dropzone" id="dropzone" for="file"><div id="upload-hint"><div class="upload-icon">↑</div><h3>キャラクター画像を選択</h3><p>タップして端末の画像を選びます</p><span class="file-note">PNG・JPG・WebP / 最大 10 MB</span><span class="choose-button">画像を選択</span></div><img id="source-preview" hidden alt="アップロードしたキャラクター画像"></label>
<input id="file" type="file" accept="image/png,image/jpeg,image/webp" class="visually-hidden"><p id="file-info" class="muted">背景がシンプルな正面画像がおすすめです</p></section>
<section class="panel settings"><div class="panel-title"><h2><span>02</span> パーツ分離</h2><span class="pill">デモモード</span></div><div class="mode-controls"><label>パーツ構成 <select id="parts-template"><option value="basic">基本の四分類</option><option value="production">制作向け・上半身15項目</option></select></label><label>処理方式 <select id="processing-mode"><option value="demo">デモ（固定領域）</option><option value="ai">AI 試作（点・枠を指定）</option></select></label><button id="edit-prompts" class="secondary" disabled hidden>切り抜く場所を指定</button></div><p id="ai-help" class="muted" hidden>試作サーバーへ画像を送って処理します。第三者の AI サービスへは送りません。外部公開には対応していません。</p><p id="template-help" class="muted" hidden>構成を切り替えても指定と結果は保持します。左右はキャラクター本人の左右（正面では左＝画面右）。使う項目だけ選び、見える領域を指定してください。目の細分化や隠れ部分の描き足しは別工程です。</p><h3>分離するパーツ</h3><p class="muted">書き出したいパーツを選んでください。</p><div class="part-options">${BASIC_IDS.map(id => [id,labels[id]]).map(([id,label]) => `<label class="part-option"><input type="checkbox" value="${id}" checked><span>${label}</span><small>PNG</small></label>`).join('')}</div><div class="notice"><span>✧</span><p>現在は画像を領域ごとに切り出すデモです。<br>AI 試作では残す点・除く点を指定できます。</p></div><button id="separate" class="primary" disabled>✦ パーツを分離する <span>→</span></button><p id="status" role="status" aria-live="polite">まずはキャラクター画像を選択してください</p></section>
</div>
<section class="panel results-panel"><div class="panel-title"><div><h2><span>03</span> 分離結果</h2><p class="muted">表示中の構成のパーツを確認して、PNG 形式でダウンロード。</p></div><div class="result-actions"><span id="count" class="pill">0 PARTS</span><button id="download-all" class="secondary" disabled>まとめて ZIP 保存</button></div></div><div class="material-export"><button id="download-materials" class="secondary" disabled>確認記録付き 制作素材ZIP</button><p class="muted">選択中の項目のPNG・確認記録・不足一覧を保存します。結果なしの項目も一覧に残します。元画像は含みません。作業の再開には「作業ファイルを保存」を使ってください。</p><button id="download-psd" class="secondary" disabled>レイヤー付きPSDを保存（試作）</button><p class="muted">選択中のAI結果を名前付きレイヤーに保存します。結果がない項目は含みません。重なり順は仮の順序です。出力後に画像編集ソフトで確認・調整してください。Cubismでの実読み込みは未検証です。</p><p id="psd-status" role="status" aria-live="polite"></p><p id="material-status" role="status" aria-live="polite"></p></div><div id="results"><div class="empty"><span>▧</span><h3>ここにパーツが表示されます</h3><p>画像を選択して、パーツ分離を実行してください。</p></div></div></section>
<dialog id="part-dialog" aria-labelledby="dialog-title"><div class="dialog-header"><h2 id="dialog-title"></h2><button id="close-dialog" class="secondary">閉じる</button></div><div class="dialog-preview"><img id="dialog-image" alt=""></div><p class="muted">デモの切り出し結果です。AI 分離は未接続です。</p></dialog><footer><span>✦ AI Live2D Maker</span><span>あなたのキャラクターを、次のステージへ。</span></footer>
</main>`;
const $ = selector => document.querySelector(selector);
let editor;
const isAi = () => $('#processing-mode').value === 'ai';
const selected = () => [...document.querySelectorAll('.part-options input:checked')].map(input => input.value);
let brushEditor,reviewPanel,motionPanel,expressionPanel,assetPanel,expressionScene,workflow;
let motion={},expressionAssets=[],expressionLayers={},expressionDeforms={},expressionClips={};
let reviews={},materialBusy=false,assetBusy=false,psdController=null;
function invalidateReviews(ids){for(const id of ids)if(reviews[id])reviews[id]=invalidateReview(reviews[id]);}
const dirty = part => part.ai && part.signature !== promptSignature(editor?.prompts[part.id]);
editor = createPromptEditor({ labels, getSource: () => sourceUrl,
  onChange: () => { updateButton(); renderResults(); updateEditorNote(); },
  onSeparate: id => runSeparation([id], true),
});
brushEditor = createBrushEditor({ labels, getSource: () => file, getCurrent: id => results.find(part => part.id === id),
  onApply: (part, blob) => {
    if (busy || projectBusy || materialBusy || assetBusy || !results.includes(part)) return;
    const updated = { ...part, blob, url: URL.createObjectURL(blob), manual: true };
    reviewPanel.close();invalidateReviews([part.id]);closePreview(); results = results.map(result => result === part ? updated : result);
    URL.revokeObjectURL(part.url); renderResults(); updateButton(); updateEditorNote();
    $('#status').textContent = `${labels[part.id]}のブラシ補正を反映しました。PNG・ZIP に補正後の結果を保存できます。`;
  },
});
reviewPanel=createReviewPanel({labels,getState:()=>({file,sourceUrl,ids:activeIds(),selected:selected(),results,reviews,locked:busy||projectBusy||archiveBusy||materialBusy||assetBusy}),isDirty:dirty,onChange:(id,record)=>{reviews={...reviews,[id]:record};expressionPanel?.update();}});
function updateEditorNote() {
  if (!editor) return;
  const result = results.find(part => part.id === editor.selectedPart);
  editor.setResultNote(result ? dirty(result)
    ? `指定を変更しています。表示中の結果は以前の指定で生成したものです。再分離するまで保持します。${result.manual ? '再分離すると、このパーツのブラシ補正を新しい AI 結果で置き換えます。' : ''}`
    : result.manual ? 'ブラシ補正済みの結果があります。再分離すると、このパーツのブラシ補正を新しい AI 結果で置き換えます。' : '現在の指定で生成した結果があります。'
    : 'このパーツの結果はまだありません。');
}
$('#edit-prompts').addEventListener('click', () => { editor.open(); updateEditorNote(); });
motionPanel=createMotionPanel({labels,getState:()=>({file,results:visibleResults(),selected:selected(),settings:motion,locked:busy || projectBusy || archiveBusy || materialBusy || assetBusy}),onChange:(id,setting)=>{motion={...motion,[id]:setting};},isDirty:dirty});
expressionPanel=createExpressionPanel({getState:()=>({file,results,prompts:editor.prompts,reviews,assets:expressionAssets,layers:expressionLayers,deforms:expressionDeforms,clips:expressionClips,locked:busy || projectBusy || archiveBusy || materialBusy || assetBusy}),onPrepare:ids=>{
  if(!file || busy || projectBusy || archiveBusy || materialBusy || assetBusy)return;
  rememberTemplate();reviewPanel.close();brushEditor.close();editor.clearView();closePreview();
  template='production';templates.production.selected=TEMPLATES.production.map(p=>p.id).filter(id=>templates.production.selected.includes(id) || ids.includes(id));
  renderPartChoices();renderResults();updateEditorNote();updateButton();updateSelectionStatus();
}});
assetPanel=createExpressionAssetPanel({onBusy:value=>{assetBusy=value;updateButton();},getState:()=>({file,assets:expressionAssets,baseBytes:(file?.size||0)+results.reduce((sum,p)=>sum+p.blob.size,0),locked:busy || projectBusy || archiveBusy || materialBusy}),onChange:assets=>{
  if(busy || projectBusy || archiveBusy || materialBusy)return;
  expressionAssets=assets;expressionLayers=Object.fromEntries(Object.entries(expressionLayers).filter(([role])=>assets.some(a=>a.role===role)));expressionDeforms=Object.fromEntries(Object.entries(expressionDeforms).filter(([role])=>assets.some(a=>a.role===role)));expressionClips=Object.fromEntries(Object.entries(expressionClips).filter(([role])=>assets.some(a=>a.role===role)));assetPanel.update();expressionPanel.update();expressionScene?.update();
}});
expressionScene=createExpressionScene({getState:()=>({file,assets:expressionAssets,layers:expressionLayers,deforms:expressionDeforms,clips:expressionClips,locked:busy || projectBusy || archiveBusy || materialBusy || assetBusy}),onChange:(role,setting)=>{
  if(busy || projectBusy || archiveBusy || materialBusy || assetBusy)return;
  expressionLayers={...expressionLayers,[role]:setting};expressionScene.update();expressionPanel.update();
},onClip:(role,setting)=>{
  if(busy || projectBusy || archiveBusy || materialBusy || assetBusy)return;
  expressionClips={...expressionClips};if(setting)expressionClips[role]=setting;else delete expressionClips[role];
  expressionScene.update();
},onDeform:(role,setting)=>{
  if(busy || projectBusy || archiveBusy || materialBusy || assetBusy)return;
  if(setting){expressionDeforms={...expressionDeforms,[role]:setting};expressionLayers={...expressionLayers,[role]:{...(expressionLayers[role]||defaultExpressionLayer(role)),condition:'always'}};}
  else {expressionDeforms={...expressionDeforms};delete expressionDeforms[role];}
  expressionScene.update();expressionPanel.update();
}});
workflow=createWorkflowNavigation({getState:()=>({file,resultCount:results.length,assetCount:expressionAssets.length})});
function rememberTemplate() {templates[template]={mode:$('#processing-mode').value,selected:selected()};}
function renderPartChoices() {
  const parts=TEMPLATES[template],groups=template==='basic'?['']: [...new Set(parts.map(part=>part.group))];
  $('.part-options').innerHTML=groups.map(group=>`${group?`<h4 class="part-group">${group}</h4>`:''}${parts.filter(part=>!group || part.group===group).map(({id,name})=>`<label class="part-option"><input type="checkbox" value="${id}"${templates[template].selected.includes(id)?' checked':''}><span>${name}</span><small>PNG</small></label>`).join('')}`).join('');
  editor.setParts(activeIds());$('#parts-template').value=template;$('#processing-mode').value=templates[template].mode;renderMode();
}
function renderMode() {
  $('#template-help').hidden=template!=='production';
  $('#processing-mode option[value="demo"]').disabled=template==='production';
  $('#edit-prompts').hidden = !isAi(); $('#ai-help').hidden = !isAi();
  $('.settings .pill').textContent = isAi() ? 'AI 試作' : 'デモモード';
  $('.notice p').textContent = isAi() ? '残す点・除く点を複数指定できます。枠との組み合わせも可能です。見えている部分を切り抜きます。' : '現在は画像を領域ごとに切り出すデモです。AI 試作も選択できます。';
}
$('#processing-mode').addEventListener('change', () => {
  controller?.abort();busy=false;invalidateReviews(activeIds());clearResults(activeIds());rememberTemplate();renderMode();updateButton();updateSelectionStatus();
});
$('#parts-template').addEventListener('change',()=>{
  rememberTemplate();reviewPanel.close();brushEditor.close();editor.clearView?.();closePreview();
  template=$('#parts-template').value;renderPartChoices();renderResults();updateEditorNote();updateButton();updateSelectionStatus();
});
function updateSelectionStatus() {
  if (busy) return;
  if (!file) { $('#status').textContent = 'まずはキャラクター画像を選択してください'; return; }
  if (!selected().length) { $('#status').textContent = '少なくとも 1 個のパーツを選択してください。'; return; }
  const missing = selected().filter(id => !hasUsablePrompt(editor.prompts[id]));
  $('#status').textContent = isAi() && missing.length
    ? `残す点または枠を指定してください：${missing.map(id => labels[id]).join('、')}`
    : visibleResults().some(dirty) ? '指定を変更したパーツがあります。表示中の以前の結果を更新するには再分離してください。'
    : visibleResults().length ? '表示中の結果を確認・保存できます。選択変更は次の分離に反映されます。' : '準備ができました。分離を実行してください。';
}
function closePreview() { $('#part-dialog').close(); $('#dialog-image').removeAttribute('src'); }
$('#close-dialog').addEventListener('click', closePreview);
$('#part-dialog').addEventListener('click', event => {
  if (event.target === $('#part-dialog')) {
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closePreview();
  }
});
function clearResults(ids=null) {
  reviewPanel?.close();brushEditor?.close();closePreview();
  results.filter(part=>!ids || ids.includes(part.id)).forEach(part=>URL.revokeObjectURL(part.url));
  results=ids?results.filter(part=>!ids.includes(part.id)):[];renderResults();
}
function renderResults() {
  expressionScene?.update();
  assetPanel?.update();
  motionPanel?.update();
  expressionPanel?.update();
  reviewPanel?.update();
  const shown=visibleResults();
  $('#count').textContent = `${shown.length} PARTS`;
  $('#download-all').disabled = !visibleResults().length || busy || projectBusy || archiveBusy || assetBusy;
  if (!shown.length) {
    $('#results').innerHTML = '<div class="empty"><span>▧</span><h3>ここにパーツが表示されます</h3><p>画像を選択して、パーツ分離を実行してください。</p></div>'; return;
  }
  const grid = document.createElement('div'); grid.className = 'result-grid';
  for (const part of shown) {
    const card = document.createElement('article'); card.className = 'result-card'; card.dataset.part = part.id;
    const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'part-preview';
    preview.setAttribute('aria-label', `${labels[part.id]}を拡大表示`);
    preview.addEventListener('click', () => {
      $('#dialog-title').textContent = `${labels[part.id]}のプレビュー`;
      $('#dialog-image').src = part.url; $('#dialog-image').alt = `${labels[part.id]}の${part.ai ? 'AI 試作' : 'デモ切り出し'}結果`;
      $('#part-dialog .muted').textContent = part.ai ? `${dirty(part) ? '以前の指定の結果です。' : ''}AI 試作の結果です。隠れた部分の補完は行っていません。` : 'デモの切り出し結果です。';
      $('#part-dialog').showModal();
    });
    const img = document.createElement('img'); img.src = part.url; img.alt = `${labels[part.id]}の${part.ai ? 'AI 試作' : 'デモ切り出し'}結果`; preview.append(img);
    const row = document.createElement('div'); row.className = 'result-caption';
    const title = document.createElement('strong'); title.textContent = labels[part.id];
    const link = document.createElement('a'); link.href = part.url; link.download = part.name; link.textContent = '↓ PNG'; link.setAttribute('aria-label', `${labels[part.id]}をダウンロード`);
    row.append(title,link); card.append(preview,row);
    if (part.ai) {
      const state = document.createElement('p'); state.className = `result-state${dirty(part) ? ' stale' : ''}`;
      state.textContent = `${dirty(part) ? '指定変更あり・以前の結果' : '現在の指定の結果'}${part.manual ? '・ブラシ補正済み' : ''}`;
      const edit = document.createElement('button'); edit.className = 'secondary correct-part'; edit.textContent = `${labels[part.id]}を修正`; edit.disabled = busy || projectBusy;
      edit.addEventListener('click', () => { editor.open(part.id); updateEditorNote(); });
      const brush = document.createElement('button'); brush.className = 'secondary brush-part'; brush.textContent = `${labels[part.id]}をブラシで補正`; brush.disabled = busy || projectBusy;
      brush.addEventListener('click', () => brushEditor.open(part));
      card.append(state,edit,brush);
    }
    grid.append(card);
  }
  $('#results').replaceChildren(grid);
}
function updateButton() {
  expressionScene?.update();
  assetPanel?.update();
  motionPanel?.update();
  expressionPanel?.update();
  reviewPanel?.update();
  const locked=busy || projectBusy || materialBusy || assetBusy;
  $('#download-materials').disabled=!file || !selected().length || locked || archiveBusy;
  $('#download-psd').disabled=!file || !isAi() || !visibleResults().some(part=>part.ai && selected().includes(part.id)) || locked || archiveBusy;
  $('#save-project').disabled=!file || locked || archiveBusy;
  $('#open-project').disabled=locked || archiveBusy;
  $('#parts-template').disabled=locked || archiveBusy;
  $('#download-all').disabled = !visibleResults().length || busy || projectBusy || archiveBusy || assetBusy;
  const stage = visibleResults().length && !busy ? 2 : file ? 1 : 0;
  document.querySelectorAll('.steps > span').forEach((step, index) => {
    step.classList.toggle('active', index === stage);
    if (index === stage) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
  });
  document.querySelectorAll('.part-options input').forEach(input => { input.disabled = locked; });
  document.querySelectorAll('.correct-part,.brush-part').forEach(button => { button.disabled = locked; });
  $('#edit-prompts').disabled = !file || locked; $('#processing-mode').disabled = locked;
  $('#separate').disabled = locked || !file || !selected().length || (isAi() && selected().some(id => !hasUsablePrompt(editor?.prompts[id])));
  $('#separate').textContent = busy ? '処理中…' : isAi() ? '✦ AI でパーツを分離する →' : '✦ パーツを分離する →';
  workflow?.update();
  $('.settings').setAttribute('aria-busy', String(busy)); editor?.setBusy(locked); editor?.setRunEnabled(isAi());
}
let uploadVersion = 0;
function cancelProjectOperation() {assetPanel?.cancelPending();psdController?.abort();$('#psd-status').textContent='';$('#material-status').textContent='';projectVersion++;projectBusy=false;$('#project-status').textContent='';updateButton();}
async function loadFile(next) {
  cancelProjectOperation();
  const version = ++uploadVersion;
  if (!next) return;
  if (!['image/png','image/jpeg','image/webp'].includes(next.type) || next.size > 10*1024*1024) {
    $('#status').textContent = '10 MB 以下の PNG・JPG・WebP を選択してください。'; return;
  }
  try {
    const decoded = await createImageBitmap(next);
    const dimensions = `${decoded.width} × ${decoded.height}`;
    const tooLarge = decoded.width>4096 || decoded.height>4096 || decoded.width*decoded.height>16_000_000;
    decoded.close(); if (version !== uploadVersion) return;
    if (tooLarge) { $('#status').textContent = '画像が大きすぎます。各辺 4096 px 以下・1600 万画素以下に縮小してから選択してください。現在の画像と結果は保持しています。'; return; }
    controller?.abort(); busy=false;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    reviews={};motion={};expressionAssets=[];expressionLayers={};expressionDeforms={};expressionClips={};clearResults(); editor.clear(); file=next; sourceUrl=URL.createObjectURL(next);
    $('#source-preview').src=sourceUrl; $('#source-preview').hidden=false; $('#upload-hint').hidden=true;
    $('#file-info').textContent=`${next.name} · ${dimensions}`; $('#reset').disabled=false;
    updateSelectionStatus(); updateButton();
  } catch { if (version===uploadVersion) $('#status').textContent='画像を読み込めませんでした。別の画像を選択してください。'; }
}
$('#file').addEventListener('change', event => { loadFile(event.target.files[0]); event.target.value=''; });
$('#dropzone').addEventListener('dragover', event => { event.preventDefault(); $('#dropzone').classList.add('dragging'); });
$('#dropzone').addEventListener('dragleave', () => $('#dropzone').classList.remove('dragging'));
$('#dropzone').addEventListener('drop', event => { event.preventDefault(); $('#dropzone').classList.remove('dragging'); loadFile(event.dataTransfer.files[0]); });
$('.part-options').addEventListener('change', () => {rememberTemplate();updateButton();updateSelectionStatus();});
$('#reset').addEventListener('click', () => {
  cancelProjectOperation();uploadVersion++; controller?.abort(); busy=false; file=null;reviews={};motion={};expressionAssets=[];expressionLayers={};expressionDeforms={};expressionClips={}; editor.clear();
  if (sourceUrl) URL.revokeObjectURL(sourceUrl); sourceUrl=null;
  $('#source-preview').hidden=true; $('#source-preview').removeAttribute('src'); $('#upload-hint').hidden=false;
  $('#file-info').textContent='背景がシンプルな正面画像がおすすめです';
  $('#reset').disabled=true; clearResults(); updateButton(); $('#status').textContent='まずはキャラクター画像を選択してください';
});
async function runSeparation(ids, partial = false) {
  const aiRun = isAi();
  if (busy || projectBusy || materialBusy || assetBusy || !file || !ids.length || (aiRun && ids.some(id => !hasUsablePrompt(editor.prompts[id])))) return;
  brushEditor.close();
  const snapshot = editor.prompts, requestFile = file;
  const current=new AbortController(); controller=current; busy=true; updateButton();
  const message=aiRun ? `${partial ? labels[ids[0]]+'だけを再分離しています。' : ''}CPU で AI 処理中です。初回は時間がかかります…` : 'デモの切り出し処理を実行しています…';
  $('#status').textContent=message; editor.setStatus(message);
  try {
    const parts=await separateParts({file:requestFile,parts:ids,signal:current.signal,mode:aiRun?'ai':'demo',prompts:snapshot,onProgress:(done,total)=>{if(controller===current&&!current.signal.aborted){const progress=`AI 処理：${done} / ${total} パーツ。全処理の成功後に結果を更新します。`;$('#status').textContent=progress;editor.setStatus(progress);}}});
    if (current.signal.aborted || controller!==current || file!==requestFile) return;
    const replacements=parts.map(part => ({...part,ai:aiRun,signature:promptSignature(snapshot[part.id]),url:URL.createObjectURL(part.blob)}));
    closePreview();
    const replaced=new Set(partial?ids:activeIds());
    reviewPanel.close();invalidateReviews([...replaced]);
    const retained=results.filter(part=>!replaced.has(part.id));
    results.filter(part=>replaced.has(part.id)).forEach(part=>URL.revokeObjectURL(part.url));
    results=[...retained,...replacements].sort((a,b)=>Object.keys(labels).indexOf(a.id)-Object.keys(labels).indexOf(b.id));
    renderResults(); updateEditorNote();
    const complete=partial ? `${labels[ids[0]]}だけを更新しました。他のパーツは保持しています。` : `${visibleResults().length} 個の${aiRun?'AI 試作':'デモ'}パーツを生成しました。下の結果からダウンロードできます。`;
    $('#status').textContent=complete; editor.setStatus(complete);
  } catch(error) {
    if (!current.signal.aborted && controller===current) {
      const failed=`分離に失敗しました。${results.length?'以前の結果は保持しています。':''}もう一度お試しください。${error.message||''}`;
      $('#status').textContent=failed; editor.setStatus(failed);
    }
  } finally { if (controller===current) { busy=false; updateButton(); } }
}
$('#separate').addEventListener('click', () => { if (!$('#separate').disabled) runSeparation(selected()); });
$('#download-all').addEventListener('click', async () => {
  if (archiveBusy || busy || projectBusy || assetBusy || !visibleResults().length) return;
  const snapshotAll=results,snapshot=visibleResults();archiveBusy=true; updateButton(); $('#download-all').textContent='ZIP を準備中…';
  try {
    const blob=await createPartsArchive(snapshot); if(snapshotAll!==results)return;
    const url=URL.createObjectURL(blob), link=document.createElement('a'); link.href=url; link.download='character-parts.zip';
    document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),60_000);
    $('#status').textContent=`${snapshot.length} 個のパーツをまとめた ZIP の保存を開始しました。${snapshot.some(dirty)?'指定変更前の結果も含みます。':''}`;
  } catch { if(snapshotAll===results) $('#status').textContent='ZIP の作成に失敗しました。もう一度お試しください。個別 PNG 保存も利用できます。'; }
  finally { archiveBusy=false; $('#download-all').textContent='まとめて ZIP 保存'; updateButton(); }
});
$('#download-materials').addEventListener('click',async()=>{
  if(!file || !selected().length || busy || projectBusy || archiveBusy || materialBusy || assetBusy)return;
  brushEditor.close();editor.clearView();reviewPanel.close();
  const version=uploadVersion,snapshotResults=results,snapshot={file,template,mode:$('#processing-mode').value,selected:selected(),prompts:editor.prompts,results:[...results],reviews:structuredClone(reviews)};
  const isCurrent=()=>version===uploadVersion && file===snapshot.file && results===snapshotResults;
  materialBusy=true;archiveBusy=true;updateButton();$('#material-status').textContent='制作素材ZIPを準備しています…';
  try {
    const blob=await createMaterialArchive(snapshot);if(!isCurrent())return;
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='ai-live2d-materials.zip';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);
    const exported=snapshot.results.filter(part=>snapshot.selected.includes(part.id)).length;
    $('#material-status').textContent=`選択中${snapshot.selected.length}項目の確認記録とPNG ${exported}個の保存を開始しました。PNGなし${snapshot.selected.length-exported}項目も一覧に含みます。`;
  } catch(error) {if(isCurrent())$('#material-status').textContent=`制作素材ZIPの作成に失敗しました。現在の作業は保持しています。${error.message}`;}
  finally {materialBusy=false;archiveBusy=false;updateButton();}
});
$('#download-psd').addEventListener('click',async()=>{
  if($('#download-psd').disabled)return;
  brushEditor.close();editor.clearView();reviewPanel.close();
  const snapshot={file,template,selected:selected(),results:visibleResults().map(({id,ai,blob})=>({id,ai,blob}))},version=uploadVersion;
  const current=new AbortController();psdController=current;
  const isCurrent=()=>!current.signal.aborted && file===snapshot.file && version===uploadVersion;
  materialBusy=true;archiveBusy=true;updateButton();$('#psd-status').textContent='PSDを準備しています…';
  try {
    const blob=await createPsdExport(snapshot,{signal:current.signal,onProgress:message=>{if(isCurrent())$('#psd-status').textContent=message;}});
    if(!isCurrent())return;
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='ai-live2d-parts.psd';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);
    const chosen=visibleResults().filter(part=>snapshot.selected.includes(part.id));
    $('#psd-status').textContent=`${chosen.length}レイヤーのPSDの保存を開始しました。結果なし${snapshot.selected.length-chosen.length}項目は含みません。${chosen.some(dirty)?'指定変更前の結果を含みます。再分離・再確認が必要です。':''}重なり順と色を画像編集ソフトで確認してください。`;
  } catch(error) {if(isCurrent())$('#psd-status').textContent=`PSDの作成に失敗しました。現在の作業は保持しています。${error.message}`;}
  finally {if(psdController===current){psdController=null;materialBusy=false;archiveBusy=false;updateButton();}}
});
$('#open-project').addEventListener('click',()=>$('#project-file').click());
$('#save-project').addEventListener('click',async()=>{
  if(!file || busy || projectBusy || archiveBusy || assetBusy)return;
  rememberTemplate();
  const ticket=++projectVersion,snapshot={file,mode:$('#processing-mode').value,selected:selected(),prompts:editor.prompts,results,template,templates:structuredClone(templates),reviews:structuredClone(reviews),motion:structuredClone(motion),expressions:expressionAssets.map(a=>({...a,placement:{...a.placement}})),expressionLayers:structuredClone(expressionLayers),expressionDeforms:structuredClone(expressionDeforms),expressionClips:structuredClone(expressionClips)};
  projectBusy=true;updateButton();$('#project-status').textContent='作業ファイルを準備しています…';
  try {
    const blob=await createProjectFile(snapshot);if(ticket!==projectVersion)return;
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='ai-live2d-work.zip';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);
    $('#project-status').textContent='作業ファイルの保存を開始しました。ダウンロードしたファイルを保管してください。';
  } catch(error) {if(ticket===projectVersion)$('#project-status').textContent=`保存に失敗しました。現在の作業は保持しています。${error.message}`;}
  finally {if(ticket===projectVersion){projectBusy=false;updateButton();}}
});
$('#project-file').addEventListener('change',async event=>{
  const next=event.target.files[0];event.target.value='';if(!next || busy || projectBusy || archiveBusy || assetBusy)return;
  const ticket=++projectVersion;uploadVersion++;projectBusy=true;updateButton();$('#project-status').textContent='作業ファイルを確認しています…';
  try {
    const restored=await readProjectFile(next);if(ticket!==projectVersion)return;
    const nextUrls=[];
    try {
      const nextSource=URL.createObjectURL(restored.file);nextUrls.push(nextSource);
      const nextResults=restored.results.map(part=>{const url=URL.createObjectURL(part.blob);nextUrls.push(url);return{...part,url};});
      controller?.abort();busy=false;clearResults();editor.clear();
      if(sourceUrl)URL.revokeObjectURL(sourceUrl);
      file=restored.file;sourceUrl=nextSource;results=nextResults;reviews=restored.reviews;motion=restored.motion;expressionAssets=restored.expressions;expressionLayers=restored.expressionLayers;expressionDeforms=restored.expressionDeforms;expressionClips=restored.expressionClips;
      template=restored.template;templates=restored.templates;renderPartChoices();
      $('#source-preview').src=sourceUrl;$('#source-preview').hidden=false;$('#upload-hint').hidden=true;
      $('#file-info').textContent=`${file.name} · ${restored.dimensions.width} × ${restored.dimensions.height}`;$('#reset').disabled=false;
      editor.restore(restored.prompts);renderResults();updateEditorNote();updateSelectionStatus();
    } catch(error) {nextUrls.forEach(url=>URL.revokeObjectURL(url));throw error;}
    $('#project-status').textContent='作業を再開しました。元画像・指定・反映済みパーツを復元しています。';
  } catch(error) {if(ticket===projectVersion)$('#project-status').textContent=`読み込みに失敗しました。現在の作業は保持しています。${error.message}`;}
  finally {if(ticket===projectVersion){projectBusy=false;updateButton();}}
});
document.querySelector('#prompt-dialog').addEventListener('close', updateSelectionStatus);
document.querySelector('#prompt-part').addEventListener('change', updateEditorNote);
renderPartChoices();updateButton();
