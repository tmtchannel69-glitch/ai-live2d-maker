import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,readdir,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,relative,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {zipSync,strToU8} from 'fflate';
import {prepareModelPsd} from './prepare.mjs';
const MIB=1024*1024;
export function runTool(command,args,{signal,timeout=180_000}={}){
  return new Promise((res,rej)=>{
    if(signal?.aborted){rej(new Error('生成を中止しました。'));return;}
    const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});let log='',done=false;
    const kill=()=>{try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL');}catch{}};
    const stop=()=>{kill();finish(new Error('生成を中止しました。'));};
    const timer=setTimeout(()=>{kill();finish(new Error('生成が制限時間を超えました。'));},timeout);
    const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);error?rej(error):res(log);};
    signal?.addEventListener('abort',stop,{once:true});
    child.stdout.on('data',b=>{if(log.length<512*1024)log+=b.toString().slice(0,512*1024-log.length);});
    child.stderr.on('data',()=>{}); // Runtime diagnostics must not contaminate the JSON on stdout.
    child.on('error',()=>finish(new Error('生成ツールを起動できませんでした。設定を確認してください。')));
    child.on('close',code=>finish(code===0?null:new Error(`生成ツールが終了しました（終了コード ${code}）。`)));
  });
}
async function outputFiles(root){
  const entries={};let total=0;
  async function walk(path){for(const item of await readdir(path,{withFileTypes:true})){
    const full=join(path,item.name),s=await lstat(full);if(s.isSymbolicLink())throw new Error('出力のリンクは使用できません。');
    if(s.isDirectory()){if(relative(root,full).split(/[\\/]/).length>5)throw new Error('出力の階層が深すぎます。');await walk(full);}
    else if(s.isFile()){total+=s.size;if(total>100*MIB || Object.keys(entries).length>=128)throw new Error('モデル出力の上限を超えました。');entries[relative(root,full).split('\\').join('/')]=new Uint8Array(await readFile(full));}
  }}await walk(root);return entries;
}
export function checkModelFiles(entries){
  const manifests=Object.keys(entries).filter(n=>n.endsWith('.model3.json'));if(manifests.length!==1)throw new Error('model3.jsonを一つ出力する必要があります。');
  const name=manifests[0];if(entries[name].length>256*1024)throw new Error('モデル設定が大きすぎます。');
  let meta;try{meta=JSON.parse(new TextDecoder().decode(entries[name]));}catch{throw new Error('モデル設定のJSONが正しくありません。');}
  const refs=meta.FileReferences;if(meta.Version!==3 || !refs || typeof refs.Moc!=='string' || !Array.isArray(refs.Textures) || !refs.Textures.length || refs.Textures.length>16)throw new Error('モデルの必須参照がありません。');
  const base=dirname(name)==='.'?'':dirname(name)+'/';
  const check=(p)=>{if(typeof p!=='string' || !p || p.length>240 || isAbsolute(p) || /[\\:\x00-\x1f?#]/.test(p) || p.split('/').some(s=>!s || s==='.' || s==='..') || !entries[base+p])throw new Error('モデル参照先が正しくないか、ファイルが不足しています。');return entries[base+p];};
  const moc=check(refs.Moc);if(moc.length<64 || new TextDecoder().decode(moc.subarray(0,4))!=='MOC3')throw new Error('MOC3のヘッダーがありません。');
  for(const p of refs.Textures){const b=check(p);if(b.length<33 || [137,80,78,71,13,10,26,10].some((v,i)=>v!==b[i]))throw new Error('テクスチャPNGが正しくありません。');const dv=new DataView(b.buffer,b.byteOffset,b.byteLength),w=dv.getUint32(16),h=dv.getUint32(20);if(!w || !h || w>4096 || h>4096)throw new Error('テクスチャのサイズが制限を超えています。');}
  for(const key of ['Physics','Pose','DisplayInfo','UserData'])if(refs[key]){const b=check(refs[key]);if(b.length>2*MIB)throw new Error('参照JSONが大きすぎます。');JSON.parse(new TextDecoder().decode(b));}
  for(const e of refs.Expressions||[])check(e.File);
  for(const list of Object.values(refs.Motions||{}))for(const m of list){check(m.File);if(m.Sound)check(m.Sound);}
  return {model:name,moc:base+refs.Moc,textures:refs.Textures.length,structureChecked:true,officialCoreTested:false,vtubeStudioTested:false};
}
export async function buildModel(bytes,{binary,validator=[],signal}={}){
  if(process.platform!=='linux')throw new Error('モデル生成サーバーの試作はLinux環境に対応しています。出力モデルのWindows/VTube Studio読込は別途確認してください。');
  if(!binary)throw new Error('モデル生成ツールが未設定です。');
  if(!Array.isArray(validator) || validator.some(v=>typeof v!=='string') || validator.length>16)throw new Error('検証ツールの設定が正しくありません。');
  const prepared=prepareModelPsd(bytes),work=await mkdtemp(join(tmpdir(),'ai-live2d-build-'));
  try{
    const input=join(work,'character.psd'),out=join(work,'model');await writeFile(input,prepared.psd,{mode:0o600});
    await runTool(binary,['--input',input,'--output',out,'--atlas','1024','--upscale','1','--no-motions'],{signal});
    if(signal?.aborted)throw new Error('生成を中止しました。');
    const entries=await outputFiles(out),checked=checkModelFiles(entries);let runtime=null;
    if(validator.length){const log=await runTool(validator[0],[...validator.slice(1),resolve(out,checked.moc)],{signal});try{runtime=JSON.parse(log);}catch{throw new Error('独立ランタイムの検証結果を読み込めませんでした。');}if(runtime.model_sha256!==createHash('sha256').update(entries[checked.moc]).digest('hex'))throw new Error('独立ランタイムの検証結果とモデル本体が一致しません。');if(!Array.isArray(runtime.texture_indices) || !runtime.texture_indices.length)throw new Error('独立ランタイムのテクスチャ番号がありません。');if(runtime.texture_indices.some(i=>!Number.isInteger(i) || i<0 || i>=checked.textures))throw new Error('モデルのテクスチャ番号が範囲外です。');if(runtime.consistency!==true || runtime.finite_default_and_all_parameter_extrema!==true || !Number.isInteger(runtime.drawable_count) || runtime.drawable_count<=0)throw new Error('独立ランタイムの検証に失敗しました。');}
    if(runtime?.file)runtime.file=checked.moc;
    const report={format:'ai-live2d-maker-model-build-report',version:1,compiler:'psd2live external experimental CLI',...checked,independentRuntime:runtime,preparation:prepared.report};
    entries['AI_LIVE2D_BUILD_REPORT.json']=strToU8(JSON.stringify(report,null,2));entries['AI_LIVE2D_README.txt']=strToU8('実験的な自動モデル生成の出力です。モデル本体と設定・テクスチャを生成しました。公式Cubism Core/VTube Studioでの読込と表情品質は未確認です。詳細はAI_LIVE2D_BUILD_REPORT.jsonを参照してください。元の作業へ戻るには別途保存した作業ZIPを使います。アプリのメッシュ/範囲/親子キーを転写したモデルではありません。');
    return {zip:zipSync(entries,{level:0}),report};
  }finally{await rm(work,{recursive:true,force:true});}
}
