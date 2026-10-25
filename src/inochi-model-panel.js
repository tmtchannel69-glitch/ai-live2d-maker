import {readModelArchive} from './inochi-model-download.js';
const MODES={five:{name:'従来の5パーツ',file:'inochi2d-character.zip'},'detailed-head':{name:'頭・首・胴体を分ける試作',file:'inochi2d-head-neck-body.zip'}};

// This panel only exports an independent model. It never replaces the current
// parts, expression assets, prompts, or saved project format.
export function createInochiModelPanel({getState,onBusy}){
  const section=document.createElement('section');
  section.className='panel inochi-model-panel';
  section.setAttribute('aria-labelledby','inochi-model-title');
  section.innerHTML=`<h2 id="inochi-model-title">画像1枚から動くモデルを作る</h2>
    <label for="inochi-model-mode">生成するモデル</label><select id="inochi-model-mode"><option value="five">従来の5パーツで作る</option><option value="detailed-head">頭・首・胴体を分ける（実験）</option></select>
    <p id="inochi-model-mode-info"></p>
    <p class="inochi-format-note">出力はInochi2D用のINP・INXです。Live2D Cubism・VTube Studio用のモデルとは異なります。</p>
    <p class="muted">正面・1人の画像向けの実験機能です。目・髪などの分離や隠れた部分の補完には限界があり、元の絵と異なる箇所や不自然な動きが残ることがあります。生成時だけ、画像をこのアプリの開発用サーバーへ送って一時処理します。</p>
    <div class="inochi-model-actions"><button id="inochi-model-check" class="secondary">ローカル処理の準備状況を確認</button><button id="inochi-model-start" class="primary" disabled>画像からInochi2Dモデルを生成</button><button id="inochi-model-cancel" class="secondary" hidden>生成を中止</button></div>
    <progress id="inochi-model-progress" aria-label="Inochi2Dモデルを生成中" hidden></progress>
    <p id="inochi-model-status" role="status" aria-live="polite">まずはキャラクター画像を選択してください。</p>
    <details><summary>準備ができていない場合</summary><p>PCのローカルサーバーと画像処理用ライブラリ、顔検出・背景除去のモデルが必要です。詳細モードはSAM2.1の重みも使います。READMEの「詳細モードの準備」に沿って配置してください。この画面からモデルは自動取得しません。</p></details>
    <div id="inochi-model-result" hidden><h3>生成したモデル</h3><p id="inochi-model-result-kind"></p><p>モデルと生成パーツ・設定・検証レポートをZIPで保存します。元の画像ファイルは含みません。Inochi Creator 0.8.6で見た目と動きを確認してください。</p><button id="inochi-model-download" class="secondary">生成済みのモデルZIPを保存</button></div>`;
  document.querySelector('.workspace').after(section);
  const $=selector=>section.querySelector(selector);
  let source=getState().file,active=null,result=null,retry=false;
  const endpoint=(name,mode)=>`/api/inochi2d/${name}${mode==='five'?'':'?mode='+encodeURIComponent(mode)}`;
  function modeInfo(){
    $('#inochi-model-mode-info').textContent=$('#inochi-model-mode').value==='detailed-head'?'顔・目元・髪の候補と頭・首・胴体を自動で分け、胴体を固定した頭の小さな移動・傾きを試作します。全身のリギングや顔の立体的な向き、髪の前後関係の完成を保証するものではありません。点・枠の指定は不要です。':'顔・左右の目・閉じたまぶたの5パーツで、まばたきと顔の左右移動を試作します。画像の選択後、この欄の生成ボタンを押してください。切り抜く場所の指定や手動のリギングは不要です。';
  }

  function controls(){
    const state=getState();
    $('#inochi-model-start').disabled=!state.file || state.locked || Boolean(active);
    $('#inochi-model-mode').disabled=state.locked||Boolean(active);
    $('#inochi-model-check').disabled=state.locked||Boolean(active);
    $('#inochi-model-start').textContent=retry?'もう一度Inochi2Dモデルを生成':'画像からInochi2Dモデルを生成';
    $('#inochi-model-cancel').hidden=!active;
    $('#inochi-model-progress').hidden=!active;
    $('#inochi-model-result').hidden=!result;
    $('#inochi-model-result-kind').textContent=result?`前回の出力: ${MODES[result.mode].name}`:'';
    $('#inochi-model-download').disabled=Boolean(active) || state.locked;
    section.setAttribute('aria-busy',String(Boolean(active)));
  }
  function clearResult(){if(result)URL.revokeObjectURL(result.url);result=null;retry=false;}
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
    if(!result || active || getState().locked)return;
    const link=document.createElement('a');link.href=result.url;link.download=MODES[result.mode].file;
    document.body.append(link);link.click();link.remove();
  }
  async function responseError(response,fallback){
    try{const body=await response.json();if(typeof body.error==='string')return body.error;}catch{}
    return fallback;
  }
  async function start(checkOnly=false){
    const state=getState();if(active || state.locked || (!checkOnly&&!state.file))return;
    const job={file:state.file,mode:$('#inochi-model-mode').value,checkOnly,control:new AbortController()};active=job;retry=false;
    onBusy(true);controls();$('#inochi-model-status').textContent='自動生成の準備を確認しています…';
    const current=()=>active===job && getState().file===job.file && !job.control.signal.aborted;
    try{
      const readiness=await fetch(endpoint('status',job.mode),{signal:job.control.signal,cache:'no-store'});
      if(!readiness.ok)throw new Error(await responseError(readiness,'生成サーバーへ接続できません。開発用サーバーの起動手順を確認してください。画像は送信していません。'));
      const status=await readiness.json();if(!current())return;
      if(status.configured!==true)throw new Error(`自動生成サーバーが未設定です。${typeof status.reason==='string'?status.reason.slice(0,2000):'開発用の起動手順を確認してください。'}画像は送信していません。`);
      if(job.mode==='detailed-head'&&status.mode!==job.mode)throw new Error('サーバーが詳細モードに対応していません。更新して再起動してください。画像は送信していません。');
      if(status.busy)throw new Error('生成サーバーが処理中です。少し待ってから、もう一度お試しください。画像は送信していません。');
      if(checkOnly){$('#inochi-model-status').textContent=`${MODES[job.mode].name}の準備ができています。画像は送信していません。生成ボタンを押すと処理を開始します。`;return;}
      $('#inochi-model-status').textContent=job.mode==='five'?'パーツ分離・動きの設定・Inochi2Dモデルを自動生成しています。数分かかることがあります…':'頭・首・胴体を分け、まばたきと頭の動きを自動生成しています。ローカル処理には数分かかることがあります…';
      const response=await fetch(endpoint('generate',job.mode),{method:'POST',headers:{'Content-Type':job.file.type},body:job.file,signal:job.control.signal});
      if(!response.ok)throw new Error(await responseError(response,'Inochi2Dモデルの生成に失敗しました。'));
      if(response.headers.get('Content-Type')?.split(';')[0].trim()!=='application/zip')throw new Error('モデルの応答形式が正しくありません。');
      const output=await readModelArchive(response,{signal:job.control.signal});if(!current())return;
      clearResult();result={url:URL.createObjectURL(output),mode:job.mode};
      $('#inochi-model-status').textContent=`Inochi2Dモデルを生成しました。${job.mode==='detailed-head'?'頭の動きだけの試作で、胴体は固定です。':''}ZIP内の検証レポートを確認し、Inochi Creator 0.8.6で開いてください。この画像の自然な表情や、公式Creatorでの動作を自動的に確認済みとは判定していません。`;
    }catch(error){
      if(current()){
        retry=true;
        const message=error instanceof TypeError?'生成サーバーへ接続できませんでした。開発用サーバーの起動を確認してください。':error.message;
        $('#inochi-model-status').textContent=`${message} 現在の作業は保持しています。${result?'前回生成したモデルは下のボタンで保存できます。':''}`;
      }
    }finally{
      if(active===job){active=null;onBusy(false);controls();}
    }
  }
  $('#inochi-model-start').addEventListener('click',()=>start());
  $('#inochi-model-check').addEventListener('click',()=>start(true));
  $('#inochi-model-mode').addEventListener('change',()=>{cancel();modeInfo();retry=false;$('#inochi-model-status').textContent='選んだモードの準備を確認できます。生成ボタンを押すまで画像は送信しません。';controls();});
  $('#inochi-model-cancel').addEventListener('click',()=>cancel());
  $('#inochi-model-download').addEventListener('click',download);
  modeInfo();controls();return {update,cancel:()=>cancel()};
}
