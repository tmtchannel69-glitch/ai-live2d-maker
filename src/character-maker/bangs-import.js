import {decode,encode} from 'fast-png';
import {cleanBangsAlpha} from '../../shared/bangs-image.js';
import {canonicalBangsManifest,withBangsPlacement} from '../../shared/bangs-placement.js';
import {makerDigest} from '../../shared/modular-character.js';
import {validateBangsPreparation} from '../../shared/bangs-preparation.js';
import {checkAbort,pngBlob} from '../character-generation/generator.js';
import {replaceMakerParts} from './project.js';
const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
const keys=['iris_l','iris_r','eye_white_l','eye_white_r','brow_l','brow_r'];
function samples(manifest,assets){
  const result={},images=new Map(manifest.parts.map(p=>[p.role,decode(assets.get(p.role))]));
  for(const role of keys){
    const p=manifest.parts.find(p=>p.role===role),im=images.get(role),q=p.rect,items=[];let total=0;
    for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++){
      let weight=im.data[(y*im.width+x)*4+3]/255;
      if(role.startsWith('iris_')){const target=manifest.parts.find(p=>p.role==='eye_white_'+role.at(-1)),mask=images.get(target.role),mx=q.x+x-target.rect.x,my=q.y+y-target.rect.y;weight*=mx>=0&&my>=0&&mx<mask.width&&my<mask.height?mask.data[(my*mask.width+mx)*4+3]/255:0;}
      if(weight){items.push([q.x+x,q.y+y,weight]);total+=weight;}
    }result[role]={items,total};
  }
  const p=manifest.parts.find(p=>p.role==='bangs_front'),im=images.get(p.role),items=[];let total=0;
  for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++){const weight=im.data[(y*im.width+x)*4+3]/255;if(weight){items.push([p.rect.x+x,p.rect.y+y,weight]);total+=weight;}}
  result.old_bangs={items,total};return result;
}
function coverage(points,data,rect){let sum=0;for(const [x,y,w] of points.items){const px=x-rect.x,py=y-rect.y;if(px>=0&&py>=0&&px<rect.width&&py<rect.height)sum+=w*data[(py*rect.width+px)*4+3]/255;}return sum/points.total;}

export async function prepareBangsImport(project,file,{signal,onProgress=()=>{}}={}){
  if(!(file instanceof Blob)||file.size<33||file.size>8*1024*1024)throw new Error('前髪PNGを1枚選んでください。8 MiB以下です。');
  const original=new Uint8Array(await file.arrayBuffer());checkAbort(signal);const header=original.subarray(0,33),v=new DataView(header.buffer,header.byteOffset,header.byteLength);
  if(![137,80,78,71,13,10,26,10].every((n,i)=>header[i]===n)||v.getUint32(8)!==13||String.fromCharCode(...header.subarray(12,16))!=='IHDR'||header[24]!==8||header[25]!==6||v.getUint32(16)<64||v.getUint32(20)<64||v.getUint32(16)>2048||v.getUint32(20)>2048)throw new Error('64〜2048pxの8bit RGBA透過PNGが必要です。');
  const manifest=canonicalBangsManifest(project.current.manifest);if(manifest.version!==2)throw new Error('自動配置はデザイン指定版の女性ベースが対象です。新しいベースを組み立ててください。');
  onProgress('元PNGを保持し、低い透明度の背景だけを調べています…');
  const decoded=decode(original),clean=await cleanBangsAlpha(decoded,{signal}),cleaned=new Blob([encode({...clean,channels:4,depth:8})],{type:'image/png'}),work=canvas(1,1),candidates=[];let crop,best=null;
  try{
    const b=clean.bounds;crop=await createImageBitmap(cleaned,b.x,b.y,b.width,b.height);
    // Protect the actual current eyes/brows, including earlier swaps. The old
    // fringe is used only as the reference coverage mask, never as an AI result.
    const referenceAssets=new Map(project.current.assets);referenceAssets.set('bangs_front',project.base.assets.get('bangs_front'));
    const sourceBytes=new Map();for(const [r,b] of referenceAssets){checkAbort(signal);sourceBytes.set(r,new Uint8Array(await b.arrayBuffer()));}
    const protect=samples(manifest,sourceBytes),ref=manifest.parts.find(p=>p.role==='bangs_front'),back=manifest.parts.find(p=>p.role==='back_hair'),head=manifest.groups.find(g=>g.id==='group_head');
    for(const widthFactor of [1,1.04,1.08,1.12,1.16,1.2])for(const offset of [-24,-16,-8,0,8,16,24]){
      checkAbort(signal);const width=Math.round(ref.rect.width*widthFactor),scale=width/crop.width,drawHeight=crop.height*scale,top=back.rect.y+offset;
      if(scale>1)continue;
      const rect={x:Math.floor(head.anchor[0]-width/2)-2,y:top-2,width:width+4,height:Math.ceil(drawHeight)+4};
      let placed;try{placed=await withBangsPlacement(manifest,rect);}catch{continue;}
      work.width=rect.width;work.height=rect.height;const ctx=work.getContext('2d',{willReadFrequently:true});ctx.drawImage(crop,2,2,width,drawHeight);
      const rgba=ctx.getImageData(0,0,work.width,work.height).data,occlusion=Object.fromEntries(keys.map(k=>[k,coverage(protect[k],rgba,rect)])),oldCoverage=coverage(protect.old_bangs,rgba,rect);
      const iris=Math.max(occlusion.iris_l,occlusion.iris_r),brow=Math.max(occlusion.brow_l,occlusion.brow_r),white=Math.max(occlusion.eye_white_l,occlusion.eye_white_r);
      const accepted=iris<=.04&&brow<=.5&&white<=.22,score=.65*oldCoverage+.25*(1-brow)+.1*(1-iris),record={rect,scale,draw_size:[width,drawHeight],occlusion,old_bangs_coverage:oldCoverage,accepted,score};candidates.push(record);
      if(accepted&&(!best||score>best.record.score))best={manifest:placed,blob:await pngBlob(work),record};
      onProgress(`縦横比を保って配置を比較中 ${candidates.length}候補`);await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(!best)throw new Error('瞳・眉に重なりすぎない配置が見つかりません。大きく引き伸ばさず、ベースの輪郭に合わせた前髪を再生成してください。');
    checkAbort(signal);const report={format:'ai-live2d-bangs-import',version:1,role:'bangs_front',source_sha256:await makerDigest(original),prepared_sha256:await makerDigest(await best.blob.arrayBuffer()),
      source_claim:'User-supplied independent PNG; generator/AI origin is not authenticated.',ai_origin_verified:false,
      cleanup:clean.report,cleaned_bounds:clean.bounds,placement:best.record,uniform_scaling:true,upscaled:false,original_preserved:true,original_rgb_repainted:false,source_crop_clipped:false,
      thresholds:{iris_occlusion:.04,brow_occlusion:.5,eye_white_occlusion:.22},candidates,appearance_quality_passed:false,style_consistency_verified:false,official_creator_tested:false};
    validateBangsPreparation(report,report.prepared_sha256);return {original:file,cleaned,file:new File([best.blob],'bangs_front.png',{type:'image/png'}),manifest:best.manifest,report};
  }finally{crop?.close();work.width=work.height=0;}
}
export async function importBangsPart(project,file,options={}){
  const fit=await prepareBangsImport(project,file,options);checkAbort(options.signal);
  const next=await replaceMakerParts(project,[fit.file],{...options,assemblyManifest:fit.manifest,label:'ユーザー添付の前髪（生成元は未確認）'});
  next.origins.bangs_front.import_preparation=fit.report;next.current.quality.bangs_import=fit.report;next.bangsImport=fit;return next;
}
