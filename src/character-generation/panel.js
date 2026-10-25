import {generateRiggedCharacter} from './model-generator.js';
import {generateDesignedCharacter} from './design-generator.js';
import {createCharacterArchive} from './archive.js';
import {createExternalPartPanel} from './external-part-panel.js';
import {createExternalBatchPanel} from './external-part-batch-panel.js';
import {createSingleImageAuditPanel} from './single-image-audit-panel.js';
import {createCharacterMaker} from '../character-maker/panel.js';
import './style.css';

function save(blob,name){
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);
}

export function createCharacterGenerationMode(){
  const main=document.querySelector('main'),footer=main.querySelector('footer'),legacy=document.createElement('div');
  legacy.id='image-conversion-mode';
  // Move existing nodes only after all old panels have mounted. Event handlers,
  // project blobs, DOM identities and the existing save format stay intact.
  for(const node of [...main.children])if(node!==footer)legacy.append(node);
  const nav=document.createElement('nav');nav.className='creation-mode-switch';nav.setAttribute('aria-label','制作モード');
  nav.innerHTML='<button type="button" class="secondary" id="mode-maker" aria-pressed="true" aria-controls="character-maker-mode">キャラクター制作</button><button type="button" class="secondary" id="mode-generate" aria-label="パーツからキャラ生成" aria-pressed="false" aria-controls="character-generation-mode">従来のパーツ生成</button><button type="button" class="secondary" id="mode-convert" aria-pressed="false" aria-controls="image-conversion-mode">画像1枚から変換</button>';
  const section=document.createElement('section');section.id='character-generation-mode';section.hidden=true;section.setAttribute('aria-labelledby','cg-heading');
  section.innerHTML=`<div class="cg-intro"><span class="eyebrow">PARTS FIRST / TEMPLATE</span><h1 id="cg-heading" tabindex="-1">パーツから、<span>キャラクターを作る。</span></h1><p>顔・目・髪・服を別々に描いて、自動で組み立てます。</p><p class="cg-scope">正面 ／ 胸から上 ／ メイド服 ／ 通常顔</p></div>
    <div class="cg-workspace"><section class="panel cg-settings" aria-labelledby="cg-settings-title"><h2 id="cg-settings-title">Live2D向けキャラ生成</h2><p>まずはテンプレート方式です。AIによる自由生成は未接続です。画像のアップロードや外部送信はありません。</p>
    <form id="cg-form"><label>作り方<select id="cg-provider"><option value="template">テンプレートの女の子</option><option value="design-local">デザイン指定の端末内描画</option><option value="dummy">配置確認用の図形</option><option value="ai" disabled>AI自由生成（未接続）</option></select></label><div class="cg-colors" id="cg-old-colors"><label>髪の色<select id="cg-hair"><option value="lavender">ラベンダー</option><option value="silver">シルバー</option><option value="brown">ブラウン</option></select></label><label>瞳の色<select id="cg-eyes"><option value="violet">バイオレット</option><option value="blue">ブルー</option><option value="amber">アンバー</option></select></label></div>
    <div id="cg-design-fields" hidden><p>共通の色・線・陰影で33パーツを描きます。現在は端末内の描画で、AI生成ではありません。選べる髪型・服装の範囲を試せます。</p>
    <label>キャラクター名<input id="cg-design-name" type="text" maxlength="60" value="新しいキャラクター"></label><div class="cg-colors">
    <label>髪型<select id="cg-design-hair-style"><option value="long-straight">ロングストレート</option><option value="bob">ボブ</option></select></label><label>髪色<input id="cg-design-hair-color" type="color" value="#b6a4d9"></label>
    <label>目の形<select id="cg-design-eye-shape"><option value="round">丸い目</option><option value="almond">アーモンド形</option><option value="slanted">つり目</option></select></label><label>瞳色<input id="cg-design-eye-color" type="color" value="#8065bd"></label>
    <label>顔立ち<select id="cg-design-face"><option value="soft">やわらかい輪郭</option><option value="oval">すっきりした輪郭</option></select></label><label>肌の色<input id="cg-design-skin" type="color" value="#ffe5db"></label>
    <label>服装<select id="cg-design-outfit"><option value="classic-maid">クラシックメイド</option><option value="cafe-maid">カフェメイド</option></select></label><label>服の色<input id="cg-design-cloth" type="color" value="#302d41"></label>
    <label>リボンの色<input id="cg-design-accent" type="color" value="#b5a0d8"></label><label>雰囲気<select id="cg-design-mood"><option value="gentle">穏やか</option><option value="bright">明るい</option><option value="cool">クール</option></select></label></div></div>
    <label>完成画像の背景<select id="cg-background"><option value="transparent">透過</option><option value="white">白</option><option value="lavender">薄紫</option></select></label>
    <button id="cg-generate" class="primary" type="submit">パーツを生成して組み立てる</button><button id="cg-cancel" class="secondary" type="button" hidden>キャラ生成を中止</button></form>
    <progress id="cg-progress" max="33" value="0" aria-label="キャラクターのパーツ生成" hidden></progress><p id="cg-status" role="status" aria-live="polite">色を選び、生成ボタンを押してください。</p><p class="muted">左右はキャラクター本人の左右です。左のパーツは画面の右に配置します。</p></section>
    <section class="panel cg-preview-panel" aria-labelledby="cg-preview-title"><h2 id="cg-preview-title">完成プレビュー</h2><div class="cg-preview"><p id="cg-empty">33パーツを組み立てた<br>キャラクターを表示します</p><img id="cg-preview-image" alt="パーツから自動で組み立てたメイド服のキャラクター" hidden></div><p id="cg-summary" class="muted"></p></section></div>
    <section class="panel cg-output" id="cg-output" hidden aria-labelledby="cg-output-title"><h2 id="cg-output-title">パーツの確認と保存</h2><p id="cg-saved-settings" class="muted"></p><div class="cg-part-layout"><div><label for="cg-part">確認するパーツ</label><select id="cg-part"></select><p id="cg-part-info" class="muted"></p><button type="button" id="cg-part-download" class="secondary">選んだパーツのPNGを保存</button></div><div class="cg-part-preview"><img id="cg-part-image" alt=""></div></div>
    <div class="cg-downloads"><button type="button" id="cg-download-zip" class="primary">パーツと設定をZIP保存</button><button type="button" id="cg-download-preview" class="secondary">完成PNGを保存</button><button type="button" id="cg-download-recipe" class="secondary">再生成設定を保存</button></div>
    <div id="cg-model-output" hidden><h3>Inochi2Dモデル</h3><p>左右のまばたき・口の開閉・頭だけの小さな移動と傾きを自動設定しました。胴体と襟は固定です。</p><div class="cg-downloads"><button type="button" id="cg-download-inp" class="secondary">Inochi2D INPを保存</button><button type="button" id="cg-download-inx" class="secondary">Creator用 INXを保存</button></div><p class="muted">Inochi Creator 0.8.6用です。モデルは背景透過で、髪の物理演算は含みません。自然な見た目・スマホ実機・Cubism / VTube Studio互換は別の未完了項目です。</p></div>
    <div id="cg-design-output" hidden><h3>共通デザインの保存</h3><p>デザインと配置図をZIPへ追加しました。AI向けの依頼仕様も保存できます。これは端末にJSONを保存する操作で、AIへの送信・生成は行いません。</p><button type="button" class="secondary" id="cg-download-ai-request">AI向け依頼仕様を端末に保存</button></div>
    <p id="cg-model-note" class="muted">ZIPに完成PNG、33パーツ、配置・支点・親子のJSONを入れます。テンプレートではInochi2DのINP/INXと動作設定も追加します。配置確認用の図形は静止素材のみです。</p><p class="muted">このZIPは従来の作業ファイルとは別形式です。画面を閉じる前に保存してください。Inochi2DとCubism・VTube Studioは異なる形式です。</p></section>`;
  const maker=createCharacterMaker();
  main.prepend(nav,maker.element,legacy,section);
  const $=s=>section.querySelector(s);let active=null,result=null,previewUrl=null,partUrl=null,packing=false,externalBusy=false,externalPartPanel=null,batchPartPanel=null;
  function switchMode(mode,focus=true){
    for(const [key,element] of [['maker',maker.element],['convert',legacy],['generate',section]]){element.hidden=mode!==key;nav.querySelector('#mode-'+key).setAttribute('aria-pressed',String(mode===key));}
    maker.setVisible(mode==='maker');
    if(focus){const title=(mode==='maker'?maker.element:mode==='convert'?legacy:section).querySelector('h1');title.setAttribute('tabindex','-1');title.focus({preventScroll:true});}
  }
  for(const mode of ['maker','convert','generate'])nav.querySelector('#mode-'+mode).addEventListener('click',()=>switchMode(mode));
  const initial=new URL(location.href).searchParams.get('mode');switchMode(['maker','convert','generate'].includes(initial)?initial:'maker',false);
  function controls(){
    const locked=Boolean(active)||packing||externalBusy;
    for(const e of section.querySelectorAll('select,input,button'))e.disabled=locked;
    $('#cg-provider option[value="ai"]').disabled=true;
    $('#cg-cancel').disabled=!active;$('#cg-cancel').hidden=!active;$('#cg-progress').hidden=!active;
    $('#cg-generate').textContent=active?'パーツを生成中…':result?'設定でキャラを作り直す':'パーツを生成して組み立てる';
    section.setAttribute('aria-busy',String(locked));
  }
  function selectPart(){
    if(partUrl)URL.revokeObjectURL(partUrl);partUrl=null;
    const p=result?.manifest.parts.find(p=>p.role===$('#cg-part').value);if(!p)return;
    partUrl=URL.createObjectURL(result.assets.get(p.role));$('#cg-part-image').src=partUrl;$('#cg-part-image').alt=p.label+'の独立した透明PNG';
    $('#cg-part-info').textContent=`${p.role} ／ ${p.rect.width}×${p.rect.height}px ／ 位置 ${p.rect.x}, ${p.rect.y} ／ ${p.enabled_in_neutral?'通常顔で表示':'通常顔では非表示'}`;
  }
  function publish(next){
    const preparedUrl=URL.createObjectURL(next.preview);
    const options=next.manifest.parts.map(p=>{const o=document.createElement('option');o.value=p.role;o.textContent=p.label;return o;});
    if(previewUrl)URL.revokeObjectURL(previewUrl);result=next;previewUrl=preparedUrl;
    externalPartPanel?.update();batchPartPanel?.update();
    $('#cg-preview-image').src=previewUrl;$('#cg-preview-image').hidden=false;$('#cg-empty').hidden=true;$('#cg-output').hidden=false;
    $('#cg-summary').textContent=`33パーツ ／ 768×1024px ／ ${result.manifest.generator.id==='dummy'?'配置確認用の図形':result.manifest.version===2?'デザイン指定の端末内描画':'テンプレート描画'}（AI生成ではありません）`;
    $('#cg-part').replaceChildren(...options);$('#cg-part').value='face_base';selectPart();
    $('#cg-model-output').hidden=!next.native;
    $('#cg-design-output').hidden=!next.design;
    $('#cg-saved-settings').textContent='表示とダウンロードは、最後に生成が完了した設定のものです。';
    if(!section.hidden)$('#cg-preview-title').scrollIntoView({block:'start',behavior:'auto'});
  }
  function changed(){if(result&&!active)$('#cg-saved-settings').textContent='設定を変えた場合は、作り直すとプレビューと保存内容に反映します。現在は前回の完成結果です。';}
  for(const e of section.querySelectorAll('#cg-form select,#cg-form input'))e.addEventListener('change',changed);
  $('#cg-provider').addEventListener('change',()=>{const design=$('#cg-provider').value==='design-local';$('#cg-design-fields').hidden=!design;$('#cg-old-colors').hidden=design;});
  function designSettings(){return {name:$('#cg-design-name').value,background:$('#cg-background').value,features:{hair:{style:$('#cg-design-hair-style').value,color:$('#cg-design-hair-color').value},eyes:{shape:$('#cg-design-eye-shape').value,color:$('#cg-design-eye-color').value},face:{shape:$('#cg-design-face').value,skin:$('#cg-design-skin').value},outfit:{style:$('#cg-design-outfit').value,color:$('#cg-design-cloth').value,accent:$('#cg-design-accent').value},mood:$('#cg-design-mood').value}};}
  $('#cg-form').addEventListener('submit',async event=>{
    event.preventDefault();if(active||packing)return;const job=new AbortController();active=job;controls();$('#cg-progress').value=0;$('#cg-status').textContent='独立したパーツを準備しています…';
    try{
      const options={signal:job.signal,onProgress:p=>{if(active===job){$('#cg-progress').max=p.total;$('#cg-progress').value=p.completed;$('#cg-status').textContent=p.stage==='model'?`Inochi2Dモデルを作成中：${p.label}`:`${p.completed} / 33：${p.label}を準備しました`;}}};
      const next=$('#cg-provider').value==='design-local'?await generateDesignedCharacter(designSettings(),options):await generateRiggedCharacter({provider:$('#cg-provider').value,hair:$('#cg-hair').value,eyes:$('#cg-eyes').value,background:$('#cg-background').value},options);
      if(active!==job||job.signal.aborted)return;publish(next);$('#cg-status').textContent='33パーツを組み立てました。'+(next.native?'Inochi2Dのまばたき・口・頭の動作を設定し、INP/INXをZIPに追加しました。':'配置確認用の図形は静止素材として保存できます。');
    }catch(error){if(active===job)$('#cg-status').textContent=`${error.name==='AbortError'?'生成を中止しました。':`生成できませんでした。${error.message}`} ${result?'前回の完成結果は保持しています。':'設定を確認して、もう一度生成できます。'}`;}
    finally{if(active===job){active=null;controls();}}
  });
  $('#cg-cancel').addEventListener('click',()=>active?.abort());
  $('#cg-part').addEventListener('change',selectPart);
  $('#cg-part-download').addEventListener('click',()=>{if(result&&!active&&!packing)save(result.assets.get($('#cg-part').value),$('#cg-part').value+'.png');});
  $('#cg-download-preview').addEventListener('click',()=>{if(result&&!active&&!packing)save(result.preview,'character-preview.png');});
  $('#cg-download-recipe').addEventListener('click',()=>{if(result&&!active&&!packing)save(new Blob([JSON.stringify(result.manifest.generator.recipe,null,2)+'\n'],{type:'application/json'}),'generation_recipe.json');});
  $('#cg-download-ai-request').addEventListener('click',()=>{if(result?.aiRequest&&!active&&!packing)save(new Blob([JSON.stringify(result.aiRequest,null,2)+'\n'],{type:'application/json'}),'ai_generation_request.json');});
  for(const ext of ['inp','inx'])$('#cg-download-'+ext).addEventListener('click',()=>{if(result?.native&&!active&&!packing)save(new Blob([result.native[ext]],{type:'application/octet-stream'}),'character.'+ext);});
  $('#cg-download-zip').addEventListener('click',async()=>{
    if(!result||active||packing)return;packing=true;controls();$('#cg-status').textContent='PNGと設定をZIPにまとめています…';
    try{save(await createCharacterArchive(result),'ai-live2d-generated-character.zip');$('#cg-status').textContent='ZIPの保存を開始しました。端末のダウンロード先を確認してください。';}
    catch(error){$('#cg-status').textContent=`ZIPを作成できませんでした。${error.message} 完成結果は保持しています。もう一度保存できます。`;}
    finally{packing=false;controls();}
  });
  externalPartPanel=createExternalPartPanel({section,getCharacter:()=>result,save,onBusy:v=>{externalBusy=v;controls();}});
  batchPartPanel=createExternalBatchPanel({section,getCharacter:()=>result,save,onBusy:v=>{externalBusy=v;controls();}});
  createSingleImageAuditPanel({section,save,onBusy:v=>{externalBusy=v;controls();}});
  controls();return {element:section};
}
