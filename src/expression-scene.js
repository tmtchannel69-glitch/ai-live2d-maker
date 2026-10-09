import {EXPRESSION_ROLES} from './expression-assets.js';
import {EXPRESSION_CONDITIONS,defaultExpressionLayer,expressionLayerVisible} from './expression-layer-state.js';

export function createExpressionScene({getState,onChange}) {
  const section=document.createElement('section');section.className='panel expression-scene';section.hidden=true;
  section.innerHTML=`<h2>表情素材の重なり・開閉の試作</h2><p class="muted">追加素材だけを重ね、左右の目と口の開閉に応じて画像を切り替えます。0.5を境に表示を切り替える試作です。滑らかな変形やLive2Dモデルの出力は未対応です。</p>
  <p id="scene-status" role="status" aria-live="polite"></p><div class="motion-workspace"><div class="motion-stage"><canvas id="scene-canvas" width="1" height="1" aria-label="表情素材の合成と開閉プレビュー"></canvas></div><div class="motion-controls">
  <label>背景<select id="scene-background"><option value="transparent">透明背景・追加素材だけ</option><option value="source">元画像・位置確認用</option></select></label>
  <label>左目の開き（0＝閉じる、1＝開く）<input id="scene-left" type="range" min="0" max="1" step="0.1" value="1"></label><label>右目の開き（0＝閉じる、1＝開く）<input id="scene-right" type="range" min="0" max="1" step="0.1" value="1"></label><label>口の開き（0＝閉じる、1＝開く）<input id="scene-mouth" type="range" min="0" max="1" step="0.1" value="0"></label><p id="scene-values" class="muted"></p><button id="scene-play" class="secondary">瞬き・口の切替を再生</button>
  <form id="scene-layer"><label>調整する素材<select id="scene-role"></select></label><label>重なり順（大きいほど手前）<input id="scene-order" type="number" min="0" max="99" step="1" required></label><label>表示する条件<select id="scene-condition"></select></label><label class="motion-check"><input id="scene-enabled" type="checkbox"> この素材を表示対象にする</label><button id="scene-apply" class="secondary">表示設定を反映</button></form>
  <p class="muted">表示条件・重なり順は作業ファイルに保存できます。初期設定は仮の値です。元画像の目・口は背景に残ります。開閉する素材がないと、切替時に部品が消える場合があります。PNG・PSDには表示設定を反映しません。</p></div></div>`;
  document.querySelector('.asset-panel').after(section);
  const $=s=>section.querySelector(s),canvas=$('#scene-canvas'),ctx=canvas.getContext('2d');
  for(const [value,text] of Object.entries(EXPRESSION_CONDITIONS)){const o=document.createElement('option');o.value=value;o.textContent=text;$('#scene-condition').append(o);}
  let source=null,assets=[],bitmaps=[],background=null,current='',generation=0,loading=false,error='',playing=false,raf=0,start=0,lastFrame='';
  const layer=role=>getState().layers[role]||defaultExpressionLayer(role);
  const manual=()=>Object.fromEntries(['left','right','mouth'].map(id=>[id,Number($(`#scene-${id}`).value)]));
  function draw(values=manual()) {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(background && $('#scene-background').value==='source')ctx.drawImage(background,0,0,canvas.width,canvas.height);
    for(const item of bitmaps.slice().sort((a,b)=>layer(a.role).order-layer(b.role).order || EXPRESSION_ROLES.findIndex(([id])=>id===a.role)-EXPRESSION_ROLES.findIndex(([id])=>id===b.role))) {
      if(!expressionLayerVisible(layer(item.role),values))continue;
      const p=getState().assets.find(a=>a.role===item.role)?.placement;if(p)ctx.drawImage(item.bitmap,p.x*canvas.width,p.y*canvas.height,p.width*canvas.width,p.height*canvas.height);
    }
    $('#scene-values').textContent=`${playing?'再生中：':'手動：'}左目 ${values.left} ／ 右目 ${values.right} ／ 口 ${values.mouth}`;
  }
  function stop(){playing=false;cancelAnimationFrame(raf);raf=0;$('#scene-play').textContent='瞬き・口の切替を再生';draw();}
  function frame(now) {
    if(!playing)return;const t=(now-start)/1000,values={left:t%4>=3.6?0:1,right:t%4>=3.5 && t%4<3.9?0:1,mouth:t%2>=1?1:0},key=JSON.stringify(values);
    if(key!==lastFrame){lastFrame=key;draw(values);}raf=requestAnimationFrame(frame);
  }
  function fields(){const s=layer(current);$('#scene-order').value=s.order;$('#scene-condition').value=s.condition;$('#scene-enabled').checked=s.enabled;}
  function controls() {
    const state=getState(),disabled=state.locked || loading || !bitmaps.length;section.hidden=!state.file;
    for(const input of section.querySelectorAll('input,select,button'))input.disabled=disabled;
    if(state.locked && playing)stop();
    for(const id of ['left','right','mouth'])$(`#scene-${id}`).disabled=disabled || playing;
    $('#scene-status').textContent=loading?'表情の合成を準備しています…':error || (assets.length?`${assets.length}素材。切替時の隙間や重なりを確認してください。読み込み済みでも品質・動作は未確認です。`:'上の「表情素材の読み込み・位置合わせ」でPNGを用意してください。');
  }
  function release(){background?.close();background=null;bitmaps.forEach(a=>a.bitmap.close());bitmaps=[];ctx.clearRect(0,0,canvas.width,canvas.height);}
  async function load(ticket,file,chosen) {
    const next=[];let full,bg;
    try {
      full=await createImageBitmap(file);if(ticket!==generation)return;
      const ratio=Math.min(1,640/full.width,960/full.height),width=Math.max(1,Math.round(full.width*ratio)),height=Math.max(1,Math.round(full.height*ratio));
      bg=await createImageBitmap(full,{resizeWidth:width,resizeHeight:height});full.close();full=null;
      for(const a of chosen) {
        if(ticket!==generation)return;full=await createImageBitmap(a.blob);if(ticket!==generation)return;
        const s=Math.min(1,320/full.width,480/full.height),bitmap=await createImageBitmap(full,{resizeWidth:Math.max(1,Math.round(full.width*s)),resizeHeight:Math.max(1,Math.round(full.height*s))});next.push({role:a.role,bitmap});full.close();full=null;
      }
      if(ticket!==generation)return;canvas.width=width;canvas.height=height;background=bg;bg=null;bitmaps=next.splice(0);draw();
    } catch(e){if(ticket===generation)error=`合成を読み込めませんでした。素材と設定は保持しています。${e.message}`;}
    finally {full?.close();bg?.close();next.forEach(a=>a.bitmap.close());if(ticket===generation){loading=false;controls();}}
  }
  function update() {
    const state=getState(),changed=source!==state.file || assets.length!==state.assets.length || state.assets.some((a,i)=>a.role!==assets[i].role || a.blob!==assets[i].blob);
    if(!changed && state.assets.some((a,i)=>['x','y','width','height'].some(k=>a.placement[k]!==assets[i].placement[k]))){stop();assets=[...state.assets];}
    if(source!==state.file){$('#scene-left').value='1';$('#scene-right').value='1';$('#scene-mouth').value='0';}
    if(changed) {
      stop();generation++;release();source=state.file;assets=[...state.assets];loading=Boolean(source && assets.length);error='';
      if(!assets.some(a=>a.role===current))current=assets[0]?.role||'';
      $('#scene-role').replaceChildren(...assets.map(a=>{const o=document.createElement('option');o.value=a.role;o.textContent=EXPRESSION_ROLES.find(([id])=>id===a.role)[1];return o;}));$('#scene-role').value=current;
      if(current)fields();if(loading)void load(generation,source,[...assets]);
      if(!source){$('#scene-left').value='1';$('#scene-right').value='1';$('#scene-mouth').value='0';}
    }
    controls();if(!playing)draw();
  }
  $('#scene-role').addEventListener('change',()=>{current=$('#scene-role').value;fields();});
  for(const id of ['left','right','mouth'])$(`#scene-${id}`).addEventListener('input',()=>draw());
  $('#scene-background').addEventListener('change',()=>{stop();controls();});
  $('#scene-layer').addEventListener('submit',event=>{
    event.preventDefault();if(getState().locked || loading || !current || !$('#scene-layer').reportValidity())return;
    stop();onChange(current,{order:Number($('#scene-order').value),condition:$('#scene-condition').value,enabled:$('#scene-enabled').checked});draw();controls();
  });
  $('#scene-play').addEventListener('click',()=>{if(playing){stop();controls();return;}if(getState().locked || loading || !bitmaps.length)return;playing=true;start=performance.now();lastFrame='';$('#scene-play').textContent='再生を停止';controls();raf=requestAnimationFrame(frame);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();controls();}});
  return {update};
}
