export function createPromptEditor({ labels, getSource, onChange }) {
  let prompts = {}, start = null;
  const dialog = document.createElement('dialog'); dialog.id = 'prompt-dialog';
  dialog.setAttribute('aria-labelledby', 'prompt-title');
  dialog.innerHTML = `<div class="dialog-header"><h2 id="prompt-title">切り抜く場所を指定</h2><button type="button" class="secondary" id="close-prompts">閉じる</button></div>
    <p class="muted">パーツを選び、画像をタップして点を置くか、ドラッグして枠を描いてください。見えている領域が対象です。</p>
    <div class="prompt-controls"><label>対象 <select id="prompt-part">${Object.entries(labels).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
    <label>指定方法 <select id="prompt-kind"><option value="point">点（タップ）</option><option value="box">枠（ドラッグ）</option></select></label><button type="button" id="clear-prompt" class="secondary">この指定を消す</button></div>
    <div class="prompt-image"><img alt="切り抜く場所を指定する元画像" draggable="false"><svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="画像上で切り抜く場所を指定"></svg></div>
    <details><summary>数値で指定（キーボード操作）</summary><form id="coordinate-form"><div class="coordinate-grid">
      <label>X / 左 % <input name="x" type="number" min="0" max="100" step="0.1" value="50" required></label>
      <label>Y / 上 % <input name="y" type="number" min="0" max="100" step="0.1" value="50" required></label>
      <label>右 %（枠）<input name="right" type="number" min="0" max="100" step="0.1" value="75" required></label>
      <label>下 %（枠）<input name="bottom" type="number" min="0" max="100" step="0.1" value="75" required></label></div><button class="secondary">数値を反映</button></form></details>
    <p id="prompt-summary" role="status"></p>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const part = () => $('#prompt-part').value;
  const render = () => {
    const shapes = [];
    for (const [id, prompt] of Object.entries(prompts)) {
      const color = id === part() ? '#fbd38d' : '#b794f4';
      if (prompt.point) shapes.push(`<circle cx="${prompt.point[0] * 1000}" cy="${prompt.point[1] * 1000}" r="12" fill="${color}" stroke="#10111b" stroke-width="4"/>`);
      if (prompt.box) {
        const [x1,y1,x2,y2] = prompt.box;
        shapes.push(`<rect x="${x1 * 1000}" y="${y1 * 1000}" width="${(x2-x1)*1000}" height="${(y2-y1)*1000}" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-width="4"/>`);
      }
    }
    $('svg').innerHTML = shapes.join('');
    $('#prompt-summary').textContent = `指定済み：${Object.keys(prompts).map(id => labels[id]).join('、') || 'なし'}`;
    onChange(prompts);
  };
  const position = event => {
    const rect = $('svg').getBoundingClientRect();
    return [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))];
  };
  $('svg').addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    start = position(event); $('svg').setPointerCapture(event.pointerId);
  });
  $('svg').addEventListener('pointerup', event => {
    if (!start) return;
    const end = position(event);
    if ($('#prompt-kind').value === 'point') prompts[part()] = { point: end };
    else {
      const box = [Math.min(start[0], end[0]), Math.min(start[1],end[1]), Math.max(start[0],end[0]), Math.max(start[1],end[1])];
      if (box[2]-box[0] < .005 || box[3]-box[1] < .005) { start = null; $('#prompt-summary').textContent = '枠に幅と高さが必要です。ドラッグして指定してください。'; return; }
      prompts[part()] = { box };
    }
    start = null; render();
  });
  $('svg').addEventListener('pointercancel', () => { start = null; });
  $('#coordinate-form').addEventListener('submit', event => {
    event.preventDefault(); const form = new FormData(event.target);
    const x = Number(form.get('x'))/100, y = Number(form.get('y'))/100;
    if ($('#prompt-kind').value === 'point') prompts[part()] = { point: [x,y] };
    else {
      const right = Number(form.get('right'))/100, bottom = Number(form.get('bottom'))/100;
      if (right <= x || bottom <= y) { $('#prompt-summary').textContent = '右と下は左と上より大きくしてください。'; return; }
      prompts[part()] = { box: [x,y,right,bottom] };
    }
    render();
  });
  $('#close-prompts').addEventListener('click', () => dialog.close());
  $('#clear-prompt').addEventListener('click', () => { delete prompts[part()]; render(); });
  $('#prompt-part').addEventListener('change', render);
  return {
    open() { $('.prompt-image img').src = getSource(); render(); dialog.showModal(); },
    clear() { dialog.close(); $('.prompt-image img').removeAttribute('src'); prompts = {}; render(); },
    get prompts() { return prompts; },
  };
}
