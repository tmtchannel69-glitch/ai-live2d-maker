import {EXPRESSION_ROLES} from './expression-assets.js';

// View-only settings: never written to the project or exported images.
export function createExpressionInspector({isLocked,render,onEdit}) {
  const dialog=document.createElement('dialog');dialog.id='expression-inspector';dialog.className='expression-inspector';dialog.setAttribute('aria-labelledby','inspector-heading');
  dialog.innerHTML=`<div class="dialog-header"><h2 id="inspector-heading">表情を拡大して確認</h2><button id="inspector-close" class="secondary">確認画面を戻る</button></div>
  <label>確認する素材<select id="inspector-role"></select></label>
  <div class="inspector-tools"><label>拡大<select id="inspector-zoom"><option value="1">100%</option><option value="2">200%</option><option value="4">400%</option></select></label><button id="inspector-focus" class="secondary">選んだ素材へ移動</button><button id="inspector-fit" class="secondary">全体を表示</button></div>
  <div id="inspector-viewport" tabindex="0" aria-label="拡大プレビュー。指でスクロール、キーボードは矢印で移動"><div id="inspector-content"><canvas id="inspector-canvas" aria-label="表情の詳細プレビュー"></canvas></div></div>
  <p id="inspector-status" role="status" aria-live="polite"></p>
  <div class="inspector-options"><label><input id="inspector-isolate" type="checkbox">選択素材だけを確認</label><label><input id="inspector-reference" type="checkbox">元画像を薄く重ねる（位置比較）</label></div>
  <div class="inspector-values">${[['left','左目'],['right','右目'],['mouth','口'],['turn','顔の向き']].map(([id,label])=>`<label>${label}<input id="inspector-${id}" type="range" min="${id==='turn'?-1:0}" max="1" step="0.05"></label>`).join('')}</div><p id="inspector-values-text" class="muted"></p>
  <p class="muted">指で画像内をスクロールできます。拡大・移動・比較は確認用で、画像や保存設定を変えません。元画像の目・口は比較表示に残り、動きません。</p>
  <div class="inspector-edit"><button id="inspector-edit-layer" class="secondary">この素材の表示を調整</button><button id="inspector-edit-deform" class="secondary">この素材の形を調整</button><button id="inspector-edit-clip" class="secondary">この素材の範囲を調整</button></div>`;
  const layoutPanel=document.createElement('div'),previewPanel=document.createElement('div'),controlsPanel=document.createElement('div');
  layoutPanel.className='inspector-layout';previewPanel.className='inspector-preview';controlsPanel.className='inspector-controls';
  for(const node of [...dialog.children]){if(node.classList.contains('dialog-header'))continue;(['inspector-viewport','inspector-status'].includes(node.id)?previewPanel:controlsPanel).append(node);}
  layoutPanel.append(previewPanel,controlsPanel);dialog.append(layoutPanel);document.body.append(dialog);
  const $=s=>dialog.querySelector(s),canvas=$('#inspector-canvas'),ctx=canvas.getContext('2d'),viewport=$('#inspector-viewport'),content=$('#inspector-content');
  const isolated=document.createElement('canvas'),isolatedCtx=isolated.getContext('2d',{willReadFrequently:true});
  let bounds=null,fitWidth=1,fitHeight=1,displayWidth=1,displayHeight=1,roles=[],opener=null,restoreFocus=true;
  const values=()=>Object.fromEntries(['left','right','mouth','turn'].map(id=>[id,Number($(`#inspector-${id}`).value)]));
  function draw(){
    if(!dialog.open)return;
    const v=values(),role=$('#inspector-role').value;
    render(ctx,v,{role:$('#inspector-isolate').checked?role:null,sourceOpacity:$('#inspector-reference').checked?.25:0});
    render(isolatedCtx,v,{role,sourceOpacity:0});
    const data=isolatedCtx.getImageData(0,0,isolated.width,isolated.height).data;let left=isolated.width,top=isolated.height,right=-1,bottom=-1;
    for(let y=0;y<isolated.height;y++)for(let x=0;x<isolated.width;x++)if(data[(y*isolated.width+x)*4+3]>0){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
    bounds=right<0?null:{x:(left+right+1)/2/isolated.width,y:(top+bottom+1)/2/isolated.height};
    $('#inspector-focus').disabled=!bounds || isLocked();
    $('#inspector-status').textContent=bounds?'選択素材の描画位置を確認できました。素材へ移動すると400%で表示します。重なりは合成表示でも確認してください。':'選択素材はこの状態では見えません。開閉値・表示条件・表示範囲を確認してください。';
    $('#inspector-values-text').textContent=`左目 ${v.left.toFixed(2)} ／ 右目 ${v.right.toFixed(2)} ／ 口 ${v.mouth.toFixed(2)} ／ 向き ${v.turn.toFixed(2)}`;
  }
  function layout(keep=true){
    if(!dialog.open || !viewport.clientWidth)return;
    const oldWidth=displayWidth,oldHeight=displayHeight,cx=(viewport.scrollLeft+viewport.clientWidth/2-content.offsetWidth/2+oldWidth/2)/oldWidth,cy=(viewport.scrollTop+viewport.clientHeight/2-content.offsetHeight/2+oldHeight/2)/oldHeight;
    const scale=Math.min(viewport.clientWidth/canvas.width,viewport.clientHeight/canvas.height),zoom=Number($('#inspector-zoom').value);
    fitWidth=canvas.width*scale;fitHeight=canvas.height*scale;displayWidth=fitWidth*zoom;displayHeight=fitHeight*zoom;
    content.style.width=`${Math.max(viewport.clientWidth,displayWidth)}px`;content.style.height=`${Math.max(viewport.clientHeight,displayHeight)}px`;canvas.style.width=`${displayWidth}px`;canvas.style.height=`${displayHeight}px`;
    if(keep){viewport.scrollLeft=(content.offsetWidth-displayWidth)/2+cx*displayWidth-viewport.clientWidth/2;viewport.scrollTop=(content.offsetHeight-displayHeight)/2+cy*displayHeight-viewport.clientHeight/2;}else{viewport.scrollLeft=0;viewport.scrollTop=0;}
  }
  function focusSelected(){
    if(!bounds || isLocked())return;$('#inspector-zoom').value='4';layout(false);
    viewport.scrollLeft=(content.offsetWidth-displayWidth)/2+bounds.x*displayWidth-viewport.clientWidth/2;viewport.scrollTop=(content.offsetHeight-displayHeight)/2+bounds.y*displayHeight-viewport.clientHeight/2;viewport.focus({preventScroll:true});
  }
  function close(restore=true){restoreFocus=restore;if(dialog.open)dialog.close();}
  $('#inspector-close').addEventListener('click',()=>close());
  dialog.addEventListener('close',()=>{ctx.clearRect(0,0,canvas.width,canvas.height);isolatedCtx.clearRect(0,0,isolated.width,isolated.height);bounds=null;if(restoreFocus)opener?.focus({preventScroll:true});});
  $('#inspector-zoom').addEventListener('change',()=>layout());
  $('#inspector-focus').addEventListener('click',focusSelected);
  $('#inspector-fit').addEventListener('click',()=>{$('#inspector-zoom').value='1';layout(false);});
  for(const id of ['role','isolate','reference'])$(`#inspector-${id}`).addEventListener('change',draw);
  for(const id of ['left','right','mouth','turn'])$(`#inspector-${id}`).addEventListener('input',draw);
  for(const kind of ['layer','deform','clip'])$(`#inspector-edit-${kind}`).addEventListener('click',()=>{if(isLocked())return;const role=$('#inspector-role').value,v=values();close(false);onEdit({kind,role},v);});
  new ResizeObserver(()=>layout()).observe(viewport);
  return {close,open({width,height,assets,role,pose}){
    if(isLocked() || !assets.length)return false;
    restoreFocus=true;opener=document.activeElement;roles=assets.map(a=>a.role);$('#inspector-role').replaceChildren(...roles.map(id=>new Option(EXPRESSION_ROLES.find(([key])=>key===id)[1],id)));$('#inspector-role').value=roles.includes(role)?role:roles[0];
    canvas.width=isolated.width=width;canvas.height=isolated.height=height;
    for(const id of ['left','right','mouth','turn'])$(`#inspector-${id}`).value=pose[id];
    $('#inspector-zoom').value='1';$('#inspector-isolate').checked=false;$('#inspector-reference').checked=false;
    dialog.showModal();controlsPanel.scrollTop=0;layout(false);draw();$('#inspector-close').focus();return true;
  }};
}
