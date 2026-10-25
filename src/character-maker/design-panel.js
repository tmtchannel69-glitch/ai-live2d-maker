import {DESIGN_HAIR_ROLES} from '../../shared/design-reference.js';
import {registerDesignReference,importReferenceHair,auditReferenceDesign} from './design-workflow.js';
import {createReferenceArchive,createReferenceComparison,createHairComparisonSheet} from './design-review.js';
import {readMakerPartZip} from './archive.js';
import {shareOrSaveImage} from './mobile-image-save.js';

const roles={bangs_front:'前髪',side_hair_l:'本人左の横髪',side_hair_r:'本人右の横髪',back_hair:'後ろ髪'};
const warningNames={'palette-difference-candidate':'色の差','line-width-difference-candidate':'線幅の差','shading-contrast-difference-candidate':'陰影の濃さの差','faint-alpha-residue-candidate':'薄い背景残留','clipped-boundary-candidate':'画像端への接触','attachment-patch-thin-candidate':'根元の透明領域','underlap-missing-candidate':'重なり下地の不足候補'};
export function createDesignPanel({getProject,run,save,savePrepared}){
  const element=document.createElement('section');element.className='panel maker-design';
  element.innerHTML=`<details id="maker-design-workflow"><summary>共通原画からデザインを揃える</summary><p>完成キャラクター1枚を共通原画として保持し、まず前髪・横髪・後ろ髪を揃えます。横髪は本人の左右で2枚、合計4枚です。ChatGPTでの生成はご自身で行い、ここでは端末内だけで取り込みます。</p>
  <h2>原画と共通条件</h2><label class="maker-file-label">完成キャラクター原画（PNG / JPEG / WebP）<input id="maker-reference-file" type="file" accept="image/png,image/jpeg,image/webp"></label><p class="muted">選択だけでは読み込みません。8 MiB・64〜4096px・800万画素以下。原画は切り分けず、元データのまま制作ZIPにも保存します。</p>
  <label>原画の名前<input id="maker-reference-title" maxlength="80" value="共通デザイン原画"></label><div class="maker-fields"><label>線幅の目安（任意 / px）<input id="maker-reference-line" type="number" min="0.5" max="12" step="0.5" placeholder="原画に合わせる"></label><label>陰影<select id="maker-reference-shading"><option value="reference">原画に合わせる</option><option value="soft-cel">柔らかいセル塗り</option><option value="smooth-painterly">滑らかな塗り</option></select></label><label>光源<select id="maker-reference-lighting"><option value="reference">原画に合わせる</option><option value="upper-left">左上</option><option value="upper-right">右上</option><option value="front">正面</option></select></label><label>髪の共通色（任意）<input id="maker-reference-palette" placeholder="#b6a4d9, #756486" maxlength="44"></label></div>
  <button id="maker-reference-register" type="button" class="primary" disabled>原画と共通条件を登録</button><p id="maker-reference-note" role="status" class="muted">原画は未登録です。まず既存のベースを用意してください。</p>
  <button id="maker-reference-guide" type="button" class="secondary" disabled>原画・髪の制作依頼と33パーツ仕様を保存</button>
  <h2>同じ原画の髪を取り込む</h2><label class="maker-file-label">前髪・左右の横髪・後ろ髪の独立PNG、または部品ZIP<input id="maker-design-hair-files" type="file" multiple accept=".png,.zip,image/png,application/zip"></label><p class="muted">bangs_front.png / side_hair_l.png / side_hair_r.png / back_hair.png。1枚から試せます。不足する素材を成功扱いせず、4枚を揃えて比較します。寸法と位置は制作仕様に従ってください。</p>
  <label class="maker-check"><input id="maker-design-claim" type="checkbox">登録した原画を参照して作った素材です（自己申告）</label><button id="maker-design-hair-apply" type="button" class="primary" disabled>原画用の髪パーツを検査して交換</button>
  <p id="maker-design-state" role="status">原画との一致・完成品質は未確認です。</p><div class="maker-design-thumbs" id="maker-design-thumbs" hidden><button type="button" class="secondary" data-design-view="reference"><img alt="登録した共通デザイン原画"><span>共通原画を大きく見る</span></button><button type="button" class="secondary" data-design-view="current"><img alt="現在の33パーツ組み立て"><span>組み立てを大きく見る</span></button><button type="button" class="secondary" data-design-view="comparison"><img alt="原画と組み立ての左右比較"><span>比較画像を確認・保存</span></button></div>
  <ul id="maker-design-hair-state" class="maker-design-list"></ul><details><summary>パーツ別の品質検査と未確認事項</summary><p class="muted">原画を同じ比率で配置し、現在のパーツのalpha下を比較しています。人物や髪を意味で認識した結果ではありません。短い暗色線の太さ、色差、陰影のコントラストは注意候補です。光源・隠れた形・自然な画風は自動合格にしません。</p><div id="maker-design-metrics"></div></details>
  <button id="maker-reference-review" type="button" class="secondary" disabled>原画・髪4枚・比較画像・検査ZIPを保存</button><p class="muted">制作ZIPなら原画と交換パーツを保存して再開できます。比較ZIPは確認用です。iPhoneは画像をタップして「画像を共有・保存」→「ファイルに保存」。未対応時は「画像だけを開く」から確認できます。実iPhone/Safariでの保存は未検証です。</p>
  </details><dialog id="maker-design-viewer" aria-labelledby="maker-design-viewer-title"><h2 id="maker-design-viewer-title">画像の確認</h2><button id="maker-design-viewer-close" type="button" class="secondary">閉じる</button><div class="maker-design-large"><img id="maker-design-large-image" alt="選んだ確認画像"></div><div class="maker-actions"><button id="maker-design-image-share" type="button" class="primary">画像を共有・保存</button><button id="maker-design-image-save" type="button" class="secondary">画像を端末に保存</button><a id="maker-design-image-open" target="_blank" rel="noopener">画像だけを開く</a></div><p id="maker-design-share-note" role="status">共有画面を開ける端末では「ファイルに保存」を選べます。画像は端末内で扱います。</p></dialog>`;
  const $=s=>element.querySelector(s);let views={},urls=[],selected=null,lastBusy=false,referenceKey=null;
  const hairButton=document.createElement('button');hairButton.type='button';hairButton.className='secondary';hairButton.dataset.designView='hair';hairButton.innerHTML='<img alt="前髪・左右の横髪・後ろ髪の比較"><span>髪4枚を比較・保存</span>';$('#maker-design-thumbs').append(hairButton);
  const zoom=document.createElement('button');zoom.id='maker-design-image-zoom';zoom.type='button';zoom.className='secondary';zoom.textContent='表示を2倍に拡大';zoom.setAttribute('aria-pressed','false');$('#maker-design-viewer-close').after(zoom);zoom.addEventListener('click',()=>{const enlarged=zoom.getAttribute('aria-pressed')!=='true';zoom.setAttribute('aria-pressed',String(enlarged));zoom.textContent=enlarged?'全体表示に戻す':'表示を2倍に拡大';$('#maker-design-large-image').style.width=enlarged?'200%':'100%';});
  function clear(){for(const u of urls)URL.revokeObjectURL(u);urls=[];views={};selected=null;$('#maker-design-viewer').close();$('#maker-design-large-image').removeAttribute('src');$('#maker-design-image-open').removeAttribute('href');}
  function policy(){const line=$('#maker-reference-line').value.trim(),palette=$('#maker-reference-palette').value.trim().toLowerCase();return {line_width_px:line?Number(line):null,hair_palette:palette?palette.split(/[,\s]+/).filter(Boolean):[],shading:$('#maker-reference-shading').value,lighting:$('#maker-reference-lighting').value};}
  $('#maker-reference-register').addEventListener('click',()=>run(signal=>registerDesignReference(getProject(),$('#maker-reference-file').files[0]||getProject().designReference.blob,{signal,label:$('#maker-reference-title').value,policy:policy()}),'共通原画を登録しました。既存33パーツの絵は変えず、原画との違いを確認できます。'));
  $('#maker-design-hair-apply').addEventListener('click',()=>run(async(signal,onProgress)=>{
    const project=getProject();let files=[...$('#maker-design-hair-files').files];if(files.length===1&&/\.zip$/i.test(files[0].name))files=await readMakerPartZip(files[0],project.current.manifest.parts,{signal});
    return importReferenceHair(project,files,{signal,onProgress,declaredReference:$('#maker-design-claim').checked});
  },'共通原画用の髪を交換しました。原画と比較し、未確認の画風・根元・境界を確認してください。'));
  $('#maker-reference-guide').addEventListener('click',()=>run(async(signal,onProgress)=>{await savePrepared(signal,()=>createReferenceArchive(getProject(),{signal,onProgress,guideOnly:true}),'common-design-hair-guide.zip');return null;},'共通原画と制作依頼を端末へ保存しました。AIへの送信・生成は行っていません。'));
  $('#maker-reference-review').addEventListener('click',()=>run(async(signal,onProgress)=>{await savePrepared(signal,()=>createReferenceArchive(getProject(),{signal,onProgress}),'common-design-review.zip');return null;},'比較ZIPの保存を開始しました。完成品質の合格ではありません。制作ZIPも保存してください。'));
  for(const button of element.querySelectorAll('[data-design-view]'))button.addEventListener('click',()=>{
    selected=views[button.dataset.designView];if(!selected)return;$('#maker-design-viewer-title').textContent=button.querySelector('span').textContent;$('#maker-design-large-image').src=selected.url;$('#maker-design-large-image').style.width='100%';zoom.setAttribute('aria-pressed','false');zoom.textContent='表示を2倍に拡大';$('#maker-design-image-open').href=selected.url;$('#maker-design-share-note').textContent='共有画面の「ファイルに保存」、または画像の保存を使ってください。';$('#maker-design-viewer').showModal();
  });
  $('#maker-design-viewer-close').addEventListener('click',()=>$('#maker-design-viewer').close());
  $('#maker-design-image-save').addEventListener('click',()=>{if(selected)save(selected.blob,selected.name);});
  $('#maker-design-image-share').addEventListener('click',async()=>{
    if(!selected)return;const entry=selected;$('#maker-design-image-share').disabled=true;
    try{const result=await shareOrSaveImage(entry.blob,entry.name,save);$('#maker-design-share-note').textContent=result==='shared'?'共有操作を受け付けました。ファイルへの保存先を確認してください。':result==='cancelled'?'共有を取り消しました。画像と制作データは保持しています。':'このブラウザではファイル共有を使えないため、画像のダウンロードを開始しました。';}
    catch{$('#maker-design-share-note').textContent='共有を開始できませんでした。「画像を端末に保存」または「画像だけを開く」を使ってください。';}finally{$('#maker-design-image-share').disabled=false;}
  });
  function controls(busy){lastBusy=busy;const p=getProject(),has=!!p?.designReference;
    $('#maker-reference-register').disabled=busy||!p||!($('#maker-reference-file').files.length||has);
    for(const id of ['maker-reference-guide','maker-reference-review'])$('#'+id).disabled=busy||!has;
    $('#maker-design-hair-apply').disabled=busy||!has||!$('#maker-design-hair-files').files.length||!$('#maker-design-claim').checked;
    for(const b of element.querySelectorAll('[data-design-view]'))b.disabled=busy||!has;
  }
  for(const id of ['maker-reference-file','maker-design-hair-files','maker-design-claim'])$('#'+id).addEventListener('change',()=>{if(id==='maker-design-hair-files')$('#maker-design-claim').checked=false;controls(lastBusy);});
  function update(project,prepared){
    clear();$('#maker-design-hair-state').replaceChildren();$('#maker-design-metrics').replaceChildren();const ref=project?.designReference;
    const key=ref?ref.meta.source.sha256+ref.meta.policy_sha256:null;if(key!==referenceKey)$('#maker-design-claim').checked=false;referenceKey=key;
    $('#maker-design-thumbs').hidden=!ref;
    if(!ref){$('#maker-reference-note').textContent='原画は未登録です。完成キャラクターの原画を選び、登録してください。';$('#maker-design-state').textContent='共通原画との一致・完成品質は未確認です。';return;}
    const m=ref.meta,audit=prepared.audit;
    $('#maker-reference-title').value=m.label;$('#maker-reference-line').value=m.policy.line_width_px??'';$('#maker-reference-palette').value=m.policy.hair_palette.join(', ');$('#maker-reference-shading').value=m.policy.shading;$('#maker-reference-lighting').value=m.policy.lighting;
    $('#maker-reference-note').textContent=`${m.label} ／ ${m.source.width}×${m.source.height}px ／ 指紋 ${m.source.sha256.slice(0,12)}… 元データを保持。原画の画質・権利・AI出典は未確認です。`;
    $('#maker-design-state').textContent=`同じ原画に関連付けた髪 ${audit.hair_progress.linked_pngs}/4枚（3系統）。注意候補 ${audit.warning_count}件。${audit.hair_progress.linked_pngs<4?'髪セットが不足しています。':'4枚の関連付けが揃いました。'}見た目の統一・隠れ領域・完成品質は未確認です。`;
    for(const role of DESIGN_HAIR_ROLES){const p=audit.parts.find(p=>p.role===role),li=document.createElement('li');li.textContent=`${roles[role]}：${p.reference_binding==='declared-current-reference'?'この原画用（自己申告）':p.reference_binding==='not-linked-to-reference'?'この原画に未関連付け':'原画または共通条件が変わっています'} ／ ${p.warning_codes.length?'注意 '+p.warning_codes.map(c=>warningNames[c]).join('・'):'数値の注意候補なし、目視未確認'}`;$('#maker-design-hair-state').append(li);}
    for(const p of audit.parts){const row=document.createElement('p');row.className='muted';row.textContent=`${p.role}：色差 ${p.palette_delta_e76??'不明'} ／ 暗色線の太さの代理値 ${p.measurement.ink_run_proxy_px??'不明'}px ／ 陰影コントラスト ${p.measurement.material_luma_std??'不明'} ／ 端への接触 ${p.measurement.edge_strong_pixels}px ／ 支点周囲の不透明率 ${p.measurement.anchor_patch.opaque_ratio===null?'不明':(p.measurement.anchor_patch.opaque_ratio*100).toFixed(0)+'%'} ／ 下地不足候補 ${p.hidden_overlap_probe.missing_opaque_pixels}/${p.hidden_overlap_probe.tested_pixels}標本。隠れた形・光源は未検証。`;$('#maker-design-metrics').append(row);}
    const entries={reference:{blob:ref.blob,name:'common-design-reference.'+m.source.file.split('.').at(-1)},current:{blob:project.current.preview,name:'work-in-progress-preview.png'},comparison:{blob:prepared.comparison,name:'reference-comparison.png'},hair:{blob:prepared.hair,name:'hair-comparison.png'}};
    for(const [key,entry] of Object.entries(entries)){const url=URL.createObjectURL(entry.blob);urls.push(url);views[key]={...entry,url};element.querySelector(`[data-design-view="${key}"] img`).src=url;}
  }
  return {element,controls,update,prepare:async(project,signal)=>project.designReference?{audit:await auditReferenceDesign(project,{signal}),comparison:await createReferenceComparison(project,{signal}),hair:await createHairComparisonSheet(project,{signal})}:null,
    close:clear};
}
