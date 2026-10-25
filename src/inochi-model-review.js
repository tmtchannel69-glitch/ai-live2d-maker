import {strFromU8} from 'fflate';
import {readBoundedZip} from '../shared/bounded-zip.js';

const MIB=1024*1024,FORMAT='ai-live2d-maker-model-review';
const fail=message=>{throw new Error(message||'モデルZIPの確認情報が正しくありません。');};
const need=(value,message)=>{if(!value)fail(message);};
const abort=signal=>{if(signal?.aborted)throw new DOMException('読み込みを中止しました。','AbortError');};
const safe=name=>typeof name==='string'&&name.length<=180&&/^[a-zA-Z0-9_./-]+$/.test(name)&&!name.startsWith('/')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&p!=='__proto__');

// Keep the existing public API and limits while sharing bounded extraction.
export const readReviewEntries=(blob,options={})=>readBoundedZip(blob,options);

function json(entries,name){
  const bytes=entries.get(name);need(bytes&&bytes.length<=MIB,`${name}が不足しているか大きすぎます。`);
  try{return JSON.parse(strFromU8(bytes));}catch{fail(`${name}を読み込めません。`);}
}
function png(entries,name,size){
  need(safe(name)&&name.endsWith('.png'));const b=entries.get(name);need(b?.length>=33&&b.length<=8*MIB,'確認用PNGが不足しているか大きすぎます。');
  const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  need([137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n)&&v.getUint32(8)===13&&strFromU8(b.subarray(12,16))==='IHDR');
  need(v.getUint32(16)===size[0]&&v.getUint32(20)===size[1]&&b[24]===8&&[2,6].includes(b[25]),'確認用PNGと配置情報のサイズが一致しません。');
}
const sizeOK=(size,maxEdge,maxPixels)=>Array.isArray(size)&&size.length===2&&size.every(v=>Number.isInteger(v)&&v>0&&v<=maxEdge)&&size[0]*size[1]<=maxPixels;
const short=value=>typeof value==='string'&&value.length>0&&value.length<=120;
const nativeSignature=b=>b?.length>=8&&[84,82,78,83,82,84,83,0].every((n,i)=>b[i]===n);
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');

export async function readModelReview(blob,{signal,expectedMode,requirePipeline=false}={}){
  const entries=await readReviewEntries(blob,{signal});abort(signal);
  const pipeline=entries.has('generation-report.json')?json(entries,'generation-report.json'):null;
  const known=pipeline?.format==='ai-live2d-maker-detailed-head-app-pipeline'?'detailed-head':pipeline?.format==='ai-live2d-maker-inochi2d-image-pipeline'?'five':null;
  if(known)need([1,2].includes(pipeline.version),'このモデルZIPの版には対応していません。');
  if(requirePipeline)need(known&&nativeSignature(entries.get('model.inp')),'このアプリで生成した画像変換用モデルZIPを選んでください。作業保存ZIPや33パーツ生成ZIPとは別です。');
  if(known&&expectedMode)need(known===expectedMode,'生成結果のモードが要求と一致しません。');
  const mode=known||expectedMode;
  need(mode==='five'||mode==='detailed-head');
  if(!entries.has('review/review.json')){
    need(!pipeline?.reviewManifest,'比較画像の確認情報が不足しています。');
    return {available:false,mode,entries,pipeline};
  }
  const review=json(entries,'review/review.json');
  need(known==='detailed-head'&&review.format===FORMAT&&[1,2].includes(review.version)&&review.mode===mode&&review.renderer==='independent-cpu-serialized-model');
  need(nativeSignature(entries.get('model.inp'))&&sizeOK(review.source_size,4096,16_000_000));
  need(await sha(entries.get('model.inp'))===review.model_sha256,'比較画像の対象モデルが一致しません。');abort(signal);
  need(Array.isArray(review.views)&&review.views.length===2);
  const names=new Set();
  for(const view of review.views){
    need(['head','blink'].includes(view.id)&&!names.has(view.id)&&sizeOK(view.size,640,640*640));names.add(view.id);
    const roi=view.source_roi;need(Array.isArray(roi)&&roi.length===4&&roi.every(Number.isInteger)&&roi[0]>=0&&roi[1]>=0&&roi[2]>roi[0]&&roi[3]>roi[1]&&roi[2]<=review.source_size[0]&&roi[3]<=review.source_size[1]);
    need(Array.isArray(view.frames)&&view.frames.length===10);
    const framePaths=new Set(),beforePaths=new Set();
    for(const frame of view.frames){
      need(typeof frame.file==='string'&&frame.file.startsWith(`review/${view.id}-`)&&!framePaths.has(frame.file)&&short(frame.state));framePaths.add(frame.file);
      const keys=view.id==='blink'?['EyeOpenL','EyeOpenR']:['HeadX','HeadTilt'];
      need(frame.parameters&&Object.keys(frame.parameters).length===2&&keys.every(k=>Number.isFinite(frame.parameters[k])&&frame.parameters[k]>= (view.id==='blink'?0:-1)&&frame.parameters[k]<=1));
      png(entries,frame.file,view.size);
      if(frame.before_file!==undefined){
        need(review.version===2&&view.id==='blink'&&typeof frame.before_file==='string'&&frame.before_file.startsWith('review/blink-before-')&&!beforePaths.has(frame.before_file));beforePaths.add(frame.before_file);
        need(frame.before_diagnostics?.opening===frame.parameters.EyeOpenL,'改善前後の目の開度が一致しません。');
        png(entries,frame.before_file,view.size);
      }
    }
    need(beforePaths.size===0||beforePaths.size===10,'改善前後の比較画像が不足しています。');
  }
  const graph=json(entries,'common/parts.json');
  need(graph.source?.width===review.source_size[0]&&graph.source?.height===review.source_size[1]&&Array.isArray(graph.parts)&&graph.parts.length>0&&graph.parts.length<=100);
  const ids=new Set();
  for(const part of graph.parts){
    need(short(part.id)&&!ids.has(part.id)&&short(part.role)&&short(part.parent)&&[null,'l','r'].includes(part.side)&&Number.isFinite(part.order));ids.add(part.id);
    const box=part.source_box_xywh;need(Array.isArray(box)&&box.length===4&&box.every(Number.isInteger)&&box[0]>=0&&box[1]>=0&&sizeOK(box.slice(2),4096,16_000_000)&&box[0]+box[2]<=review.source_size[0]&&box[1]+box[3]<=review.source_size[1]);
    for(const plane of ['observed','completion'])if(part[plane]?.rgba){need(safe(part[plane].rgba));png(entries,'common/'+part[plane].rgba,box.slice(2));}
  }
  let skinBoundary=null;
  const compared=review.views.find(v=>v.id==='blink').frames.every(f=>f.before_file);
  if(review.skin_boundary_correction){
    need(review.version===2&&compared&&review.skin_boundary_correction.report_file==='skin-boundary-report.json');
    skinBoundary=json(entries,'skin-boundary-report.json');
    need(skinBoundary.format==='ai-live2d-maker-skin-boundary-correction'&&skinBoundary.version===1&&skinBoundary.profile==='screened-skin-boundary-v1');
    need(sizeOK(skinBoundary.source_size,4096,16_000_000)&&skinBoundary.source_size.every((v,i)=>v===review.source_size[i]));
    need(/^[a-f0-9]{64}$/.test(skinBoundary.before_model_sha256)&&skinBoundary.before_model_sha256===review.skin_boundary_correction.before_model_sha256&&skinBoundary.after_model_sha256===review.model_sha256,'肌の比較情報とモデルが一致しません。');
    const underpaint=graph.parts.find(p=>p.id==='eye_skin_underpaint');need(underpaint?.completion?.rgba);
    png(entries,'skin-boundary-before.png',review.source_size);
    need(await sha(entries.get('skin-boundary-before.png'))===skinBoundary.before_png_sha256&&await sha(entries.get('common/'+underpaint.completion.rgba))===skinBoundary.after_png_sha256,'改善前後の肌画像が確認情報と一致しません。');abort(signal);
    for(const side of ['l','r']){
      const r=skinBoundary.eyes?.[side];need(r&&typeof r.applied==='boolean'&&short(r.status));
      if(r.applied)for(const phase of ['before','after']){
        const m=r[phase];need(m&&Number.isSafeInteger(m.pairs)&&m.pairs>=12&&Number.isFinite(m.mean_absolute_rgb_difference)&&m.mean_absolute_rgb_difference>=0&&m.mean_absolute_rgb_difference<=255);
      }
    }
  }else need(!compared,'改善前後の確認情報が不足しています。');
  return {available:true,mode,entries,pipeline,review,parts:graph.parts,skinBoundary};
}
