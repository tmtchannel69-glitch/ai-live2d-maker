// Local-first entry point from one completed portrait to an inspectable source
// contract. This does NOT split the image or synthesize hidden layer geometry.
import {zip,strToU8} from 'fflate';
import {createDesignPlan} from '../../shared/character-design.js';
import {createForegroundMask} from '../../shared/portrait-foreground-mask.js';
import {proposePortraitRegions} from '../../shared/portrait-region-proposals.js';
import {SOURCE_CANVAS,SOURCE_MAX_BYTES,planPortraitNormalization,auditPortraitPixels} from '../../shared/single-image-source.js';

const supported=new Set(['image/png','image/jpeg','image/webp']);
const need=(ok,msg)=>{if(!ok)throw new Error(msg);};
const sha256=async buffer=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');
const pngBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNGを保存できませんでした。')),'image/png'));

export function createSingleImageAuditPanel({section,save,onBusy}){
  const host=document.createElement('section');
  host.className='panel cg-single-portrait';
  host.id='cg-single-portrait';
  host.innerHTML='<h2>画像1枚からの自動生成：入力画像の検査</h2>'+
    '<p class="muted">ここから完成画像1枚の処理を始めます。現在はサイズ・透過・33箇所の配置候補のチェックまでです。髪や目の自動分離、隠れた部分の描き足し、モデル生成はまだ行いません。</p>'+
    '<label for="cg-single-file">キャラクター画像を選択（PNG・JPEG・WebP／最大8MB）'+
    '<input id="cg-single-file" type="file" accept="image/png,image/jpeg,image/webp"></label>'+
    '<p id="cg-single-status" role="status" aria-live="polite">正面向き・胸から上の1人のキャラクター画像を選んでください。</p>'+
    '<div id="cg-single-result" hidden>'+
    '<label for="cg-single-role">確認する領域（テンプレートの仮位置）<select id="cg-single-role"></select></label>'+
    '<div class="cg-single-image"><canvas id="cg-single-canvas" width="768" height="1024" aria-label="入力画像を768×1024に収め、指定箇所を枠で示した画像"></canvas></div>'+
    '<p id="cg-single-summary" class="muted"></p>'+ 
    '<button id="cg-single-make-mask" class="secondary" type="button">前景の自動切り抜きを試す（背景が透明・単色の場合）</button>'+ 
    '<section id="cg-single-mask-output" hidden><h3>自動切り抜きの試作結果</h3>'+ 
    '<div class="cg-single-image"><canvas id="cg-single-mask-preview" width="768" height="1024" aria-label="背景から切り抜いた前景シルエット"></canvas></div>'+ 
    '<p id="cg-single-mask-summary" class="muted"></p>'+ 
    '<p class="muted">これは人物全体の前景マスクです。髪や目などの独立した33レイヤー、隠れた部分の補完、リギングではありません。</p>'+
    '<button type="button" id="cg-single-suggest-regions" class="secondary">頭部・胴体の候補範囲を推定する</button>'+
    '<div id="cg-single-region-output" hidden><h3>形状から推定した候補</h3>'+
    '<div class="cg-single-image"><canvas id="cg-single-region-preview" width="768" height="1024" aria-label="前景シルエットに重ねた頭部と胴体の候補範囲"></canvas></div>'+
    '<p id="cg-single-region-summary" class="muted"></p>'+
    '<p class="muted">くびれによる形状推定です。頭や胴体のAI認識・髪の分割・33パーツ化ではありません。</p></div></section>'+ 
    '<button id="cg-single-download" class="secondary" type="button">基準画像と検査結果をZIP保存</button>'+
    '<p class="muted">矩形内に画素があっても独立したパーツではありません。AIによる位置検出・背景除去・隠れ面生成・リギングの成功判定には使えません。</p></div>';
  section.querySelector('#cg-output').after(host);
  const $=s=>host.querySelector(s);
  let current=null,token=0,running=false;
  const preview=$('#cg-single-canvas'),ctx=preview.getContext('2d');
  const maskPreview=$('#cg-single-mask-preview'),maskCtx=maskPreview.getContext('2d');
  const regionPreview=$('#cg-single-region-preview'),regionCtx=regionPreview.getContext('2d');
  function draw(){
    if(!current)return;
    ctx.clearRect(0,0,SOURCE_CANVAS.width,SOURCE_CANVAS.height);
    ctx.drawImage(current.normalized,0,0);
    const selected=current.report.role_windows.find(p=>p.role===$('#cg-single-role').value);
    if(!selected)return;
    const {x,y,width,height}=selected.rect;
    ctx.strokeStyle='#ffbd52';ctx.lineWidth=4;ctx.strokeRect(x+2,y+2,Math.max(1,width-4),Math.max(1,height-4));
    ctx.fillStyle='rgba(0,0,0,.75)';const label=selected.role+' / '+Math.round(selected.visible_fraction*100)+'% visible';
    ctx.font='bold 17px sans-serif';
    const labelW=Math.min(SOURCE_CANVAS.width,Math.ceil(ctx.measureText(label).width+16));
    const labelX=Math.max(0,Math.min(x,SOURCE_CANVAS.width-labelW));
    const labelY=y>32?y-29:Math.min(SOURCE_CANVAS.height-28,y+height+3);
    ctx.fillRect(labelX,labelY,labelW,26);ctx.fillStyle='white';ctx.fillText(label,labelX+8,labelY+19);
  }
  async function read(file,job){
    need(file instanceof File&&file.size>0&&file.size<=SOURCE_MAX_BYTES&&supported.has(file.type),
      'PNG・JPEG・WebPの8MB以下の画像が必要です。');
    const originalBytes=await file.arrayBuffer();
    const hash=await sha256(originalBytes);
    let bitmap,normalized;
    try{
      bitmap=await createImageBitmap(file);
      if(token!==job)return null;
      const geometry=planPortraitNormalization(bitmap.width,bitmap.height);
      normalized=document.createElement('canvas');
      normalized.width=SOURCE_CANVAS.width;normalized.height=SOURCE_CANVAS.height;
      const nc=normalized.getContext('2d',{willReadFrequently:true});need(nc,'Canvasを使えません。');
      const r=geometry.draw_rect;
      nc.drawImage(bitmap,r.x,r.y,r.width,r.height);
      const plan=await createDesignPlan();
      if(token!==job)return null;
      const report=auditPortraitPixels(nc.getImageData(0,0,normalized.width,normalized.height).data,plan.blueprint.parts,{drawRect:r});
      return {normalized,plan,geometry,report,source:{name:file.name,type:file.type,sha256:hash,size_bytes:file.size}};
    }finally{bitmap?.close();}
  }
  function clear(){
    current=null;
    $('#cg-single-mask-output').hidden=true;
    $('#cg-single-mask-summary').textContent='';
    $('#cg-single-region-output').hidden=true;
    $('#cg-single-region-summary').textContent='';
    regionCtx.clearRect(0,0,SOURCE_CANVAS.width,SOURCE_CANVAS.height);
    maskCtx.clearRect(0,0,SOURCE_CANVAS.width,SOURCE_CANVAS.height);
    $('#cg-single-result').hidden=true;
    $('#cg-single-role').replaceChildren();
    ctx.clearRect(0,0,SOURCE_CANVAS.width,SOURCE_CANVAS.height);
  }
  $('#cg-single-role').addEventListener('change',draw);
  $('#cg-single-file').addEventListener('change',async()=>{
    const job=++token,selected=$('#cg-single-file').files?.[0];
    clear();
    if(!selected){$('#cg-single-status').textContent='キャラクター画像を選択してください。';return;}
    running=true;onBusy(true);
    $('#cg-single-status').textContent='画像のサイズ・配置候補を分析しています…';
    try{
      const analyzed=await read(selected,job);
      if(job!==token||!analyzed)return;
      current=analyzed;
      const options=analyzed.report.role_windows.map(p=>{
        const o=document.createElement('option');o.value=p.role;o.textContent=p.label+' ('+p.role+')';return o;
      });
      $('#cg-single-role').replaceChildren(...options);
      if(analyzed.report.role_windows.some(p=>p.role==='face_base'))$('#cg-single-role').value='face_base';
      $('#cg-single-result').hidden=false;draw();
      $('#cg-single-summary').textContent='画像 '+analyzed.geometry.source_size.join('×')+
        'px → 768×1024 / 33領域を検査 / 警告 '+analyzed.report.warning_codes.length+
        '件 / 分離済みパーツ 0枚 / モデル生成なし';
      $('#cg-single-status').textContent='入力画像の検査が完了しました。次に必要なのは対象部位の検出・マスク分離と隠れた部分の復元です。';
    }catch(error){if(job===token){clear();$('#cg-single-status').textContent='画像を確認できませんでした：'+error.message;}}
    finally{if(job===token){running=false;onBusy(false);}}
  });
  $('#cg-single-make-mask').addEventListener('click',async()=>{
    if(!current||running)return;
    const info=current;running=true;onBusy(true);
    $('#cg-single-mask-output').hidden=true;
    $('#cg-single-region-output').hidden=true;
    $('#cg-single-region-summary').textContent='';
    regionCtx.clearRect(0,0,SOURCE_CANVAS.width,SOURCE_CANVAS.height);
    info.foreground=null;
    $('#cg-single-status').textContent='背景とキャラクターの前景を判別しています…';
    try{
      const width=SOURCE_CANVAS.width,height=SOURCE_CANVAS.height;
      const pixels=info.normalized.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height);
      const segmented=createForegroundMask(pixels.data,info.geometry.draw_rect);
      const cutout=document.createElement('canvas'),maskCanvas=document.createElement('canvas');
      cutout.width=maskCanvas.width=width;cutout.height=maskCanvas.height=height;
      const cutPixels=new Uint8ClampedArray(pixels.data),maskPixels=new Uint8ClampedArray(pixels.data.length);
      for(let i=0;i<segmented.mask.length;i++){
        const offset=i*4,a=segmented.mask[i];
        // Existing PNG transparency must not be multiplied by itself.
        cutPixels[offset+3]=segmented.report.method==='existing-alpha'
          ?cutPixels[offset+3]:Math.round(cutPixels[offset+3]*a/255);
        maskPixels[offset]=255;maskPixels[offset+1]=255;maskPixels[offset+2]=255;maskPixels[offset+3]=a;
      }
      const outCtx=cutout.getContext('2d'),layerCtx=maskCanvas.getContext('2d');
      outCtx.putImageData(new ImageData(cutPixels,width,height),0,0);
      layerCtx.putImageData(new ImageData(maskPixels,width,height),0,0);
      if(info!==current)return;
      info.foreground={cutout,maskCanvas,maskData:segmented.mask,report:segmented.report,regionProposal:null};
      maskCtx.clearRect(0,0,width,height);maskCtx.drawImage(cutout,0,0);
      $('#cg-single-mask-output').hidden=false;
      $('#cg-single-mask-summary').textContent='方式 '+(segmented.report.method==='existing-alpha'?'既存の透明度':'単色背景からの領域検出')+
        ' / 前景 '+Math.round(segmented.report.foreground_fraction*100)+'% / 注意 '+segmented.report.warning_codes.length+
        '件 / 分離済みの人体パーツ 0枚';
      $('#cg-single-status').textContent='前景マスクを試作しました。品質と輪郭を目視確認してください。33パーツ化はまだです。';
    }catch(error){
      if(info===current){info.foreground=null;$('#cg-single-status').textContent='安全に前景を切り出せませんでした：'+error.message;}
    }finally{running=false;onBusy(false);}
  });
  $('#cg-single-suggest-regions').addEventListener('click',()=>{
    const info=current;
    if(!info?.foreground||running)return;
    try{
      const report=proposePortraitRegions(info.foreground.maskData);
      info.foreground.regionProposal=report;
      const width=SOURCE_CANVAS.width,height=SOURCE_CANVAS.height;
      regionCtx.clearRect(0,0,width,height);
      regionCtx.drawImage(info.foreground.cutout,0,0);
      if(report.status==='candidate'){
        for(const [candidate,color,label] of [
          [report.upper_candidate,'#ffc14a','上部候補'],
          [report.lower_candidate,'#58c8ff','下部候補']
        ]){
          const {x,y,width:w,height:h}=candidate.rect;
          regionCtx.strokeStyle=color;regionCtx.lineWidth=4;
          regionCtx.strokeRect(x+2,y+2,Math.max(1,w-4),Math.max(1,h-4));
          regionCtx.fillStyle='rgba(0,0,0,.8)';
          regionCtx.fillRect(x,Math.min(height-28,Math.max(0,y)),115,28);
          regionCtx.fillStyle=color;regionCtx.font='bold 18px sans-serif';
          regionCtx.fillText(label,x+6,Math.min(height-8,Math.max(20,y+20)));
        }
        $('#cg-single-region-summary').textContent='形状のくびれから境界候補を表示しました。位置の正しさ、髪・服の重なりは未確認です。独立パーツ0枚。';
      }else{
        $('#cg-single-region-summary').textContent='頭部・胴体の境界を推定できませんでした（'+report.reason+'）。誤った部位分割は行いません。';
      }
      $('#cg-single-region-output').hidden=false;
    }catch(error){
      info.foreground.regionProposal=null;
      $('#cg-single-region-output').hidden=true;
      $('#cg-single-status').textContent='候補領域を解析できませんでした：'+error.message;
    }
  });
  $('#cg-single-download').addEventListener('click',async()=>{
    if(!current||running)return;
    running=true;onBusy(true);
    try{
      const info=current,files={};
      files['normalized_reference.png']=new Uint8Array(await (await pngBlob(info.normalized)).arrayBuffer());
      if(info.foreground){
        if(info.foreground.regionProposal)files['region_proposals.json']=strToU8(JSON.stringify(info.foreground.regionProposal,null,2)+'\n');
        files['foreground_cutout.png']=new Uint8Array(await (await pngBlob(info.foreground.cutout)).arrayBuffer());
        files['foreground_mask.png']=new Uint8Array(await (await pngBlob(info.foreground.maskCanvas)).arrayBuffer());
      }
      files['source_audit.json']=strToU8(JSON.stringify({
        source:info.source,normalization:info.geometry,design_id:info.plan.blueprint.design_id,
        blueprint_id:info.plan.blueprint_id,...info.report,
        foreground_mask_result:info.foreground?.report??null,
        region_proposals:info.foreground?.regionProposal??null
      },null,2)+'\n');
      files['README.txt']=strToU8('入力画像1枚の検査結果です。これは33パーツの切り出し/背景除去/隠れ面補完/リギングの結果ではありません。\n'+
        'normalized_reference.png は縦横比を保って768x1024キャンバスへ配置した入力画像。\n'+
        'source_audit.json に33領域の暫定位置と未完了項目を記録します。\n'+
        'foreground_* は試作の全身シルエット（存在する場合）のみ。髪・顔・衣装の33分割ではありません。\n');
      const data=await new Promise((resolve,reject)=>zip(files,{level:0},(err,bytes)=>err?reject(err):resolve(new Blob([bytes],{type:'application/zip'}))));
      save(data,'ai-live2d-single-image-audit.zip');
      $('#cg-single-status').textContent='画像と検査結果をZIPに保存しました。AI自動分離やモデル生成はまだ行っていません。';
    }catch(error){$('#cg-single-status').textContent='ZIPの保存に失敗しました：'+error.message;}
    finally{running=false;onBusy(false);}
  });
  return {clear};
}