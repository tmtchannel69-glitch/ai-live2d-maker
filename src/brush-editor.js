import { createBrushMask } from './brush-mask.js';

export function createBrushEditor({ getSource, getCurrent, onApply, labels }) {
  const dialog=document.createElement('dialog');dialog.id='brush-dialog';dialog.setAttribute('aria-labelledby','brush-title');
  dialog.innerHTML=`<div class="dialog-header"><h2 id="brush-title">ブラシで補正</h2><button id="brush-cancel" class="secondary">閉じる・反映しない</button></div>
    <p class="muted">消すと透明に、戻すと元画像の色に戻ります。隠れた部分は描き足せません。反映するまで保存対象は変わりません。</p>
    <div class="brush-controls"><label>ブラシ <select id="brush-tool"><option value="erase">消す</option><option value="restore">元画像から戻す</option><option value="pan">画面を移動</option></select></label>
    <label>太さ <input id="brush-size" type="range" min="1" max="200" value="24"><output id="brush-size-value">24 px</output></label>
    <label>拡大 <select id="brush-zoom"><option value="1">100%</option><option value="2">200%</option><option value="4">400%</option></select></label></div>
    <div class="brush-controls"><label>表示 <select id="brush-view"><option value="edited">補正中</option><option value="before">補正前（確認用）</option></select></label>
    <label class="brush-overlay-label"><input id="brush-overlay" type="checkbox">元画像を薄く重ねる</label></div>
    <div class="brush-viewport"><div class="brush-stage"><canvas id="brush-canvas" aria-label="画像上をなぞって補正"></canvas></div></div>
    <details><summary>数値でブラシを置く（キーボード操作）</summary><form id="brush-coordinate-form"><div class="coordinate-grid"><label>X % <input name="brushx" type="number" min="0" max="100" step="0.1" value="50" required></label><label>Y % <input name="brushy" type="number" min="0" max="100" step="0.1" value="50" required></label></div><button class="secondary">ブラシを置く</button></form></details>
    <div class="brush-controls"><button id="brush-undo" class="secondary">一つ戻す</button><button id="brush-redo" class="secondary">やり直す</button></div>
    <button id="brush-apply" class="primary">補正を反映</button><p id="brush-status" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);
  const $=s=>dialog.querySelector(s), canvas=$('#brush-canvas'),ctx=canvas.getContext('2d');
  const mask=document.createElement('canvas'),mctx=mask.getContext('2d',{willReadFrequently:true});
  const output=document.createElement('canvas'),octx=output.getContext('2d');
  let source=null,before=null,state=null,part=null,version=0,saving=false,pointer=null,frame=0;
  function controls() {
    const ready=Boolean(state), editable=ready && !saving && $('#brush-view').value==='edited';
    for(const element of dialog.querySelectorAll('select,input,form button'))element.disabled=!ready || saving;
    $('#brush-undo').disabled=!editable || pointer!==null || !state?.canUndo;
    $('#brush-redo').disabled=!editable || pointer!==null || !state?.canRedo;
    $('#brush-apply').disabled=!ready || saving || !state.changed || pointer!==null;
    $('#brush-coordinate-form button').disabled=!editable || $('#brush-tool').value==='pan';
    canvas.style.touchAction=$('#brush-tool').value==='pan'?'auto':'none';
    canvas.setAttribute('aria-disabled',String(!editable));
  }
  function compose() {
    octx.clearRect(0,0,output.width,output.height);octx.drawImage(source,0,0);
    octx.globalCompositeOperation='destination-in';octx.drawImage(mask,0,0);octx.globalCompositeOperation='source-over';
  }
  function render() {
    if(!state)return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if($('#brush-overlay').checked){ctx.globalAlpha=.25;ctx.drawImage(source,0,0);ctx.globalAlpha=1;}
    if($('#brush-view').value==='before')ctx.drawImage(before,0,0);
    else {compose();ctx.drawImage(output,0,0);}
    controls();
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;render();});}
  function close() {version++;dialog.close();dispose();}
  function dispose() {
    cancelAnimationFrame(frame);frame=0;state?.dispose();state=null;pointer=null;saving=false;
    source?.close();before?.close();source=before=part=null;
    for(const c of [mask,output,canvas]){c.width=1;c.height=1;}
  }
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('#brush-cancel').addEventListener('click',close);
  const editable=()=>state && !saving && $('#brush-view').value==='edited';
  const paintable=()=>editable() && $('#brush-tool').value!=='pan';
  const position=e=>{const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width-1,(e.clientX-r.left)*canvas.width/r.width)),y:Math.max(0,Math.min(canvas.height-1,(e.clientY-r.top)*canvas.height/r.height))};};
  canvas.addEventListener('pointerdown',e=>{
    if(!paintable() || pointer!==null || !e.isPrimary || e.button!==0)return;
    pointer=e.pointerId;canvas.setPointerCapture(pointer);state.begin(position(e),$('#brush-tool').value,Number($('#brush-size').value));controls();schedule();
  });
  canvas.addEventListener('pointermove',e=>{
    if(pointer!==e.pointerId)return;
    if(state.move(position(e))===false){
      state.finish();pointer=null;canvas.releasePointerCapture(e.pointerId);render();
      $('#brush-status').textContent='長い操作を区切りました。続けてなぞってください。';
    } else schedule();
  });
  function finish(e,cancel=false){if(pointer!==e.pointerId)return;if(cancel)state.cancel();else{state.move(position(e));state.finish();}pointer=null;render();$('#brush-status').textContent=state.limited?'古い取り消し履歴を整理しました。未反映の補正があります。':'補正はまだ反映していません。';}
  canvas.addEventListener('pointerup',e=>finish(e));canvas.addEventListener('pointercancel',e=>finish(e,true));
  canvas.addEventListener('lostpointercapture',e=>{if(pointer===e.pointerId)finish(e,true);});
  $('#brush-coordinate-form').addEventListener('submit',e=>{
    e.preventDefault();if(!paintable() || pointer!==null)return;
    const form=new FormData(e.target),point={x:Math.min(canvas.width-1,Number(form.get('brushx'))/100*canvas.width),y:Math.min(canvas.height-1,Number(form.get('brushy'))/100*canvas.height)};
    state.begin(point,$('#brush-tool').value,Number($('#brush-size').value));state.finish();render();$('#brush-status').textContent='補正はまだ反映していません。';
  });
  for(const action of ['undo','redo'])$('#brush-'+action).addEventListener('click',()=>{if(editable() && pointer===null){state[action]();render();}});
  $('#brush-size').addEventListener('input',()=>{$('#brush-size-value').textContent=$('#brush-size').value+' px';});
  for(const id of ['brush-overlay','brush-view','brush-tool'])$('#'+id).addEventListener('change',()=>{if(pointer!==null){state.cancel();pointer=null;}render();});
  $('#brush-zoom').addEventListener('change',()=>{$('.brush-stage').style.width=Number($('#brush-zoom').value)*100+'%';});
  $('#brush-apply').addEventListener('click',async()=>{
    if(!state || saving || !state.changed || pointer!==null)return;
    const currentVersion=version,currentPart=part;saving=true;controls();$('#brush-status').textContent='PNG を準備しています…';
    try {
      compose();const blob=await new Promise((resolve,reject)=>output.toBlob(value=>value?resolve(value):reject(new Error('PNG を生成できませんでした。')),'image/png'));
      if(version!==currentVersion || getCurrent(currentPart.id)!==currentPart)return;
      onApply(currentPart,blob);close();
    } catch(error) {if(version===currentVersion)$('#brush-status').textContent=`反映に失敗しました。以前の結果は保持しています。${error.message}`;}
    finally {if(version===currentVersion){saving=false;controls();}}
  });
  controls();
  return {
    close,
    async open(result) {
      close();part=result;const currentVersion=version;
      $('#brush-title').textContent=`${labels[result.id]}をブラシで補正`;
      $('#brush-status').textContent='画像を読み込んでいます…';
      $('#brush-view').value='edited';$('#brush-zoom').value='1';$('#brush-overlay').checked=false;$('.brush-stage').style.width='100%';
      controls();dialog.showModal();
      let loaded=[];
      try {
        const settled=await Promise.allSettled([createImageBitmap(getSource()),createImageBitmap(result.blob)]);
        loaded=settled.filter(r=>r.status==='fulfilled').map(r=>r.value);
        if(version!==currentVersion){loaded.forEach(b=>b.close());return;}
        if(settled.some(r=>r.status==='rejected'))throw new Error('画像を読み込めませんでした。');
        [source,before]=loaded;
        if(source.width!==before.width || source.height!==before.height)throw new Error('元画像と同じサイズの AI 結果が必要です。');
        for(const c of [canvas,mask,output]){c.width=source.width;c.height=source.height;}
        mctx.drawImage(before,0,0);octx.drawImage(source,0,0);
        // The API PNG already includes source alpha. Normalize to a mask so
        // composition preserves semitransparency instead of multiplying twice.
        for(let y=0;y<mask.height;y+=256)for(let x=0;x<mask.width;x+=256){
          const w=Math.min(256,mask.width-x),h=Math.min(256,mask.height-y);
          const alpha=mctx.getImageData(x,y,w,h),original=octx.getImageData(x,y,w,h).data;
          for(let i=0;i<alpha.data.length;i+=4){
            alpha.data[i]=alpha.data[i+1]=alpha.data[i+2]=255;
            alpha.data[i+3]=original[i+3]?Math.min(255,Math.round(alpha.data[i+3]*255/original[i+3])):0;
          }
          mctx.putImageData(alpha,x,y);
        }
        state=createBrushMask(mask);render();$('#brush-status').textContent='なぞって補正できます。太さは元画像の px 単位です。';
      } catch(error) {
        loaded.forEach(b=>b.close());source=before=null;
        if(version===currentVersion){$('#brush-status').textContent=error.message;controls();}
      }
    },
  };
}
