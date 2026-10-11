// Additional decoded RGBA textures are limited to 16 MiB in total. Decode
// serially, retain no full-size intermediate bitmap and close cancelled work.
export const DETAIL_PIXEL_BUDGET=4*1024*1024;
export function detailPlan(assets,width,height){
  const plans=[{role:null,width,height},...assets.map(a=>{
    const scale=Math.min(1,Math.max(width*a.placement.width/a.width,height*a.placement.height/a.height));
    return {role:a.role,width:Math.max(1,Math.floor(a.width*scale)),height:Math.max(1,Math.floor(a.height*scale))};
  })];
  // Reserve room for one-pixel minimum dimensions of very thin textures.
  const total=plans.reduce((sum,p)=>sum+p.width*p.height,0),budget=DETAIL_PIXEL_BUDGET-plans.length*8192,scale=total>DETAIL_PIXEL_BUDGET?Math.sqrt(budget/total):1;
  return plans.map(p=>({...p,width:Math.max(1,Math.floor(p.width*scale)),height:Math.max(1,Math.floor(p.height*scale))}));
}
export async function loadInspectionDetail({file,assets,width,height,isCurrent}){
  const plans=detailPlan(assets,width,height),loaded=[];
  try{
    for(const p of plans){
      if(!isCurrent())throw new DOMException('確認を中止しました','AbortError');
      const bitmap=await createImageBitmap(p.role===null?file:assets.find(a=>a.role===p.role).blob,{resizeWidth:p.width,resizeHeight:p.height,resizeQuality:'high'});
      loaded.push({role:p.role,bitmap});
      if(!isCurrent())throw new DOMException('確認を中止しました','AbortError');
    }
    return {background:loaded[0].bitmap,bitmaps:loaded.slice(1),close(){loaded.forEach(p=>p.bitmap.close());}};
  }catch(error){loaded.forEach(p=>p.bitmap.close());throw error;}
}
