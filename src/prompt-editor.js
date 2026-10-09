import { createPromptState, hasUsablePrompt, MAX_POINTS } from './prompt-state.js';

export function createPromptEditor({ labels, getSource, onChange, onSeparate }) {
  let start = null, busy = false, runEnabled = false, resultNote = '';
  const dialog = document.createElement('dialog'); dialog.id = 'prompt-dialog';
  dialog.setAttribute('aria-labelledby', 'prompt-title');
  dialog.innerHTML = `<div class="dialog-header"><h2 id="prompt-title">切り抜く場所を指定</h2><button type="button" class="secondary" id="close-prompts">閉じる</button></div>
    <p class="muted">残す部分には ＋、混ざった部分には − の点を置きます。枠と点を組み合わせられます。隠れた部分は描き足しません。</p>
    <div class="prompt-controls"><label>対象 <select id="prompt-part">${Object.entries(labels).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
    <label>指定方法 <select id="prompt-kind"><option value="point">＋ 残す点（タップ）</option><option value="exclude">− 除く点（タップ）</option><option value="box">枠（ドラッグ）</option></select></label></div>
    <div class="prompt-image"><img alt="切り抜く場所を指定する元画像" draggable="false"><svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="画像上で切り抜く場所を指定"></svg></div>
    <div class="prompt-controls"><button type="button" id="undo-prompt" class="secondary">一つ戻す</button><button type="button" id="redo-prompt" class="secondary">やり直す</button><button type="button" id="clear-prompt" class="secondary">この指定を消す</button></div>
    <details><summary>数値で指定（キーボード操作）</summary><form id="coordinate-form"><div class="coordinate-grid">
      <label>X / 左 % <input name="x" type="number" min="0" max="100" step="0.1" value="50" required></label>
      <label>Y / 上 % <input name="y" type="number" min="0" max="100" step="0.1" value="50" required></label>
      <label>右 %（枠）<input name="right" type="number" min="0" max="100" step="0.1" value="75" required></label>
      <label>下 %（枠）<input name="bottom" type="number" min="0" max="100" step="0.1" value="75" required></label></div><button class="secondary">数値を反映</button></form></details>
    <p id="prompt-summary" role="status" aria-live="polite"></p><p id="prompt-result-note" class="muted"></p><button type="button" id="separate-one" class="primary">このパーツを再分離</button><p id="prompt-run-status" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const part = () => $('#prompt-part').value;
  const state = createPromptState(() => { render(); onChange(); });
  function render() {
    const prompt = state.prompts[part()] || {};
    const shapes = [];
    for (const point of prompt.points || []) {
      const x = point.x * 1000, y = point.y * 1000, positive = point.label === 1;
      shapes.push(`<g class="prompt-marker"><circle cx="${x}" cy="${y}" r="18" fill="${positive ? '#b4f1c1' : '#ffc0bd'}" stroke="#10111b" stroke-width="3"/><path d="M ${x-9} ${y} H ${x+9}${positive ? ` M ${x} ${y-9} V ${y+9}` : ''}" stroke="#10111b" stroke-width="3"/></g>`);
    }
    if (prompt.box) {
      const [x1,y1,x2,y2] = prompt.box;
      shapes.unshift(`<rect x="${x1*1000}" y="${y1*1000}" width="${(x2-x1)*1000}" height="${(y2-y1)*1000}" fill="#b794f4" fill-opacity=".12" stroke="#b794f4" stroke-width="4"/>`);
    }
    $('svg').innerHTML = shapes.join('');
    const positives = (prompt.points || []).filter(p => p.label === 1).length;
    const negatives = (prompt.points || []).length - positives;
    const named = Object.entries(state.prompts).filter(([,p]) => hasUsablePrompt(p)).map(([id]) => labels[id]);
    $('#prompt-summary').textContent = `指定済み：${named.join('、') || 'なし'}。${labels[part()]}：残す ${positives} 点・除く ${negatives} 点${prompt.box ? '・枠あり' : ''}。${hasUsablePrompt(prompt) ? '' : '残す点または枠を指定してください。'}`;
    $('#undo-prompt').disabled = busy || !state.canUndo(part());
    $('#redo-prompt').disabled = busy || !state.canRedo(part());
    $('#clear-prompt').disabled = busy || (!prompt.box && !prompt.points?.length);
    $('#prompt-part').disabled = busy;
    $('#prompt-kind').disabled = busy;
    $('#coordinate-form button').disabled = busy;
    $('#separate-one').disabled = busy || !runEnabled || !hasUsablePrompt(prompt);
    $('#separate-one').textContent = busy ? 'AI 処理中…' : 'このパーツを再分離';
    $('#prompt-result-note').textContent = resultNote;
  }
  function add(x,y) {
    const label = $('#prompt-kind').value === 'exclude' ? 0 : 1;
    if (!state.addPoint(part(), {x,y,label})) $('#prompt-summary').textContent = `点は合計 ${MAX_POINTS} 個までです。一つ戻すか指定を消してから追加してください。`;
  }
  const position = event => {
    const rect = $('svg').getBoundingClientRect();
    return [Math.min(1, Math.max(0, (event.clientX-rect.left)/rect.width)), Math.min(1, Math.max(0, (event.clientY-rect.top)/rect.height))];
  };
  $('svg').addEventListener('pointerdown', event => {
    if (busy || event.button !== 0 || !event.isPrimary) return;
    start = { point: position(event), pointer: event.pointerId, id: part(), kind: $('#prompt-kind').value };
    $('svg').setPointerCapture(event.pointerId);
  });
  $('svg').addEventListener('pointerup', event => {
    if (!start || start.pointer !== event.pointerId) return;
    const beginning = start; start = null;
    if (busy || beginning.id !== part() || beginning.kind !== $('#prompt-kind').value) return;
    const end = position(event);
    if (beginning.kind !== 'box') add(...end);
    else {
      const [x,y] = beginning.point;
      const box = [Math.min(x,end[0]),Math.min(y,end[1]),Math.max(x,end[0]),Math.max(y,end[1])];
      if (box[2]-box[0]<.005 || box[3]-box[1]<.005) { $('#prompt-summary').textContent='枠に幅と高さが必要です。ドラッグして指定してください。'; return; }
      state.setBox(part(),box);
    }
  });
  $('svg').addEventListener('pointercancel', () => { start=null; });
  $('#coordinate-form').addEventListener('submit', event => {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.target), x=Number(form.get('x'))/100, y=Number(form.get('y'))/100;
    if ($('#prompt-kind').value !== 'box') add(x,y);
    else {
      const right=Number(form.get('right'))/100,bottom=Number(form.get('bottom'))/100;
      if (right<=x || bottom<=y) { $('#prompt-summary').textContent='右と下は左と上より大きくしてください。'; return; }
      state.setBox(part(),[x,y,right,bottom]);
    }
  });
  $('#close-prompts').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { start=null; });
  $('#clear-prompt').addEventListener('click', () => state.clearPart(part()));
  $('#undo-prompt').addEventListener('click', () => state.undo(part()));
  $('#redo-prompt').addEventListener('click', () => state.redo(part()));
  $('#prompt-part').addEventListener('change', () => { resultNote=''; $('#prompt-run-status').textContent=''; render(); });
  $('#separate-one').addEventListener('click', () => { if (!busy && hasUsablePrompt(state.prompts[part()])) onSeparate(part()); });
  render();
  return {
    open(id) { if (id) $('#prompt-part').value=id; $('.prompt-image img').src=getSource(); render(); dialog.showModal(); },
    clear() { dialog.close(); $('.prompt-image img').removeAttribute('src'); resultNote=''; $('#prompt-run-status').textContent=''; start=null; state.reset(); },
    setRunEnabled(value) { runEnabled=value; render(); },
    setBusy(value) { busy=value; render(); },
    setStatus(message) { $('#prompt-run-status').textContent=message; },
    setResultNote(message) { resultNote=message; $('#prompt-result-note').textContent=message; },
    get prompts() { return state.prompts; },
    get selectedPart() { return part(); },
  };
}
