import {createExpressionTouchEditor} from './expression-touch-editor.js';
import {GRID,TRIANGLES,defaultDeform,validateDeforms,interpolateShape,drawDeformed} from './expression-deform.js';
import {EXPRESSION_ROLES} from './expression-assets.js';
import {EXPRESSION_CONDITIONS,defaultExpressionLayer,expressionLayerVisible} from './expression-layer-state.js';

export function createExpressionScene({getState,onChange,onDeform}) {
  const section=document.createElement('section');section.className='panel expression-scene';section.hidden=true;
  section.innerHTML=`<h2>表情素材の重なり・開閉の試作</h2><p class="muted">追加素材だけを重ね、左右の目と口の開閉に応じて画像を切り替えます。表示条件は0.5を境に切り替えます。変形を設定した素材は開閉の間を滑らかに動かせます。Live2Dモデルの出力は未対応です。</p>
  <p id="scene-status" role="status" aria-live="polite"></p><div class="motion-workspace"><div class="motion-stage"><canvas id="scene-canvas" width="1" height="1" aria-label="表情素材の合成と開閉プレビュー"></canvas></div><div class="motion-controls">
  <label>背景<select id="scene-background"><option value="transparent">透明背景・追加素材だけ</option><option value="source">元画像・位置確認用</option></select></label>
  <label>左目の開き（0＝閉じる、1＝開く）<input id="scene-left" type="range" min="0" max="1" step="0.1" value="1"></label><label>右目の開き（0＝閉じる、1＝開く）<input id="scene-right" type="range" min="0" max="1" step="0.1" value="1"></label><label>口の開き（0＝閉じる、1＝開く）<input id="scene-mouth" type="range" min="0" max="1" step="0.1" value="0"></label><p id="scene-values" class="muted"></p><button id="scene-play" class="secondary">瞬き・口の切替を再生</button>
  <form id="scene-layer"><label>調整する素材<select id="scene-role"></select></label><label>重なり順（大きいほど手前）<input id="scene-order" type="number" min="0" max="99" step="1" required></label><label>表示する条件<select id="scene-condition"></select></label><label class="motion-check"><input id="scene-enabled" type="checkbox"> この素材を表示対象にする</label><button id="scene-apply" class="secondary">表示設定を反映</button></form>
  <form id="deform-form"><h3>選択した素材の形を編集</h3><button id="deform-touch" type="button" class="secondary">指で形を編集</button><p class="muted">9点を結んで変形します。未設定では「開く＝元の形」「閉じる＝中央に薄く縮む」を仮の形として用意します。反映すると表示条件を「常に表示」に変更します。点の座標は素材の幅・高さに対する割合です。</p>
  <label>動きに使う値<select id="deform-driver"><option value="left">左目の開き</option><option value="right">右目の開き</option><option value="mouth">口の開き</option></select></label>
  <label>編集する形<select id="deform-key"><option value="closed">閉じた形（0）</option><option value="open">開いた形（1）</option></select></label>
  <label>編集する点<select id="deform-point"></select></label><label>点の横位置（%）<input id="deform-x" type="number" min="-50" max="150" step="0.1" required></label><label>点の縦位置（%）<input id="deform-y" type="number" min="-50" max="150" step="0.1" required></label>
  <label class="motion-check"><input id="deform-grid" type="checkbox"> 選択素材の点と線を表示</label><button id="deform-apply" class="secondary">この点と開閉の形を反映</button><button id="deform-reset" type="button" class="secondary">選択中の形を元の形に戻す</button><button id="deform-remove" type="button" class="secondary">この素材の変形を解除</button><p id="deform-status" role="status" aria-live="polite"></p></form>
  <p class="muted">画像を縮めるだけでは自然な瞬きや口になりません。素材と形の調整が必要です。指での点編集は専用画面で行えます。目の内側だけに描く処理、親子の動きは未対応です。点・形は作業ファイルに保存し、元のPNG・PSDは変えません。</p>
  <p class="muted">表示条件・重なり順は作業ファイルに保存できます。初期設定は仮の値です。元画像の目・口は背景に残ります。開閉する素材がないと、切替時に部品が消える場合があります。PNG・PSDには表示設定を反映しません。</p></div></div>`;
  document.querySelector('.asset-panel').after(section);
  const $=s=>section.querySelector(s),canvas=$('#scene-canvas'),ctx=canvas.getContext('2d');
  for(const [value,text] of Object.entries(EXPRESSION_CONDITIONS)){const o=document.createElement('option');o.value=value;o.textContent=text;$('#scene-condition').append(o);}
  const pointLabels=['左上','上中央','右上','左中央','中央','右中央','左下','下中央','右下'];
  pointLabels.forEach((text,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${i+1}：${text}`;$('#deform-point').append(o);});
  let source=null,assets=[],bitmaps=[],background=null,current='',generation=0,loading=false,error='',playing=false,raf=0,start=0,lastFrame='',lastTime=0;
  const layer=role=>getState().layers[role]||defaultExpressionLayer(role);
  const touchEditor=createExpressionTouchEditor({getState,onApply:(setting,key)=>{$('#deform-key').value=key;return applyShape(setting);}});
  const manual=()=>Object.fromEntries(['left','right','mouth'].map(id=>[id,Number($(`#scene-${id}`).value)]));
  function draw(values=manual()) {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(background && $('#scene-background').value==='source')ctx.drawImage(background,0,0,canvas.width,canvas.height);
    for(const item of bitmaps.slice().sort((a,b)=>layer(a.role).order-layer(b.role).order || EXPRESSION_ROLES.findIndex(([id])=>id===a.role)-EXPRESSION_ROLES.findIndex(([id])=>id===b.role))) {
      if(!expressionLayerVisible(layer(item.role),values))continue;
      const p=getState().assets.find(a=>a.role===item.role)?.placement,setting=getState().deforms[item.role];
      if(p){if(setting)drawDeformed(ctx,item.bitmap,p,interpolateShape(setting,values[setting.driver]),canvas.width,canvas.height);else ctx.drawImage(item.bitmap,p.x*canvas.width,p.y*canvas.height,p.width*canvas.width,p.height*canvas.height);}
    }
    if($('#deform-grid').checked) {
      const p=getState().assets.find(a=>a.role===current)?.placement,setting=getState().deforms[current];
      if(p && setting && expressionLayerVisible(layer(current),values)){const points=interpolateShape(setting,values[setting.driver]).map(([x,y])=>[(p.x+x*p.width)*canvas.width,(p.y+y*p.height)*canvas.height]);ctx.save();ctx.strokeStyle='#00ffff';ctx.fillStyle='#00ffff';ctx.lineWidth=1;for(const ids of TRIANGLES){ctx.beginPath();ids.forEach((i,j)=>j?ctx.lineTo(...points[i]):ctx.moveTo(...points[i]));ctx.closePath();ctx.stroke();}points.forEach((point,i)=>{ctx.beginPath();ctx.arc(...point,i===Number($('#deform-point').value)?5:3,0,Math.PI*2);ctx.fill();});ctx.restore();}
    }
    $('#scene-values').textContent=`${playing?'再生中：':'手動：'}左目 ${values.left.toFixed(2)} ／ 右目 ${values.right.toFixed(2)} ／ 口 ${values.mouth.toFixed(2)}`;
  }
  function stop(){playing=false;cancelAnimationFrame(raf);raf=0;$('#scene-play').textContent='瞬き・口の切替を再生';draw();}
  function frame(now) {
    if(!playing)return;const t=(now-start)/1000,values={left:t%4>=3.6?0:1,right:t%4>=3.5 && t%4<3.9?0:1,mouth:t%2>=1?1:0},key=JSON.stringify(values);
    if(Object.keys(getState().deforms).length){
      if(now-lastTime>=33){const blink=phase=>phase<3.5?1:Math.abs((phase-3.5)/.25-1);draw({left:blink(t%4),right:blink((t+.1)%4),mouth:(1-Math.cos(t*Math.PI))/2});lastTime=now;}
    }else if(key!==lastFrame){lastFrame=key;draw(values);}raf=requestAnimationFrame(frame);
  }
  function fields(){const s=layer(current);$('#scene-order').value=s.order;$('#scene-condition').value=s.condition;$('#scene-enabled').checked=s.enabled;deformFields();}
  function deformFields(){
    const setting=getState().deforms[current]||defaultDeform(current),point=setting[$('#deform-key').value][Number($('#deform-point').value)];
    $('#deform-driver').value=setting.driver;$('#deform-x').value=(point[0]*100).toFixed(1);$('#deform-y').value=(point[1]*100).toFixed(1);
    $('#deform-status').textContent=getState().deforms[current]?'変形設定あり。スライダーで途中の形も確認してください。':'変形は未設定です。反映してから動きを確認してください。';
  }
  function applyShape(setting){
    try{validateDeforms({[current]:setting},getState().assets);stop();onDeform(current,setting);fields();const id=setting.driver;$(`#scene-${id}`).value=$('#deform-key').value==='closed'?'0':'1';draw();controls();return true;}
    catch(e){$('#deform-status').textContent=e.message;return false;}
  }
  function controls() {
    const state=getState(),disabled=state.locked || loading || !bitmaps.length;section.hidden=!state.file;
    for(const input of section.querySelectorAll('input,select,button'))input.disabled=disabled;
    if(state.locked && playing)stop();
    for(const input of $('#deform-form').querySelectorAll('input,select,button'))input.disabled=disabled || playing;
    $('#deform-remove').disabled=disabled || playing || !state.deforms[current];
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
    if(changed || state.locked)touchEditor.close();
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
  $('#scene-role').addEventListener('change',()=>{stop();current=$('#scene-role').value;fields();draw();controls();});
  for(const id of ['left','right','mouth'])$(`#scene-${id}`).addEventListener('input',()=>draw());
  $('#scene-background').addEventListener('change',()=>{stop();controls();});
  $('#scene-layer').addEventListener('submit',event=>{
    event.preventDefault();if(getState().locked || loading || !current || !$('#scene-layer').reportValidity())return;
    stop();onChange(current,{order:Number($('#scene-order').value),condition:$('#scene-condition').value,enabled:$('#scene-enabled').checked});draw();controls();
  });
  for(const id of ['key','point'])$(`#deform-${id}`).addEventListener('change',()=>{deformFields();const setting=getState().deforms[current];if(setting && id==='key')$(`#scene-${setting.driver}`).value=$('#deform-key').value==='closed'?'0':'1';draw();});
  $('#deform-touch').addEventListener('click',()=>{const item=bitmaps.find(a=>a.role===current);if(getState().locked || loading || !item)return;stop();controls();touchEditor.open({role:current,bitmap:item.bitmap,setting:getState().deforms[current],key:$('#deform-key').value,name:EXPRESSION_ROLES.find(([id])=>id===current)[1]});});
  $('#deform-grid').addEventListener('change',()=>draw());
  $('#deform-form').addEventListener('submit',event=>{event.preventDefault();if(getState().locked || loading || playing || !current || !$('#deform-form').reportValidity())return;const s=structuredClone(getState().deforms[current]||defaultDeform(current));s.driver=$('#deform-driver').value;s[$('#deform-key').value][Number($('#deform-point').value)]=[Number($('#deform-x').value)/100,Number($('#deform-y').value)/100];applyShape(s);});
  $('#deform-reset').addEventListener('click',()=>{if(getState().locked || loading || playing || !current)return;const s=structuredClone(getState().deforms[current]||defaultDeform(current));s.driver=$('#deform-driver').value;s[$('#deform-key').value]=GRID.map(p=>[...p]);applyShape(s);});
  $('#deform-remove').addEventListener('click',()=>{if(getState().locked || loading || playing || !current)return;stop();onDeform(current,null);fields();draw();controls();});
  $('#scene-play').addEventListener('click',()=>{if(playing){stop();controls();return;}if(getState().locked || loading || !bitmaps.length)return;playing=true;start=performance.now();lastFrame='';$('#scene-play').textContent='再生を停止';controls();raf=requestAnimationFrame(frame);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();controls();}});
  return {update};
}
