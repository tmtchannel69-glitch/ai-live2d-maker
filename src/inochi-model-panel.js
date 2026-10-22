const MAX_MODEL_BYTES=110*1024*1024;
const DOWNLOAD_NAME='inochi2d-character.zip';

// This panel only exports an independent model. It never replaces the current
// parts, expression assets, prompts, or saved project format.
export function createInochiModelPanel({getState,onBusy}){
  const section=document.createElement('section');
  section.className='panel inochi-model-panel';
  section.setAttribute('aria-labelledby','inochi-model-title');
  section.innerHTML=`<h2 id="inochi-model-title">画像1枚から動くモデルを作る</h2>
    <p>顔・左右の目・閉じたまぶたの5パーツで、まばたきと顔の左右移動を試作します。画像の選択後、この欄の生成ボタンを押してください。切り抜く場所の指定や手動のリギングは不要です。</p>
    <p class="inochi-format-note">出力はInochi2D用のINP・INXです。Live2D Cubism・VTube Studio用のモデルとは異なります。</p>
    <p class="muted">正面・1人の画像向けの実験機能です。目・髪などの分離や隠れた部分の補完には限界があり、元の絵と異なる箇所や不自然な動きが残ることがあります。生成時だけ、画像をこのアプリの開発用サーバーへ送って一時処理します。</p>
    <div class="inochi-model-actions"><button id="inochi-model-start" class="primary" disabled>画像からInochi2Dモデルを生成</button><button id="inochi-model-cancel" class="secondary" hidden>生成を中止</button></div>
    <progress id="inochi-model-progress" aria-label="Inochi2Dモデルを生成中" hidden></progress>
    <p id="inochi-model-status" role="status" aria-live="polite">まずはキャラクター画像を選択してください。</p>
    <div id="inochi-model-result" hidden><h3>生成したモデル</h3><p>モデルと自動生成したパーツ・設定・検証レポートをZIPで保存します。Inochi Creator 0.8.6で見た目と動きを確認してください。</p><button id="inochi-model-download" class="secondary">生成済みのモデルZIPを保存</button></div>`;
  document.querySelector('.workspace').after(section);
  const $=selector=>section.querySelector(selector);
  let source=getState().file,active=null,resultUrl=null,retry=false;

  function controls(){
    const state=getState();
    $('#inochi-model-start').disabled=!state.file || state.locked || Boolean(active);
    $('#inochi-model-start').textContent=retry?'もう一度Inochi2Dモデルを生成':'画像からInochi2Dモデルを生成';
    $('#inochi-model-cancel').hidden=!active;
    $('#inochi-model-progress').hidden=!active;
    $('#inochi-model-result').hidden=!resultUrl;
    $('#inochi-model-download').disabled=Boolean(active) || state.locked;
    section.setAttribute('aria-busy',String(Boolean(active)));
  }
  function clearResult(){if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=null;retry=false;}
  function cancel(clear=false){
    const job=active;active=null;job?.control.abort();
    if(clear){clearResult();$('#inochi-model-status').textContent='';}
    else if(job){retry=true;$('#inochi-model-status').textContent='生成を中止しました。現在の作業は保持しています。サーバー側の処理が終了するまで、再試行を待つ場合があります。';}
    if(job)onBusy(false);
    controls();
  }
  function update(){
    const next=getState().file;
    if(next!==source){
      source=next;cancel(true);
      $('#inochi-model-status').textContent=next?'準備できました。生成ボタンを押すまで画像は送信しません。':'まずはキャラクター画像を選択してください。';
    }
    controls();
  }
  function download(){
    if(!resultUrl || active || getState().locked)return;
    const link=document.createElement('a');link.href=resultUrl;link.download=DOWNLOAD_NAME;
    document.body.append(link);link.click();link.remove();
  }
  async function responseError(response,fallback){
    try{const body=await response.json();if(typeof body.error==='string')return body.error;}catch{}
    return fallback;
  }
  $('#inochi-model-start').addEventListener('click',async()=>{
    const state=getState();if(active || state.locked || !state.file)return;
    const job={file:state.file,control:new AbortController()};active=job;retry=false;
    onBusy(true);controls();$('#inochi-model-status').textContent='自動生成の準備を確認しています…';
    const current=()=>active===job && getState().file===job.file && !job.control.signal.aborted;
    try{
      const readiness=await fetch('/api/inochi2d/status',{signal:job.control.signal});
      if(!readiness.ok)throw new Error(await responseError(readiness,'生成サーバーへ接続できません。開発用サーバーの起動手順を確認してください。画像は送信していません。'));
      const status=await readiness.json();if(!current())return;
      if(!status.configured)throw new Error('自動生成サーバーが未設定です。開発用の起動手順を確認してください。画像は送信していません。');
      if(status.busy)throw new Error('生成サーバーが処理中です。少し待ってから、もう一度お試しください。画像は送信していません。');
      $('#inochi-model-status').textContent='パーツ分離・動きの設定・Inochi2Dモデルを自動生成しています。数分かかることがあります…';
      const response=await fetch('/api/inochi2d/generate',{method:'POST',headers:{'Content-Type':job.file.type},body:job.file,signal:job.control.signal});
      if(!response.ok)throw new Error(await responseError(response,'Inochi2Dモデルの生成に失敗しました。'));
      if(response.headers.get('Content-Type')?.split(';')[0].trim()!=='application/zip')throw new Error('モデルの応答形式が正しくありません。');
      const length=Number(response.headers.get('Content-Length'));
      if(Number.isFinite(length) && length>MAX_MODEL_BYTES)throw new Error('モデル出力のサイズが上限を超えています。');
      const output=await response.blob();if(!current())return;
      if(!output.size || output.size>MAX_MODEL_BYTES)throw new Error('モデル出力のサイズが正しくありません。');
      const signature=new Uint8Array(await output.slice(0,4).arrayBuffer());if(!current())return;
      if(signature[0]!==0x50 || signature[1]!==0x4b || signature[2]!==0x03 || signature[3]!==0x04)throw new Error('モデルZIPの形式が正しくありません。');
      clearResult();resultUrl=URL.createObjectURL(output);
      $('#inochi-model-status').textContent='Inochi2Dモデルを生成しました。ZIP内の検証レポートを確認し、Inochi Creator 0.8.6で開いてください。この画像の自然な表情や、公式Creatorでの動作を自動的に確認済みとは判定していません。';
    }catch(error){
      if(current()){
        retry=true;
        const message=error instanceof TypeError?'生成サーバーへ接続できませんでした。開発用サーバーの起動を確認してください。':error.message;
        $('#inochi-model-status').textContent=`${message} 現在の作業は保持しています。${resultUrl?'前回生成したモデルは下のボタンで保存できます。':''}`;
      }
    }finally{
      if(active===job){active=null;onBusy(false);controls();}
    }
  });
  $('#inochi-model-cancel').addEventListener('click',()=>cancel());
  $('#inochi-model-download').addEventListener('click',download);
  controls();return {update,cancel:()=>cancel()};
}
