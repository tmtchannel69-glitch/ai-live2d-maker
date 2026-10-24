// Browser-only experimental import of one user-supplied PNG layer.
// Does not claim AI provenance or change the canonical 33-part generation result.
import {validateDesignedCharacter} from '../../shared/designed-character.js';
import {assembleValidatedCharacter,checkAbort,validateAsset,pngBlob} from './generator.js';
import {buildDesignedInochi} from '../../shared/generated-character-inochi.js';

const MAX_SOURCE=8*1024*1024;
const sig=[137,80,78,71,13,10,26,10];
const need=(v,m)=>{if(!v)throw new Error(m);};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};

// Accept an exactly cropped layer, a full 768x1024 layer or the 1024x1024
// API-layout canvas (128px left offset), but never a finished composite portrait.
export async function importExternalPart(character,role,file,{signal,onProgress=()=>{}}={}){
  need(character?.manifest?.version===2&&character?.assets instanceof Map,'先に「デザイン指定の端末内描画」でキャラクターを生成してください。');
  const manifest=await validateDesignedCharacter(character.manifest);checkAbort(signal);
  const part=manifest.parts.find(p=>p.role===role);
  need(part&&manifest.parts.length===33&&character.assets.size===33,'33パーツの有効な役割を選んでください。');
  need(file instanceof Blob&&file.size>33&&file.size<=MAX_SOURCE&&(file.type===''||file.type==='image/png'),
    'PNGファイルを選択してください（最大8MB）。JPEGやスクリーンショットの写真は使えません。');
  const sourceBytes=await file.arrayBuffer(),header=new Uint8Array(sourceBytes,0,33),v=new DataView(sourceBytes);
  need(sig.every((n,i)=>header[i]===n)&&v.getUint32(8)===13&&
    String.fromCharCode(...header.slice(12,16))==='IHDR'&&header[24]===8&&header[25]===6,
    '8bit RGBA形式の透過PNGが必要です。');
  const w=v.getUint32(16),h=v.getUint32(20),q=part.rect;
  const cropped=w===q.width&&h===q.height;
  const plain=w===768&&h===1024,api=w===1024&&h===1024;
  need(cropped||plain||api,
    '画像サイズが合いません。切り抜き済みパーツ、768×1024、1024×1024のいずれかが必要です。');
  const dx=cropped?0:q.x+(api?128:0),dy=cropped?0:q.y;
  let bitmap,c;
  try{
    bitmap=await createImageBitmap(file);checkAbort(signal);
    need(bitmap.width===w&&bitmap.height===h,'PNGのヘッダーと画像サイズが一致しません。');
    c=canvas(w,h);const ctx=c.getContext('2d',{willReadFrequently:true});
    need(ctx,'画像検査を利用できません。');ctx.drawImage(bitmap,0,0);
    const pixels=ctx.getImageData(0,0,w,h).data;
    let inPart=0,outside=0,transparentInPart=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const alpha=pixels[(y*w+x)*4+3];
      const inside=x>=dx&&x<dx+q.width&&y>=dy&&y<dy+q.height;
      if(inside){if(alpha>0)inPart++;else transparentInPart++;}
      else if(alpha>0)outside++;
    }
    need(outside===0,'指定パーツの範囲外に画像があります。全体イラストは分割済みPNGとして扱えません。');
    need(inPart>0&&transparentInPart>0,'空画像または不透明背景です。透明部分のあるパーツPNGが必要です。');
    onProgress('透過・配置を確認しました。元の33パーツと合成しています…');
    const tileCanvas=canvas(q.width,q.height),tctx=tileCanvas.getContext('2d');
    need(tctx,'パーツを切り出せません。');
    tctx.drawImage(c,dx,dy,q.width,q.height,0,0,q.width,q.height);
    const tile=await pngBlob(tileCanvas);tileCanvas.width=tileCanvas.height=0;
    await validateAsset(part,tile,signal,{requireTransparency:true});checkAbort(signal);
    const assets=new Map(character.assets);assets.set(role,tile);
    const preview=await assembleValidatedCharacter(manifest,assets,{signal});checkAbort(signal);
    onProgress('Inochi2Dモデルを再生成しています…');
    const nativeBytes=new Map();
    for(const p of manifest.parts){
      checkAbort(signal);nativeBytes.set(p.role,new Uint8Array(await assets.get(p.role).arrayBuffer()));
    }
    const native=await buildDesignedInochi(manifest,nativeBytes,{signal});checkAbort(signal);
    const report={format:'ai-live2d-external-part-experiment',version:1,role,
      design_id:manifest.generator.design_id,blueprint_id:manifest.generator.blueprint_id,
      source_sha256:await digest(sourceBytes),input_canvas:[w,h],role_rect:q,
      source_kind:'user-supplied-png',ai_origin_verified:false,
      replacement_count:1,remaining_local_template_parts:32,full_ai_character:false,
      in_bounds_visible_pixels:inPart,out_of_bounds_visible_pixels:outside,
      rgba_structure_passed:true,
      inochi_model_generated:true,official_creator_tested:false,appearance_quality_passed:false,
      no_network_transmission:true,limitations:'元のデザインを基準に1パーツのみ差し替えた実験モデルです。実AI生成の真偽、自然さ、33パーツ生成成功を保証しません。'};
    return {tile,preview,native,report};
  }finally{bitmap?.close();if(c)c.width=c.height=0;}
}
