// Offline foreground mask MVP for one 768x1024 portrait.
// Masks a whole foreground silhouette only. Not 33 anatomical part layers.
const W=768,H=1024;
const fail=(reason)=>{throw new Error(reason)};
const validRect=r=>r&&[r.x,r.y,r.width,r.height].every(Number.isInteger)&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=W&&r.y+r.height<=H;
const dist=(p,i,c)=>Math.max(Math.abs(p[i]-c[0]),Math.abs(p[i+1]-c[1]),Math.abs(p[i+2]-c[2]));
const rate=(part,all)=>Math.round(part/all*10000)/10000;

export function createForegroundMask(data,drawRect,{threshold=28}={}){
  if(!(data instanceof Uint8ClampedArray)||data.length!==W*H*4)fail('768×1024のRGBA画素が必要です。');
  if(!validRect(drawRect))fail('入力画像の配置が不正です。');
  if(!Number.isInteger(threshold)||threshold<6||threshold>48)fail('色差の設定が範囲外です。');
  const {x,y,width,height}=drawRect,area=width*height;
  const index=(px,py)=>py*W+px;
  let originalAlphaEmpty=0,originalVisible=0;
  // Ignore transparent letterbox margins: only examine original drawn area.
  for(let py=y;py<y+height;py++)for(let px=x;px<x+width;px++){
    const a=data[index(px,py)*4+3];
    if(a<=8)originalAlphaEmpty++;
    if(a>=32)originalVisible++;
  }
  if(originalVisible/area<0.01)fail('キャラクターの可視領域がほとんどありません。');
  const mask=new Uint8Array(W*H);
  let mode,background=null,backgroundPixels=0;
  if(originalAlphaEmpty/area>=0.005){
    mode='existing-alpha';
    for(let py=y;py<y+height;py++)for(let px=x;px<x+width;px++){
      const k=index(px,py);
      mask[k]=data[k*4+3];if(mask[k]===0)backgroundPixels++;
    }
  }else{
    mode='flat-background-flood';
    const cornerPoints=[[x+1,y+1],[x+width-2,y+1],[x+1,y+height-2],[x+width-2,y+height-2]];
    const colors=cornerPoints.map(([px,py])=>{
      const n=index(px,py)*4;return [data[n],data[n+1],data[n+2]];
    });
    const center=[0,1,2].map(c=>Math.round(colors.reduce((s,a)=>s+a[c],0)/4));
    if(colors.some(c=>Math.max(...c.map((v,i)=>Math.abs(v-center[i])))>14))
      fail('背景の四隅の色が一致しません。単色背景・透過背景以外は安全に切り抜けません。');
    background=center;
    const queue=new Uint32Array(W*H),visited=new Uint8Array(W*H);let head=0,tail=0;
    function consider(px,py){
      if(px<x||px>=x+width||py<y||py>=y+height)return;
      const k=index(px,py);
      if(visited[k])return;
      visited[k]=1;
      const offset=k*4;
      if(data[offset+3]<250||dist(data,offset,background)>threshold)return;
      queue[tail++]=k;
    }
    for(let px=x;px<x+width;px++){consider(px,y);consider(px,y+height-1);}
    for(let py=y;py<y+height;py++){consider(x,py);consider(x+width-1,py);}
    while(head<tail){
      const k=queue[head++],px=k%W,py=Math.floor(k/W);
      consider(px-1,py);consider(px+1,py);consider(px,py-1);consider(px,py+1);
    }
    backgroundPixels=tail;
    for(let py=y;py<y+height;py++)for(let px=x;px<x+width;px++){
      const k=index(px,py);mask[k]=visited[k]&&dist(data,k*4,background)<=threshold?0:255;
    }
    const fraction=backgroundPixels/area;
    if(fraction<.10)fail('単色背景を十分に検出できません。切り抜き結果を生成せず停止しました。');
  }
  let foregroundCount=0,lowAlpha=0,edgeForeground=0,minX=W,minY=H,maxX=-1,maxY=-1;
  for(let py=y;py<y+height;py++)for(let px=x;px<x+width;px++){
    const value=mask[index(px,py)];
    if(value>8){
      foregroundCount++;if(value<255)lowAlpha++;
      minX=Math.min(minX,px);minY=Math.min(minY,py);maxX=Math.max(maxX,px);maxY=Math.max(maxY,py);
      if(px===x||py===y||px===x+width-1||py===y+height-1)edgeForeground++;
    }
  }
  if(foregroundCount/area<.01||foregroundCount/area>.95)fail('前景と背景を安全に区別できません。');
  const warnings=[];
  if(edgeForeground>0)warnings.push('foreground-touches-input-edge');
  if(mode==='flat-background-flood')warnings.push('flat-background-color-loss-possible');
  if(lowAlpha===0)warnings.push('hard-mask-edges');
  const bounds=foregroundCount?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:null;
  return {mask,report:{
    format:'ai-live2d-foreground-mask-mvp',version:1,
    method:mode,canvas_size:[W,H],input_draw_rect:{...drawRect},
    foreground_fraction:rate(foregroundCount,area),
    background_fraction:rate(backgroundPixels,area),
    foreground_bounds:bounds,soft_edge_pixels:lowAlpha,
    background_corner_rgb:background,foreground_touches_source_edge:edgeForeground>0,
    warning_codes:warnings,foreground_mask_generated:true,independent_parts_generated:0,
    anatomical_segmentation_performed:false,hidden_surfaces_recovered:0,
    rigging_performed:false,ai_generation_performed:false,
    pixel_precision_guaranteed:false,appearance_quality_verified:false,
    note:'Silhouette-only local mask. It cannot separate hair/face/eyes or reconstruct occluded surfaces.'
  }};
}
