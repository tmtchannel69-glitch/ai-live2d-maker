import {defaultMotion} from './motion-state.js';

export function createMotionPanel({labels,getState,onChange,isDirty}) {
  const section=document.createElement('section');section.className='panel motion-panel';section.hidden=true;
  section.innerHTML=`<h2>04 動きの試作</h2><p class="muted">選択中のAIパーツで重なり順・頭の傾き・髪の揺れを確認します。アプリ独自の平面変形です。VTube Studio用モデルの出力、立体的な顔の向き、瞬き・口の動きは未対応です。</p>
  <p id="motion-status" role="status" aria-live="polite"></p><div class="motion-workspace"><div class="motion-stage"><canvas id="motion-canvas" width="1" height="1" aria-label="分離パーツの動作プレビュー"></canvas></div>
  <div class="motion-controls"><button id="motion-play" class="secondary" disabled>揺れ・呼吸を再生</button><label>頭の傾き（度）<input id="motion-tilt" type="range" min="-15" max="15" value="0"><output id="motion-tilt-value">0</output></label>
  <label>調整するパーツ<select id="motion-part"></select></label><p class="muted">支点は元画像の左上を0%、右下を100%として指定します。順序が大きいほど手前です。支点・順序・追従・揺れ幅は作業ファイルに保存できます。PNG・PSDは元の形を維持します。</p>
  <form id="motion-form"><div class="coordinate-grid"><label>支点 X（%）<input id="motion-x" type="number" min="0" max="100" step="0.1" required></label><label>支点 Y（%）<input id="motion-y" type="number" min="0" max="100" step="0.1" required></label><label>重なり順<input id="motion-order" type="number" min="0" max="99" step="1" required></label><label>揺れ幅（度）<input id="motion-swing" type="number" min="0" max="15" step="0.1" required></label></div><label class="motion-check"><input id="motion-head" type="checkbox"> 頭の傾きに追従する</label><button class="secondary" id="motion-apply">設定を反映</button></form><p class="muted">初期設定は仮の値です。動かすと露出する隙間は、別途描き足しが必要です。再生は保存・復元後に自動開始しません。</p></div></div>`;
  document.querySelector('.review-panel').after(section);
  const $=s=>section.querySelector(s),canvas=$('#motion-canvas'),ctx=canvas.getContext('2d');
  let parts=[],bitmaps=[],source=null,generation=0,loading=false,playing=false,raf=0,started=0,elapsed=0,current='',error='';
  const setting=id=>getState().settings[id]||defaultMotion(id);
  function draw(time=elapsed) {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const tilt=Number($('#motion-tilt').value),breath=playing?Math.sin(time*2)*0.003:0;
    const ordered=bitmaps.slice().sort((a,b)=>setting(a.id).order-setting(b.id).order || parts.findIndex(p=>p.id===a.id)-parts.findIndex(p=>p.id===b.id));
    for(const {id,bitmap} of ordered) {
      const s=setting(id),angle=((s.head?tilt:0)+(playing?Math.sin(time*2.5)*s.swing:0))*Math.PI/180;
      ctx.save();ctx.translate(canvas.width*0.5,canvas.height*0.75);ctx.scale(1,1+breath);ctx.translate(-canvas.width*0.5,-canvas.height*0.75);
      ctx.translate(s.x*canvas.width,s.y*canvas.height);ctx.rotate(angle);ctx.translate(-s.x*canvas.width,-s.y*canvas.height);
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);ctx.restore();
    }
  }
  function stop() {playing=false;cancelAnimationFrame(raf);raf=0;elapsed=0;$('#motion-play').textContent='揺れ・呼吸を再生';draw(0);}
  function frame(now) {if(!playing)return;elapsed=(now-started)/1000;draw();raf=requestAnimationFrame(frame);}
  function fields() {
    const s=setting(current);$('#motion-x').value=+(s.x*100).toFixed(1);$('#motion-y').value=+(s.y*100).toFixed(1);$('#motion-order').value=s.order;$('#motion-swing').value=s.swing;$('#motion-head').checked=s.head;
  }
  function controls() {
    const state=getState(),disabled=state.locked || loading || !bitmaps.length;
    section.hidden=!state.file;
    for(const input of section.querySelectorAll('input,select,button'))input.disabled=disabled;
    if(state.locked && playing)stop();
    $('#motion-status').textContent=loading?'動作プレビューを準備しています…':error || (!parts.length?'選択中のAI結果が必要です。固定領域のデモ結果は配置を再現できないため対象外です。':`${parts.length} パーツ。${parts.some(isDirty)?'指定変更前の結果を含みます。再分離してください。':''}重なり順と動かしたときの隙間を確認してください。`);
  }
  async function load(ticket,file,chosen) {
    const next=[];let original;
    try {
      original=await createImageBitmap(file);const width=original.width,height=original.height;original.close();original=null;
      if(ticket!==generation)return;
      const ratio=Math.min(1,640/width,960/height),w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));
      for(const part of chosen) {
        let full,small;
        try {
          full=await createImageBitmap(part.blob);
          if(full.width!==width || full.height!==height)throw new Error('AIパーツは元画像と同じサイズにしてください。');
          if(ticket!==generation)return;
          small=await createImageBitmap(full,{resizeWidth:w,resizeHeight:h});
          if(ticket!==generation){small.close();return;}
          next.push({id:part.id,bitmap:small});
        } finally {full?.close();}
      }
      if(ticket!==generation)return;
      bitmaps=next.splice(0);canvas.width=w;canvas.height=h;error='';draw();
    } catch(e) {if(ticket===generation)error=`動作プレビューを作れませんでした。${e.message}`;}
    finally {original?.close();next.forEach(p=>p.bitmap.close());if(ticket===generation){loading=false;controls();}}
  }
  function update() {
    const state=getState(),chosen=state.results.filter(p=>p.ai && state.selected.includes(p.id));
    const changed=state.file!==source || chosen.length!==parts.length || chosen.some((p,i)=>p.id!==parts[i].id || p.blob!==parts[i].blob);
    if(changed) {
      stop();generation++;bitmaps.forEach(p=>p.bitmap.close());bitmaps=[];ctx.clearRect(0,0,canvas.width,canvas.height);
      source=state.file;parts=chosen;error='';loading=Boolean(source && parts.length);
      if(!parts.some(p=>p.id===current))current=parts[0]?.id||'';
      $('#motion-part').replaceChildren(...parts.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=labels[p.id];return o;}));$('#motion-part').value=current;
      $('#motion-tilt').value=0;$('#motion-tilt-value').value='0';
      if(current)fields();
      if(loading)void load(generation,source,[...parts]);
    }
    controls();if(!playing)draw();
  }
  $('#motion-part').addEventListener('change',()=>{current=$('#motion-part').value;fields();});
  $('#motion-tilt').addEventListener('input',()=>{$('#motion-tilt-value').value=$('#motion-tilt').value;if(!playing)draw();});
  $('#motion-form').addEventListener('submit',event=>{
    event.preventDefault();if(getState().locked || loading || !current || !$('#motion-form').reportValidity())return;
    onChange(current,{x:Number($('#motion-x').value)/100,y:Number($('#motion-y').value)/100,order:Number($('#motion-order').value),swing:Number($('#motion-swing').value),head:$('#motion-head').checked});draw();
  });
  $('#motion-play').addEventListener('click',()=>{if(playing){stop();return;}if(getState().locked || loading || !bitmaps.length)return;playing=true;started=performance.now();$('#motion-play').textContent='再生を停止';raf=requestAnimationFrame(frame);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  return {update,stop};
}
