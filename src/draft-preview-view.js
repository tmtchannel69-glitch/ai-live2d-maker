import {releaseDeformationLayer} from './expression-deform.js';

// Display-only zoom and navigation. Scan the selected rendered material only
// on explicit focus, then release its pixels; no persistent image/settings.
export function createDraftPreviewView({viewport,content,canvas,zoom,status,renderSelected}){
  let displayWidth=1,displayHeight=1,viewWidth=1,viewHeight=1,ready=false;
  const probe=document.createElement('canvas'),ctx=probe.getContext('2d',{willReadFrequently:true});
  function release(){releaseDeformationLayer(ctx);probe.width=probe.height=1;}
  function center(x,y){viewport.scrollLeft=(content.offsetWidth-displayWidth)/2+x*displayWidth-viewport.clientWidth/2;viewport.scrollTop=(content.offsetHeight-displayHeight)/2+y*displayHeight-viewport.clientHeight/2;}
  function layout(keep=true){
    if(!viewport.clientWidth || !viewport.clientHeight)return;
    const x=(viewport.scrollLeft+viewWidth/2-(content.offsetWidth-displayWidth)/2)/displayWidth,y=(viewport.scrollTop+viewHeight/2-(content.offsetHeight-displayHeight)/2)/displayHeight;
    const scale=Math.min(viewport.clientWidth/canvas.width,viewport.clientHeight/canvas.height)*Number(zoom.value);
    displayWidth=canvas.width*scale;displayHeight=canvas.height*scale;
    content.style.width=`${Math.max(viewport.clientWidth,displayWidth)}px`;content.style.height=`${Math.max(viewport.clientHeight,displayHeight)}px`;canvas.style.width=`${displayWidth}px`;canvas.style.height=`${displayHeight}px`;
    center(keep && ready?x:.5,keep && ready?y:.5);viewWidth=viewport.clientWidth;viewHeight=viewport.clientHeight;ready=true;
  }
  function focus(){
    try{
      renderSelected(ctx);
      const pixels=ctx.getImageData(0,0,probe.width,probe.height).data;let left=probe.width,top=probe.height,right=-1,bottom=-1;
      for(let y=0;y<probe.height;y++)for(let x=0;x<probe.width;x++)if(pixels[(y*probe.width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
      if(right<0){status.textContent='この状態では素材が見えません。開き・非表示設定・表示範囲を確認してください。';return;}
      zoom.value='4';layout(false);center((left+right+1)/2/probe.width,(top+bottom+1)/2/probe.height);viewport.focus({preventScroll:true});status.textContent='選んだ素材の描画位置を400%で表示しました。画像を指でスクロールできます。';
    }catch{status.textContent='素材の位置を確認できませんでした。下書きは保持しています。もう一度試せます。';}
    finally{release();}
  }
  function reset(){zoom.value='1';ready=false;layout(false);status.textContent='100%で全体を表示。拡大した画像は指でスクロールできます。';}
  function clear(){release();ready=false;zoom.value='1';viewport.scrollLeft=viewport.scrollTop=0;status.textContent='';}
  const observer=new ResizeObserver(()=>layout());observer.observe(viewport);
  return {layout,focus,reset,clear};
}
