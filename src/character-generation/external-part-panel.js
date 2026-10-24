// Phone-friendly local PNG import experiment. Canonical generated assets are not mutated.
import {zip,strToU8} from 'fflate';
import {importExternalPart} from './external-part-import.js';

const message='これは1パーツだけを外部PNGに差し替える実験です。残り32パーツは端末内テンプレートで、AIの完全自動生成ではありません。画像は外部送信されません。';
export function createExternalPartPanel({section,getCharacter,save,onBusy}){
  const region=document.createElement('section');
  region.className='panel cg-external-import';
  region.id='cg-external-import';
  region.hidden=true;
  region.innerHTML='<h3>ChatGPTなどで作った透過PNGを試す</h3>'+
    '<p class="muted">'+message+'</p>'+
    '<label for="cg-ex-role">差し替えるパーツ<select id="cg-ex-role"></select></label>'+
    '<label for="cg-ex-file">透過PNGを選ぶ（最大8MB）<input id="cg-ex-file" type="file" accept="image/png,.png"></label>'+
    '<p class="muted">パーツ単体の画像を選択します。規定サイズで切り抜いたPNG、768×1024の全体座標、1024×1024のAPI座標（左右128px余白）に対応。全身イラストは自動分離できません。</p>'+
    '<button type="button" class="primary" id="cg-ex-apply">1パーツを置換してモデルを試す</button>'+
    '<p id="cg-ex-status" role="status" aria-live="polite">まずは上の「デザイン指定」でキャラを生成してください。</p>'+
    '<div id="cg-ex-results" hidden><p class="muted">実験用プレビュー。通常の完成結果・ダウンロード内容は変更していません。</p>'+
    '<div class="cg-preview"><img id="cg-ex-preview" alt="外部PNGを1パーツだけ使った実験用キャラクターのプレビュー"></div>'+
    '<p id="cg-ex-summary" class="muted"></p>'+
    '<button type="button" class="secondary" id="cg-ex-download">実験結果ZIPを保存（PNG・INP/INX・記録）</button></div>';
  section.querySelector('#cg-output').after(region);
  const $=s=>region.querySelector(s);
  let experimental=null,previewUrl=null,busy=false;
  function clear(){
    experimental=null;
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl=null;$('#cg-ex-preview').removeAttribute('src');$('#cg-ex-results').hidden=true;
    $('#cg-ex-file').value='';
  }
  function update(){
    clear();
    const base=getCharacter(),available=base?.manifest?.version===2;
    region.hidden=!available;
    if(!available)return;
    const options=base.manifest.parts.map(p=>{const o=document.createElement('option');o.value=p.role;o.textContent=p.label+' ('+p.role+', '+p.rect.width+'×'+p.rect.height+')';return o;});
    $('#cg-ex-role').replaceChildren(...options);
    if(base.manifest.parts.some(p=>p.role==='iris_l'))$('#cg-ex-role').value='iris_l';
    $('#cg-ex-status').textContent='透過PNGを選んでください。元の33パーツは保持されます。';
  }
  $('#cg-ex-role').addEventListener('change',()=>{clear();$('#cg-ex-status').textContent='差し替えるPNGを選択してください。';});
  $('#cg-ex-file').addEventListener('change',()=>{clearResultsOnly();$('#cg-ex-status').textContent='画像を選びました。差し替えを実行できます。';});
  function clearResultsOnly(){
    experimental=null;
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl=null;$('#cg-ex-preview').removeAttribute('src');$('#cg-ex-results').hidden=true;
  }
  $('#cg-ex-apply').addEventListener('click',async()=>{
    if(busy||!getCharacter()||!$('#cg-ex-file').files?.[0]){$('#cg-ex-status').textContent='差し替える透過PNGを選択してください。';return;}
    const base=getCharacter(),role=$('#cg-ex-role').value,file=$('#cg-ex-file').files[0];
    busy=true;onBusy(true);$('#cg-ex-status').textContent='画像を検証しています…';
    try{
      const result=await importExternalPart(base,role,file,{onProgress:txt=>$('#cg-ex-status').textContent=txt});
      experimental=result;previewUrl=URL.createObjectURL(result.preview);
      $('#cg-ex-preview').src=previewUrl;
      $('#cg-ex-summary').textContent=role+'のみ外部PNG / その他32パーツはテンプレート / AI出典未確認 / Creator実機未検証';
      $('#cg-ex-results').hidden=false;
      $('#cg-ex-status').textContent='実験用モデルを作成しました。品質の良し悪しは実際の動作で確認してください。';
    }catch(error){
      clearResultsOnly();
      $('#cg-ex-status').textContent='取り込みできませんでした。'+error.message+' 元のキャラクターは保持しています。';
    }finally{busy=false;onBusy(false);}
  });
  $('#cg-ex-download').addEventListener('click',async()=>{
    if(busy||!experimental)return;
    busy=true;onBusy(true);
    try{
      const x=experimental,files={};
      const put=(name,bytes)=>{files[name]=[bytes,{mtime:new Date('2000-01-01T00:00:00Z')}];};
      put('parts/'+x.report.role+'.png',new Uint8Array(await x.tile.arrayBuffer()));
      put('preview.png',new Uint8Array(await x.preview.arrayBuffer()));
      put('character.inp',x.native.inp);
      put('character.inx',x.native.inx);
      put('experimental_import_report.json',strToU8(JSON.stringify(x.report,null,2)+'\n'));
      put('README.txt',strToU8('実験用：外部PNG '+x.report.role+' の1パーツのみ使用。残り32は端末内描画。AI生成モデルではありません。Inochi2D INP/INXです。Creator実機品質未検証。\n'));
      const output=await new Promise((resolve,reject)=>zip(files,{level:0},(err,data)=>err?reject(err):resolve(new Blob([data],{type:'application/zip'}))));
      save(output,'ai-live2d-external-part-experiment.zip');
      $('#cg-ex-status').textContent='実験用ZIPを保存しました。元の生成物は変更していません。';
    }catch(error){$('#cg-ex-status').textContent='ZIP保存に失敗しました。'+error.message;}
    finally{busy=false;onBusy(false);}
  });
  return {update,clear};
}
