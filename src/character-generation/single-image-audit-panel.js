// Local-first entry point from one completed portrait to an inspectable source
// contract. This does NOT split the image or synthesize hidden layer geometry.
import {zip,strToU8} from 'fflate';
import {createDesignPlan} from '../../shared/character-design.js';
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
    '<button id="cg-single-download" class="secondary" type="button">基準画像と検査結果をZIP保存</button>'+
    '<p class="muted">矩形内に画素があっても独立したパーツではありません。AIによる位置検出・背景除去・隠れ面生成・リギングの成功判定には使えません。</p></div>';
  section.querySelector('#cg-output').after(host);
  const $=s=>host.querySelector(s);
  let current=null,token=0,running=false;
  const preview=$('#cg-single-canvas'),ctx=preview.getContext('2d');
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
  $('#cg-single-download').addEventListener('click',async()=>{
    if(!current||running)return;
    running=true;onBusy(true);
    try{
      const info=current,files={};
      files['normalized_reference.png']=new Uint8Array(await (await pngBlob(info.normalized)).arrayBuffer());
      files['source_audit.json']=strToU8(JSON.stringify({
        source:info.source,normalization:info.geometry,design_id:info.plan.blueprint.design_id,
        blueprint_id:info.plan.blueprint_id,...info.report
      },null,2)+'\n');
      files['README.txt']=strToU8('入力画像1枚の検査結果です。これは33パーツの切り出し/背景除去/隠れ面補完/リギングの結果ではありません。\n'+
        'normalized_reference.png は縦横比を保って768x1024キャンバスへ配置した入力画像。\n'+
        'source_audit.json に33領域の暫定位置と未完了項目を記録します。\n');
      const data=await new Promise((resolve,reject)=>zip(files,{level:0},(err,bytes)=>err?reject(err):resolve(new Blob([bytes],{type:'application/zip'}))));
      save(data,'ai-live2d-single-image-audit.zip');
      $('#cg-single-status').textContent='画像と検査結果をZIPに保存しました。AI自動分離やモデル生成はまだ行っていません。';
    }catch(error){$('#cg-single-status').textContent='ZIPの保存に失敗しました：'+error.message;}
    finally{running=false;onBusy(false);}
  });
  return {clear};
}
