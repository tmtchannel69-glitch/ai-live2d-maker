import {EXPRESSION_ROLES} from './expression-assets.js';
import {loadInspectionDetail} from './inspection-detail.js';
import {releaseDeformationLayer} from './expression-deform.js';
import {createExpressionComparison} from './expression-comparison.js';

// View-only settings: never written to the project or exported images.
export function createExpressionInspector({isLocked,render,onEdit}) {
  const dialog=document.createElement('dialog');dialog.id='expression-inspector';dialog.className='expression-inspector';dialog.setAttribute('aria-labelledby','inspector-heading');
  dialog.innerHTML=`<div class="dialog-header"><h2 id="inspector-heading">表情を拡大して確認</h2><button id="inspector-close" class="secondary">確認画面を戻る</button></div>
  <label>確認する素材<select id="inspector-role"></select></label>
  <div class="inspector-tools"><label>拡大<select id="inspector-zoom"><option value="1">100%</option><option value="2">200%</option><option value="4">400%</option></select></label><button id="inspector-focus" class="secondary">選んだ素材へ移動</button><button id="inspector-fit" class="secondary">全体を表示</button></div>
  <div id="inspector-viewport" tabindex="0" aria-label="拡大プレビュー。指でスクロール、キーボードは矢印で移動"><div id="inspector-content"><canvas id="inspector-canvas" aria-label="表情の詳細プレビュー"></canvas></div></div>
  <p id="inspector-status" role="status" aria-live="polite"></p>
  <button id="inspector-detail" class="secondary" aria-pressed="false">鮮明に確認</button><p id="inspector-detail-status" role="status" aria-live="polite"></p>
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
  let detail=null,detailLoading=false,detailGeneration=0,baseWidth=1,baseHeight=1,originalFile=null,originalAssets=[];
  const comparison=createExpressionComparison({container:controlsPanel,render,isLocked,onSelect:v=>{for(const id of ['left','right','mouth','turn'])$(`#inspector-${id}`).value=v[id];syncComparison();draw();focusSelected();}});
  controlsPanel.insertBefore(comparison.tools,$('#inspector-detail'));
  previewPanel.insertBefore(comparison.panel,$('#inspector-status'));
  function syncComparison(){viewport.hidden=comparison.active;$('#inspector-focus').disabled=comparison.active || !bounds || isLocked();$('#inspector-fit').disabled=comparison.active;$('#inspector-zoom').disabled=comparison.active;if(!comparison.active)layout();}
  controlsPanel.addEventListener('comparisonchange',()=>{syncComparison();draw();});
  function releaseDetail(){
    detailGeneration++;detail?.close();detail=null;detailLoading=false;
    releaseDeformationLayer(ctx);releaseDeformationLayer(isolatedCtx);
    canvas.width=baseWidth;canvas.height=baseHeight;
    $('#inspector-detail').textContent='鮮明に確認';$('#inspector-detail').setAttribute('aria-pressed','false');canvas.setAttribute('aria-busy','false');
    $('#inspector-detail-status').textContent='通常表示。細部を確認するときだけ鮮明表示へ切り替えられます。';
  }
  async function toggleDetail(){
    if(isLocked() || !dialog.open)return;
    if(detail || detailLoading){releaseDetail();layout();draw();return;}
    const ticket=++detailGeneration;detailLoading=true;canvas.setAttribute('aria-busy','true');
    $('#inspector-detail').textContent='読み込みを中止';$('#inspector-detail-status').textContent='元PNGから確認用の画像を読み込んでいます。現在の表示はそのまま操作できます。';
    const isCurrent=()=>ticket===detailGeneration && dialog.open && !isLocked();
    try{
      const loaded=await loadInspectionDetail({file:originalFile,assets:originalAssets,width:baseWidth*2,height:baseHeight*2,isCurrent});
      if(!isCurrent()){loaded.close();return;}
      detail=loaded;detailLoading=false;canvas.width=baseWidth*2;canvas.height=baseHeight*2;layout();draw();
      $('#inspector-detail').textContent='通常表示に戻す';$('#inspector-detail').setAttribute('aria-pressed','true');
      $('#inspector-detail-status').textContent='鮮明表示。元PNGから読み直しました。素材の大きさと読込量の上限により細部の見え方は異なります。';
    }catch(error){
      if(ticket===detailGeneration){releaseDetail();layout();draw();$('#inspector-detail-status').textContent='鮮明表示を読み込めませんでした。通常表示と素材は保持しています。もう一度試せます。';}
    }finally{if(ticket===detailGeneration)canvas.setAttribute('aria-busy','false');}
  }
  const values=()=>Object.fromEntries(['left','right','mouth','turn'].map(id=>[id,Number($(`#inspector-${id}`).value)]));
  function draw(){
    if(!dialog.open)return;
    const v=values(),role=$('#inspector-role').value;
    comparison.draw({ctx,values:v,role,view:{role:$('#inspector-isolate').checked?role:null,sourceOpacity:$('#inspector-reference').checked?.25:0,detail},width:baseWidth,height:baseHeight});
    render(ctx,v,{role:$('#inspector-isolate').checked?role:null,sourceOpacity:$('#inspector-reference').checked?.25:0,detail});
    render(isolatedCtx,v,{role,sourceOpacity:0,detail});
    const data=isolatedCtx.getImageData(0,0,isolated.width,isolated.height).data;let left=isolated.width,top=isolated.height,right=-1,bottom=-1;
    for(let y=0;y<isolated.height;y++)for(let x=0;x<isolated.width;x++)if(data[(y*isolated.width+x)*4+3]>0){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
    bounds=right<0?null:{x:(left+right+1)/2/isolated.width,y:(top+bottom+1)/2/isolated.height};
    $('#inspector-focus').disabled=comparison.active || !bounds || isLocked();
    $('#inspector-status').textContent=comparison.active?'気になる状態の「この状態を詳しく」から拡大確認し、表示・形・範囲の編集へ戻れます。':bounds?'選択素材の描画位置を確認できました。素材へ移動すると400%で表示します。重なりは合成表示でも確認してください。':'選択素材はこの状態では見えません。開閉値・表示条件・表示範囲を確認してください。';
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
  function close(restore=true){restoreFocus=restore;comparison.close();syncComparison();releaseDetail();if(dialog.open)dialog.close();}
  $('#inspector-close').addEventListener('click',()=>close());
  dialog.addEventListener('close',()=>{comparison.close();syncComparison();releaseDetail();originalFile=null;originalAssets=[];ctx.clearRect(0,0,canvas.width,canvas.height);isolatedCtx.clearRect(0,0,isolated.width,isolated.height);bounds=null;if(restoreFocus)opener?.focus({preventScroll:true});});
  $('#inspector-detail').addEventListener('click',toggleDetail);
  $('#inspector-zoom').addEventListener('change',()=>layout());
  $('#inspector-focus').addEventListener('click',focusSelected);
  $('#inspector-fit').addEventListener('click',()=>{$('#inspector-zoom').value='1';layout(false);});
  for(const id of ['role','isolate','reference'])$(`#inspector-${id}`).addEventListener('change',draw);
  for(const id of ['left','right','mouth','turn'])$(`#inspector-${id}`).addEventListener('input',draw);
  for(const kind of ['layer','deform','clip'])$(`#inspector-edit-${kind}`).addEventListener('click',()=>{if(isLocked())return;const role=$('#inspector-role').value,v=values();close(false);onEdit({kind,role},v);});
  new ResizeObserver(()=>layout()).observe(viewport);
  return {close,open({width,height,assets,file,role,pose}){
    if(isLocked() || !assets.length)return false;
    restoreFocus=true;opener=document.activeElement;roles=assets.map(a=>a.role);$('#inspector-role').replaceChildren(...roles.map(id=>new Option(EXPRESSION_ROLES.find(([key])=>key===id)[1],id)));$('#inspector-role').value=roles.includes(role)?role:roles[0];
    baseWidth=width;baseHeight=height;originalFile=file;originalAssets=[...assets];releaseDetail();canvas.width=isolated.width=width;canvas.height=isolated.height=height;
    comparison.reset($('#inspector-role').value);syncComparison();
    for(const id of ['left','right','mouth','turn'])$(`#inspector-${id}`).value=pose[id];
    $('#inspector-zoom').value='1';$('#inspector-isolate').checked=false;$('#inspector-reference').checked=false;
    dialog.showModal();controlsPanel.scrollTop=0;layout(false);draw();$('#inspector-close').focus();return true;
  }};
}
