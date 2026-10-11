import {EXPRESSION_ROLES} from './expression-assets.js';
import {defaultExpressionLayer,expressionLayerVisible} from './expression-layer-state.js';
import {GROUP_LABELS} from './expression-groups.js';
const roleName=role=>EXPRESSION_ROLES.find(([id])=>id===role)[1];
export const CHECK_GROUPS=[
  {id:'face',label:'顔全体・向き',driver:'turn',roles:['face_base']},
  {id:'left_eye',label:'左目（画面右）',driver:'left',roles:['eye_white_l','eye_iris_l','eye_lash_l','eye_closed_l']},
  {id:'right_eye',label:'右目（画面左）',driver:'right',roles:['eye_white_r','eye_iris_r','eye_lash_r','eye_closed_r']},
  {id:'mouth',label:'口',driver:'mouth',roles:['mouth_upper','mouth_lower','mouth_inside','mouth_closed','mouth_teeth','mouth_tongue']},
];
export function motionChecks(state){
  return CHECK_GROUPS.map(group=>{
    const assets=state.assets.filter(a=>group.roles.includes(a.role)),role=assets[0]?.role||group.roles[0],rows=[];
    const add=(id,label,detail,attention,kind,target=role)=>rows.push({id,label,detail,attention,action:{kind,role:target,group:group.id,driver:group.driver}});
    add('assets','素材',assets.length?assets.map(a=>roleName(a.role)).join('・'):'まだ読み込んでいません。',!assets.length,'asset');
    if(!assets.length)return {...group,assets:0,rows};
    const disabled=assets.filter(a=>!(state.layers[a.role]||defaultExpressionLayer(a.role)).enabled);
    add('visibility','表示',disabled.length?`${disabled.length}素材が表示対象から外れています。`:'読み込んだ素材は表示対象です。',Boolean(disabled.length),'layer',disabled[0]?.role||role);
    if(group.driver!=='turn'){
      const values={left:1,right:1,mouth:0},empty=[0,.5,1].filter(v=>!assets.some(a=>expressionLayerVisible(state.layers[a.role]||defaultExpressionLayer(a.role),{...values,[group.driver]:v})));
      add('coverage','開閉時の表示',empty.length?`${empty.map(v=>v===0?'閉じる':v===1?'開く':'半分').join('・')}で、この部位の表示素材がありません。`:'閉じる・半分・開くに表示対象があります。形や重なりはプレビューで確認してください。',Boolean(empty.length),'layer');
      const wrong=assets.find(a=>state.deforms[a.role] && state.deforms[a.role].driver!==group.driver);
      const shaped=assets.filter(a=>state.deforms[a.role]);
      add('deform','開閉の形',wrong?`${roleName(wrong.role)}の変形が、この部位と違う値に結び付いています。`:shaped.length?`${shaped.length}素材に変形設定あり。自然な形かは未確認です。`:'変形は未設定です。画像の切替だけで試すこともできます。',Boolean(wrong)||!shaped.length,'deform',wrong?.role||role);
      const clipped=assets.filter(a=>state.clips[a.role]),keyed=assets.filter(a=>state.clipKeys[a.role]),mismatch=assets.find(a=>state.clipKeys[a.role] && state.clipKeys[a.role].driver!==group.driver);
      add('clip','表示範囲',mismatch?`${roleName(mismatch.role)}の範囲が、この部位と違う値に結び付いています。`:`固定 ${clipped.length}素材 ／ 開閉 ${keyed.length}素材。${clipped.length?'はみ出しをプレビューで確認してください。':'必要な場合に範囲を設定してください。'}`,Boolean(mismatch),'clip',mismatch?.role||role);
    }
    const unassigned=assets.filter(a=>!state.groups.assignments[a.role]),other=assets.find(a=>state.groups.assignments[a.role] && ![group.id,'face'].includes(state.groups.assignments[a.role]));
    add('groups','まとめ方',other?`${roleName(other.role)}は${GROUP_LABELS[state.groups.assignments[other.role]]}に所属しています。意図したまとめ方か確認してください。`:unassigned.length?`${unassigned.length}素材がグループ未所属です。まとめて動かす場合は割り当ててください。`:'読み込んだ素材にグループの割り当てがあります。',Boolean(other)||Boolean(unassigned.length),'groups');
    add('keys','向きの動き',state.groupKeys[group.id]?'左・中央・右の設定あり。動きの品質は未確認です。':'このグループの3位置は未設定です。通常の配置や親の動きは利用できます。',false,'keys');
    return {...group,assets:assets.length,rows};
  });
}
export function motionCheckReport(state){
  const lines=['AI Live2D Maker — 動きの設定チェック','設定の有無から作る確認候補です。自然な表情・立体的な向き・Live2Dモデルの完成を判定しません。','画像は含みません。作業再開には作業ファイルを別途保存してください。',''];
  for(const card of motionChecks(state)){lines.push(`【${card.label}】`);for(const row of card.rows)lines.push(`- ${row.label}：${row.attention?'確認候補':'設定情報'} ／ ${row.detail}`);lines.push('');}
  lines.push('VTube Studio用モデル出力（moc3）：未実装。');return '\uFEFF'+lines.join('\r\n');
}
export function createMotionChecklist({getState,onNavigate}){
  const section=document.createElement('section');section.className='motion-checklist workflow-target';section.setAttribute('aria-labelledby','motion-check-heading');
  section.innerHTML='<h3 id="motion-check-heading" tabindex="-1">動きの設定チェック</h3><p class="muted">設定の有無から確認候補を表示します。自然な動きやLive2Dモデルの完成を判定するものではありません。</p><p id="motion-check-summary" role="status" aria-live="polite"></p><div id="motion-check-cards"></div><button id="motion-check-report" class="secondary">動きの確認一覧を保存</button><p id="motion-check-status" role="status" aria-live="polite"></p>';
  document.querySelector('#expression-assets-summary').before(section);
  let signature='',source=null;
  const labels={asset:'素材を読み込む',layer:'表示を調整',deform:'形を調整',clip:'範囲を調整',groups:'まとめ方を調整',keys:'3位置を調整'};
  function update(){const state=getState();section.hidden=!state.file;const changed=source!==state.file;if(changed){source=state.file;section.querySelector('#motion-check-status').textContent='';}const cards=motionChecks(state),next=JSON.stringify(cards);
    if(next!==signature){signature=next;const open=new Map([...section.querySelectorAll('[data-check-group]')].map(a=>[a.dataset.checkGroup,a.querySelector('details').open]));const fragments=[];
      for(const card of cards){const article=document.createElement('article');article.dataset.checkGroup=card.id;const h=document.createElement('h4');h.textContent=card.label;article.append(h);
        const poses=document.createElement('div');poses.className='motion-check-poses';for(const [value,label] of card.driver==='turn'?[[-1,'左'],[0,'中央'],[1,'右']]:[[0,'閉じた状態'],[.5,'半分'],[1,'開いた状態']]){const button=document.createElement('button');button.className='secondary';button.textContent=label;button.setAttribute('aria-label',`${card.label}：${label}を試す`);button.dataset.pose=value;button.addEventListener('click',()=>{if(!getState().locked)onNavigate({kind:'pose',driver:card.driver,value});});poses.append(button);}article.append(poses);
        const details=document.createElement('details'),summary=document.createElement('summary');const count=card.rows.filter(r=>r.attention).length;summary.textContent=`${card.assets}素材 ／ ${count}件の確認候補・設定詳細`;details.open=!changed && open.has(card.id)?open.get(card.id):count>0;details.append(summary);const list=document.createElement('ul');for(const row of card.rows){const li=document.createElement('li');li.dataset.check=row.id;li.dataset.attention=row.attention;const text=document.createElement('p');text.textContent=`${row.label}：${row.detail}`;const button=document.createElement('button');button.className='secondary';button.textContent=labels[row.action.kind];button.setAttribute('aria-label',`${card.label}・${row.label}：${labels[row.action.kind]}`);button.dataset.checkAction=row.action.kind;button.addEventListener('click',()=>{if(!getState().locked)onNavigate(row.action);});li.append(text,button);list.append(li);}details.append(list);article.append(details);fragments.push(article);
      }section.querySelector('#motion-check-cards').replaceChildren(...fragments);
    }
    const count=cards.reduce((n,c)=>n+c.rows.filter(r=>r.attention).length,0);section.querySelector('#motion-check-summary').textContent=`${state.assets.length}役割を読込済み ／ ${count}件の確認候補。範囲・変形・所属は用途に合わせて選べます。`;
    for(const button of section.querySelectorAll('button'))button.disabled=state.locked || !state.file || (button.dataset.pose!==undefined && !state.assets.length);
  }
  section.querySelector('#motion-check-report').addEventListener('click',()=>{const state=getState();if(state.locked || !state.file)return;const url=URL.createObjectURL(new Blob([motionCheckReport(state)],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='ai-live2d-motion-check.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);section.querySelector('#motion-check-status').textContent='確認一覧の保存を開始しました。画像は含みません。作業ファイルも別途保存してください。';});
  return {update};
}
