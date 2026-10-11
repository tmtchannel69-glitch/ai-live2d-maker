import {activateTouchButtons} from './touch-controls.js';
import {TRIANGLES,defaultDeform,validateDeforms,drawDeformed,interpolateShape,releaseDeformationLayer} from './expression-deform.js';
import {adjustShape} from './shape-adjustments.js';

export function createExpressionTouchEditor({getState,onApply,renderDraft}) {
  const dialog=document.createElement('dialog');dialog.id='touch-deform-dialog';dialog.setAttribute('aria-labelledby','touch-deform-title');
  dialog.innerHTML=`<div class="dialog-header"><h2 id="touch-deform-title">指で形を編集</h2><button id="touch-deform-close" class="secondary">閉じる</button></div>
  <p id="touch-deform-name"></p><p class="muted">点を指で動かします。細かい位置は矢印で調整できます。「形を反映」するまで元の設定は変わりません。反映すると表示条件は「常に表示」になります。</p>
  <div class="touch-deform-toolbar"><label>編集する形<select id="touch-deform-key"><option value="closed">閉じた形</option><option value="open">開いた形</option></select></label><label>拡大<select id="touch-deform-zoom"><option value="1">1倍</option><option value="2">2倍</option><option value="3">3倍</option></select></label><label>指の操作<select id="touch-deform-mode"><option value="edit">点を動かす</option><option value="pan">拡大画面を移動</option></select></label></div>
  <div id="touch-deform-viewport"><canvas id="touch-deform-canvas" width="512" height="512" aria-label="点を指で動かす形の編集。点の選択と矢印ボタンでも編集できます。"></canvas></div>
  <details id="touch-composite"><summary>重なりを確認（下書き）</summary><canvas id="touch-composite-canvas" width="1" height="1" aria-label="編集中の形と他の素材の重なりの下書きプレビュー"></canvas></details><div id="touch-composite-controls" hidden><div class="touch-composite-options"><label>確認の背景<select id="touch-composite-background"><option value="transparent">透明背景</option><option value="source">元画像・位置確認</option></select></label><label>確認の向き<input id="touch-composite-turn" type="range" min="-1" max="1" step="0.05" value="0"></label></div><p id="touch-composite-status" role="status">確認のみ。形を反映するまで元の設定は変わりません。</p></div>
  <label class="touch-deform-select">調整する点<select id="touch-deform-point"></select></label>
  <div class="touch-deform-nudges" aria-label="選択した点を0.5%ずつ動かす"><button class="secondary" data-nudge="left" aria-label="点を左へ">← 左</button><button class="secondary" data-nudge="up" aria-label="点を上へ">↑ 上</button><button class="secondary" data-nudge="down" aria-label="点を下へ">↓ 下</button><button class="secondary" data-nudge="right" aria-label="点を右へ">→ 右</button></div>
  <details class="touch-shape-adjustments"><summary>形全体をまとめて調整</summary><p class="muted">選んだ閉じた/開いた形だけを調整します。幅/厚みは今の形の中心から5%、移動は素材の大きさの0.5%ずつ。交差や範囲外になる操作は反映しません。</p><div class="touch-shape-buttons">${[['narrow','幅を狭める'],['widen','幅を広げる'],['thin','薄くする'],['thicken','厚くする'],['left','全体を左へ'],['right','全体を右へ'],['up','全体を上へ'],['down','全体を下へ']].map(([id,label])=>`<button class="secondary" data-shape="${id}">${label}</button>`).join('')}</div><button id="touch-shape-copy" class="secondary" data-shape="copy">もう一方の形をコピー</button><p class="muted">コピーも取り消せます。元PNGやもう一方の形は変えません。</p></details>
  <label class="touch-shape-preview"><input id="touch-shape-preview" type="checkbox">途中の形を確認（編集を一時停止）</label><label>確認する開き（0＝閉じる、1＝開く）<input id="touch-shape-value" type="range" min="0" max="1" step="0.05" value="0" disabled></label>
  <p id="touch-deform-status" role="status" aria-live="polite"></p><div class="touch-deform-history"><button id="touch-deform-undo" class="secondary">取り消し</button><button id="touch-deform-redo" class="secondary">やり直し</button></div>
  <div class="touch-deform-actions"><button id="touch-deform-cancel" class="secondary">変更せず戻る</button><button id="touch-deform-apply" class="primary">形を反映</button></div>`;
  document.body.append(dialog);
  activateTouchButtons(dialog);
  const $=s=>dialog.querySelector(s),canvas=$('#touch-deform-canvas'),ctx=canvas.getContext('2d');
  const composite=$('#touch-composite-canvas'),compositeCtx=composite.getContext('2d');
  const names=['左上','上中央','右上','左中央','中央','右中央','左下','下中央','右下'];
  names.forEach((name,i)=>{const option=document.createElement('option');option.value=i;option.textContent=`${i+1}：${name}`;$('#touch-deform-point').append(option);});
  let role='',draft=null,bitmap=null,placement=null,gesture=null,undo=[],redo=[];
  const key=()=>$('#touch-deform-key').value,selected=()=>Number($('#touch-deform-point').value);
  const preview=()=>$('#touch-shape-preview').checked;
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function controls(message='') {
    $('#touch-deform-undo').disabled=!undo.length || Boolean(gesture) || preview();$('#touch-deform-redo').disabled=!redo.length || Boolean(gesture) || preview();
    if(!draft)return;
    for(const button of dialog.querySelectorAll('[data-shape],[data-nudge]'))button.disabled=preview() || Boolean(gesture);
    $('#touch-deform-point').disabled=preview();$('#touch-shape-value').disabled=!preview();$('#touch-deform-apply').disabled=preview() || Boolean(gesture);
    if(preview()){$('#touch-deform-status').textContent=`途中の形を確認中：開き ${Number($('#touch-shape-value').value).toFixed(2)}。編集に戻るには確認のチェックを外してください。`;return;}
    const p=draft[key()][selected()];$('#touch-deform-status').textContent=message || `${names[selected()]}：横 ${(p[0]*100).toFixed(1)}% ／ 縦 ${(p[1]*100).toFixed(1)}%`;
  }
  function draw() {
    ctx.clearRect(0,0,512,512);if(!draft || !bitmap)return;
    drawComposite();
    const points=preview()?interpolateShape(draft,Number($('#touch-shape-value').value)):draft[key()];drawDeformed(ctx,bitmap,placement,points,512,512);
    const screen=points.map(([x,y])=>[(placement.x+x*placement.width)*512,(placement.y+y*placement.height)*512]);
    const scale=512/(canvas.getBoundingClientRect().width||512);
    ctx.save();ctx.strokeStyle='#7ef4ff';ctx.lineWidth=scale;
    for(const ids of TRIANGLES){ctx.beginPath();ids.forEach((i,j)=>j?ctx.lineTo(...screen[i]):ctx.moveTo(...screen[i]));ctx.closePath();ctx.stroke();}
    if(!preview())screen.forEach((p,i)=>{ctx.beginPath();ctx.fillStyle=i===selected()?'#ffdb70':'#7ef4ff';ctx.arc(...p,(i===selected()?8:6)*scale,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#10111b';ctx.lineWidth=2*scale;ctx.stroke();});ctx.restore();
  }
  function clearComposite(){compositeCtx.clearRect(0,0,composite.width,composite.height);releaseDeformationLayer(compositeCtx);composite.width=composite.height=1;}
  function drawComposite(){
    $('#touch-composite-controls').hidden=!$('#touch-composite').open;
    if(!$('#touch-composite').open || !renderDraft){clearComposite();return;}
    const value=preview()?Number($('#touch-shape-value').value):key()==='closed'?0:1;
    try{
      renderDraft(compositeCtx,{role,setting:draft,value,turn:Number($('#touch-composite-turn').value),source:$('#touch-composite-background').value==='source'});
      $('#touch-composite-status').textContent=`下書き：開き ${value.toFixed(2)} ／ 向き ${Number($('#touch-composite-turn').value).toFixed(2)}。反映後の「常に表示」で確認。非表示設定・範囲・他の素材で隠れる場合があります。`;
    }catch{clearComposite();$('#touch-composite-status').textContent='確認の描画に失敗しました。下書きは保持しています。閉じて開き直すと再試行できます。';}
  }
  function remember(previous){if(equal(previous,draft))return;undo.push(previous);if(undo.length>30)undo.shift();redo=[];}
  function move(point) {
    const next=structuredClone(draft);next[key()][selected()]=point.map(v=>Math.max(-.5,Math.min(1.5,v)));
    try{validateDeforms({[role]:next},getState().assets);draft=next;draw();controls();return true;}
    catch{controls('点が交差する位置には動かせません。少し戻して調整してください。');return false;}
  }
  function cancelGesture(){if(!gesture)return;const active=gesture;gesture=null;if(active.before)draft=active.before;if(canvas.hasPointerCapture(active.id))canvas.releasePointerCapture(active.id);draw();controls();}
  function close(){cancelGesture();if(dialog.open)dialog.close();bitmap=null;draft=null;undo=[];redo=[];ctx.clearRect(0,0,512,512);releaseDeformationLayer(ctx);clearComposite();$('#touch-composite').open=false;$('#touch-composite-controls').hidden=true;$('#touch-composite-status').textContent='確認のみ。形を反映するまで元の設定は変わりません。';}
  function coordinates(event){const r=canvas.getBoundingClientRect();return [(event.clientX-r.left)/r.width,(event.clientY-r.top)/r.height];}
  canvas.addEventListener('pointerdown',event=>{
    if(gesture){cancelGesture();return;}if(!draft || !event.isPrimary || event.button!==0)return;
    const r=canvas.getBoundingClientRect(),pos=coordinates(event);
    if($('#touch-deform-mode').value==='pan'){const view=$('#touch-deform-viewport');gesture={id:event.pointerId,pan:true,start:[event.clientX,event.clientY],scroll:[view.scrollLeft,view.scrollTop]};canvas.setPointerCapture(event.pointerId);controls();return;}
    if(preview())return;
    const distances=draft[key()].map(([x,y],i)=>({i,d:Math.hypot((placement.x+x*placement.width-pos[0])*r.width,(placement.y+y*placement.height-pos[1])*r.height)})).sort((a,b)=>a.d-b.d);
    if(distances[0].d>24)return;
    $('#touch-deform-point').value=distances[0].i;
    gesture={id:event.pointerId,start:pos,point:[...draft[key()][selected()]],before:structuredClone(draft)};canvas.setPointerCapture(event.pointerId);draw();controls();
  });
  canvas.addEventListener('pointermove',event=>{if(!gesture || gesture.id!==event.pointerId)return;if(gesture.pan){const view=$('#touch-deform-viewport');view.scrollLeft=gesture.scroll[0]+gesture.start[0]-event.clientX;view.scrollTop=gesture.scroll[1]+gesture.start[1]-event.clientY;return;}const p=coordinates(event);move([gesture.point[0]+(p[0]-gesture.start[0])/placement.width,gesture.point[1]+(p[1]-gesture.start[1])/placement.height]);});
  canvas.addEventListener('pointerup',event=>{if(!gesture || gesture.id!==event.pointerId)return;const previous=gesture.before;gesture=null;canvas.releasePointerCapture(event.pointerId);if(previous)remember(previous);controls();});
  canvas.addEventListener('pointercancel',cancelGesture);canvas.addEventListener('lostpointercapture',cancelGesture);
  for(const id of ['key','point','mode'])$(`#touch-deform-${id}`).addEventListener('change',()=>{cancelGesture();if(id==='key'){$('#touch-shape-preview').checked=false;$('#touch-shape-value').value=key()==='closed'?'0':'1';}draw();controls();});
  $('#touch-deform-zoom').addEventListener('change',()=>{cancelGesture();canvas.style.width=`${Number($('#touch-deform-zoom').value)*100}%`;draw();});
  for(const button of dialog.querySelectorAll('[data-nudge]'))button.addEventListener('click',()=>{if(preview() || !draft)return;cancelGesture();const p=[...draft[key()][selected()]],previous=structuredClone(draft),direction=button.dataset.nudge;p[['left','right'].includes(direction)?0:1]+=['left','up'].includes(direction)?-.005:.005;if(move(p))remember(previous);controls($('#touch-deform-status').textContent);});
  for(const button of dialog.querySelectorAll('[data-shape]'))button.addEventListener('click',()=>{if(preview() || !draft || getState().locked)return;cancelGesture();const previous=structuredClone(draft);try{draft=adjustShape(draft,key(),button.dataset.shape,role,getState().assets);remember(previous);draw();controls('選んだ形全体を調整しました。反映前に途中の形も確認できます。');}catch(error){controls(`この調整は反映できません。以前の形を保持しています。${error.message}`);}});
  $('#touch-composite').addEventListener('toggle',()=>{cancelGesture();if(draft)drawComposite();else clearComposite();});
  for(const [id,event] of [['background','change'],['turn','input']])$(`#touch-composite-${id}`).addEventListener(event,()=>{cancelGesture();if(draft)drawComposite();});
  $('#touch-shape-preview').addEventListener('change',()=>{cancelGesture();draw();controls();});
  $('#touch-shape-value').addEventListener('input',()=>{if(preview()){draw();controls();}});
  $('#touch-deform-undo').addEventListener('click',()=>{if(preview())return;cancelGesture();if(!undo.length)return;redo.push(structuredClone(draft));draft=undo.pop();draw();controls();});
  $('#touch-deform-redo').addEventListener('click',()=>{if(preview())return;cancelGesture();if(!redo.length)return;undo.push(structuredClone(draft));draft=redo.pop();draw();controls();});
  for(const id of ['close','cancel'])$(`#touch-deform-${id}`).addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('#touch-deform-apply').addEventListener('click',()=>{if(preview())return;cancelGesture();if(getState().locked){close();return;}if(onApply(structuredClone(draft),key()))close();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelGesture();});
  return {
    open({role:chosen,bitmap:image,setting,key:chosenKey,name,turn=0}) {
      close();role=chosen;bitmap=image;draft=structuredClone(setting||defaultDeform(role));
      const ratio=bitmap.width/bitmap.height,w=Math.min(.5,.5*ratio),h=w/ratio;placement={x:(1-w)/2,y:(1-h)/2,width:w,height:h};
      $('#touch-deform-name').textContent=name;$('#touch-deform-key').value=chosenKey;$('#touch-deform-point').value='4';$('#touch-deform-mode').value='edit';$('#touch-deform-zoom').value='1';$('#touch-shape-preview').checked=false;$('#touch-shape-value').value=chosenKey==='closed'?'0':'1';$('.touch-shape-adjustments').open=false;canvas.style.width='100%';
      $('#touch-composite-background').value='transparent';$('#touch-composite-turn').value=turn;
      dialog.showModal();$('#touch-deform-viewport').scrollTop=0;$('#touch-deform-viewport').scrollLeft=0;draw();controls();
    },close,
  };
}
