import {releaseDeformationLayer} from './expression-deform.js';

const DRIVERS=[['left','左目'],['right','右目'],['mouth','口'],['turn','顔の向き']];
// All cards use the union of the selected material's three painted bounds,
// so changes in size/position stay visible rather than being fitted separately.
export function createExpressionComparison({container,render,isLocked,onSelect}){
  const tools=document.createElement('div');tools.className='comparison-tools';
  tools.innerHTML='<button id="inspector-compare" class="secondary" aria-pressed="false">3状態を並べて比較</button><label>比較する動き<select id="comparison-driver"></select></label>';
  const panel=document.createElement('div');panel.id='inspector-comparison';panel.hidden=true;panel.setAttribute('aria-label','同じ範囲で3状態を比較');
  const strip=document.createElement('div');strip.className='comparison-strip';strip.tabIndex=0;strip.setAttribute('aria-label','比較画像。左右にスクロールできます');
  const cards=[0,1,2].map(i=>{const card=document.createElement('section');card.className='comparison-card';const title=document.createElement('p'),canvas=document.createElement('canvas'),button=document.createElement('button');canvas.width=384;canvas.height=256;button.className='secondary';button.textContent='この状態を詳しく';button.id=`comparison-pose-${i}`;card.append(title,canvas,button);strip.append(card);return {title,canvas,ctx:canvas.getContext('2d'),button};});
  const status=document.createElement('p');status.id='comparison-status';status.className='muted';status.setAttribute('role','status');panel.append(strip,status);
  container.append(tools);
  const driver=tools.querySelector('select'),toggle=tools.querySelector('button');DRIVERS.forEach(([id,label])=>driver.add(new Option(label,id)));
  const probe=document.createElement('canvas'),probeCtx=probe.getContext('2d',{willReadFrequently:true});let active=false,last=null;
  const poses=()=>driver.value==='turn'?[-1,0,1]:[0,.5,1];
  function clear(){cards.forEach(c=>c.ctx.clearRect(0,0,384,256));probe.width=probe.height=1;releaseDeformationLayer(probeCtx);last=null;}
  function setActive(value){active=value;panel.hidden=!active;toggle.setAttribute('aria-pressed',String(active));toggle.textContent=active?'1状態の確認に戻る':'3状態を並べて比較';driver.disabled=!active;if(!active)clear();}
  toggle.addEventListener('click',()=>{if(isLocked())return;setActive(!active);container.dispatchEvent(new Event('comparisonchange'));});
  driver.addEventListener('change',()=>container.dispatchEvent(new Event('comparisonchange')));
  cards.forEach((card,i)=>card.button.addEventListener('click',()=>{if(isLocked() || !last)return;const v={...last.values,[driver.value]:poses()[i]};setActive(false);onSelect(v);}));
  function draw({ctx,values,role,view,width,height}){
    if(!active)return;last={values:{...values}};
    const scale=Math.min(1,320/width,480/height);probe.width=Math.max(1,Math.round(width*scale));probe.height=Math.max(1,Math.round(height*scale));
    let left=probe.width,top=probe.height,right=-1,bottom=-1;const visible=[];
    for(const value of poses()){
      render(probeCtx,{...values,[driver.value]:value},{...view,role,sourceOpacity:0,excludeRole:null,sourceOnly:false});
      const data=probeCtx.getImageData(0,0,probe.width,probe.height).data;let found=false;
      for(let y=0;y<probe.height;y++)for(let x=0;x<probe.width;x++)if(data[(y*probe.width+x)*4+3]>0){found=true;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
      visible.push(found);
    }
    const pad=right<0?0:Math.max(4,Math.max(right-left+1,bottom-top+1)*.15);
    const x=right<0?0:Math.max(0,left-pad)/probe.width,y=right<0?0:Math.max(0,top-pad)/probe.height;
    const w=right<0?1:Math.min(probe.width,right+1+pad)/probe.width-x,h=right<0?1:Math.min(probe.height,bottom+1+pad)/probe.height-y;
    poses().forEach((value,i)=>{
      const card=cards[i],label=driver.value==='turn'?['左','中央','右'][i]:['閉じた','途中','開いた'][i];
      card.title.textContent=`${label}（${value}）${visible[i]?'':'・選択素材は非表示'}`;card.canvas.setAttribute('aria-label',`${label}の比較プレビュー`);
      render(ctx,{...values,[driver.value]:value},view);card.ctx.clearRect(0,0,384,256);
      const fit=Math.min(384/(w*ctx.canvas.width),256/(h*ctx.canvas.height)),cw=w*ctx.canvas.width*fit,ch=h*ctx.canvas.height*fit;
      card.ctx.drawImage(ctx.canvas,x*ctx.canvas.width,y*ctx.canvas.height,w*ctx.canvas.width,h*ctx.canvas.height,(384-cw)/2,(256-ch)/2,cw,ch);
    });
    status.textContent=right<0?'選択素材は3状態とも見えません。全体を表示しています。表示条件・範囲を確認してください。':'3枚は同じ範囲・倍率です。左右にスクロールして比較できます。他の開閉値と向きは現在の値を使います。品質確認済みの判定は行いません。';
    probeCtx.clearRect(0,0,probe.width,probe.height);
  }
  setActive(false);
  return {panel,tools,draw,get active(){return active;},reset(role){setActive(false);driver.value=role.endsWith('_l')?'left':role.endsWith('_r')?'right':'mouth';strip.scrollLeft=0;},close(){setActive(false);}};
}
