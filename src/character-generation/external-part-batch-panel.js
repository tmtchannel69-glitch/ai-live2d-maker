// Phone-friendly, local-only multi-PNG import. Canonical result remains intact.
import {zip,strToU8} from 'fflate';
import {matchExternalPartFiles} from '../../shared/external-part-file-list.js';
import {importExternalPartBatch} from './external-part-batch.js';
import {readExternalPartZip} from './external-part-zip.js';
import {buildExternalPartComparison} from '../../shared/external-part-comparison.js';

export function createExternalBatchPanel({section,getCharacter,save,onBusy}){
  const region=document.createElement('section');
  region.className='panel cg-external-import';
  region.id='cg-batch-import';
  region.hidden=true;
  region.innerHTML='<h3>透過PNGをまとめて取り込む（試験版）</h3>'+
    '<p class="muted">ChatGPTなどで作った独立した画像を複数選びます。ファイル名は <code>iris_l.png</code> のように役割名と完全一致させてください。端末内だけで検査・組み立てし、画像は外部送信されません。</p>'+
    '<label for="cg-batch-files">パーツPNGを複数選択（最大33枚・合計12MB）'+
    '<input id="cg-batch-files" type="file" accept="image/png,.png" multiple></label>'+ 
    '<label for="cg-batch-zip">またはZIPファイルを1つ選択（最大16MB）'+ 
    '<input id="cg-batch-zip" type="file" accept=".zip,application/zip"></label>'+ 
    '<p id="cg-batch-selection" class="muted">まず基準キャラを生成し、透過PNGを選んでください。</p>'+
    '<button id="cg-batch-apply" type="button" class="primary">選択したパーツをまとめて取り込む</button>'+
    '<button id="cg-batch-cancel" type="button" class="secondary" hidden>取り込みを中止</button>'+
    '<p id="cg-batch-status" role="status" aria-live="polite"></p>'+
    '<div id="cg-batch-output" hidden><div class="cg-preview"><img id="cg-batch-preview" alt="外部PNGを複数パーツに使った実験プレビュー"></div>'+
    '<p id="cg-batch-summary" class="muted"></p>'+ 
    '<div id="cg-batch-warnings" role="status" aria-live="polite"></div>'+ 
    '<section id="cg-batch-review"><h4>元画像と差し替え画像を比較</h4>'+ 
    '<label for="cg-batch-review-role">確認するパーツ<select id="cg-batch-review-role"></select></label>'+ 
    '<div class="cg-batch-comparison">'+ 
    '<figure><div class="cg-part-preview"><img id="cg-batch-original" alt="差し替え前のテンプレートパーツ"></div><figcaption>変更前（テンプレート）</figcaption></figure>'+ 
    '<figure><div class="cg-part-preview"><img id="cg-batch-replacement" alt="差し替えた外部PNGパーツ"></div><figcaption>変更後（外部PNG）</figcaption></figure></div>'+ 
    '<p id="cg-batch-review-info" class="muted"></p>'+ 
    '<p class="muted">サイズと透過を比較できます。警告がなくても絵柄・隠れた部分・動作時の自然さは未検証です。</p></section>'+ 
    '<button id="cg-batch-download" type="button" class="secondary">モデル・33パーツ・検証記録をZIP保存</button></div>'+
    '<p class="muted">未選択のパーツはローカル描画のままです。33枚そろってもAI出典や品質を認定するものではありません。通常のキャラクターZIPは変更しません。</p>';
  section.querySelector('#cg-external-import').after(region);
  const $=s=>region.querySelector(s);
  let result=null,previewUrl=null,aborter=null,packing=false,reviewUrls=[];
  let zipFiles=null,zipReading=false,zipTicket=0;
  function releaseReviewImages(){
    for(const url of reviewUrls)URL.revokeObjectURL(url);
    reviewUrls=[];
    $('#cg-batch-original').removeAttribute('src');$('#cg-batch-replacement').removeAttribute('src');
  }
  function showComparison(){
    releaseReviewImages();
    const base=getCharacter(),role=$('#cg-batch-review-role').value;
    if(!result||!base?.assets.has(role)||!result.replacements.has(role))return;
    const info=buildExternalPartComparison(result.manifest,result.report,role);
    const before=URL.createObjectURL(base.assets.get(role)),after=URL.createObjectURL(result.replacements.get(role));
    reviewUrls=[before,after];
    $('#cg-batch-original').src=before;$('#cg-batch-replacement').src=after;
    $('#cg-batch-review-info').textContent=info.role+' ／ 可視画素 '+info.visible_percent+'% ／ 端の接触 '+info.edge_contact_percent+'% ／ '+(info.warning_count?'警告 '+info.warning_count+'件':'画素統計上の警告なし');
  }
  $('#cg-batch-review-role').addEventListener('change',showComparison);
  function clearResult(){
    releaseReviewImages();
    $('#cg-batch-review-role').replaceChildren();$('#cg-batch-review-info').textContent='';
    result=null;
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl=null;$('#cg-batch-preview').removeAttribute('src');$('#cg-batch-output').hidden=true;
    $('#cg-batch-warnings').replaceChildren();
  }
  function update(){
    zipTicket++;zipFiles=null;zipReading=false;aborter?.abort();
    clearResult();$('#cg-batch-files').value='';$('#cg-batch-zip').value='';
    region.hidden=getCharacter()?.manifest?.version!==2;
    $('#cg-batch-selection').textContent='ファイル名とパーツ名を合わせて複数選択してください。';
    $('#cg-batch-status').textContent='';
  }
  function preflight(){
    zipTicket++;zipFiles=null;zipReading=false;$('#cg-batch-zip').value='';
    clearResult();
    const base=getCharacter();
    if(!base||base.manifest.version!==2)return;
    try{
      const summary=matchExternalPartFiles($('#cg-batch-files').files,base.manifest.parts);
      $('#cg-batch-selection').textContent=summary.provided_count+'枚を検出：'+summary.provided_roles.join(', ')+
        '。不足'+summary.missing_count+'枚はローカル描画を保持します。';
      $('#cg-batch-status').textContent='構造検査前です。画像の透過・配置は実行時に検査します。';
    }catch(error){
      $('#cg-batch-selection').textContent=error.message;
      $('#cg-batch-status').textContent='ファイル名を直すか、役割を確認してください。';
    }
  }
  $('#cg-batch-files').addEventListener('change',preflight);
  $('#cg-batch-zip').addEventListener('change',async()=>{
    const ticket=++zipTicket;zipFiles=null;zipReading=true;clearResult();
    $('#cg-batch-files').value='';
    const archive=$('#cg-batch-zip').files?.[0],base=getCharacter();
    if(!archive||!base?.manifest?.parts){zipReading=false;return;}
    $('#cg-batch-selection').textContent='ZIP内のPNGを検査しています…';
    $('#cg-batch-status').textContent='ZIPの役割・容量・ファイル名を確認しています。';
    try{
      const {files,summary}=await readExternalPartZip(archive,base.manifest.parts);
      if(ticket!==zipTicket)return;
      zipFiles=files;
      $('#cg-batch-selection').textContent='ZIP内のPNG '+summary.provided_count+'枚を検出：'+
        summary.provided_roles.join(', ')+'。未収録の'+summary.missing_count+'枚はローカル描画を保持します。';
      $('#cg-batch-status').textContent='ZIPの一覧を確認しました。透過・配置は取り込み実行時に検査します。';
    }catch(error){
      if(ticket!==zipTicket)return;
      zipFiles=null;
      $('#cg-batch-selection').textContent='ZIPを取り込めません：'+error.message;
      $('#cg-batch-status').textContent='ZIPの中身を確認してください。';
    }finally{if(ticket===zipTicket)zipReading=false;}
  });
  $('#cg-batch-apply').addEventListener('click',async()=>{
    if(aborter||packing)return;
    const base=getCharacter();
    if(!base||base.manifest?.version!==2){
      $('#cg-batch-status').textContent='「デザイン指定の端末内描画」で基準キャラを生成してください。';return;
    }
    if(zipReading){$('#cg-batch-status').textContent='ZIPの検査が終わってから実行してください。';return;}
    const selectedFiles=zipFiles??$('#cg-batch-files').files;
    try{matchExternalPartFiles(selectedFiles,base.manifest.parts);}
    catch(error){$('#cg-batch-status').textContent=error.message;return;}
    clearResult();aborter=new AbortController();onBusy(true);
    $('#cg-batch-cancel').hidden=false;$('#cg-batch-cancel').disabled=false;
    $('#cg-batch-status').textContent='画像を検査しています…';
    try{
      const created=await importExternalPartBatch(base,selectedFiles,{
        signal:aborter.signal,
        onProgress:({stage,completed,total,role})=>{
          $('#cg-batch-status').textContent=stage==='checking'
            ?completed+' / '+total+'枚を検査：'+(role??'')
            :stage==='preview'?'合成プレビューを準備しています…':'Inochi2Dモデルを1回だけ生成しています…';
        }
      });
      created.report.input_bundle_kind=zipFiles?'local-zip':'individual-png';
      result=created;previewUrl=URL.createObjectURL(created.preview);
      $('#cg-batch-preview').src=previewUrl;$('#cg-batch-output').hidden=false;
      $('#cg-batch-summary').textContent='外部PNG '+created.report.external_part_count+
        '枚・テンプレート '+created.report.local_template_part_count+
        '枚／AI出典未確認／Creator実機未検証';
      const warningHost=$('#cg-batch-warnings');
      const labels={'very-low-coverage':'描画範囲が極端に小さい','almost-opaque-tile':'透明部分が非常に少ない','high-edge-contact':'矩形の端に描画が集中'};
      warningHost.replaceChildren();
      const heading=document.createElement('p');
      heading.textContent=created.report.quality_warning_count
        ?'要確認：次の画像は見た目と切り口を確認してください。'
        :'画素統計上の警告はありません。ただし絵柄・隠れた部分・人物の一致は必ず確認してください。';
      warningHost.append(heading);
      if(created.report.quality_warning_count){
        const list=document.createElement('ul');
        for(const item of created.report.quality_warnings){
          const li=document.createElement('li');li.textContent=item.role+'：'+(labels[item.code]??item.code);list.append(li);
        }
        warningHost.append(list);
      }
      const options=created.report.provided_roles.map(role=>{
        const part=created.manifest.parts.find(p=>p.role===role),option=document.createElement('option');
        option.value=role;option.textContent=part.label+' ('+role+')';return option;
      });
      $('#cg-batch-review-role').replaceChildren(...options);
      showComparison();
      $('#cg-batch-status').textContent='一括取り込みを完了しました。通常のキャラクターは変更していません。';
    }catch(error){
      clearResult();
      $('#cg-batch-status').textContent=error.name==='AbortError'?'取り込みを中止しました。'
        :'一括取り込みに失敗しました：'+error.message+' 元のキャラは保持しています。';
    }finally{
      aborter=null;onBusy(false);$('#cg-batch-cancel').hidden=true;$('#cg-batch-cancel').disabled=true;
    }
  });
  $('#cg-batch-cancel').addEventListener('click',()=>aborter?.abort());
  $('#cg-batch-download').addEventListener('click',async()=>{
    if(!result||aborter||packing)return;
    packing=true;onBusy(true);
    try{
      const x=result,files={};let total=0;
      const put=(name,b)=>{
        total+=b.length;if(total>32*1024*1024)throw new Error('ZIPが32MBを超えました。');
        files[name]=[b,{mtime:new Date('2000-01-01T00:00:00Z')}];
      };
      for(const p of x.manifest.parts)put(p.file,new Uint8Array(await x.assets.get(p.role).arrayBuffer()));
      put('preview.png',new Uint8Array(await x.preview.arrayBuffer()));
      put('character.inp',x.native.inp);
      put('character.inx',x.native.inx);
      const json=(name,v)=>put(name,strToU8(JSON.stringify(v,null,2)+'\n'));
      json('character_manifest.json',x.manifest);
      json('experimental_batch_report.json',x.report);
      json('inochi_report.json',x.native.report);
      put('README.txt',strToU8('33パーツは外部透過PNGと端末内テンプレートを組み合わせた実験結果です。\n'+
        '外部置換役割: '+x.report.provided_roles.join(', ')+'\n'+
        '残るテンプレート役割: '+x.report.local_template_roles.join(', ')+'\n'+
        'character_manifest.jsonのgeneratorは基準テンプレート由来です。実際の外部置換はexperimental_batch_report.jsonを参照。\n'+
        '実AI由来・見た目・公式Creatorでの実動作・Cubism互換は未確認。\n'));
      const zipped=await new Promise((ok,bad)=>zip(files,{level:0},(err,bytes)=>err?bad(err):ok(new Blob([bytes],{type:'application/zip'}))));
      save(zipped,'ai-live2d-batch-parts-experiment.zip');
      $('#cg-batch-status').textContent='実験用ZIPを保存しました。通常のキャラクターは変更されていません。';
    }catch(error){$('#cg-batch-status').textContent='ZIP保存に失敗しました：'+error.message;}
    finally{packing=false;onBusy(false);}
  });
  return {update,clearResult};
}