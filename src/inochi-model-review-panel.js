// Review of discrete images rendered from the exported model. No runtime claim,
// external requests, changes to editing data or automatic animation on load.
const POSES={neutral:'通常',shift_left:'移動 −1',shift_right:'移動 +1',tilt_left:'傾き −1',tilt_right:'傾き +1',combined_left:'移動 −1・傾き −1',combined_right:'移動 +1・傾き +1',opposed_left:'移動 −1・傾き +1',opposed_right:'移動 +1・傾き −1',neutral_return:'通常へ戻る'};
const ROLES={upper_lid:'上まぶた',lower_lid:'下まぶた',eyelash_upper:'上まつ毛',eyelash_lower:'下まつ毛',sclera:'白目',iris:'虹彩',pupil:'瞳孔',highlight:'反射',context:'目元の下地',closed_eyelash:'閉眼線',skin_completion:'肌の補完',hair_strand:'毛束の候補',hair_region:'髪の領域候補',head_surface:'頭の表面',neck:'首',body:'胴体'};
export function createModelReviewPanel(container){
  container.className='inochi-review';
  container.innerHTML=`<p id="inochi-review-unavailable" hidden>このモデルZIPには画面用の動作比較画像がありません。モデルZIPは保存できます。詳細モードで新しく生成すると比較画像も保存されます。</p>
    <div id="inochi-review-content" hidden>
      <p class="inochi-format-note">生成モデルから描画した比較画像です。公式Creatorの画面や、ブラウザでモデルを動かす機能ではありません。</p>
      <dl class="inochi-review-verdict"><div><dt>ファイル生成</dt><dd>モデルを受け取り済み</dd></div><div><dt>公式Creatorの動作</dt><dd>この結果では自動検証しません</dd></div><div><dt>自然な見た目</dt><dd>未合格・目視確認が必要</dd></div></dl>
      <label for="inochi-review-view">確認する動き</label><select id="inochi-review-view"><option value="head">頭の移動・傾き（胴体固定）</option><option value="blink">目元の開閉10状態（両目同時）</option></select>
      <label for="inochi-review-variant" id="inochi-review-variant-label" hidden>肌の境界調整の前後</label><select id="inochi-review-variant" hidden><option value="after">補正後のモデルから描画</option><option value="before">補正前の比較画像</option></select><p id="inochi-review-skin-summary" hidden></p>
      <figure class="inochi-review-frame"><img id="inochi-review-image" alt=""/><figcaption id="inochi-review-caption"></figcaption></figure>
      <label for="inochi-review-frame">比較する状態 <span id="inochi-review-position"></span></label><input id="inochi-review-frame" type="range" min="0" max="9" step="1" value="0"/>
      <div class="inochi-review-buttons"><button id="inochi-review-prev" class="secondary">前の状態</button><button id="inochi-review-next" class="secondary">次の状態</button><button id="inochi-review-play" class="secondary">比較画像を順に表示</button></div>
      <p id="inochi-review-metrics"></p><p class="muted">数値は画像上の不具合候補の検査です。肌のぼけ・線の境界・隠れた形や髪の前後関係の正解、自然な動きの合格は保証しません。左右はキャラクター本人を基準にしています。</p>
      <details id="inochi-review-parts"><summary>分離したパーツと補完領域を確認</summary><div class="inochi-review-parts-content">
        <label for="inochi-review-part">パーツ</label><select id="inochi-review-part"></select>
        <label for="inochi-review-plane">確認する領域</label><select id="inochi-review-plane"><option value="observed">元画像から分離した領域</option><option value="completion">補完した領域（推定）</option></select>
        <p id="inochi-review-part-info"></p><figure class="inochi-review-frame"><img id="inochi-review-part-image" alt="選択したパーツ" hidden/></figure><p id="inochi-review-part-status" role="status"></p>
      </div></details><p id="inochi-review-error" role="status"></p>
    </div>`;
  const $=s=>container.querySelector(s);
  let data=null,timer=null,frameURL=null,partURL=null,frameToken=0,partToken=0;
  const frame=()=>data.review.views.find(v=>v.id===$('#inochi-review-view').value);
  function stop(){clearInterval(timer);timer=null;$('#inochi-review-play').textContent='比較画像を順に表示';$('#inochi-review-play').setAttribute('aria-pressed','false');}
  function release(kind){
    const current=kind==='frame'?frameURL:partURL;if(current)URL.revokeObjectURL(current);
    if(kind==='frame')frameURL=null;else partURL=null;
  }
  function image(kind,bytes,alt){
    const element=$(kind==='frame'?'#inochi-review-image':'#inochi-review-part-image');release(kind);
    const token=kind==='frame'?++frameToken:++partToken;
    const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));if(kind==='frame')frameURL=url;else partURL=url;
    element.src=url;element.alt=alt;element.hidden=false;
    element.decode().catch(()=>{if(token===(kind==='frame'?frameToken:partToken))$('#inochi-review-error').textContent='比較用PNGを表示できませんでした。ZIPを保存して確認してください。';});
  }
  function showFrame(){
    if(!data?.available)return;
    const view=frame(),i=Number($('#inochi-review-frame').value),f=view.frames[i];
    const compared=view.id==='blink'&&view.frames.every(f=>f.before_file),isBefore=compared&&$('#inochi-review-variant').value==='before';
    $('#inochi-review-variant').hidden=!compared;$('#inochi-review-variant-label').hidden=!compared;
    const label=view.id==='blink'?`両目の開度 ${f.parameters.EyeOpenL.toFixed(3)}`:(POSES[f.state]||f.state);
    const caption=(compared?(isBefore?'補正前・':'補正後・'):'')+label;
    $('#inochi-review-caption').textContent=caption;$('#inochi-review-position').textContent=`${i+1} / ${view.frames.length}`;
    image('frame',data.entries.get(isBefore?f.before_file:f.file),`${view.id==='blink'?'目元':'頭と固定した胴体'}：${caption}`);
    const diagnostic=isBefore?f.before_diagnostics:f.diagnostics,n=key=>Number.isSafeInteger(diagnostic?.[key])?diagnostic[key]:'未検査';
    $('#inochi-review-metrics').textContent=view.id==='blink'?`透明な穴の候補: ${n('transparent_hole_pixels')}画素 ／ 虹彩の残像候補: ${n('closed_iris_residual_pixels')}画素 ／ 二重線の候補: ${n('central_iris_double_lash_columns')}列`:`首の検査範囲内の穴の候補: ${n('neck_bridge_transparent_pixels')}画素 ／ 胴体の検査範囲の変化: ${n('fixed_torso_changed_pixels')}画素`;
  }
  function showPart(){
    if(!data?.available||!$('#inochi-review-parts').open)return;
    const p=data.parts[Number($('#inochi-review-part').value)],plane=$('#inochi-review-plane').value,asset=p[plane]?.rgba;
    const b=p.source_box_xywh;
    $('#inochi-review-part-info').textContent=`${p.id} ／ 親: ${p.parent} ／ 重なり順: ${p.order} ／ 元画像の位置: (${b[0]}, ${b[1]})・${b[2]}×${b[3]}px`;
    if(asset){image('part',data.entries.get('common/'+asset),`${ROLES[p.role]||p.role}の${plane==='observed'?'分離領域':'補完領域（推定）'}`);$('#inochi-review-part-status').textContent=plane==='observed'?'透明部分を含む元座標のパーツです。':'推定した補完画像です。隠れていた形の正確な復元を保証しません。';}
    else{release('part');partToken++;$('#inochi-review-part-image').hidden=true;$('#inochi-review-part-image').removeAttribute('src');$('#inochi-review-part-status').textContent=plane==='completion'?'このパーツには補完画像を作っていません。':'このパーツには元画像から分離した画像がありません。';}
  }
  function clear(){
    stop();data=null;frameToken++;partToken++;release('frame');release('part');
    for(const id of ['#inochi-review-image','#inochi-review-part-image'])$(id).removeAttribute('src');
    $('#inochi-review-content').hidden=true;$('#inochi-review-unavailable').hidden=true;$('#inochi-review-error').textContent='';$('#inochi-review-part').replaceChildren();
    $('#inochi-review-parts').open=false;
    $('#inochi-review-skin-summary').hidden=true;$('#inochi-review-variant').hidden=true;$('#inochi-review-variant-label').hidden=true;
  }
  function set(next){
    clear();data=next;$('#inochi-review-unavailable').hidden=next.available;$('#inochi-review-content').hidden=!next.available;
    if(!next.available)return;
    for(const [i,p] of next.parts.entries()){
      const option=document.createElement('option');option.value=String(i);option.textContent=`${ROLES[p.role]||p.role}${p.side==='l'?'（本人左）':p.side==='r'?'（本人右）':''} — ${p.id}`;$('#inochi-review-part').append(option);
    }
    $('#inochi-review-view').value='head';$('#inochi-review-frame').value='0';$('#inochi-review-plane').value='observed';$('#inochi-review-variant').value='after';
    if(next.skinBoundary){
      const text=['l','r'].map(s=>{const r=next.skinBoundary.eyes[s];return `本人${s==='l'?'左':'右'}: ${r.applied?`${r.before.mean_absolute_rgb_difference.toFixed(2)} → ${r.after.mean_absolute_rgb_difference.toFixed(2)}`:'調整を適用せず元の補完を保持'}`;});
      const blur=next.skinBoundary.skin_detail?.after?.possible_blur===true?'ぼけの候補は残っています。':'';
      $('#inochi-review-skin-summary').textContent=`肌と補完の境界の色差（0〜255・小さいほど近い）：${text.join(' ／ ')}。${blur}対象境界だけの検査で、肌のぼけ・形・自然さの合格ではありません。`;
      $('#inochi-review-skin-summary').hidden=false;
    }
    showFrame();
  }
  $('#inochi-review-view').addEventListener('change',()=>{stop();$('#inochi-review-frame').value='0';$('#inochi-review-variant').value='after';showFrame();});
  $('#inochi-review-variant').addEventListener('change',()=>{stop();showFrame();});
  $('#inochi-review-frame').addEventListener('input',()=>{stop();showFrame();});
  for(const [id,delta] of [['prev',-1],['next',1]])$('#inochi-review-'+id).addEventListener('click',()=>{stop();$('#inochi-review-frame').value=String((Number($('#inochi-review-frame').value)+delta+10)%10);showFrame();});
  $('#inochi-review-play').addEventListener('click',()=>{
    if(timer){stop();return;}if(!data?.available)return;
    $('#inochi-review-play').textContent='連続表示を止める';$('#inochi-review-play').setAttribute('aria-pressed','true');
    timer=setInterval(()=>{if(!container.getClientRects().length){stop();return;}$('#inochi-review-frame').value=String((Number($('#inochi-review-frame').value)+1)%10);showFrame();},400);
  });
  $('#inochi-review-part').addEventListener('change',showPart);$('#inochi-review-plane').addEventListener('change',showPart);
  $('#inochi-review-parts').addEventListener('toggle',()=>{if($('#inochi-review-parts').open)showPart();else{release('part');partToken++;$('#inochi-review-part-image').removeAttribute('src');}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});window.addEventListener('pagehide',stop);
  return {set,clear,stop};
}
