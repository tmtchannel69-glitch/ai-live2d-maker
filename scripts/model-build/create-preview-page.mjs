#!/usr/bin/env node
// Package this project's bounded CPU renders into a private, offline review page.
// This displays rendered frames; it is not an official Live2D runtime or VTS.
import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,join,extname,relative,isAbsolute,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';

const LABELS={default:'通常','left-closed':'左目を閉じる','left-half':'左目を半分','right-closed':'右目を閉じる','right-half':'右目を半分','both-closed':'両目を閉じる','both-half':'両目を半分','mouth-half':'口を半分開く','mouth-open':'口を開く','both-closed-mouth-open':'両目を閉じて口を開く','head-left':'顔を左へ','head-right':'顔を右へ','both-025':'両目の開き 2.5%','both-05':'両目の開き 5%','both-075':'両目の開き 7.5%','both-10':'両目の開き 10%','both-15':'両目の開き 15%','both-25':'両目の開き 25%','both-75':'両目の開き 75%'};
const MIB=1024*1024;
const require=(ok,message)=>{if(!ok)throw new Error(message);};
async function readBounded(path,max){const stat=await lstat(path);require(stat.isFile() && !stat.isSymbolicLink() && stat.size>0 && stat.size<=max,'入力ファイルの種類またはサイズが正しくありません。');const data=await readFile(path);require(data.length<=max,'入力ファイルが大きすぎます。');return data;}
export async function createPreviewPage({renders,output,work,model}){
  renders=resolve(renders);output=resolve(output);
  output=join(await realpath(dirname(output)),basename(output));
  const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),rel=relative(repo,output);
  require(isAbsolute(rel) || rel==='..' || rel.startsWith('../'),'画像を含む確認ページはGitの外へ保存してください。');
  require(extname(output)==='.html','出力先には新しい.htmlファイルを指定してください。');
  const report=JSON.parse(await readBounded(join(renders,'preview-report.json'),256*1024));
  require(report.format==='ai-live2d-independent-cpu-preview' && report.version===1 && /^[a-f0-9]{64}$/.test(report.model_sha256),'このアプリの描画レポートが必要です。');
  const poses=Object.keys(report.poses||{});require(poses.includes('default') && poses.length<=10 && poses.every(p=>Object.hasOwn(LABELS,p)),'比較する表情の構成が正しくありません。');
  let total=0;const frames={};
  for(const pose of poses){
    frames[pose]={};
    for(const area of ['face','full']){
      const bytes=await readBounded(join(renders,`${area}-${pose}.png`),Math.min(8*MIB,32*MIB-total));total+=bytes.length;
      require(bytes.length>=33 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) && bytes.toString('ascii',12,16)==='IHDR','描画PNGが正しくありません。');
      const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);require(w>0 && h>0 && w<=768 && h<=768 && total<=32*MIB,'描画画像量の上限を超えています。');
      frames[pose][area]='data:image/png;base64,'+bytes.toString('base64');
    }
  }
  const downloads={};
  for(const [key,path] of [['work',work],['model',model]])if(path){const bytes=await readBounded(resolve(path),48*MIB-total);require(bytes.length>=4 && bytes.readUInt32LE(0)===0x04034b50,'作業/モデルにはZIPファイルを指定してください。');total+=bytes.length;require(total<=48*MIB,'確認ページに含めるファイル量が大きすぎます。');downloads[key]='data:application/zip;base64,'+bytes.toString('base64');}
  const blink=report.pose_set==='blink-transitions',labels=blink?{...LABELS,default:'両目の開き 100%','both-closed':'両目の開き 0%','both-half':'両目の開き 50%'}:LABELS;
  const nonce=randomBytes(18).toString('base64'),payload=JSON.stringify({frames,downloads,labels,poseSet:report.pose_set||'default'}).replaceAll('<','\\u003c');
  const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<title>AI Live2D Maker 表情の確認</title><style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:#171722;color:#f5f2fb;font:16px/1.6 system-ui,sans-serif}main{max-width:900px;margin:auto;padding:20px}h1{font-size:23px;margin:0 0 8px}p{margin:8px 0}button,select,a{font:inherit;min-height:48px;border-radius:10px;touch-action:manipulation}button,select{color:inherit;background:#30283e;border:1px solid #89739f;padding:10px}button[aria-pressed=true]{background:#6a4a8e;border-color:#dac4ff}.toolbar,.downloads{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.toolbar label{display:flex;align-items:center;gap:8px;min-width:0}.toolbar label:has(#pose){flex-basis:100%}.toolbar select{min-width:0;flex:1}.board{aspect-ratio:1;max-height:65svh;max-width:100%;margin:auto;display:grid;place-items:center;border-radius:12px;overflow:hidden;background:#fff}.board.checker{background:repeating-conic-gradient(#c4c4ce 0% 25%,#eeeef4 0% 50%) 0 0/24px 24px}.board.black{background:#000}.board img{display:block;width:100%;height:100%;min-height:0;object-fit:contain}.poses{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:14px 0}.muted{font-size:14px;color:#d2c9de}.downloads a{display:inline-flex;align-items:center;background:#503a6a;color:white;padding:10px 14px;text-decoration:none}output{display:block;text-align:center;font-weight:600;padding-top:8px}select{max-width:100%}@media(max-width:360px){main{padding:12px}.poses{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style><main><h1>表情の動き確認（試作）</h1><p>ボタンで表情を切り替えられます。このページだけで開けます。</p><p class="muted">実モデルを描画した画像での比較です。VTube Studioでの実動作と自然さは未確認です。顔・目・肌色にはAI補完による変化があります。</p>
${blink?'<p class="muted">瞬き途中の描画を10段階で比較します。開きは指定値です。モデルの対応範囲によって実際の値は変わります。</p>':''}
<div class="toolbar"><button id="play" type="button">自動で切り替える</button><button id="previous" type="button">前へ</button><button id="next" type="button">次へ</button><label>表情<select id="pose"></select></label><label>表示<select id="area"><option value="face">顔</option><option value="full">全身</option></select></label><label>背景<select id="background"><option value="white">白</option><option value="black">黒</option><option value="checker">市松</option></select></label></div>
<div class="board" id="board"><img id="preview" alt="通常の表情"></div><output id="caption">通常</output><div class="poses" id="poses"></div><div class="downloads" id="downloads"></div><p class="muted" id="save-note" hidden>作業ファイルは元画像と素材を含みます。モデルZIPは作業再開用ではありません。</p></main>
<script nonce="${nonce}" type="application/json" id="data">${payload}</script><script nonce="${nonce}">
const data=JSON.parse(document.querySelector('#data').textContent),$=s=>document.querySelector(s),poseOrder=data.poseSet==='blink-transitions'?['both-closed','both-025','both-05','both-075','both-10','both-15','both-25','both-half','both-75','default'].filter(p=>data.frames[p]):Object.keys(data.frames);let pose='default',timer=null,playing=false,index=0;
const blinkOrder=['default','both-75','both-half','both-25','both-15','both-10','both-075','both-05','both-025','both-closed','both-025','both-05','both-075','both-10','both-15','both-25','both-half','both-75'];
const sequence=(data.poseSet==='blink-transitions'?blinkOrder.map(p=>[p,p==='default'?800:p==='both-closed'?350:200]):[['default',800],['both-half',80],['both-closed',130],['both-half',80],['default',650],['left-half',80],['left-closed',160],['default',650],['mouth-half',200],['mouth-open',300],['mouth-half',160],['default',500],['both-closed-mouth-open',300]]).filter(([p])=>data.frames[p]);
function show(p){pose=p;$('#pose').value=p;$('#preview').src=data.frames[p][$('#area').value];$('#preview').alt=data.labels[p];$('#caption').textContent=data.labels[p];for(const b of $('#poses').children)b.setAttribute('aria-pressed',String(b.dataset.pose===p));}
function stop(){playing=false;clearTimeout(timer);timer=null;$('#play').textContent='自動で切り替える';}
function next(){if(!playing)return;const [p,delay]=sequence[index++%sequence.length];show(p);timer=setTimeout(next,delay);}
function step(direction){stop();show(poseOrder[(poseOrder.indexOf(pose)+direction+poseOrder.length)%poseOrder.length]);}
for(const p of poseOrder){const o=document.createElement('option');o.value=p;o.textContent=data.labels[p];$('#pose').append(o);const b=document.createElement('button');b.type='button';b.dataset.pose=p;b.textContent=data.labels[p];b.onclick=()=>{stop();show(p);};$('#poses').append(b);}
$('#pose').onpointerdown=stop;$('#pose').onchange=()=>{stop();show($('#pose').value);};$('#play').onclick=()=>{if(playing)stop();else{playing=true;index=0;$('#play').textContent='再生を停止';next();}};$('#area').onchange=()=>show(pose);$('#background').onchange=()=>{$('#board').className='board '+$('#background').value;};document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
$('#previous').onclick=()=>step(-1);$('#next').onclick=()=>step(1);
for(const [kind,url] of Object.entries(data.downloads)){const a=document.createElement('a');a.href=url;a.download=kind==='work'?'ai-live2d-generated-work.zip':'ai-live2d-generated-model.zip';a.textContent=kind==='work'?'作業ファイルを保存':'試作モデルを保存';$('#downloads').append(a);$('#save-note').hidden=false;}show(pose);
</script></html>`;
  await writeFile(output,html,{flag:'wx',mode:0o600});
  return {output,poses:poses.length,bytes:Buffer.byteLength(html),containsOriginal:Boolean(work),externalRequests:false};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const args=process.argv.slice(2),[renders,output,...options]=args;require(renders && output && options.length%2===0,'使い方: create-preview-page.mjs RENDERS NEW.html [--work WORK.zip] [--model MODEL.zip]');const paths={};for(let i=0;i<options.length;i+=2){require(['--work','--model'].includes(options[i]) && !Object.hasOwn(paths,options[i].slice(2)),'指定するオプションが正しくありません。');paths[options[i].slice(2)]=options[i+1];}console.log(JSON.stringify(await createPreviewPage({renders,output,...paths})));}catch(e){console.error(e.message);process.exitCode=1;}
}
