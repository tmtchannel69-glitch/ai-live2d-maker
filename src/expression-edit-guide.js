import {EXPRESSION_ROLES} from './expression-assets.js';
import {defaultExpressionLayer} from './expression-layer-state.js';

const name=role=>EXPRESSION_ROLES.find(([id])=>id===role)[1];
export const EDIT_GUIDE_GROUPS=[
  {id:'left',label:'左目（画面右）',core:['eye_white_l','eye_iris_l','eye_lash_l'],optional:['eye_closed_l']},
  {id:'right',label:'右目（画面左）',core:['eye_white_r','eye_iris_r','eye_lash_r'],optional:['eye_closed_r']},
  {id:'mouth',label:'口',core:['mouth_upper','mouth_lower','mouth_inside'],optional:['mouth_closed','mouth_teeth','mouth_tongue']},
];
const present=(state,role)=>state.assets.some(a=>a.role===role);
export function editGuideReport(state){
  const lines=['【目・口の素材準備ガイド】','基本素材は分けて動かす場合の目安です。別の閉じた絵・歯・舌は用途に応じて準備します。読込済みでも品質は未確認です。'];
  for(const g of EDIT_GUIDE_GROUPS){lines.push(`${g.label}：`,...g.core.map(r=>`- 基本 ${name(r)}：${present(state,r)?'読込済み':'未読込'}`),...g.optional.map(r=>`- 用途に応じて ${name(r)}：${present(state,r)?'読込済み':'未読込'}`));}
  lines.push('元画像にない閉じた形・口内部・動かした下の肌は自動生成しません。別途用意したPNGを読み込んでください。');return lines.join('\r\n');
}
export function createExpressionEditGuide({getState,onNavigate}){
  const element=document.createElement('details');element.id='expression-edit-guide';
  element.innerHTML='<summary>目・口の編集ガイド</summary><p class="muted">素材の準備 → 表示・形の調整 → 開閉の確認。設定だけで自然な表情や完成モデルとは判定しません。</p><div class="expression-guide-selects"><label>編集する部位<select id="guide-group"></select></label><label>作業する素材<select id="guide-role"></select></label></div><h4>1. 素材を用意する</h4><p id="guide-inventory-summary"></p><ul id="guide-materials"></ul><p class="muted">基本素材は分けて動かす場合の目安です。画像の切替だけで試す方法もあります。元画像にない閉じた形・口内部・動かした下の肌は自動生成しません。別途PNGを用意し、元の顔に目や口の絵が残る場合は下地の肌も準備してください。</p><h4>2. 選んだ素材を調整する</h4><p id="guide-role-status" role="status"></p><p id="guide-next-text"></p><button id="guide-next" class="primary"></button><div class="expression-guide-actions"><button id="guide-asset" class="secondary">素材・位置を調整</button><button id="guide-layer" class="secondary">表示を調整</button><button id="guide-deform" class="secondary">形を調整</button><button id="guide-clip" class="secondary">範囲を調整</button></div><p class="muted">「形を調整」から指での編集・重なりの下書き確認へ進めます。別の閉じた絵を切り替える場合は表示条件も確認。範囲ははみ出す場合に設定します。</p><h4>3. 動きを見て確認する</h4><div class="expression-guide-poses"></div><button id="guide-review" class="secondary">選んだ素材を拡大確認・メモ</button><p class="muted">閉じる・半分・開くを合成で確認。確認メモを残し、作業ファイルを保存してください。歯・舌は必要な場合だけ追加します。</p>';
  const $=s=>element.querySelector(s),groupSelect=$('#guide-group'),roleSelect=$('#guide-role');
  EDIT_GUIDE_GROUPS.forEach(g=>groupSelect.add(new Option(g.label,g.id)));
  let source=null,materialRows=[],nextAction=null;
  const group=()=>EDIT_GUIDE_GROUPS.find(g=>g.id===groupSelect.value);
  function selectGroup(){const g=group();roleSelect.replaceChildren(...[...g.core,...g.optional].map(r=>new Option(name(r),r)));materialRows=[...g.core,...g.optional].map(role=>{const li=document.createElement('li'),text=document.createElement('p'),button=document.createElement('button');button.className='secondary';button.textContent='この素材を準備';button.dataset.guideAsset=role;button.addEventListener('click',()=>{if(getState().locked)return;roleSelect.value=role;update();navigate({kind:'asset',role});});li.append(text,button);return {role,li,text,button};});$('#guide-materials').replaceChildren(...materialRows.map(r=>r.li));}
  function navigate(action){if(!getState().locked && getState().file)onNavigate(action);}
  groupSelect.addEventListener('change',()=>{selectGroup();update();});roleSelect.addEventListener('change',update);
  for(const kind of ['asset','layer','deform','clip'])$(`#guide-${kind}`).addEventListener('click',()=>navigate({kind,role:roleSelect.value}));
  $('#guide-next').addEventListener('click',()=>{if(nextAction)navigate(nextAction);});
  $('#guide-review').addEventListener('click',()=>navigate({kind:'note',role:roleSelect.value}));
  for(const [value,label] of [[0,'閉じる'],[.5,'半分'],[1,'開く']]){const button=document.createElement('button');button.className='secondary';button.textContent=label;button.dataset.guidePose=value;button.addEventListener('click',()=>navigate({kind:'pose',driver:group().id,value}));$('.expression-guide-poses').append(button);}
  function update(){
    const state=getState();if(source!==state.file){source=state.file;groupSelect.value='left';selectGroup();element.open=false;}
    if(!materialRows.length)selectGroup();const g=group(),role=roleSelect.value,loaded=present(state,role),layer=state.layers[role]||defaultExpressionLayer(role),shape=state.deforms[role],clip=state.clipKeys[role],note=state.notes?.[role];
    for(const o of roleSelect.options)o.textContent=`${name(o.value)}：${present(state,o.value)?'読込済み':'未読込'}${g.optional.includes(o.value)?'（用途に応じて）':''}`;
    for(const r of materialRows){r.text.textContent=`${g.core.includes(r.role)?'基本':'用途に応じて'}・${name(r.role)}：${present(state,r.role)?'読込済み':'未読込'}`;r.button.textContent=present(state,r.role)?'素材・位置を確認':'この素材を準備';}
    $('#guide-inventory-summary').textContent=`${g.label}：基本 ${g.core.filter(r=>present(state,r)).length}/${g.core.length}、用途に応じた素材 ${g.optional.filter(r=>present(state,r)).length}/${g.optional.length}を読込済み。素材の不足と品質は別に確認してください。`;
    $('#guide-role-status').textContent=`${name(role)}：${loaded?'読込済み':'未読込'}。`;
    let kind='note',label='拡大して確認する',text='閉じた・途中・開いた形と重なりを確認し、気になる状態をメモしてください。';
    if(!loaded){kind='asset';label='素材を準備する';text='この役割は未読込です。用意したPNGを読み込むか、該当するAI分離結果からコピーしてください。コピーは選んだ役割の細分化を自動では行いません。';}
    else if(!layer.enabled){kind='layer';label='表示設定を確認する';text='この素材は非表示です。意図した設定か、先に表示を確認してください。';}
    else if(shape && shape.driver!==g.id){kind='deform';label='開閉の値を確認する';text='形がこの部位と違う開閉の値に結び付いています。変形の設定を確認してください。';}
    else if(clip && clip.driver!==g.id){kind='clip';label='範囲の開閉を確認する';text='範囲がこの部位と違う開閉の値に結び付いています。範囲の設定を確認してください。';}
    else if(note?.stale || note?.status==='needs_fix'){label='確認メモから見直す';text='修正または再確認の記録があります。記録した状態を見直してから調整してください。';}
    else if(!shape && g.core.includes(role)){kind='deform';label='開閉の形を調整する';text='変形は未設定です。閉じた・開いた形を編集するか、別の画像を表示条件で切り替えて試せます。';}
    nextAction={kind,role};$('#guide-next').textContent=label;$('#guide-next-text').textContent=text;
    for(const control of element.querySelectorAll('button,select'))control.disabled=state.locked || !state.file;
    for(const id of ['layer','deform','clip'])$(`#guide-${id}`).disabled=state.locked || !loaded;
    $('#guide-review').disabled=state.locked || !loaded;for(const button of element.querySelectorAll('[data-guide-pose]'))button.disabled=state.locked || !state.assets.some(a=>[...g.core,...g.optional].includes(a.role));
  }
  selectGroup();return {element,update};
}
