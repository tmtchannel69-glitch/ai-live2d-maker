import {expressionPngSize} from './expression-assets.js';

const FRONT_IDS=['hair_side_r','hair_side_l','hair_front'];
export function selectSceneHair(results=[]) {
  const candidates=results.filter(p=>p.ai && [...FRONT_IDS,'hair'].includes(p.id));
  return (candidates.some(p=>FRONT_IDS.includes(p.id))?candidates.filter(p=>FRONT_IDS.includes(p.id)):candidates.filter(p=>p.id==='hair'))
    .slice().sort((a,b)=>FRONT_IDS.indexOf(a.id)-FRONT_IDS.indexOf(b.id));
}

// A single reduced canvas is retained. Pending/stale decodes never draw onto
// the scene; only a completed generation can be used by draw().
export function createSceneHairOverlay({onChange=()=>{}}={}) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
  let ticket=0,snapshot=null,ready=false,message='',loading=false;
  function invalidate(){ticket++;ready=false;loading=false;snapshot=null;canvas.width=canvas.height=1;}
  function clear(){invalidate();message='';}
  function update({enabled,file,results,width,height}){
    if(!enabled || !file || !width || !height){if(snapshot || ready || loading)clear();return;}
    const parts=selectSceneHair(results),old=snapshot;
    if(old && old.file===file && old.width===width && old.height===height && parts.length===old.parts.length && parts.every((p,i)=>p.id===old.parts[i].id && p.blob===old.parts[i].blob))return;
    invalidate();snapshot={file,width,height,parts};const token=ticket;
    if(!parts.length){message='元画像と追加素材を表示しています。手前に重ねられるAIの髪がありません。後ろ髪とデモは対象外です。';onChange();return;}
    loading=true;message='分離した髪を位置確認用に読み込んでいます…';onChange();
    void load(snapshot,token);
  }
  async function load(state,token){
    const scale=Math.min(1,640/state.width,960/state.height),width=Math.max(1,Math.round(state.width*scale)),height=Math.max(1,Math.round(state.height*scale));
    canvas.width=width;canvas.height=height;let count=0,skipped=0,bitmap;
    try {
      for(const part of state.parts){
        if(token!==ticket)return;
        let size;
        try{size=expressionPngSize(new Uint8Array(await part.blob.slice(0,33).arrayBuffer()));}catch{skipped++;continue;}
        if(token!==ticket)return;
        if(size.width!==state.width || size.height!==state.height){skipped++;continue;}
        bitmap=await createImageBitmap(part.blob,{resizeWidth:width,resizeHeight:height});
        if(token!==ticket)return;
        canvas.getContext('2d').drawImage(bitmap,0,0,width,height);bitmap.close();bitmap=null;count++;
      }
      if(token!==ticket)return;
      ready=count>0;loading=false;
      if(!ready)canvas.width=canvas.height=1;
      message=`${count}枚のAIの髪を手前に重ねています。${skipped?`${skipped}枚は元画像と寸法が違うかPNGを読めないため除外しました。`:''}髪は静止した位置確認用です。モデルと同じ動きを保証する表示ではありません。`;
      onChange();
    }catch(error){if(token===ticket){ready=false;loading=false;canvas.width=canvas.height=1;message='髪の位置確認を読み込めませんでした。元画像と追加素材は保持しています。背景を切り替えて再試行できます。';onChange();}}
    finally{bitmap?.close();}
  }
  return {update,clear,draw(ctx){if(ready)ctx.drawImage(canvas,0,0,ctx.canvas.width,ctx.canvas.height);},get status(){return message;}};
}
