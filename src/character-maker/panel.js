import {generateDesignedCharacter} from '../character-generation/design-generator.js';
import {createMakerProject,replaceMakerParts,undoMakerChange,restoreMakerParts} from './project.js';
import {createMakerPreset} from './presets.js';
import {createMakerArchive,readMakerArchive,readMakerPartZip} from './archive.js';
import {createMakerGuide} from './guide.js';
import {createMakerPreview} from './preview.js';
import {DEFAULT_POSE,MAKER_PARAMETERS,matchMakerFiles} from '../../shared/modular-character.js';
import './style.css';

const names={EyeOpenL:'本人左目の開き',EyeOpenR:'本人右目の開き',MouthOpen:'口の開き',HeadX:'頭を左右へ',HeadY:'頭を上下へ',HeadTilt:'頭の傾き',Breath:'呼吸のふくらみ'};
const sets={bangs:'前髪',eyes:'目',outfit:'衣装'};
function save(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60_000);}

export function createCharacterMaker(){
  const section=document.createElement('section');section.id='character-maker-mode';section.setAttribute('aria-labelledby','maker-heading');
  section.innerHTML=`<div class="maker-intro"><span class="eyebrow">PARTS FIRST / CHARACTER MAKER</span><h1 id="maker-heading" tabindex="-1">パーツを選んで、<span>自分のキャラクターに。</span></h1><p>33枚の独立パーツを組み立て、前髪・目・衣装を交換します。</p><p class="maker-scope">正面・胸から上の女性キャラクター ／ Inochi2D</p></div>
  <div class="maker-workspace"><div class="maker-sidebar"><section class="panel"><h2>1. ベースを用意</h2><p>端末内で自作テンプレートを描きます。AI画像生成は未接続です。</p>
  <form id="maker-form"><div class="maker-fields"><label>髪型<select id="maker-hair-style"><option value="long-straight">ロング</option><option value="bob">ボブ</option></select></label><label>髪色<input id="maker-hair-color" type="color" value="#b6a4d9"></label><label>目の形<select id="maker-eye-shape"><option value="round">丸い目</option><option value="almond">アーモンド形</option><option value="slanted">つり目</option></select></label><label>瞳色<input id="maker-eye-color" type="color" value="#8065bd"></label></div><button type="submit" id="maker-create" class="primary">ベースを組み立てる</button></form>
  <label class="maker-file-label" for="maker-open-file">保存した制作ZIPを選択<input id="maker-open-file" type="file" accept=".zip,application/zip"></label><button type="button" id="maker-open" class="secondary" disabled>制作を再開</button><p class="muted">制作ZIPは48 MiBまで。旧33パーツZIPも読み込めます。画像変換モードのZIPは別入口です。</p></section>
  <section class="panel"><h2>2. パーツを交換</h2><p>動作確認用の別デザインを試せます。すべて自作テンプレートで、AI生成品ではありません。</p><div class="maker-stack">${Object.entries(sets).map(([id,label])=>`<button type="button" id="maker-preset-${id}" class="secondary" data-needs-project>${label}の別テンプレートを試す</button>`).join('')}</div>
  <details><summary>ChatGPT等の独立PNGを取り込む</summary><p>共通のデザインと配置ガイドを使って作った透過PNGを読み込みます。1枚絵の自動分離とは別の操作です。</p><button type="button" id="maker-guide" class="secondary" data-needs-project>共通参考画像と配置ガイドを保存</button><label class="maker-file-label" for="maker-part-files">役割名のPNG、または部品ZIP<input type="file" id="maker-part-files" multiple accept=".png,.zip,image/png,application/zip"></label><p id="maker-files-note" class="muted">ファイルの選択だけでは交換しません。外部への画像送信はありません。</p><button type="button" id="maker-apply" class="primary" disabled>確認して交換</button><p class="muted">例：bangs_front.png、iris_l.png、dress_base.png。左右は本人基準です。左目は画面の右側。指定寸法か、配置済み768×1024画像が必要です。PNG合計12 MiB、部品ZIP16 MiBまで。</p></details>
  <div class="maker-undo"><button type="button" id="maker-undo" class="secondary" disabled>ひとつ前の交換に戻す</button><label>基準に戻す範囲<select id="maker-reset-set"><option value="bangs">前髪</option><option value="eyes">目</option><option value="outfit">衣装</option></select></label><button type="button" id="maker-restore" class="secondary" data-needs-project>この範囲を元に戻す</button></div></section></div>
  <section class="panel maker-stage-panel"><h2>組み立てと動き</h2><div class="maker-stage"><p id="maker-empty">ベースを組み立てると<br>ここで交換と動きを確認できます。</p><canvas id="maker-canvas" width="384" height="512" aria-label="現在の33パーツと動作の独立描画プレビュー" hidden></canvas></div><p id="maker-summary" class="muted">現在の制作データはありません。</p>
  <div id="maker-motion" hidden><h3>3. 基本動作を確認</h3><div class="maker-sliders">${Object.entries(MAKER_PARAMETERS).map(([id,[min,max,value]])=>`<label for="maker-${id}">${names[id]}<output id="maker-value-${id}">${value.toFixed(2)}</output><input type="range" id="maker-${id}" min="${min}" max="${max}" step="0.025" value="${value}"></label>`).join('')}</div><div class="maker-actions"><button type="button" id="maker-pose-reset" class="secondary">通常の姿勢へ</button><button type="button" id="maker-play" class="secondary" aria-pressed="false">瞬きと呼吸を再生</button></div><p class="muted">実モデルの設定を使う独立Canvas描画です。公式SDKではありません。頭は小さな平面移動・傾きで、立体的な角度や髪の物理演算は含みません。自然な見た目は未合格です。</p></div>
  </section></div>
  <div class="panel maker-feedback"><p id="maker-status" role="status" aria-live="polite">ベースを組み立てるか、保存済みの制作ZIPを開いてください。</p><button type="button" id="maker-cancel" class="secondary" hidden>処理を中止</button><p id="maker-quality" class="muted">構造検査、ファイル生成、公式Creator動作、完成品質は別々に判定します。</p></div>
  <section id="maker-output" class="panel" hidden><h2>4. 制作を保存</h2><p>交換済みの33枚と基準パーツ、配置・支点・親子関係、動作設定、完成PNG、INP/INXをまとめます。画面を閉じる前に保存してください。</p><div class="maker-actions"><button type="button" id="maker-save" class="primary">制作ZIPを保存</button><button type="button" id="maker-save-image" class="secondary">完成PNGを保存</button><button type="button" id="maker-save-inp" class="secondary">Inochi2D INPを保存</button><button type="button" id="maker-save-inx" class="secondary">Creator用 INXを保存</button></div><div class="maker-part"><label>個別PNG<select id="maker-part"></select></label><button type="button" id="maker-save-part" class="secondary">選んだパーツを保存</button><img id="maker-part-preview" alt="選択中の独立PNG"></div><p id="maker-part-origin" class="muted"></p><p class="muted">完成PNGは通常姿勢です。操作中の動作値は制作ZIPに保存します。Inochi Creator 0.8.6向けで、Cubism／MOC3／VTube Studio互換ではありません。外部PNGのAI出典・画風・隠れ領域は未確認です。</p></section>`;
  // Keep the short job status/cancel near the phone viewport. Longer quality
  // notes stay in normal flow instead of covering the character while scrolling.
  const feedback=section.querySelector('.maker-feedback'),qualityPanel=document.createElement('div');qualityPanel.className='maker-quality';qualityPanel.append(section.querySelector('#maker-quality'));feedback.after(qualityPanel);section.querySelector('.maker-workspace').before(feedback);
  const jump=document.createElement('button');jump.type='button';jump.id='maker-see-preview';jump.className='secondary';jump.dataset.needsProject='';jump.textContent='組み立てと動きを見る';section.querySelector('.maker-stack').after(jump);jump.addEventListener('click',()=>section.querySelector('.maker-stage-panel').scrollIntoView({block:'start'}));
  const $=s=>section.querySelector(s);let project=null,renderer=null,active=null,partUrl=null,playing=false,raf=0,t0=0,lastFrame=0,idlePose=null;
  function status(s){$('#maker-status').textContent=s;}
  function controls(){const busy=!!active;section.setAttribute('aria-busy',String(busy));for(const e of section.querySelectorAll('button,input,select'))e.disabled=busy;
    for(const e of section.querySelectorAll('[data-needs-project]'))e.disabled=busy||!project;
    $('#maker-open').disabled=busy||!$('#maker-open-file').files.length;$('#maker-apply').disabled=busy||!project||!$('#maker-part-files').files.length;$('#maker-undo').disabled=busy||!project?.undo.length;
    $('#maker-cancel').disabled=!busy;$('#maker-cancel').hidden=!busy;
  }
  function syncPose(){if(!project)return;for(const name of Object.keys(MAKER_PARAMETERS)){$('#maker-'+name).value=project.pose[name];$('#maker-value-'+name).textContent=project.pose[name].toFixed(2);}}
  function draw(){if(project&&renderer)renderer.render($('#maker-canvas'),project.pose);}
  function stop(){cancelAnimationFrame(raf);raf=0;playing=false;$('#maker-play').setAttribute('aria-pressed','false');$('#maker-play').textContent='瞬きと呼吸を再生';if(project&&idlePose){project={...project,pose:idlePose};idlePose=null;syncPose();draw();}}
  function selectedPart(){if(partUrl)URL.revokeObjectURL(partUrl);partUrl=null;if(!project)return;const role=$('#maker-part').value;if(!project.current.assets.has(role))return;partUrl=URL.createObjectURL(project.current.assets.get(role));$('#maker-part-preview').src=partUrl;const o=project.origins[role];$('#maker-part-origin').textContent=`${role} ／ ${o.label} ／ AI由来は未確認`;
  }
  async function publish(candidate,job){const prepared=await createMakerPreview(candidate.current.native,{signal:job.signal});if(active!==job||job.signal.aborted){prepared.close();return;}const first=!project;stop();renderer?.close();renderer=prepared;project=candidate;
    $('#maker-empty').hidden=true;$('#maker-canvas').hidden=false;$('#maker-motion').hidden=false;$('#maker-output').hidden=false;section.dataset.revision=String(project.revision);
    const counts=Object.values(project.origins).reduce((a,o)=>(a[o.kind]=(a[o.kind]||0)+1,a),{});$('#maker-summary').textContent=`33パーツ ／ 交換 ${project.revision}回 ／ 基準 ${counts['local-template']||0}・別テンプレート ${counts['local-preset']||0}・取り込み ${counts['user-png']||0}`;
    const previous=$('#maker-part').value;$('#maker-part').replaceChildren(...project.current.manifest.parts.map(p=>{const o=document.createElement('option');o.value=p.role;o.textContent=p.label;return o;}));if(previous)$('#maker-part').value=previous;selectedPart();syncPose();draw();
    const warnings=project.current.quality.parts.filter(p=>p.warning_count).map(p=>`${p.role}（${p.warning_codes.map(c=>({'very-low-coverage':'描画範囲が小さい','almost-opaque-tile':'不透明部分が多い','high-edge-contact':'画像端への接触が多い'}[c])).join('・')}）`);$('#maker-quality').textContent=`構造検査：33枚と首の接続・目の配置を確認。${warnings.length?'画素の注意候補：'+warnings.join('、')+'。':''}モデル生成：完了。今回の素材の公式Creator動作・完成品質：画面上の自動合格判定は行いません。`;
    if(first&&!section.hidden)section.querySelector('.maker-stage-panel').scrollIntoView({block:'start'});
  }
  async function run(task,success){if(active)return;stop();const job=new AbortController();active=job;controls();status('端末内で確認しています…');try{const candidate=await task(job.signal,msg=>{if(active===job)status(msg);});if(job.signal.aborted)throw new DOMException('中止しました。','AbortError');if(candidate)await publish(candidate,job);if(active===job&&!job.signal.aborted)status(success);}catch(e){if(active===job)status((e.name==='AbortError'?'処理を中止しました。':`処理できませんでした。${e.message}`)+(project?' 交換前の制作データと動作は保持しています。':' ベースの作成・選択からやり直せます。'));}finally{if(active===job){active=null;controls();}}}
  $('#maker-form').addEventListener('submit',e=>{e.preventDefault();run(async(signal,progress)=>createMakerProject(await generateDesignedCharacter({features:{hair:{style:$('#maker-hair-style').value,color:$('#maker-hair-color').value},eyes:{shape:$('#maker-eye-shape').value,color:$('#maker-eye-color').value}}},{signal,onProgress:p=>progress(`${p.completed}/${p.total}：${p.label}`)}),{signal}),'33パーツを組み立てました。前髪・目・衣装を交換して、動きを確認できます。');});
  $('#maker-open-file').addEventListener('change',controls);$('#maker-open').addEventListener('click',()=>run(signal=>readMakerArchive($('#maker-open-file').files[0],{signal}),'制作ZIPを再開しました。PNGから動作を再計算しました。'));
  for(const set of Object.keys(sets))$('#maker-preset-'+set).addEventListener('click',()=>run(async(signal,onProgress)=>replaceMakerParts(project,await createMakerPreset(project,set,{signal}),{signal,onProgress,originKind:'local-preset',label:sets[set]+'の別テンプレート（端末内描画）'}),sets[set]+'を交換しました。他の交換と共通動作は保持しています。'));
  $('#maker-part-files').addEventListener('change',()=>{const files=[...$('#maker-part-files').files];try{if(files.length===1&&/\.zip$/i.test(files[0].name)){if(files[0].size>16*1024*1024)throw new Error('部品ZIPは16 MiBまでです。');$('#maker-files-note').textContent='部品ZIPを選びました。「確認して交換」で中身を検査します。';}else{$('#maker-files-note').textContent=matchMakerFiles(files).map(p=>p.role).join('、')+' を選択。まだ交換していません。';}}catch(e){$('#maker-files-note').textContent=e.message;}controls();});
  $('#maker-apply').addEventListener('click',()=>run(async(signal,onProgress)=>{let files=[...$('#maker-part-files').files];if(files.length===1&&/\.zip$/i.test(files[0].name))files=await readMakerPartZip(files[0],project.current.manifest.parts,{signal});return replaceMakerParts(project,files,{signal,onProgress});},'パーツを交換しました。目・口・頭の動きで接続を確認してください。'));
  $('#maker-undo').addEventListener('click',()=>run(async()=>undoMakerChange(project),'ひとつ前の交換に戻しました。現在の動作値を保持しています。'));
  $('#maker-restore').addEventListener('click',()=>run((signal,onProgress)=>restoreMakerParts(project,$('#maker-reset-set').value,{signal,onProgress}),'選択した範囲を基準パーツに戻しました。'));
  $('#maker-cancel').addEventListener('click',()=>active?.abort());
  for(const name of Object.keys(MAKER_PARAMETERS))$('#maker-'+name).addEventListener('input',()=>{if(!project||active)return;const value=Number($('#maker-'+name).value);stop();project={...project,pose:{...project.pose,[name]:value}};syncPose();draw();});
  $('#maker-pose-reset').addEventListener('click',()=>{stop();project={...project,pose:{...DEFAULT_POSE}};syncPose();draw();});
  $('#maker-play').addEventListener('click',()=>{if(playing){stop();return;}if(!project||active||section.hidden)return;idlePose={...project.pose};playing=true;t0=performance.now();lastFrame=0;$('#maker-play').textContent='再生を停止';$('#maker-play').setAttribute('aria-pressed','true');const frame=t=>{if(!playing)return;if(t-lastFrame>=80){lastFrame=t;const seconds=(t-t0)/1000,phase=seconds%5.4,open=phase<.28?Math.abs(phase-.14)/.14:1;project={...project,pose:{...idlePose,EyeOpenL:open,EyeOpenR:open,Breath:(1-Math.cos(seconds/4.2*Math.PI*2))*.5}};syncPose();draw();}raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);});
  $('#maker-part').addEventListener('change',selectedPart);
  const savePrepared=async(signal,prepare,name)=>{const blob=await prepare();if(signal.aborted)throw new DOMException('保存を中止しました。','AbortError');save(blob,name);};
  for(const [id,action] of Object.entries({
    'maker-save':signal=>savePrepared(signal,()=>createMakerArchive(project),'ai-live2d-character-project.zip'),
    'maker-guide':signal=>savePrepared(signal,()=>createMakerGuide(project),'character-part-guide.zip'),
    'maker-save-image':async()=>save(project.current.preview,'character-preview.png'),
    'maker-save-inp':async()=>save(new Blob([project.current.native.inp]),'character.inp'),
    'maker-save-inx':async()=>save(new Blob([project.current.native.inx]),'character.inx'),
    'maker-save-part':async()=>save(project.current.assets.get($('#maker-part').value),$('#maker-part').value+'.png')
  }))$('#'+id).addEventListener('click',()=>run(async signal=>{await action(signal);return null;},'端末への保存を開始しました。ダウンロード先を確認してください。'));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});window.addEventListener('pagehide',event=>{stop();active?.abort();if(!event.persisted){renderer?.close();if(partUrl)URL.revokeObjectURL(partUrl);}});
  controls();return {element:section,setVisible:visible=>{if(!visible)stop();}};
}
