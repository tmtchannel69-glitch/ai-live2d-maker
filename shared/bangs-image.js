// Alpha-only cleanup. No inpainting, colour replacement, opaque-alpha boost or
// semantic claim. Every source pixel at alpha >= 8 is retained unchanged.
const abort=signal=>{if(signal?.aborted)throw new DOMException('前髪の準備を中止しました。','AbortError');};
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
export async function cleanBangsAlpha(image,{signal}={}){
  const {width:w,height:h,data}=image,n=w*h;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<64||h<64||w>2048||h>2048||data?.length!==n*4)throw new Error('前髪は64〜2048pxのRGBA画像で用意してください。');
  const horizontal=new Uint8Array(n),near=new Uint8Array(n),out=new Uint8ClampedArray(data);let visible=0,strong=0,edgeStrong=0,edgeVisible=0,semi=0;
  let sx=w,sy=h,ex=-1,ey=-1;
  for(let y=0;y<h;y++){
    abort(signal);let window=0;
    for(let x=0;x<w;x++){
      if(x===0){for(let k=0;k<=2;k++)window+=data[(y*w+k)*4+3]>=8?1:0;}
      else{if(x+2<w)window+=data[(y*w+x+2)*4+3]>=8?1:0;if(x-3>=0)window-=data[(y*w+x-3)*4+3]>=8?1:0;}
      const i=y*w+x,a=data[i*4+3];horizontal[i]=window?1:0;
      if(a){visible++;if(a<255)semi++;sx=Math.min(sx,x);sy=Math.min(sy,y);ex=Math.max(ex,x);ey=Math.max(ey,y);if(x===0||y===0||x===w-1||y===h-1)edgeVisible++;}
      if(a>=8){strong++;if(x===0||y===0||x===w-1||y===h-1)edgeStrong++;}
    }
    if(y%96===0)await pause();
  }
  if(strong<512||visible>=n*.98)throw new Error('前髪の有効な描画領域が不足しているか、不透明な背景があります。');
  if(edgeStrong)throw new Error('前髪の有効画素が画像端に接触しています。毛先を切らず、余白を付けたPNGを用意してください。');
  for(let x=0;x<w;x++){
    abort(signal);let window=0;
    for(let y=0;y<h;y++){
      if(y===0){for(let k=0;k<=2;k++)window+=horizontal[k*w+x];}
      else{if(y+2<h)window+=horizontal[(y+2)*w+x];if(y-3>=0)window-=horizontal[(y-3)*w+x];}
      near[y*w+x]=window?1:0;
    }
    if(x%96===0)await pause();
  }
  let x0=w,y0=h,x1=-1,y1=-1,removed=0,removedAlpha=0;
  for(let y=0;y<h;y++){
    abort(signal);
    for(let x=0;x<w;x++){
      const i=y*w+x,a=data[i*4+3];
      if(a&&!near[i]){removed++;removedAlpha+=a;out.fill(0,i*4,i*4+4);}
      else if(a){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    }if(y%96===0)await pause();
  }
  return {width:w,height:h,data:out,bounds:{x:x0,y:y0,width:x1-x0+1,height:y1-y0+1},report:{algorithm:'low-alpha-background-v1',alpha_threshold:8,edge_halo_radius:2,
    source_size:[w,h],source_visible_pixels:visible,source_semitransparent_pixels:semi,source_strong_pixels:strong,source_visible_bounds:[sx,sy,ex+1,ey+1],source_edge_visible_pixels:edgeVisible,source_edge_strong_pixels:edgeStrong,
    removed_low_alpha_pixels:removed,removed_alpha_sum:removedAlpha,strong_pixels_removed:0,source_colour_repainted:false,original_alpha_boosted:false,semantically_verified:false}};
}
