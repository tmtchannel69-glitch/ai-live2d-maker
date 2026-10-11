import {CLIP_DRIVERS,defaultClipKeys,validateClipKeys,interpolateClip} from './expression-clip-keys.js';
import {GROUP_KEY_LABELS,defaultGroupKeys,evaluateGroupKeys,validateGroupKeys} from './group-motion-keys.js';
import {createExpressionGroupEditor} from './expression-group-editor.js';
import {validateGroups,hasGroups,groupMatrix,IDENTITY,GROUP_LABELS,groupMembers,defaultGroupTransform} from './expression-groups.js';
import {createAssetPlacementEditor} from './asset-placement-editor.js';
import {validateClips,clipPath} from './expression-clips.js';
import {createExpressionTouchEditor} from './expression-touch-editor.js';
import {GRID,TRIANGLES,defaultDeform,validateDeforms,interpolateShape,drawDeformed} from './expression-deform.js';
import {EXPRESSION_ROLES} from './expression-assets.js';
import {EXPRESSION_CONDITIONS,defaultExpressionLayer,expressionLayerVisible} from './expression-layer-state.js';

export function createExpressionScene({getState,onChange,onDeform,onClip,onGroups,onGroupKeys,onClipKeys}) {
  const section=document.createElement('section');section.className='panel expression-scene';section.hidden=true;
  section.innerHTML=`<h2>表情素材の重なり・開閉の試作</h2><p class="muted">追加素材だけを重ね、左右の目と口の開閉に応じて画像を切り替えます。表示条件は0.5を境に切り替えます。変形を設定した素材は開閉の間を滑らかに動かせます。Live2Dモデルの出力は未対応です。</p>
  <p id="scene-status" role="status" aria-live="polite"></p><div class="motion-workspace"><div class="motion-stage"><canvas id="scene-canvas" width="1" height="1" aria-label="表情素材の合成と開閉プレビュー"></canvas></div><div class="motion-controls">
  <label>背景<select id="scene-background"><option value="transparent">透明背景・追加素材だけ</option><option value="source">元画像・位置確認用</option></select></label>
  <label>左目の開き（0＝閉じる、1＝開く）<input id="scene-left" type="range" min="0" max="1" step="0.1" value="1"></label><label>右目の開き（0＝閉じる、1＝開く）<input id="scene-right" type="range" min="0" max="1" step="0.1" value="1"></label><label>口の開き（0＝閉じる、1＝開く）<input id="scene-mouth" type="range" min="0" max="1" step="0.1" value="0"></label><label>顔の向きの試作（左 −1・中央 0・右 1）<input id="scene-turn" type="range" min="-1" max="1" step="0.05" value="0"></label><p id="scene-values" class="muted"></p><button id="scene-play" class="secondary">瞬き・口の切替を再生</button>
  <button id="scene-groups" class="secondary">素材をまとめて動かす</button><p id="scene-group-status" class="muted"></p>
  <details id="group-key-panel"><summary>スライダーで動く位置を設定</summary><p class="muted">グループごとに左・中央・右の位置を作ります。設定ありのグループは通常の配置をこの3位置で置き換えて動きます。実際の立体的な顔の向きやLive2D出力ではありません。</p>
  <label>動かすグループ<select id="key-group"></select></label><label>編集する位置<select id="key-position"></select></label><button id="key-edit" class="secondary">この位置の動きを編集</button><button id="key-use-base" class="secondary">通常の配置から3位置を作る</button><button id="key-remove" class="secondary">このグループの動きを解除</button><p id="key-status" role="status" aria-live="polite"></p></details>
  <button id="scene-motion-play" class="secondary">向きと表情の動きを再生</button>
  <form id="scene-layer"><label>調整する素材<select id="scene-role"></select></label><label>重なり順（大きいほど手前）<input id="scene-order" type="number" min="0" max="99" step="1" required></label><label>表示する条件<select id="scene-condition"></select></label><label class="motion-check"><input id="scene-enabled" type="checkbox"> この素材を表示対象にする</label><button id="scene-apply" class="secondary">表示設定を反映</button></form>
  <form id="clip-form"><h3>選択素材を表示する範囲</h3><p class="muted">範囲の外側を隠します。元画像上の範囲を指定します。既定は固定です。「素材をまとめて動かす」で範囲の追従を選べます。開閉の2範囲は独立に調整でき、9点の輪郭を自動で写す機能はありません。</p>
  <label>編集する範囲<select id="clip-key"><option value="base">固定範囲（開閉設定なしで使う）</option><option value="closed">閉じた範囲（0）</option><option value="open">開いた範囲（1）</option></select></label>
  <label id="clip-driver-label" hidden>範囲の動きに使う値<select id="clip-driver"><option value="left">左目の開き</option><option value="right">右目の開き</option><option value="mouth">口の開き</option></select></label>
  <p class="muted">先に固定範囲を反映し、閉じた・開いた範囲を調整します。2つの範囲はスライダーで滑らかにつながります。設定ありでは固定範囲を置き換えます。範囲の形は2位置で共通です。</p>
  <button id="clip-thin" type="button" class="secondary" hidden>閉じた範囲を薄くする</button><button id="clip-keys-remove" type="button" class="secondary">範囲の開閉を解除</button>
  <label>範囲の形<select id="clip-shape"><option value="ellipse">楕円</option><option value="rect">長方形</option></select></label>
  <label>左端（元画像の%）<input id="clip-x" type="number" min="0" max="100" step="any" required></label><label>上端（元画像の%）<input id="clip-y" type="number" min="0" max="100" step="any" required></label>
  <label>幅（元画像の%）<input id="clip-width" type="number" min="0.01" max="100" step="any" required></label><label>高さ（元画像の%）<input id="clip-height" type="number" min="0.01" max="100" step="any" required></label>
  <button id="clip-touch" type="button" class="secondary">指で表示範囲を調整</button><button id="clip-apply" class="secondary">表示範囲を反映</button><button id="clip-remove" type="button" class="secondary">表示範囲の制限を解除</button><p id="clip-status" role="status" aria-live="polite"></p></form>
  <form id="deform-form"><h3>選択した素材の形を編集</h3><button id="deform-touch" type="button" class="secondary">指で形を編集</button><p class="muted">9点を結んで変形します。未設定では「開く＝元の形」「閉じる＝中央に薄く縮む」を仮の形として用意します。反映すると表示条件を「常に表示」に変更します。点の座標は素材の幅・高さに対する割合です。</p>
  <label>動きに使う値<select id="deform-driver"><option value="left">左目の開き</option><option value="right">右目の開き</option><option value="mouth">口の開き</option></select></label>
  <label>編集する形<select id="deform-key"><option value="closed">閉じた形（0）</option><option value="open">開いた形（1）</option></select></label>
  <label>編集する点<select id="deform-point"></select></label><label>点の横位置（%）<input id="deform-x" type="number" min="-50" max="150" step="0.1" required></label><label>点の縦位置（%）<input id="deform-y" type="number" min="-50" max="150" step="0.1" required></label>
  <label class="motion-check"><input id="deform-grid" type="checkbox"> 選択素材の点と線を表示</label><button id="deform-apply" class="secondary">この点と開閉の形を反映</button><button id="deform-reset" type="button" class="secondary">選択中の形を元の形に戻す</button><button id="deform-remove" type="button" class="secondary">この素材の変形を解除</button><p id="deform-status" role="status" aria-live="polite"></p></form>
  <p class="muted">画像を縮めるだけでは自然な瞬きや口になりません。素材と形の調整が必要です。指での点編集は専用画面で行えます。表示範囲を長方形・楕円で制限できます。顔全体・左右の目・口をまとめて移動・回転できます。点・形は作業ファイルに保存し、元のPNG・PSDは変えません。</p>
  <p class="muted">表示条件・重なり順は作業ファイルに保存できます。初期設定は仮の値です。元画像の目・口は背景に残ります。開閉する素材がないと、切替時に部品が消える場合があります。PNG・PSDには表示設定を反映しません。</p></div></div>`;
  document.querySelector('.asset-panel').after(section);
  const $=s=>section.querySelector(s),canvas=$('#scene-canvas'),ctx=canvas.getContext('2d');
  for(const [value,text] of Object.entries(EXPRESSION_CONDITIONS)){const o=document.createElement('option');o.value=value;o.textContent=text;$('#scene-condition').append(o);}
  for(const [value,label] of Object.entries(GROUP_LABELS)){const o=document.createElement('option');o.value=value;o.textContent=label;$('#key-group').append(o);}
  for(const [value,label] of Object.entries(GROUP_KEY_LABELS)){const o=document.createElement('option');o.value=value;o.textContent=label;$('#key-position').append(o);}$('#key-position').value='center';
  const pointLabels=['左上','上中央','右上','左中央','中央','右中央','左下','下中央','右下'];
  pointLabels.forEach((text,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${i+1}：${text}`;$('#deform-point').append(o);});
  let source=null,assets=[],bitmaps=[],background=null,current='',generation=0,loading=false,error='',playing=false,raf=0,start=0,lastFrame='',lastTime=0;
  const layer=role=>getState().layers[role]||defaultExpressionLayer(role);
  const touchEditor=createExpressionTouchEditor({getState,onApply:(setting,key)=>{$('#deform-key').value=key;return applyShape(setting);}});
  const clipEditor=createAssetPlacementEditor({prefix:'clip-placement',region:true,isLocked:()=>getState().locked || loading,onApply:p=>applyClip({shape:$('#clip-shape').value,...p})});
  const groupEditor=createExpressionGroupEditor({getState,isLocked:()=>getState().locked || loading,onApply:setting=>{
    if(getState().locked || loading)return false;
    try{validateGroups(setting,getState().assets,getState().clips);stop();onGroups(setting);controls();draw();return true;}catch(e){$('#scene-group-status').textContent=e.message;return false;}
  }});
  const manual=()=>Object.fromEntries(['left','right','mouth','turn'].map(id=>[id,Number($(`#scene-${id}`).value)]));
  function render(ctx,values,override,groups=getState().groups,withKeys=true) {
    if(withKeys)groups=evaluateGroupKeys(groups,getState().groupKeys,values.turn||0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(background && $('#scene-background').value==='source')ctx.drawImage(background,0,0,canvas.width,canvas.height);
    for(const item of bitmaps.slice().sort((a,b)=>layer(a.role).order-layer(b.role).order || EXPRESSION_ROLES.findIndex(([id])=>id===a.role)-EXPRESSION_ROLES.findIndex(([id])=>id===b.role))) {
      if(!expressionLayerVisible(layer(item.role),values))continue;
      const p=getState().assets.find(a=>a.role===item.role)?.placement,setting=getState().deforms[item.role];
      const motionClip=getState().clipKeys[item.role];
      const clip=override?.role===item.role?override.setting:motionClip?interpolateClip(motionClip,values[motionClip.driver]):getState().clips[item.role];
      const follow=groups.clipFollow[item.role],matrix=groupMatrix(groups,groups.assignments[item.role],canvas.width,canvas.height);
      ctx.save();if(clip && !follow){clipPath(ctx,clip,canvas.width,canvas.height);ctx.clip();}
      ctx.transform(...matrix);if(clip && follow){clipPath(ctx,clip,canvas.width,canvas.height);ctx.clip();}
      if(p){if(setting)drawDeformed(ctx,item.bitmap,p,interpolateShape(setting,values[setting.driver]),canvas.width,canvas.height);else ctx.drawImage(item.bitmap,p.x*canvas.width,p.y*canvas.height,p.width*canvas.width,p.height*canvas.height);}
      ctx.restore();
    }
  }
  function draw(values=manual()) {
    render(ctx,values);
    if($('#deform-grid').checked) {
      const p=getState().assets.find(a=>a.role===current)?.placement,setting=getState().deforms[current];
      if(p && setting && expressionLayerVisible(layer(current),values)){const points=interpolateShape(setting,values[setting.driver]).map(([x,y])=>[(p.x+x*p.width)*canvas.width,(p.y+y*p.height)*canvas.height]);ctx.save();ctx.transform(...groupMatrix(evaluateGroupKeys(getState().groups,getState().groupKeys,values.turn||0),getState().groups.assignments[current],canvas.width,canvas.height));ctx.strokeStyle='#00ffff';ctx.fillStyle='#00ffff';ctx.lineWidth=1;for(const ids of TRIANGLES){ctx.beginPath();ids.forEach((i,j)=>j?ctx.lineTo(...points[i]):ctx.moveTo(...points[i]));ctx.closePath();ctx.stroke();}points.forEach((point,i)=>{ctx.beginPath();ctx.arc(...point,i===Number($('#deform-point').value)?5:3,0,Math.PI*2);ctx.fill();});ctx.restore();}
    }
    $('#scene-values').textContent=`${playing?'再生中：':'手動：'}左目 ${values.left.toFixed(2)} ／ 右目 ${values.right.toFixed(2)} ／ 口 ${values.mouth.toFixed(2)} ／ 向き ${(values.turn||0).toFixed(2)}`;
  }
  function stop(){playing=false;cancelAnimationFrame(raf);raf=0;$('#scene-play').textContent='瞬き・口の切替を再生';$('#scene-motion-play').textContent='向きと表情の動きを再生';draw();}
  function frame(now) {
    if(!playing)return;const t=(now-start)/1000,values={left:t%4>=3.6?0:1,right:t%4>=3.5 && t%4<3.9?0:1,mouth:t%2>=1?1:0},key=JSON.stringify(values);
    if(Object.keys(getState().deforms).length || Object.keys(getState().groupKeys).length || Object.keys(getState().clipKeys).length){
      if(now-lastTime>=33){const blink=phase=>phase<3.5?1:Math.abs((phase-3.5)/.25-1);draw({left:blink(t%4),right:blink((t+.1)%4),mouth:(1-Math.cos(t*Math.PI))/2,turn:Math.sin(t*Math.PI/2)});lastTime=now;}
    }else if(key!==lastFrame){lastFrame=key;draw(values);}raf=requestAnimationFrame(frame);
  }
  function fields(){const s=layer(current);$('#scene-order').value=s.order;$('#scene-condition').value=s.condition;$('#scene-enabled').checked=s.enabled;deformFields();clipFields();}
  function deformFields(){
    const setting=getState().deforms[current]||defaultDeform(current),point=setting[$('#deform-key').value][Number($('#deform-point').value)];
    $('#deform-driver').value=setting.driver;$('#deform-x').value=(point[0]*100).toFixed(1);$('#deform-y').value=(point[1]*100).toFixed(1);
    $('#deform-status').textContent=getState().deforms[current]?'変形設定あり。スライダーで途中の形も確認してください。':'変形は未設定です。反映してから動きを確認してください。';
  }
  function clipFields(){
    const state=getState(),key=$('#clip-key').value,base=state.clips[current]||{shape:'ellipse',...state.assets.find(a=>a.role===current)?.placement},motionClip=state.clipKeys[current];
    const s=key==='base'?base:motionClip?.[key]||base;
    $('#clip-driver').value=motionClip?.driver||defaultDeform(current).driver;
    $('#clip-driver-label').hidden=key==='base';$('#clip-thin').hidden=key!=='closed';
    $('#clip-shape').value=s.shape;for(const k of ['x','y','width','height'])$(`#clip-${k}`).value=Number((s[k]*100).toFixed(4));
    $('#clip-status').textContent=motionClip?'開閉する範囲を設定済み。固定範囲は保持しています。スライダーで途中も確認してください。':state.clips[current]?'表示範囲を設定済み。合成画面で隠れる部分を確認してください。':'範囲は未設定です。先に固定範囲を反映してください。';
  }
  function clipPreviewValues(){return $('#clip-key').value==='base'?manual():{...manual(),[$('#clip-driver').value]:$('#clip-key').value==='closed'?0:1};}
  function inputClip(){return {shape:$('#clip-shape').value,...Object.fromEntries(['x','y','width','height'].map(k=>[k,Number($(`#clip-${k}`).value)/100]))};}
  function applyClip(setting){
    if(getState().locked || loading || !current)return false;
    try {
      const state=getState(),key=$('#clip-key').value;
      validateClips({[current]:setting},state.assets);
      if(key==='base'){stop();onClip(current,setting);}
      else {
        const next=structuredClone(state.clipKeys[current]||defaultClipKeys(state.clips[current],$('#clip-driver').value));next.driver=$('#clip-driver').value;next[key]=setting;
        validateClipKeys({[current]:next},state.assets,state.clips);stop();onClipKeys(current,next);$(`#scene-${next.driver}`).value=key==='closed'?'0':'1';
      }
      clipFields();draw();controls();return true;
    }
    catch(e){$('#clip-status').textContent=e.message;return false;}
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
    for(const input of $('#clip-form').querySelectorAll('input,select,button'))input.disabled=disabled || playing;
    $('#clip-keys-remove').disabled=disabled || playing || !state.clipKeys[current];
    for(const option of $('#clip-key').options)option.disabled=option.value!=='base' && !state.clips[current];
    const keyed=$('#clip-key').value!=='base';$('#clip-shape').disabled=disabled || playing || keyed;$('#clip-apply').disabled=disabled || playing || (keyed && !state.clips[current]);$('#clip-touch').disabled=$('#clip-apply').disabled;
    $('#clip-remove').disabled=disabled || playing || !state.clips[current];
    $('#deform-remove').disabled=disabled || playing || !state.deforms[current];
    for(const id of ['left','right','mouth','turn'])$(`#scene-${id}`).disabled=disabled || playing;
    const group=$('#key-group').value,assigned=groupMembers(state.groups,group,state.assets).length;for(const id of ['edit','use-base'])$(`#key-${id}`).disabled=disabled || playing || !assigned;$('#key-remove').disabled=disabled || playing || !state.groupKeys[group];$('#key-group').disabled=disabled || playing;$('#key-position').disabled=disabled || playing;$('#key-status').textContent=state.groupKeys[group]?'左・中央・右の動きあり。向きのスライダーで途中も確認できます。':assigned?'動きは未設定です。編集を確定するまで通常の配置を使います。':'先に「素材をまとめて動かす」でこのグループへ素材を割り当ててください。';
    $('#scene-group-status').textContent=hasGroups(state.groups)?'まとめて動かす設定あり。個別の配置・点の編集はグループを適用する前の値です。':'素材をまとめて移動・回転できます。設定は確定するまで適用しません。';
    $('#scene-status').textContent=loading?'表情の合成を準備しています…':error || (assets.length?`${assets.length}素材。切替時の隙間や重なりを確認してください。読み込み済みでも品質・動作は未確認です。`:'上の「表情素材の読み込み・位置合わせ」でPNGを用意してください。');
  }
  function release(){groupEditor.close();clipEditor.close();background?.close();background=null;bitmaps.forEach(a=>a.bitmap.close());bitmaps=[];ctx.clearRect(0,0,canvas.width,canvas.height);}
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
    if(changed || state.locked){touchEditor.close();clipEditor.close();groupEditor.close();}
    if(!changed && state.assets.some((a,i)=>['x','y','width','height'].some(k=>a.placement[k]!==assets[i].placement[k]))){clipEditor.close();groupEditor.close();stop();assets=[...state.assets];if(current)clipFields();}
    if(source!==state.file){$('#clip-key').value='base';$('#scene-turn').value='0';$('#scene-left').value='1';$('#scene-right').value='1';$('#scene-mouth').value='0';}
    if(changed) {
      stop();generation++;release();source=state.file;assets=[...state.assets];loading=Boolean(source && assets.length);error='';
      if(!assets.some(a=>a.role===current)){current=assets[0]?.role||'';$('#clip-key').value='base';}
      $('#scene-role').replaceChildren(...assets.map(a=>{const o=document.createElement('option');o.value=a.role;o.textContent=EXPRESSION_ROLES.find(([id])=>id===a.role)[1];return o;}));$('#scene-role').value=current;
      if(current)fields();if(loading)void load(generation,source,[...assets]);
      if(!source){$('#scene-left').value='1';$('#scene-right').value='1';$('#scene-mouth').value='0';}
    }
    controls();if(!playing)draw();
  }
  $('#scene-role').addEventListener('change',()=>{groupEditor.close();clipEditor.close();touchEditor.close();stop();$('#clip-key').value='base';current=$('#scene-role').value;fields();draw();controls();});
  for(const id of ['left','right','mouth','turn'])$(`#scene-${id}`).addEventListener('input',()=>draw());
  $('#scene-background').addEventListener('change',()=>{stop();controls();});
  $('#scene-layer').addEventListener('submit',event=>{
    event.preventDefault();if(getState().locked || loading || !current || !$('#scene-layer').reportValidity())return;
    stop();onChange(current,{order:Number($('#scene-order').value),condition:$('#scene-condition').value,enabled:$('#scene-enabled').checked});draw();controls();
  });
  for(const id of ['key','point'])$(`#deform-${id}`).addEventListener('change',()=>{deformFields();const setting=getState().deforms[current];if(setting && id==='key')$(`#scene-${setting.driver}`).value=$('#deform-key').value==='closed'?'0':'1';draw();});
  $('#scene-groups').addEventListener('click',()=>{if(getState().locked || loading || !bitmaps.length)return;stop();controls();groupEditor.open({width:canvas.width,height:canvas.height,renderPreview:(target,groups)=>render(target,manual(),undefined,groups,false)});});
  $('#deform-touch').addEventListener('click',()=>{const item=bitmaps.find(a=>a.role===current);if(getState().locked || loading || !item)return;stop();controls();touchEditor.open({role:current,bitmap:item.bitmap,setting:getState().deforms[current],key:$('#deform-key').value,name:EXPRESSION_ROLES.find(([id])=>id===current)[1]});});
  $('#clip-form').addEventListener('submit',e=>{e.preventDefault();if(getState().locked || loading || playing || !$('#clip-form').reportValidity())return;applyClip(inputClip());});
  $('#clip-touch').addEventListener('click',()=>{
    if(getState().locked || loading || playing || !current || !background || !$('#clip-form').reportValidity())return;
    const s=inputClip();try{validateClips({[current]:s},getState().assets);}catch(e){$('#clip-status').textContent=e.message;return;}
    stop();controls();const values=clipPreviewValues();clipEditor.open({asset:{name:EXPRESSION_ROLES.find(([id])=>id===current)[1]+($('#clip-key').value==='base'?'':`：${$('#clip-key').value==='closed'?'閉じた範囲（0）':'開いた範囲（1）'}・${CLIP_DRIVERS[$('#clip-driver').value]}`),placement:s},sourceBitmap:canvas,sourceVisible:false,shape:s.shape,outlineMatrix:getState().groups.clipFollow[current]?groupMatrix(evaluateGroupKeys(getState().groups,getState().groupKeys,manual().turn),getState().groups.assignments[current],canvas.width,canvas.height):IDENTITY,renderPreview:(target,p)=>render(target,values,{role:current,setting:{shape:s.shape,...p}})});
  });
  $('#clip-key').addEventListener('change',()=>{clipEditor.close();stop();clipFields();controls();});
  $('#clip-driver').addEventListener('change',()=>clipEditor.close());
  $('#clip-thin').addEventListener('click',()=>{if(getState().locked || loading || playing || $('#clip-key').value!=='closed' || !getState().clips[current])return;const base=inputClip(),height=Math.max(.0001,base.height*.05);applyClip({...base,y:Math.min(1,base.y+(base.height-height)/2),height});});
  $('#clip-keys-remove').addEventListener('click',()=>{if(getState().locked || loading || playing || !current)return;stop();onClipKeys(current,null);$('#clip-key').value='base';clipFields();controls();draw();});
  $('#clip-remove').addEventListener('click',()=>{if(getState().locked || loading || playing || !current)return;stop();onClip(current,null);$('#clip-key').value='base';clipFields();draw();controls();});
  $('#deform-grid').addEventListener('change',()=>draw());
  $('#deform-form').addEventListener('submit',event=>{event.preventDefault();if(getState().locked || loading || playing || !current || !$('#deform-form').reportValidity())return;const s=structuredClone(getState().deforms[current]||defaultDeform(current));s.driver=$('#deform-driver').value;s[$('#deform-key').value][Number($('#deform-point').value)]=[Number($('#deform-x').value)/100,Number($('#deform-y').value)/100];applyShape(s);});
  $('#deform-reset').addEventListener('click',()=>{if(getState().locked || loading || playing || !current)return;const s=structuredClone(getState().deforms[current]||defaultDeform(current));s.driver=$('#deform-driver').value;s[$('#deform-key').value]=GRID.map(p=>[...p]);applyShape(s);});
  $('#deform-remove').addEventListener('click',()=>{if(getState().locked || loading || playing || !current)return;stop();onDeform(current,null);fields();draw();controls();});
  for(const id of ['group','position'])$(`#key-${id}`).addEventListener('change',()=>{groupEditor.close();controls();});
  function applyKeys(next){if(getState().locked || loading)return false;try{validateGroupKeys(next,getState().groups,getState().assets,getState().clips);stop();onGroupKeys(next);controls();draw();return true;}catch(e){$('#key-status').textContent=e.message;return false;}}
  $('#key-use-base').addEventListener('click',()=>{if(getState().locked || playing || loading)return;const id=$('#key-group').value;applyKeys({...getState().groupKeys,[id]:defaultGroupKeys(getState().groups,id)});});
  $('#key-remove').addEventListener('click',()=>{if(getState().locked || playing || loading)return;const next={...getState().groupKeys};delete next[$('#key-group').value];applyKeys(next);});
  $('#key-edit').addEventListener('click',()=>{
    const state=getState(),id=$('#key-group').value,key=$('#key-position').value;if(state.locked || loading || playing || !groupMembers(state.groups,id,state.assets).length)return;
    stop();const value={negative:-1,center:0,positive:1}[key],setting=structuredClone(state.groupKeys[id]||defaultGroupKeys(state.groups,id)),initial=evaluateGroupKeys(state.groups,state.groupKeys,value);initial.transforms[id]={...setting[key]};
    groupEditor.open({width:canvas.width,height:canvas.height,editGroup:id,keyLabel:GROUP_KEY_LABELS[key],initialGroups:initial,renderPreview:(target,groups)=>render(target,{...manual(),turn:value},undefined,groups,false),onConfirm:groups=>{setting[key]={...(groups.transforms[id]||defaultGroupTransform())};const ok=applyKeys({...getState().groupKeys,[id]:setting});if(ok){$('#scene-turn').value=String(value);draw();}return ok;}});
  });
  function togglePlayback(){if(playing){stop();controls();return;}if(getState().locked || loading || !bitmaps.length)return;playing=true;start=performance.now();lastFrame='';lastTime=0;$('#scene-play').textContent='再生を停止';$('#scene-motion-play').textContent='再生を停止';controls();raf=requestAnimationFrame(frame);}
  $('#scene-play').addEventListener('click',togglePlayback);$('#scene-motion-play').addEventListener('click',togglePlayback);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();controls();}});
  return {update};
}
