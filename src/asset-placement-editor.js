import {IDENTITY,inversePoint} from './expression-groups.js';
import {activateTouchButtons} from './touch-controls.js';

export function createAssetPlacementEditor({isLocked,onApply,prefix='placement',region=false}) {
  const dialog=document.createElement('dialog');dialog.id='placement-dialog';dialog.className='touch-editor-dialog';dialog.setAttribute('aria-labelledby','placement-title');
  dialog.innerHTML=`<div class="dialog-header"><h2 id="placement-title">指で素材の位置合わせ</h2><button id="placement-close" class="secondary">閉じる</button></div>
  <p id="placement-name"></p><p id="placement-help" class="muted">素材の枠を指で動かします。大きさを変えるときは右下の点を動かします。「配置を確定」するまで元の配置は変わりません。</p>
  <div class="touch-deform-toolbar"><label>指の操作<select id="placement-mode"><option value="move">素材を動かす</option><option value="resize">大きさを変える</option><option value="pan">拡大画面を移動</option></select></label><label>画面の拡大<select id="placement-zoom"><option value="1">1倍</option><option value="2">2倍</option><option value="3">3倍</option><option value="4">4倍</option></select></label></div>
  <label class="placement-opacity">素材の見え方<input id="placement-opacity" type="range" min="0.2" max="1" step="0.1" value="0.7"></label>
  <div id="placement-viewport" class="touch-editor-viewport"><canvas id="placement-canvas" aria-label="素材の配置編集。矢印でも位置を調整できます。"></canvas></div>
  <div class="touch-deform-nudges"><button class="secondary" data-placement-nudge="left">← 左</button><button class="secondary" data-placement-nudge="up">↑ 上</button><button class="secondary" data-placement-nudge="down">↓ 下</button><button class="secondary" data-placement-nudge="right">→ 右</button></div>
  <div class="touch-deform-history"><button id="placement-smaller" class="secondary">5%小さく</button><button id="placement-larger" class="secondary">5%大きく</button></div><p id="placement-status" role="status" aria-live="polite"></p>
  <div class="touch-deform-history"><button id="placement-undo" class="secondary">取り消し</button><button id="placement-redo" class="secondary">やり直し</button></div><div class="touch-deform-actions"><button id="placement-cancel" class="secondary">変更せず戻る</button><button id="placement-confirm" class="primary">配置を確定</button></div>`;
  if(prefix!=='placement') {
    dialog.id=`${prefix}-dialog`;dialog.setAttribute('aria-labelledby',`${prefix}-title`);
    for(const element of dialog.querySelectorAll('[id]'))element.id=element.id.replace('placement-',`${prefix}-`);
    for(const b of dialog.querySelectorAll('[data-placement-nudge]')){b.setAttribute(`data-${prefix}-nudge`,b.dataset.placementNudge);b.removeAttribute('data-placement-nudge');}
  }
  document.body.append(dialog);activateTouchButtons(dialog);
  const $=s=>dialog.querySelector(s.replace('#placement-',`#${prefix}-`)),canvas=$('#placement-canvas'),ctx=canvas.getContext('2d'),view=$('#placement-viewport');
  let draft=null,background=null,image=null,showBackground=true,gesture=null,undo=[],redo=[],renderer=null,outlineShape='rect',outlineMatrix=IDENTITY;
  if(region) {
    $('#placement-title').textContent='指で表示範囲を調整';$('#placement-help').textContent='明るい枠の内側だけに選択素材を表示します。枠を動かすか、右下の点で大きさを変えます。確定まで元の設定は変わりません。「幅・高さを変える」では縦横を別々に調整できます。';
    const stretch=document.createElement('option');stretch.value='stretch';stretch.textContent='幅・高さを変える';$('#placement-mode').append(stretch);
    $('#placement-mode option[value="move"]').textContent='範囲を動かす';$('#placement-confirm').textContent='範囲を確定';
    $('#placement-opacity').closest('label').hidden=true;canvas.setAttribute('aria-label','素材の表示範囲編集。矢印でも位置を調整できます。');
  }
  const clone=p=>({...p}),equal=(a,b)=>['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<1e-12);
  function controls() {
    $('#placement-undo').disabled=!undo.length || Boolean(gesture);$('#placement-redo').disabled=!redo.length || Boolean(gesture);
    if(draft)$('#placement-status').textContent=`左端 ${(draft.x*100).toFixed(2)}% ／ 上端 ${(draft.y*100).toFixed(2)}% ／ 幅 ${(draft.width*100).toFixed(2)}% ／ 高さ ${(draft.height*100).toFixed(2)}%。矢印は0.5%ずつ移動します。`;
  }
  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);if(!draft || (!image && !renderer))return;
    if(renderer)renderer(ctx,draft);else if(showBackground)ctx.drawImage(background,0,0,canvas.width,canvas.height);
    const p=draft,x=p.x*canvas.width,y=p.y*canvas.height,w=p.width*canvas.width,h=p.height*canvas.height;
    if(!renderer){ctx.save();ctx.globalAlpha=Number($('#placement-opacity').value);ctx.drawImage(image,x,y,w,h);ctx.restore();}
    const scale=canvas.width/(canvas.getBoundingClientRect().width||canvas.width)/Math.hypot(outlineMatrix[0],outlineMatrix[1]);ctx.save();ctx.transform(...outlineMatrix);ctx.strokeStyle='#7ef4ff';ctx.lineWidth=2*scale;if(outlineShape==='ellipse'){ctx.beginPath();ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2);ctx.stroke();}else ctx.strokeRect(x,y,w,h);ctx.fillStyle='#ffdb70';ctx.beginPath();ctx.arc(x+w,y+h,9*scale,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function remember(before){if(equal(before,draft))return;undo.push(before);if(undo.length>30)undo.shift();redo=[];}
  function scalePlacement(before,factor){const f=Math.max(Math.max(.0001/before.width,.0001/before.height),Math.min(Math.min(1/before.width,1/before.height),factor));return {...before,width:Math.max(.0001,Math.min(1,before.width*f)),height:Math.max(.0001,Math.min(1,before.height*f))};}
  function cancelGesture(){if(!gesture)return;const g=gesture;gesture=null;if(g.before)draft=g.before;if(canvas.hasPointerCapture(g.id))canvas.releasePointerCapture(g.id);draw();controls();}
  function close(){cancelGesture();if(dialog.open)dialog.close();draft=null;background=null;image=null;renderer=null;undo=[];redo=[];ctx.clearRect(0,0,canvas.width,canvas.height);}
  function position(e){const r=canvas.getBoundingClientRect(),p=inversePoint(outlineMatrix,[(e.clientX-r.left)/r.width*canvas.width,(e.clientY-r.top)/r.height*canvas.height]);return [p[0]/canvas.width,p[1]/canvas.height];}
  canvas.addEventListener('pointerdown',e=>{
    if(gesture){cancelGesture();return;}if(!draft || !e.isPrimary || e.button!==0)return;
    const mode=$('#placement-mode').value,start=position(e),raw=canvas.getBoundingClientRect(),factor=Math.hypot(outlineMatrix[0],outlineMatrix[1]),r={width:raw.width*factor,height:raw.height*factor},p=draft;
    if(['resize','stretch'].includes(mode) && Math.hypot((start[0]-p.x-p.width)*r.width,(start[1]-p.y-p.height)*r.height)>24)return;
    if(mode==='move' && (start[0]<p.x-24/r.width || start[0]>p.x+p.width+24/r.width || start[1]<p.y-24/r.height || start[1]>p.y+p.height+24/r.height))return;
    gesture={id:e.pointerId,mode,start,before:clone(draft),client:[e.clientX,e.clientY],scroll:[view.scrollLeft,view.scrollTop]};canvas.setPointerCapture(e.pointerId);controls();
  });
  canvas.addEventListener('pointermove',e=>{
    if(!gesture || gesture.id!==e.pointerId)return;const g=gesture;
    if(g.mode==='pan'){view.scrollLeft=g.scroll[0]+g.client[0]-e.clientX;view.scrollTop=g.scroll[1]+g.client[1]-e.clientY;return;}
    const pos=position(e),dx=pos[0]-g.start[0],dy=pos[1]-g.start[1];
    draft=g.mode==='stretch'?{...g.before,width:Math.max(.0001,Math.min(1,g.before.width+dx)),height:Math.max(.0001,Math.min(1,g.before.height+dy))}:g.mode==='resize'?scalePlacement(g.before,1+(dx/g.before.width+dy/g.before.height)/2):{...g.before,x:Math.max(0,Math.min(1,g.before.x+dx)),y:Math.max(0,Math.min(1,g.before.y+dy))};draw();controls();
  });
  canvas.addEventListener('pointerup',e=>{if(!gesture || gesture.id!==e.pointerId)return;const g=gesture;gesture=null;canvas.releasePointerCapture(e.pointerId);if(g.mode!=='pan')remember(g.before);controls();});
  canvas.addEventListener('pointercancel',cancelGesture);canvas.addEventListener('lostpointercapture',cancelGesture);
  $('#placement-mode').addEventListener('change',cancelGesture);
  $('#placement-zoom').addEventListener('change',()=>{cancelGesture();canvas.style.width=`${Number($('#placement-zoom').value)*100}%`;draw();});
  $('#placement-opacity').addEventListener('input',draw);
  for(const b of dialog.querySelectorAll(`[data-${prefix}-nudge]`))b.addEventListener('click',()=>{cancelGesture();if(!draft)return;const before=clone(draft),direction=b.getAttribute(`data-${prefix}-nudge`),k=['left','right'].includes(direction)?'x':'y';draft={...draft,[k]:Math.max(0,Math.min(1,draft[k]+(['left','up'].includes(direction)?-.005:.005)))};remember(before);draw();controls();});
  for(const [id,factor] of [['smaller',.95],['larger',1.05]])$(`#placement-${id}`).addEventListener('click',()=>{cancelGesture();if(!draft)return;const before=clone(draft);draft=scalePlacement(before,factor);remember(before);draw();controls();});
  $('#placement-undo').addEventListener('click',()=>{cancelGesture();if(!undo.length)return;redo.push(clone(draft));draft=undo.pop();draw();controls();});
  $('#placement-redo').addEventListener('click',()=>{cancelGesture();if(!redo.length)return;undo.push(clone(draft));draft=redo.pop();draw();controls();});
  for(const id of ['close','cancel'])$(`#placement-${id}`).addEventListener('click',close);
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  $('#placement-confirm').addEventListener('click',()=>{cancelGesture();if(!draft || isLocked()){close();return;}if(onApply(clone(draft)))close();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelGesture();});window.addEventListener('resize',()=>{cancelGesture();if(dialog.open)draw();});
  return {close,open({asset,sourceBitmap,assetBitmap,sourceVisible,renderPreview,shape='rect',outlineMatrix:matrix=IDENTITY}){close();draft=clone(asset.placement);background=sourceBitmap;image=assetBitmap;renderer=renderPreview;outlineShape=shape;outlineMatrix=matrix;showBackground=sourceVisible;canvas.width=background.width;canvas.height=background.height;canvas.style.width='100%';$('#placement-mode').value='move';$('#placement-zoom').value='1';$('#placement-opacity').value='.7';$('#placement-name').textContent=asset.name;dialog.showModal();view.scrollLeft=0;view.scrollTop=0;draw();controls();}};
}
