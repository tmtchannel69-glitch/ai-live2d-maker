export function createWorkflowNavigation({getState}) {
  const main=document.querySelector('main');
  const routes=[
    {id:'image',label:'画像',selector:'.upload-panel',title:'画像を選ぶ',tip:'画像を選ぶか、保存した作業ファイルを開いてください。'},
    {id:'separate',label:'分離',selector:'.settings',title:'パーツを分離する',tip:'使うパーツと処理方式を選びます。AI試作では切り抜く場所の指定が必要です。'},
    {id:'review',label:'確認',selector:'.results-panel',title:'結果を確認・補正する',tip:'結果を拡大して確認します。AI結果はブラシで補正できます。確認記録は結果の下にあります。'},
    {id:'motion',label:'動き',selector:'.expression-panel',title:'表情素材と動きを整える',tip:'追加PNGを読み込み、位置を合わせます。合成画面で開閉の形を編集できます。'},
    {id:'save',label:'保存',selector:'.workflow-save-panel',title:'作業を端末に保存する',tip:'作業を再開するには作業ファイルを保存します。制作素材の出力とは用途が異なります。'},
  ];
  const nav=document.createElement('nav');nav.className='workflow-nav';nav.setAttribute('aria-label','作業する工程へ移動');
  const guide=document.createElement('section');guide.className='workflow-guide';
  guide.innerHTML='<h2 id="workflow-heading"></h2><p id="workflow-tip" class="muted"></p>';
  document.querySelector('.intro').after(nav,guide);
  const save=document.createElement('section');save.className='panel workflow-save-panel';
  save.innerHTML=`<h2>作業の保存・再開</h2><p class="muted">今日はここまで、というときは作業ファイルを端末に保存してください。画像・指定・補正済み結果・表情設定をまとめて、あとから再開できます。</p>
    <div class="workflow-save-actions"><button type="button" id="workflow-save" class="primary">この作業を端末に保存</button><button type="button" id="workflow-open" class="secondary">保存した作業を再開</button></div>
    <p id="workflow-save-status" class="muted"></p>
    <div class="handoff-export"><h3>制作工程へ引き継ぐ</h3><p class="muted">すべての分離PNG・追加した表情PNG・配置・動きの設定・確認一覧を一つにまとめます。元画像は含みません。選択中の構成以外や非表示の素材も含みます。</p><button type="button" id="download-handoff" class="secondary" disabled>素材と動きの設定をZIP保存</button><p class="muted">独自形式です。Cubism・VTube Studioへ直接読み込めるモデルではありません。アプリで続ける場合は上の作業保存を使ってください。</p><button type="button" id="download-expression-psd" class="secondary" disabled>配置済み表情素材のPSDを保存（試作）</button><p class="muted">追加した全表情素材を元画像サイズのレイヤーに配置します。表示順を反映し、目・口を開いた状態で表示します。閉じた素材・非表示素材は非表示レイヤーで残します。変形・表示範囲・グループの動きは含みません。Cubismでの読込は未検証です。</p><p id="expression-psd-status" role="status" aria-live="polite"></p><p id="handoff-status" role="status" aria-live="polite"></p></div>
    <details><summary>制作素材を取り出したいとき</summary><p class="muted">PNG・まとめたZIP・確認記録付きの制作素材ZIP・レイヤー付きPSDは、結果の画面から保存できます。これらでは作業を再開できません。実験的なモデル生成は上の専用欄で試せます。Cubism/VTube Studioでの実読込は未検証です。</p><button type="button" id="workflow-exports" class="secondary">結果と素材の出力へ</button></details>`;
  main.querySelector('footer').before(save);
  let current='image',frame=0;
  const buttons=new Map();
  const route=id=>routes.find(r=>r.id===id);
  function select(id){current=id;for(const [key,button] of buttons){if(key===id)button.setAttribute('aria-current','location');else button.removeAttribute('aria-current');}const r=route(id);guide.querySelector('h2').textContent=r.title;guide.querySelector('p').textContent=r.tip;}
  function jump(id) {
    const target=document.querySelector(route(id).selector);if(!target || target.hidden || (!getState().file && !['image','save'].includes(id)))return;
    select(id);target.scrollIntoView({block:'start',behavior:'auto'});target.querySelector('h2')?.focus({preventScroll:true});
  }
  const continuations=[];
  const nextLabels={separate:'分離の設定へ',review:'結果の確認へ',motion:'動きの準備へ',save:'作業の保存へ'};
  routes.forEach((r,i)=>{
    const target=document.querySelector(r.selector);target.classList.add('workflow-target');target.querySelector('h2')?.setAttribute('tabindex','-1');
    const button=document.createElement('button');button.type='button';button.dataset.workflow=r.id;button.innerHTML=`<span aria-hidden="true">${i+1}</span>${r.label}`;button.addEventListener('click',()=>jump(r.id));nav.append(button);buttons.set(r.id,button);
    if(i<routes.length-1){
      const next=routes[i+1],action=document.createElement('button');action.className='secondary workflow-continue';action.textContent=`次：${nextLabels[next.id]}`;action.dataset.workflowNext=next.id;action.addEventListener('click',()=>jump(next.id));target.append(action);continuations.push(action);
      if(r.id==='motion')document.querySelector('.expression-scene').append(action);
    }
  });
  const motionLinks=document.createElement('div');motionLinks.className='workflow-motion-links';
  for(const [selector,label] of [['.motion-checklist','動きの設定チェックへ'],['.asset-panel','素材の読み込みへ'],['.expression-scene','表情の合成・編集へ'],['.motion-panel','頭・髪の動きへ']]) {
    const target=document.querySelector(selector);target.classList.add('workflow-target');target.querySelector('h2,h3').setAttribute('tabindex','-1');
    const button=document.createElement('button');button.className='secondary';button.textContent=label;button.addEventListener('click',()=>{if(!getState().file)return;select('motion');target.scrollIntoView({block:'start',behavior:'auto'});target.querySelector('h2,h3').focus({preventScroll:true});});motionLinks.append(button);continuations.push(button);
  }
  document.querySelector('.expression-panel h2').after(motionLinks);
  save.querySelector('#workflow-save').addEventListener('click',()=>{if(!document.querySelector('#save-project').disabled)document.querySelector('#save-project').click();});
  save.querySelector('#workflow-open').addEventListener('click',()=>{if(!document.querySelector('#open-project').disabled)document.querySelector('#project-file').click();});
  save.querySelector('#workflow-exports').addEventListener('click',()=>jump('review'));
  function update() {
    const state=getState();for(const [id,button] of buttons)button.disabled=!state.file && !['image','save'].includes(id);
    for(const button of continuations)button.disabled=!state.file;
    save.querySelector('#workflow-save').disabled=document.querySelector('#save-project').disabled;
    save.querySelector('#workflow-open').disabled=document.querySelector('#open-project').disabled;
    save.querySelector('#workflow-exports').disabled=!state.file;
    const status=document.querySelector('#project-status').textContent;
    save.querySelector('#workflow-save-status').textContent=status || (state.file?`分離結果 ${state.resultCount}個 ／ 追加の表情素材 ${state.assetCount}役割。未完成でも作業を保存できます。`:'画像がなくても、保存した作業ファイルから再開できます。');
    if(!state.file && !['image','save'].includes(current))select('image');
  }
  function track() {
    frame=0;if(!nav.getClientRects().length)return;const edge=nav.getBoundingClientRect().bottom+32;
    const visible=routes.map(r=>({r,target:document.querySelector(r.selector)})).filter(({r,target})=>!target.hidden && !buttons.get(r.id).disabled).map(({r,target})=>({id:r.id,top:target.getBoundingClientRect().top})).sort((a,b)=>a.top-b.top);
    const before=visible.filter(r=>r.top<=edge);let id=before.at(-1)?.id||'image';
    const same=before.find(r=>r.id===current && Math.abs(r.top-before.at(-1).top)<1);if(same)id=current;
    if(window.scrollY>0 && window.scrollY+innerHeight>=document.documentElement.scrollHeight-2)id='save';
    if(id!==current)select(id);
  }
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(track);};
  document.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
  new MutationObserver(update).observe(document.querySelector('#project-status'),{childList:true,subtree:true,characterData:true});
  select('image');update();return {update};
}