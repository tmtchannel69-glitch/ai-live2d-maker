import './style.css';
import { createPartsArchive } from './archive.js';
import { separateParts } from './separator.js';

const labels = { hair: '髪', face: '顔', body: '体・衣装', eyes: '目' };
let file = null, sourceUrl = null, results = [], busy = false, controller = null, archiveBusy = false;
const app = document.querySelector('#app');
app.innerHTML = `
<header><a class="brand" href="./"><span class="brand-icon">✦</span> AI Live2D <b>Maker</b></a><span class="badge">WORKSPACE / BETA</span></header>
<main>
<section class="intro"><span class="eyebrow">FROM IMAGE TO CHARACTER</span><h1>キャラクターに、<span>動きの第一歩を。</span></h1><p>画像をアップロードして、Live2D 制作のためのパーツを準備しましょう。</p></section>
<div class="steps"><span class="active">01 <b>画像を選択</b></span><i></i><span>02 <b>パーツを分離</b></span><i></i><span>03 <b>ダウンロード</b></span></div>
<div class="workspace">
<section class="panel upload-panel"><div class="panel-title"><h2><span>01</span> キャラクター画像</h2><button id="reset" class="text-button" disabled>リセット</button></div>
<label class="dropzone" id="dropzone" for="file"><div id="upload-hint"><div class="upload-icon">↑</div><h3>画像をここにドロップ</h3><p>またはタップして画像を選択</p><span class="file-note">PNG・JPG・WebP / 最大 10 MB</span><span class="choose-button">画像を選択</span></div><img id="source-preview" hidden alt="アップロードしたキャラクター画像"></label>
<input id="file" type="file" accept="image/png,image/jpeg,image/webp" class="visually-hidden"><p id="file-info" class="muted">背景がシンプルな正面画像がおすすめです</p></section>
<section class="panel settings"><div class="panel-title"><h2><span>02</span> パーツ分離</h2><span class="pill">デモモード</span></div><h3>分離するパーツ</h3><p class="muted">書き出したいパーツを選んでください。</p><div class="part-options">${Object.entries(labels).map(([id,label]) => `<label class="part-option"><input type="checkbox" value="${id}" checked><span>${label}</span><small>PNG</small></label>`).join('')}</div><div class="notice"><span>✧</span><p>現在は画像を領域ごとに切り出すデモです。<br>AI による自動分離は、今後接続予定です。</p></div><button id="separate" class="primary" disabled>✦ パーツを分離する <span>→</span></button><p id="status" role="status" aria-live="polite">まずはキャラクター画像を選択してください</p></section>
</div>
<section class="panel results-panel"><div class="panel-title"><div><h2><span>03</span> 分離結果</h2><p class="muted">パーツを確認して、PNG 形式でダウンロード。</p></div><div class="result-actions"><span id="count" class="pill">0 PARTS</span><button id="download-all" class="secondary" disabled>まとめて ZIP 保存</button></div></div><div id="results"><div class="empty"><span>▧</span><h3>ここにパーツが表示されます</h3><p>画像を選択して、パーツ分離を実行してください。</p></div></div></section>
<dialog id="part-dialog" aria-labelledby="dialog-title"><div class="dialog-header"><h2 id="dialog-title"></h2><button id="close-dialog" class="secondary">閉じる</button></div><div class="dialog-preview"><img id="dialog-image" alt=""></div><p class="muted">デモの切り出し結果です。AI 分離は未接続です。</p></dialog><footer><span>✦ AI Live2D Maker</span><span>あなたのキャラクターを、次のステージへ。</span></footer>
</main>`;
const $ = selector => document.querySelector(selector);
function closePreview() {
  $('#part-dialog').close(); $('#dialog-image').removeAttribute('src');
}
$('#close-dialog').addEventListener('click', closePreview);
$('#part-dialog').addEventListener('click', event => {
  if (event.target === $('#part-dialog')) {
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closePreview();
  }
});
function clearResults() {
  closePreview();
  results.forEach(part => URL.revokeObjectURL(part.url)); results = [];
  $('#count').textContent = '0 PARTS'; $('#download-all').disabled = true;
  $('#results').innerHTML = '<div class="empty"><span>▧</span><h3>ここにパーツが表示されます</h3><p>画像を選択して、パーツ分離を実行してください。</p></div>';
}
function updateButton() {
  $('#download-all').disabled = !results.length || busy || archiveBusy;
  const stage = results.length && !busy ? 2 : file ? 1 : 0;
  document.querySelectorAll('.steps > span').forEach((step, index) => {
    step.classList.toggle('active', index === stage);
    if (index === stage) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
  });
  document.querySelectorAll('.part-options input').forEach(input => { input.disabled = busy; });
  $('#separate').disabled = busy || !file || !$('.part-options input:checked');
  $('#separate').textContent = busy ? '処理中…' : '✦ パーツを分離する →';
  $('.settings').setAttribute('aria-busy', String(busy));
}
let uploadVersion = 0;
async function loadFile(next) {
  const version = ++uploadVersion;
  if (!next) return;
  if (!['image/png','image/jpeg','image/webp'].includes(next.type) || next.size > 10 * 1024 * 1024) {
    $('#status').textContent = '10 MB 以下の PNG・JPG・WebP を選択してください。'; return;
  }
  try {
    const decoded = await createImageBitmap(next);
    const dimensions = `${decoded.width} × ${decoded.height}`;
    const tooLarge = decoded.width > 4096 || decoded.height > 4096 || decoded.width * decoded.height > 16_000_000;
    decoded.close();
    if (version !== uploadVersion) return;
    if (tooLarge) { $('#status').textContent = '画像が大きすぎます。各辺 4096 px 以下・1600 万画素以下に縮小してから選択してください。現在の画像と結果は保持しています。'; return; }
    controller?.abort(); busy = false;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    clearResults(); file = next; sourceUrl = URL.createObjectURL(next);
    $('#source-preview').src = sourceUrl; $('#source-preview').hidden = false;
    $('#upload-hint').hidden = true;
    $('#file-info').textContent = `${next.name} · ${dimensions}`;
    $('#reset').disabled = false;
    $('#status').textContent = '準備ができました。分離するパーツを選択してください。';
    updateButton();
  } catch { if (version === uploadVersion) $('#status').textContent = '画像を読み込めませんでした。別の画像を選択してください。'; }
}
$('#file').addEventListener('change', event => { loadFile(event.target.files[0]); event.target.value = ''; });
$('#dropzone').addEventListener('dragover', event => { event.preventDefault(); $('#dropzone').classList.add('dragging'); });
$('#dropzone').addEventListener('dragleave', () => $('#dropzone').classList.remove('dragging'));
$('#dropzone').addEventListener('drop', event => { event.preventDefault(); $('#dropzone').classList.remove('dragging'); loadFile(event.dataTransfer.files[0]); });
$('.part-options').addEventListener('change', () => {
  updateButton();
  $('#status').textContent = $('.part-options input:checked')
    ? (results.length ? '選択変更は次の分離に反映されます。表示中の結果を更新するには再実行してください。' : '分離するパーツを選択して実行してください。')
    : '少なくとも 1 個のパーツを選択してください。';
});
$('#reset').addEventListener('click', () => {
  uploadVersion++; controller?.abort(); busy = false; file = null;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl); sourceUrl = null;
  $('#source-preview').hidden = true; $('#source-preview').removeAttribute('src'); $('#upload-hint').hidden = false;
  $('#file-info').textContent = '背景がシンプルな正面画像がおすすめです';
  $('#reset').disabled = true; clearResults(); updateButton();
  $('#status').textContent = 'まずはキャラクター画像を選択してください';
});
$('#separate').addEventListener('click', async () => {
  if (busy || !file) return;
  const current = new AbortController(); controller = current; busy = true; updateButton();
  $('#status').textContent = 'デモの切り出し処理を実行しています…';
  try {
    const parts = await separateParts({ file, parts: [...document.querySelectorAll('.part-options input:checked')].map(input => input.value), signal: current.signal });
    if (current.signal.aborted) return;
    clearResults(); results = parts.map(part => ({ ...part, url: URL.createObjectURL(part.blob) }));
    const grid = document.createElement('div'); grid.className = 'result-grid';
    for (const part of results) {
      const card = document.createElement('article'); card.className = 'result-card';
      const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'part-preview';
      preview.setAttribute('aria-label', `${labels[part.id]}を拡大表示`);
      preview.addEventListener('click', () => {
        $('#dialog-title').textContent = `${labels[part.id]}のプレビュー`;
        $('#dialog-image').src = part.url; $('#dialog-image').alt = `${labels[part.id]}のデモ切り出し結果`;
        $('#part-dialog').showModal();
      });
      const img = document.createElement('img'); img.src = part.url; img.alt = `${labels[part.id]}のデモ切り出し結果`; preview.append(img);
      const row = document.createElement('div'); row.className = 'result-caption';
      const title = document.createElement('strong'); title.textContent = labels[part.id];
      const link = document.createElement('a'); link.href = part.url; link.download = part.name; link.textContent = '↓ PNG'; link.setAttribute('aria-label', `${labels[part.id]}をダウンロード`);
      row.append(title,link); card.append(preview,row); grid.append(card);
    }
    $('#results').replaceChildren(grid); $('#count').textContent = `${results.length} PARTS`;
    $('#status').textContent = `${results.length} 個のデモパーツを生成しました。下の結果からダウンロードできます。`;
  } catch (error) {
    if (!current.signal.aborted) $('#status').textContent = `分離に失敗しました。もう一度お試しください。${error.message || ''}`;
  } finally { if (controller === current) { busy = false; updateButton(); } }
});

$('#download-all').addEventListener('click', async () => {
  if (archiveBusy || busy || !results.length) return;
  const snapshot = results; archiveBusy = true; updateButton();
  $('#download-all').textContent = 'ZIP を準備中…';
  try {
    const blob = await createPartsArchive(snapshot);
    if (snapshot !== results) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'character-parts.zip';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    $('#status').textContent = `${snapshot.length} 個のパーツをまとめた ZIP の保存を開始しました。`;
  } catch {
    if (snapshot === results) $('#status').textContent = 'ZIP の作成に失敗しました。もう一度お試しください。個別 PNG 保存も利用できます。';
  } finally { archiveBusy = false; $('#download-all').textContent = 'まとめて ZIP 保存'; updateButton(); }
});
updateButton();
