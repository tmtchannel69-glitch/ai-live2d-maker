import {createAuthoringHandoff} from './authoring-handoff.js';
export function createModelBuildPanel({getState,getSnapshot,onBusy}){
  const section=document.createElement('section');section.className='model-build-panel';
  section.innerHTML='<h3>Live2Dモデルを生成する（実験）</h3><p class="muted">分離した素材から、新しい初期モデルの生成を試します。生成時は素材をこのアプリの開発用サーバーへ送り、一時処理します。第三者のAIサービスへは送りません。アプリの変形・範囲・親子キーの転写、隠れ部分の生成、自然な表情の保証は行いません。</p><button id="model-build-check" class="secondary">生成サーバーを確認</button><button id="model-build-start" class="secondary" disabled>現在の素材からモデル生成を試す</button><button id="model-build-cancel" class="secondary" hidden>生成を中止</button><p id="model-build-status" role="status" aria-live="polite">開発用サーバーと外部の生成ツールの準備が必要です。Cubism/VTube Studioでの動作確認は別途必要です。</p>';
  document.querySelector('.handoff-export').after(section);
  const $=s=>section.querySelector(s);let ready=false,active=null,source=getState().file;
  function controls(){const s=getState();$('#model-build-check').disabled=Boolean(active) || s.locked;$('#model-build-start').disabled=!ready || !s.file || !s.hasMaterials || s.locked || Boolean(active);$('#model-build-cancel').hidden=active?.type!=='build';}
  function cancel(clear=false){const job=active;active=null;job?.control.abort();if(job?.type==='build')onBusy(false);if(clear)$('#model-build-status').textContent='';else if(job)$('#model-build-status').textContent='生成を中止しました。作業は保持しています。';controls();}
  function update(){const next=getState().file;if(next!==source){source=next;cancel(true);}controls();}
  $('#model-build-check').addEventListener('click',async()=>{
    if(active || getState().locked)return;const job={type:'check',control:new AbortController()};active=job;controls();$('#model-build-status').textContent='生成サーバーを確認しています…';
    try{const r=await fetch('/api/model-build/status',{signal:job.control.signal});if(!r.ok)throw new Error();const s=await r.json();if(active!==job)return;ready=s.configured===true && !s.busy;$('#model-build-status').textContent=ready?'生成ツールに接続できました。現在の素材を送って初期モデルを作成できます。公式Core/VTube Studioでの読込は未確認です。':'生成ツールが未設定か処理中です。開発用の起動手順を確認してください。';}
    catch{if(active===job){ready=false;$('#model-build-status').textContent='生成サーバーへ接続できませんでした。開発用サーバーの起動手順を確認してください。素材は送信していません。';}}
    finally{if(active===job){active=null;controls();}}
  });
  $('#model-build-start').addEventListener('click',async()=>{
    const state=getState();if(active || !ready || state.locked || !state.file || !state.hasMaterials)return;
    const snapshot=getSnapshot(),job={type:'build',control:new AbortController()};active=job;onBusy(true);controls();$('#model-build-status').textContent='モデル生成用の素材を準備しています…';
    try{
      const blob=await createAuthoringHandoff(snapshot);if(active!==job)return;
      $('#model-build-status').textContent='初期モデルを生成しています。数分かかることがあります…';
      const r=await fetch('/api/model-build',{method:'POST',headers:{'Content-Type':'application/zip'},body:blob,signal:job.control.signal});
      if(!r.ok){let message='モデル生成に失敗しました。';try{message=(await r.json()).error||message;}catch{}throw new Error(message);}
      if(r.headers.get('Content-Type')?.split(';')[0]!=='application/zip')throw new Error('モデルの応答形式が正しくありません。');
      const output=await r.blob();if(active!==job)return;if(!output.size || output.size>110*1024*1024)throw new Error('モデル出力のサイズが正しくありません。');
      const url=URL.createObjectURL(output),a=document.createElement('a');a.href=url;a.download='ai-live2d-experimental-model.zip';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);
      $('#model-build-status').textContent='実験的な初期モデルの保存を開始しました。検証結果はZIP内のBUILD_REPORTをご確認ください。公式Core/VTube Studioでの実読込と表情品質は未確認です。';
    }catch(e){if(active===job)$('#model-build-status').textContent=`${e.message} 現在の作業は保持しています。`;}
    finally{if(active===job){active=null;onBusy(false);controls();}}
  });
  $('#model-build-cancel').addEventListener('click',()=>cancel());controls();return {update,cancel:()=>cancel(true)};
}
